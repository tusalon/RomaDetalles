-- =====================================================================
-- RomaDetalles — reactivar una reserva cancelada o vencida
-- =====================================================================
-- Hoy, si a una clienta se le pasa el plazo del anticipo (o el admin
-- cancela por eso), la única salida es que arme el pedido de nuevo desde
-- cero. Esta función le da al mismo pedido un plazo nuevo sin tocar sus
-- artículos, precio ni token de acceso — pero revalida el stock antes de
-- reabrirlo: el tiempo que pasó pudo habérselo dado a otra clienta.
--
-- Solo el dueño del negocio puede llamarla (comprobado con
-- alquiler_es_admin, no confiando en RLS de la tabla, igual que el resto
-- de funciones "de admin" de este archivo de esquema).
--
-- Idempotente.
-- =====================================================================

create or replace function alquiler_reactivar_pedido(
  p_pedido text
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido  alquiler_pedidos;
  v_negocio alquiler_negocios;
  v_item    record;
  v_disp    int;
begin
  select * into v_pedido from alquiler_pedidos where id = p_pedido;
  if not found then
    raise exception 'PEDIDO_NO_EXISTE';
  end if;

  if not alquiler_es_admin(v_pedido.negocio_id) then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Solo tiene sentido reactivar lo que ya está cancelado, o lo que sigue
  -- "pendiente" pero ya se le venció el plazo del anticipo (el cron que
  -- las pasa a cancelado es opcional — ver sql/11 — así que muchas se
  -- quedan así indefinidamente).
  if not (
    v_pedido.estado = 'cancelado'
    or (v_pedido.estado = 'pendiente' and v_pedido.expira_en < now())
  ) then
    raise exception 'RESERVA_NO_REACTIVABLE';
  end if;

  select * into v_negocio from alquiler_negocios where id = v_pedido.negocio_id;

  perform pg_advisory_xact_lock(hashtextextended(v_pedido.negocio_id::text, 0));

  -- Revalida cada artículo del pedido contra el stock actual, con la
  -- misma regla de solape de sql/12 (el día límite compartido no cuenta
  -- como choque). Si algo ya no alcanza, no se reactiva nada.
  for v_item in
    select i.producto_id, i.cantidad, p.nombre, p.cantidad as total_prod, p.fuera_de_servicio
    from alquiler_pedido_items i
    join alquiler_productos p on p.id = i.producto_id
    where i.pedido_id = p_pedido
  loop
    select greatest(0, v_item.total_prod - v_item.fuera_de_servicio - coalesce(sum(oi.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items oi
    join alquiler_pedidos ped on ped.id = oi.pedido_id
    where oi.producto_id = v_item.producto_id
      and ped.id <> p_pedido
      and ped.negocio_id = v_pedido.negocio_id
      and ped.fecha_inicio < v_pedido.fecha_fin
      and ped.fecha_fin    > v_pedido.fecha_inicio
      and (
        ped.estado in ('confirmado', 'entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_item.cantidad > v_disp then
      raise exception 'SIN_STOCK:%', v_item.nombre;
    end if;
  end loop;

  update alquiler_pedidos
     set estado = 'pendiente',
         -- Plazo nuevo desde ahora, con las horas que tenga puestas el
         -- negocio hoy (puede haber cambiado desde que se creó el pedido).
         expira_en = now() + make_interval(hours => v_negocio.horas_reserva),
         actualizado_en = now()
   where id = p_pedido
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function alquiler_reactivar_pedido(text) from public, anon;
grant execute on function alquiler_reactivar_pedido(text) to authenticated;
