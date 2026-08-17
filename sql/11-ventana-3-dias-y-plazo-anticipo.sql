-- =====================================================================
-- RomaDetalles — ventana de ocupación de 3 días y plazo del anticipo
-- =====================================================================
-- Dos cambios que tocan el stock, así que conviene leerlos juntos.
--
-- 1) La ventana de ocupación pasa de 2 días a 3.
--    Un evento el 24 saca el artículo del catálogo el 23 (se recoge), el
--    24 (se usa) y el 25 (se entrega). Antes solo bloqueaba 23 y 24.
--
--    CONSECUENCIA, a sabiendas: dos eventos separados por un solo día
--    libre dejan de poder compartir artículo. Evento el 24 → [23,25];
--    evento el 26 → [25,27]; chocan el 25. Físicamente cabría (se
--    entrega la mañana del 25 y se recoge esa tarde) pero el modelo
--    cuenta días completos. Es el comportamiento pedido.
--
-- 2) El plazo para pagar el anticipo lo decide cada negocio.
--    Antes toda reserva pendiente retenía el stock 30 minutos fijos.
--    Ahora son horas_reserva (12 por defecto). Pasado el plazo la
--    consulta de disponibilidad deja de contarla y el artículo vuelve a
--    estar libre — eso ya funcionaba así, lo que cambia es quién manda.
--
-- Idempotente.
--
-- OJO AL DESPLEGAR: cambia la FIRMA de alquiler_crear_pedido (se le cae
-- p_minutos_reserva, que ahora sale de la configuración del negocio).
-- Correr esto y desplegar la Edge Function seguido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cuántas horas espera el negocio por el anticipo
-- ---------------------------------------------------------------------
-- 12 h por defecto en vez de los 30 minutos de antes: media hora era
-- razonable para "no abandonar el carrito", pero no para que alguien
-- llegue a un cajero o haga una transferencia.
alter table alquiler_negocios
  add column if not exists horas_reserva int not null default 12;

do $$
begin
  alter table alquiler_negocios
    add constraint alquiler_negocios_horas_reserva
    check (horas_reserva between 1 and 168);
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Reservas futuras que ya existen: ampliarles la ventana
-- ---------------------------------------------------------------------
-- Solo las que siguen en pie y son de hoy en adelante. Las pasadas se
-- dejan como quedaron: son historia y cambiarlas falsearía la Ocupación.
-- Solo las de dias = 1: las viejas de varios días tienen su propio rango
-- y no siguen este modelo.
-- Se recalculan las DOS puntas, no solo fecha_fin: hay reservas heredadas
-- del modelo viejo por rango donde fecha_evento se rellenó con
-- fecha_inicio (ver sql/06), así que les falta también el día de
-- recogida. Corregir solo el final las dejaría bloqueando [evento,
-- evento+1] en vez de los tres días.
update alquiler_pedidos
   set fecha_inicio = fecha_evento - 1,
       fecha_fin    = fecha_evento + 1,
       actualizado_en = now()
 where dias = 1
   and fecha_evento >= current_date
   and estado in ('pendiente', 'confirmado')
   and (fecha_inicio <> fecha_evento - 1 or fecha_fin <> fecha_evento + 1);

-- ---------------------------------------------------------------------
-- 3. Crear pedido — ventana de 3 días y plazo del negocio
-- ---------------------------------------------------------------------
drop function if exists alquiler_crear_pedido(uuid,text,text,text,date,jsonb,int);

create or replace function alquiler_crear_pedido(
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

  -- Los tres días que el artículo está fuera: la víspera se recoge, el
  -- día del evento se usa, y al día siguiente se entrega.
  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

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
    -- El plazo que el negocio decidió para ver el anticipo.
    now() + make_interval(hours => v_negocio.horas_reserva)
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

revoke all on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb)
  from public, anon, authenticated;
grant execute on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb)
  to service_role;

