-- =====================================================================
-- RomaDetalles — enlace de reserva para la clienta, y ocultar reservas
-- =====================================================================
-- Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Token de acceso y ocultamiento
-- ---------------------------------------------------------------------
-- Token no adivinable, distinto del id corto (RD-260802-C9C10, que solo
-- tiene 5 caracteres de aleatoriedad — no sirve como "contraseña" de
-- acceso). gen_random_uuid() ya se usa en este archivo para el id del
-- pedido; aquí se reusa sin guiones para un token de 32 caracteres hex.
alter table alquiler_pedidos
  add column if not exists token_acceso text
  not null default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists alquiler_pedidos_token_idx
  on alquiler_pedidos (token_acceso);

-- Ocultar de la vista del panel sin borrar el historial (Ocupación lo
-- sigue necesitando completo).
alter table alquiler_pedidos
  add column if not exists oculto boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Función pública: la clienta consulta SU reserva por el token
-- ---------------------------------------------------------------------
-- Mismo patrón que alquiler_disponibilidad: pública vía SECURITY DEFINER,
-- sin agregar una política de SELECT general sobre alquiler_pedidos.
-- Nunca devuelve token_acceso.
create or replace function alquiler_pedido_por_token(p_token text)
returns table (
  pedido_id        text,
  fecha_evento     date,
  fecha_inicio     date,
  fecha_fin        date,
  dias             int,
  total            numeric,
  anticipo         numeric,
  estado           text,
  moneda           text,
  negocio_nombre   text,
  negocio_whatsapp text,
  items            jsonb
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
    n.moneda,
    n.nombre,
    n.whatsapp,
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
-- 3. Plantilla de solicitud — variable {enlace_reserva}
-- ---------------------------------------------------------------------
-- Mismo criterio que las migraciones anteriores de esta plantilla: se
-- cambia el DEFAULT (negocios nuevos) y se actualizan solo las filas que
-- todavía tienen el texto por defecto anterior palabra por palabra (las
-- que nunca lo personalizaron).
alter table alquiler_negocios
  alter column plantilla_solicitud set default
    'Hola, deseo solicitar este alquiler:' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.' || chr(10) ||
    '🔗 Guarda tu reserva aquí: {enlace_reserva}';

update alquiler_negocios
   set plantilla_solicitud =
    'Hola, deseo solicitar este alquiler:' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.' || chr(10) ||
    '🔗 Guarda tu reserva aquí: {enlace_reserva}'
 where plantilla_solicitud =
    'Hola, deseo solicitar este alquiler:' || chr(10) ||
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
