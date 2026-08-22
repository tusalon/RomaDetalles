-- =====================================================================
-- RomaDetalles — solicitar servicio a domicilio al hacer el pedido
-- =====================================================================
-- No todos los negocios de esta app ofrecen domicilio, así que es
-- opt-in por negocio (igual que anticipo_porciento o direccion): el
-- negocio lo activa en Configuración y solo entonces la clienta ve la
-- opción en la tienda.
--
-- El precio y el punto de entrega NO se calculan aquí — se coordinan
-- por WhatsApp entre la clienta y la admin, este campo solo dispara esa
-- conversación. Por eso no toca ninguna firma de función ni la lógica
-- de stock/disponibilidad.
--
-- Idempotente.
-- =====================================================================

alter table alquiler_negocios
  add column if not exists ofrece_domicilio boolean not null default false;

alter table alquiler_pedidos
  add column if not exists solicita_domicilio boolean not null default false;

-- ---------------------------------------------------------------------
-- Plantilla de solicitud — variable {domicilio}
-- ---------------------------------------------------------------------
-- Mismo criterio que las migraciones anteriores de esta plantilla
-- (05-08, 13): se cambia el DEFAULT (negocios nuevos) y se actualizan
-- solo las filas que todavía tienen el texto por defecto anterior
-- palabra por palabra (las que nunca lo personalizaron).
alter table alquiler_negocios
  alter column plantilla_solicitud set default
    'Hola, deseo solicitar este alquiler:' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '{politica_seguro}' || chr(10) ||
    '{domicilio}' || chr(10) ||
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
    '{politica_seguro}' || chr(10) ||
    '{domicilio}' || chr(10) ||
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
    '{politica_seguro}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.' || chr(10) ||
    '🔗 Guarda tu reserva aquí: {enlace_reserva}';
