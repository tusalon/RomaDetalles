-- =====================================================================
-- RomaDetalles — día del evento, anticipo configurable y datos de pago
-- =====================================================================
-- Idempotente.
--
-- OJO AL DESPLEGAR: este script cambia la FIRMA de alquiler_crear_pedido
-- y alquiler_crear_pedido_manual (reciben p_evento en vez de
-- p_inicio/p_fin). Entre correr esto y desplegar la Edge Function nueva,
-- la Edge Function vieja llamaría a una firma que ya no existe. Correr
-- el SQL y desplegar la función seguido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
-- fecha_evento: el día del evento de la clienta. El rango
-- fecha_inicio/fecha_fin se sigue guardando, derivado de esta fecha,
-- porque es la ventana real en que el artículo está fuera y es lo que
-- usa alquiler_disponibilidad para detectar solapamientos.
alter table alquiler_pedidos
  add column if not exists fecha_evento date;

-- Relleno para pedidos que ya existen. Para pedidos viejos de varios
-- días la fecha es aproximada, pero son históricos y su rango original
-- se conserva intacto.
update alquiler_pedidos
   set fecha_evento = fecha_inicio
 where fecha_evento is null;

alter table alquiler_pedidos
  alter column fecha_evento set not null;

alter table alquiler_pedidos
  add column if not exists anticipo numeric(12,2) not null default 0;

alter table alquiler_negocios
  add column if not exists anticipo_porciento int not null default 0;

do $$
begin
  alter table alquiler_negocios
    add constraint alquiler_negocios_anticipo_pct
    check (anticipo_porciento between 0 and 100);
exception
  when duplicate_object then null;
end $$;

alter table alquiler_negocios
  add column if not exists anticipo_redondear boolean not null default true;

alter table alquiler_negocios
  add column if not exists pago_tarjeta text not null default '';

alter table alquiler_negocios
  add column if not exists pago_telefono text not null default '';

-- ---------------------------------------------------------------------
-- 2. Cálculo del anticipo — una sola fuente de verdad
-- ---------------------------------------------------------------------
-- Dos guardas que importan:
--   · Nunca 0 por redondeo: un anticipo real de 40 CUP no puede
--     convertirse en "no pagues nada" al redondear a la centena.
--   · Nunca mayor que el total.
create or replace function alquiler_anticipo(
  p_total     numeric,
  p_porciento int,
  p_redondear boolean
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_porciento, 0) <= 0 or coalesce(p_total, 0) <= 0 then 0::numeric
    when coalesce(p_redondear, true) then
      least(
        p_total,
        case
          when round((p_total * p_porciento / 100.0) / 100) * 100 = 0
            then round(p_total * p_porciento / 100.0, 2)
          else round((p_total * p_porciento / 100.0) / 100) * 100
        end
      )
    else least(p_total, round(p_total * p_porciento / 100.0, 2))
  end::numeric(12,2);
$$;

grant execute on function alquiler_anticipo(numeric,int,boolean)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Creación de pedido — ahora por día de evento
-- ---------------------------------------------------------------------
-- Postgres no permite CREATE OR REPLACE con firma distinta, así que hay
-- que soltar las versiones viejas. Al soltarlas se pierden sus grants,
-- por eso se vuelven a otorgar más abajo.
drop function if exists alquiler_crear_pedido(uuid,text,text,text,date,date,jsonb,int);
drop function if exists alquiler_crear_pedido_manual(uuid,text,text,text,date,date,jsonb);

create or replace function alquiler_crear_pedido(
  p_negocio    uuid,
  p_nombre     text,
  p_telefono   text,
  p_notas      text,
  p_evento     date,
  p_items      jsonb,
  p_minutos_reserva int default 30
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  select * into v_negocio
  from alquiler_negocios
  where id = p_negocio and activo = true;

  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  -- La ventana real de ocupación: la clienta recoge la tarde anterior y
  -- entrega la mañana siguiente. Guardarla como [evento-1, evento] hace
  -- que el solapamiento que ya usa alquiler_disponibilidad acierte en
  -- los dos casos que importan: dos eventos en días seguidos se pisan
  -- (bloqueado), dos eventos separados por 2 días no (permitido).
  v_inicio := p_evento - 1;
  v_fin    := p_evento;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'pendiente', coalesce(p_notas, ''),
    now() + make_interval(mins => p_minutos_reserva)
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio
      and activo = true;

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
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
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

    -- Un evento = un precio. Ya no se multiplica por días.
    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb,int)
  from public, anon, authenticated;
grant execute on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb,int)
  to service_role;

-- Hermana de la anterior, para la reserva que el dueño crea a mano.
-- Nace 'confirmado' porque el trato ya se cerró en persona.
create or replace function alquiler_crear_pedido_manual(
  p_negocio  uuid,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
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

  select * into v_negocio
  from alquiler_negocios
  where id = p_negocio;

  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  v_inicio := p_evento - 1;
  v_fin    := p_evento;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'confirmado', coalesce(p_notas, ''),
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
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
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

    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function alquiler_crear_pedido_manual(uuid,text,text,text,date,jsonb)
  from public, anon;
grant execute on function alquiler_crear_pedido_manual(uuid,text,text,text,date,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------
-- 4. Plantilla de solicitud — nuevas variables
-- ---------------------------------------------------------------------
-- Se cambia el DEFAULT (para negocios nuevos) y se actualizan solo las
-- filas que todavía tienen el texto por defecto viejo palabra por
-- palabra, es decir, las que nunca lo personalizaron. Un negocio que sí
-- lo editó conserva el suyo intacto.
alter table alquiler_negocios
  alter column plantilla_solicitud set default
    'Hola, deseo solicitar este alquiler ({pedido_id}):' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.';

update alquiler_negocios
   set plantilla_solicitud =
    'Hola, deseo solicitar este alquiler ({pedido_id}):' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.'
 where plantilla_solicitud =
    'Hola, deseo solicitar este alquiler ({pedido_id}):' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total estimado: {total}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.';
