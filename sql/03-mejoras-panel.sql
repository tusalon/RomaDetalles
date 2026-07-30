-- =====================================================================
-- RomaDetalles — mejoras de panel: logo, mensaje de confirmación,
-- inventario "fuera de servicio"
-- =====================================================================
-- Idempotente: usa IF NOT EXISTS / OR REPLACE en todo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Logo del negocio y plantilla de mensaje de confirmación
-- ---------------------------------------------------------------------
alter table alquiler_negocios
  add column if not exists logo_url text not null default '';

alter table alquiler_negocios
  add column if not exists plantilla_confirmacion text not null default
    'Hola {nombre}, tu pedido {pedido_id} quedó confirmado ✅' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    'Cualquier duda me avisas. ¡Gracias por tu preferencia!';

-- ---------------------------------------------------------------------
-- 2. Unidades "fuera de servicio" (reparación, prestado fuera del
--    sistema, etc.) — se restan de lo disponible igual que una reserva,
--    sin necesidad de crear un pedido con fechas.
-- ---------------------------------------------------------------------
alter table alquiler_productos
  add column if not exists fuera_de_servicio int not null default 0
  check (fuera_de_servicio >= 0);

-- Actualiza alquiler_disponibilidad() para descontar también las
-- unidades fuera de servicio. CREATE OR REPLACE conserva los permisos
-- ya otorgados (grant execute) sobre la función.
create or replace function alquiler_disponibilidad(
  p_negocio uuid,
  p_inicio  date,
  p_fin     date
)
returns table (
  producto_id uuid,
  cantidad    int,
  reservado   int,
  disponible  int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.cantidad,
    coalesce(r.reservado, 0)::int,
    greatest(0, p.cantidad - p.fuera_de_servicio - coalesce(r.reservado, 0))::int
  from alquiler_productos p
  left join (
    select i.producto_id, sum(i.cantidad) as reservado
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where ped.negocio_id = p_negocio
      and ped.fecha_inicio <= p_fin
      and ped.fecha_fin    >= p_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      )
    group by i.producto_id
  ) r on r.producto_id = p.id
  where p.negocio_id = p_negocio
    and p.activo = true
  order by p.orden, p.creado_en;
$$;

-- alquiler_crear_pedido() también debe respetar fuera_de_servicio al
-- validar cada línea del pedido nuevo.
create or replace function alquiler_crear_pedido(
  p_negocio    uuid,
  p_nombre     text,
  p_telefono   text,
  p_notas      text,
  p_inicio     date,
  p_fin        date,
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
  v_dias      int;
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

  v_dias := (p_fin - p_inicio) + 1;

  if v_dias < 1 or v_dias > 60 then
    raise exception 'PERIODO_INVALIDO';
  end if;

  if v_dias < v_negocio.dias_minimos then
    raise exception 'MINIMO_DIAS:%', v_negocio.dias_minimos;
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
    p_inicio, p_fin, v_dias, 0, 'pendiente', coalesce(p_notas, ''),
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

    -- Disponible = cantidad total − fuera de servicio − ya reservado
    -- (excluyendo este mismo pedido, que ya está insertado arriba).
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
