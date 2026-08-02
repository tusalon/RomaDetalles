-- =====================================================================
-- RomaDetalles — reserva manual del admin, compartir tienda,
-- fix del bug de Ocupación
-- =====================================================================
-- Idempotente.
--
-- OJO: alquiler_crear_pedido_manual() se reemplaza otra vez en sql/06
-- con una firma distinta (p_evento en vez de p_inicio/p_fin). No correr
-- este archivo solo para "arreglar" algo puntual sin correr también el
-- 06 después — resucitaría la versión vieja, que ni siquiera guarda
-- fecha_evento (violaría el NOT NULL en el insert).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plantilla de mensaje para compartir la tienda
-- ---------------------------------------------------------------------
alter table alquiler_negocios
  add column if not exists plantilla_compartir text not null default
    '✨ Alquila tu decoración con {nombre} ✨' || chr(10) ||
    'Elige tus fechas y arma tu combo aquí: {enlace}';

-- ---------------------------------------------------------------------
-- 2. FIX del bug real: LEAST/GREATEST en Postgres ignoran los NULL en
--    vez de propagarlos (a diferencia de casi cualquier otro operador).
--    Cuando un producto no tenía NINGUNA reserva confirmada, el LEFT
--    JOIN dejaba ped.fecha_fin/fecha_inicio en NULL, y
--    LEAST(NULL, p_hasta) devolvía p_hasta (no NULL) — así que la resta
--    de fechas colapsaba al rango completo elegido (ej. 30 días de
--    julio) en vez de 0. La corrección: solo sumar la duración cuando
--    ped.id realmente existe (hay una reserva que sí calza).
-- ---------------------------------------------------------------------
create or replace function alquiler_ocupacion(
  p_negocio uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  producto_id     uuid,
  producto_nombre text,
  veces_alquilado bigint,
  dias_alquilado  bigint,
  ingreso         numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.nombre,
    count(distinct ped.id),
    coalesce(sum(
      case when ped.id is not null then
        (least(ped.fecha_fin, p_hasta) - greatest(ped.fecha_inicio, p_desde) + 1)
        * i.cantidad
      else 0 end
    ), 0),
    coalesce(sum(i.precio_dia * i.cantidad * ped.dias), 0)
  from alquiler_productos p
  left join alquiler_pedido_items i on i.producto_id = p.id
  left join alquiler_pedidos ped
         on ped.id = i.pedido_id
        and ped.estado in ('confirmado','entregado','devuelto')
        and ped.fecha_inicio <= p_hasta
        and ped.fecha_fin    >= p_desde
  where p.negocio_id = p_negocio
  group by p.id, p.nombre
  order by 4 desc nulls last;
$$;

-- ---------------------------------------------------------------------
-- 3. Reserva manual del admin (clienta sin internet)
-- ---------------------------------------------------------------------
-- Hermana de alquiler_crear_pedido(), NO la misma función: esa la usa
-- exclusivamente la Edge Function pública con service_role. Esta la
-- ejecuta el propio dueño autenticado (comprobado con alquiler_es_admin
-- adentro, no confiando en RLS de la tabla). Diferencia clave: nace
-- 'confirmado' directo, porque el trato ya se cerró en persona — no
-- tiene sentido una reserva "pendiente" de algo que ya se acordó.
create or replace function alquiler_crear_pedido_manual(
  p_negocio  uuid,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_inicio   date,
  p_fin      date,
  p_items    jsonb
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dias      int;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  if not alquiler_es_admin(p_negocio) then
    raise exception 'NO_AUTORIZADO';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  v_dias := (p_fin - p_inicio) + 1;
  if v_dias < 1 or v_dias > 60 then
    raise exception 'PERIODO_INVALIDO';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_inicio, p_fin, v_dias, 0, 'confirmado', coalesce(p_notas, ''),
    now()
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio <= p_fin
      and ped.fecha_fin    >= p_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (v_pedido_id, v_prod.id, v_prod.nombre, v_prod.precio_dia, v_pedida);

    v_total := v_total + (v_prod.precio_dia * v_pedida * v_dias);
  end loop;

  update alquiler_pedidos
     set total = v_total, actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

-- Solo el dueño autenticado puede llamarla (la comprobación real está
-- adentro con alquiler_es_admin; este grant solo evita que anon lo intente).
revoke all on function alquiler_crear_pedido_manual(uuid,text,text,text,date,date,jsonb) from public, anon;
grant  execute on function alquiler_crear_pedido_manual(uuid,text,text,text,date,date,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Cron del recordatorio — correr UNA VEZ, ajustando la hora si hace
--    falta (ver nota de zona horaria en la Edge Function).
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'romadetalles-recordatorio-manana',
--   '0 21 * * *',  -- 21:00 UTC = 17:00 Cuba (UTC-4). Ajustar si cambia el horario de verano.
--   $$
--   select net.http_post(
--     url := 'https://zorhclhvykikaachfrmp.supabase.co/functions/v1/recordatorio-reservas-manana',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ANON_KEY_AQUI',
--       'apikey', 'ANON_KEY_AQUI'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
-- (Reemplazar ANON_KEY_AQUI por la misma anon key que ya está en
-- utils/supabase-config.js — es pública, no un secreto. La función en sí
-- usa SUPABASE_SERVICE_ROLE_KEY por dentro para leer/escribir, igual que
-- recordatorio-turnos de rservasroma.)
