-- =====================================================================
-- RomaDetalles — quitar el código interno del pedido (ej. RD-260802-C9C10)
-- de los mensajes que ve la clienta por WhatsApp
-- =====================================================================
-- Idempotente. La variable {pedido_id} sigue disponible para quien
-- quiera agregarla a mano en su plantilla — solo se quita del DEFAULT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mensaje de solicitud (de la clienta al negocio)
-- ---------------------------------------------------------------------
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
    'Quedo pendiente de confirmación. Gracias.';

-- Solo toca las filas que todavía tienen el texto por defecto anterior
-- palabra por palabra (las que nunca lo personalizaron).
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
    'Quedo pendiente de confirmación. Gracias.'
 where plantilla_solicitud =
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

-- ---------------------------------------------------------------------
-- 2. Mensaje de confirmación (del negocio a la clienta)
-- ---------------------------------------------------------------------
alter table alquiler_negocios
  alter column plantilla_confirmacion set default
    'Hola {nombre}, tu pedido quedó confirmado ✅' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    'Cualquier duda me avisas. ¡Gracias por tu preferencia!';

update alquiler_negocios
   set plantilla_confirmacion =
    'Hola {nombre}, tu pedido quedó confirmado ✅' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    'Cualquier duda me avisas. ¡Gracias por tu preferencia!'
 where plantilla_confirmacion =
    'Hola {nombre}, tu pedido {pedido_id} quedó confirmado ✅' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    'Cualquier duda me avisas. ¡Gracias por tu preferencia!';
