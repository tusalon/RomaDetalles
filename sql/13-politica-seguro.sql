-- =====================================================================
-- RomaDetalles — política de roturas/extravíos en el mensaje de solicitud
-- =====================================================================
-- Cada negocio alquila artículos distintos con reglas distintas sobre quién
-- responde si algo se rompe o se pierde (depósito, reposición al mismo
-- modelo, etc.). No hay un texto único que sirva para todos, así que lo
-- escribe cada negocio en su Configuración y queda vacío hasta que lo haga
-- — igual que pago_tarjeta o direccion, que tampoco traen un valor por
-- defecto inventado por nosotros.
--
-- Idempotente.
-- =====================================================================

alter table alquiler_negocios
  add column if not exists politica_seguro text not null default '';

-- ---------------------------------------------------------------------
-- Plantilla de solicitud — variable {politica_seguro}
-- ---------------------------------------------------------------------
-- Mismo criterio que las migraciones anteriores de esta plantilla (05-08):
-- se cambia el DEFAULT (negocios nuevos) y se actualizan solo las filas
-- que todavía tienen el texto por defecto anterior palabra por palabra
-- (las que nunca lo personalizaron). Se coloca junto a {anticipo} porque
-- es donde más le importa verla a la clienta, pero es independiente de si
-- el negocio cobra anticipo — por eso va en su propia línea, no dentro del
-- bloque condicional de {anticipo}.
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
    'Quedo pendiente de confirmación. Gracias.' || chr(10) ||
    '🔗 Guarda tu reserva aquí: {enlace_reserva}';
