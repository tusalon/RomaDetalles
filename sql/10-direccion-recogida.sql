-- =====================================================================
-- RomaDetalles — dirección de recogida
-- =====================================================================
-- La clienta sabía CUÁNDO recoger ("el día antes, después de las 5:00
-- PM") pero no DÓNDE. Se lo tenía que preguntar al negocio por WhatsApp.
--
-- Idempotente.
-- =====================================================================

alter table alquiler_negocios
  add column if not exists direccion text not null default '';

-- ---------------------------------------------------------------------
-- La reserva por token devuelve también la dirección
-- ---------------------------------------------------------------------
-- Es el enlace que la clienta abre el día antes del evento para ver su
-- reserva: es justo ahí donde necesita la dirección. Sigue sin devolver
-- token_acceso. Postgres no deja cambiar el tipo de retorno con CREATE
-- OR REPLACE, así que se suelta primero (y se reotorga el grant).
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