-- ---------------------------------------------------------------------
-- 4. Reserva manual — misma ventana de 3 días
-- ---------------------------------------------------------------------
-- Nace confirmada, así que no le aplica el plazo del anticipo.
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

  select * into v_negocio from alquiler_negocios where id = p_negocio;
  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

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
-- 5. Editar pedido — misma ventana de 3 días
-- ---------------------------------------------------------------------
-- Igual que la versión de sql/09, cambiando solo v_fin.
create or replace function alquiler_editar_pedido(
  p_pedido   text,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb default null,
  p_token    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido   alquiler_pedidos;
  v_negocio  alquiler_negocios;
  v_es_admin boolean;
  v_items    jsonb;
  v_previos  jsonb;
  v_inicio   date;
  v_fin      date;
  v_total    numeric(12,2) := 0;
  v_item     jsonb;
  v_prod     alquiler_productos;
  v_pedida   int;
  v_disp     int;
  v_precio   numeric(12,2);
begin
  select * into v_pedido from alquiler_pedidos where id = p_pedido;
  if not found then
    raise exception 'PEDIDO_NO_EXISTE';
  end if;

  v_es_admin := alquiler_es_admin(v_pedido.negocio_id);
  if not v_es_admin
     and (p_token is null or p_token = '' or p_token <> v_pedido.token_acceso) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if not v_es_admin then
    p_nombre := null;
    p_items  := null;
  end if;

  if v_pedido.estado not in ('pendiente', 'confirmado') then
    raise exception 'RESERVA_NO_EDITABLE';
  end if;

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  if p_evento <> v_pedido.fecha_evento and p_evento < current_date then
    raise exception 'FECHA_PASADA';
  end if;

  select * into v_negocio from alquiler_negocios where id = v_pedido.negocio_id;

  perform pg_advisory_xact_lock(hashtextextended(v_pedido.negocio_id::text, 0));

  v_items := coalesce(
    p_items,
    (
      select jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad))
      from alquiler_pedido_items where pedido_id = p_pedido
    )
  );

  if v_items is null or jsonb_array_length(v_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  select jsonb_object_agg(producto_id::text, precio_dia) into v_previos
  from alquiler_pedido_items where pedido_id = p_pedido;

  v_inicio := p_evento - 1;
  v_fin    := p_evento + 1;

  delete from alquiler_pedido_items where pedido_id = p_pedido;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = v_pedido.negocio_id;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> p_pedido
      and ped.negocio_id = v_pedido.negocio_id
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
      and (
        ped.estado in ('confirmado', 'entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    v_precio := coalesce((v_previos->>v_prod.id::text)::numeric, v_prod.precio_dia);

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (p_pedido, v_prod.id, v_prod.nombre, v_precio, v_pedida);

    v_total := v_total + (v_precio * v_pedida);
  end loop;

  update alquiler_pedidos
     set cliente_nombre   = coalesce(nullif(trim(p_nombre), ''), cliente_nombre),
         cliente_telefono = coalesce(p_telefono, cliente_telefono),
         notas            = coalesce(p_notas, notas),
         fecha_evento     = p_evento,
         fecha_inicio     = v_inicio,
         fecha_fin        = v_fin,
         dias             = 1,
         total            = v_total,
         anticipo         = alquiler_anticipo(
                              v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
                            ),
         estado           = case when v_es_admin then estado else 'pendiente' end,
         -- Si edita la clienta vuelve a empezar el plazo del anticipo,
         -- con las horas que tenga puestas el negocio.
         expira_en        = case
                              when v_es_admin then expira_en
                              else now() + make_interval(hours => v_negocio.horas_reserva)
                            end,
         actualizado_en   = now()
   where id = p_pedido;
end;
$$;

grant execute on function alquiler_editar_pedido(text,text,text,text,date,jsonb,text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. La reserva por token devuelve hasta cuándo hay plazo
-- ---------------------------------------------------------------------
-- Sin esto la clienta no sabe que su reserva tiene fecha de caducidad.
drop function if exists alquiler_pedido_por_token(text);

create or replace function alquiler_pedido_por_token(p_token text)
returns table (
  pedido_id         text,
  fecha_evento      date,
  fecha_inicio      date,
  fecha_fin         date,
  dias              int,
  total             numeric,
  anticipo          numeric,
  estado            text,
  expira_en         timestamptz,
  cliente_telefono  text,
  notas             text,
  moneda            text,
  negocio_nombre    text,
  negocio_whatsapp  text,
  negocio_direccion text,
  items             jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.fecha_evento,
    p.fecha_inicio,
    p.fecha_fin,
    p.dias,
    p.total,
    p.anticipo,
    p.estado,
    p.expira_en,
    p.cliente_telefono,
    p.notas,
    n.moneda,
    n.nombre,
    n.whatsapp,
    n.direccion,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'producto_nombre', i.producto_nombre,
            'cantidad', i.cantidad,
            'precio_dia', i.precio_dia
          )
          order by i.id
        )
        from alquiler_pedido_items i
        where i.pedido_id = p.id
      ),
      '[]'::jsonb
    )
  from alquiler_pedidos p
  join alquiler_negocios n on n.id = p.negocio_id
  where p.token_acceso = p_token;
$$;

grant execute on function alquiler_pedido_por_token(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Cancelar solas las vencidas — CORRER APARTE
-- ---------------------------------------------------------------------
-- Va en su propio bloque a propósito: si pg_cron no está habilitado esto
-- falla, y no queremos que ese fallo tumbe la migración de arriba (el
-- editor de Supabase envuelve el script en una transacción).
--
-- El stock ya se libera solo al vencer — alquiler_disponibilidad no
-- cuenta las pendientes caducadas — así que esto no arregla stock: evita
-- que las abandonadas se acumulen para siempre en la pestaña Pendientes.
--
-- El margen de 1 hora sobre el vencimiento evita cancelarle la reserva a
-- una clienta justo mientras la dueña la está confirmando.
--
--   -- Habilitar pg_cron primero si hace falta:
--   --   Dashboard → Database → Extensions → pg_cron
--
--   select cron.unschedule('romadetalles-vencer-pendientes')
--    where exists (select 1 from cron.job
--                   where jobname = 'romadetalles-vencer-pendientes');
--
--   select cron.schedule(
--     'romadetalles-vencer-pendientes',
--     '7 * * * *',
--     $cron$
--     update alquiler_pedidos
--        set estado = 'cancelado', actualizado_en = now()
--      where estado = 'pendiente'
--        and expira_en < now() - interval '1 hour';
--     $cron$
--   );
