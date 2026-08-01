# Notificaciones más simples, mensaje de solicitud personalizable y galería de muestras

Fecha: 2026-08-01
Estado: Aprobado, pendiente de plan de implementación

## Contexto

Tres mejoras independientes a RomaDetalles, agrupadas en un solo spec por ser pequeñas:

1. El aviso push de "pedido nuevo" y el recordatorio de las 5pm meten fecha, lista de
   artículos y total en el cuerpo de la notificación. En pedidos largos el resumen se
   corta a la fuerza a 160 caracteres (`crear-pedido-alquiler/index.ts:223-239`) y se ve
   cortado a media palabra. El mismo problema existe en
   `recordatorio-reservas-manana/index.ts:80-93`.
2. El mensaje de WhatsApp que la clienta manda al pedir un alquiler está fijo en el
   código de `crear-pedido-alquiler/index.ts:193-209`. El negocio no puede darle un
   toque personal, a diferencia del mensaje de confirmación y el de compartir tienda,
   que ya son plantillas editables (`plantilla_confirmacion`, `plantilla_compartir` en
   `alquiler_negocios`).
3. No existe forma de que la dueña muestre trabajos de decoración ya realizados como
   portafolio/prueba social en su tienda pública.

## 1. Notificaciones más simples

**Problema:** el cuerpo del push intenta cargar datos estructurados (fecha, items,
total) en un espacio que no los tolera bien, y se corta feo cuando el pedido es largo.

**Cambio:** el aviso deja de llevar el detalle del pedido. Solo confirma que pasó algo
y manda al panel — el detalle se ve adentro, donde sí cabe completo.

- **Pedido nuevo** (`crear-pedido-alquiler`):
  - Título: `Nueva solicitud de {nombre}` si el nombre cabe corto (límite a definir en
    el plan, ej. ≤20 caracteres); si no cabe, cae a `Tienes una solicitud nueva`.
  - Cuerpo: fijo, `Toca para ver los detalles en el panel.`
  - El `url` de deep-link a `admin.html?pedido={id}` no cambia — sigue abriendo directo
    esa reserva (ya funciona vía `notificationclick` en `sw.js`).
- **Recordatorio de mañana** (`recordatorio-reservas-manana`):
  - Título: sin cambios, `Mañana tienes N entregas` / `Mañana tienes 1 entrega`.
  - Cuerpo: pasa de listar cliente por cliente y artículo por artículo a un texto fijo,
    `Toca para ver el detalle en el panel.`
  - El `url` sigue apuntando a `admin.html` (no hay un pedido único que abrir, son
    varios).

**Fuera de alcance:** no se toca el flujo de activar/desactivar avisos por dispositivo
(`utils/push-alquiler.js`, `TarjetaAvisos` en `Panel.js`) — ese ya comunica su estado
con claridad; el problema reportado era solo el contenido del mensaje.

## 2. Mensaje de solicitud personalizable

**Cambio:** mover el mensaje fijo de solicitud al mismo patrón que ya usan
`plantilla_confirmacion` y `plantilla_compartir` — plantilla de texto libre con
variables, editable por el negocio, con un valor por defecto que reproduce el mensaje
actual.

- Nuevo campo `alquiler_negocios.plantilla_solicitud` (texto, nullable).
- Variables soportadas: `{nombre}`, `{fechas}`, `{items}`, `{total}`, `{telefono}`,
  `{notas}`, `{pedido_id}`.
  - `{items}` es la lista ya formateada línea por línea, tal como se arma hoy en
    `crear-pedido-alquiler/index.ts:197-200` (`• {cantidad} × {nombre} — {subtotal} {moneda}`).
- Si `plantilla_solicitud` está vacío, se usa el texto por defecto actual (mismo
  contenido que hoy, ver `crear-pedido-alquiler/index.ts:193-209`) — ningún negocio
  existente pierde su mensaje al desplegar el cambio.
- El armado sigue pasando en la Edge Function `crear-pedido-alquiler` (server-side),
  no en el navegador — ahí es donde ya se calculan fecha/total/items, y es el único
  camino de creación de pedidos (ver comentario de cabecera del archivo).
- En el panel, pestaña Configuración: nuevo textarea "Mensaje de solicitud (de la
  clienta a ti)" junto a los otros dos, con la misma ayuda de variables debajo
  (siguiendo el patrón de `Panel.js:912-919`).

## 3. Galería de muestras

**Cambio:** pestaña nueva en el panel donde la dueña sube fotos de trabajos ya hechos,
visibles en la tienda pública como portafolio/prueba social.

### Datos

Tabla nueva `alquiler_galeria`:
- `id uuid primary key default gen_random_uuid()`
- `negocio_id uuid references alquiler_negocios(id) not null`
- `imagen_url text not null`
- `descripcion text` (opcional, corta)
- `orden int` o `created_at` para el orden de despliegue (a decidir en el plan; lo más
  simple es `created_at desc`, sin necesidad de un campo de orden manual)
- `created_at timestamptz default now()`

RLS: mismo criterio que `alquiler_productos` — lectura pública (`select` sin
restricción para filas de negocios activos), escritura solo para el dueño autenticado
vía `alquiler_es_admin()`.

### Panel

- Pestaña nueva "Galería" en la navegación (`Reservas · Artículos · Ocupación ·
  Galería · Configuración`).
- Grid de tarjetas, una por foto, con su descripción debajo y botón eliminar.
- Botón "+ Agregar foto": reusa el flujo de subida a Cloudinary ya existente para fotos
  de producto/logo (mismo preset, mismo componente de subida) + campo de descripción
  opcional.

### Tienda pública

- Nueva sección en `Tienda.js`, entre el catálogo y el footer: título "Nuestros
  trabajos" (copy fijo, no editable por ahora — no se pidió que lo fuera), grid de
  fotos con su descripción debajo.
- Clic en una foto la abre en grande (lightbox simple con CSS/JS propio, sin librería
  nueva — mismo criterio de "cero dependencias" que ya sigue el proyecto).
- Si el negocio no tiene ninguna foto en la galería, la sección entera no se renderiza
  — no debe quedar un hueco vacío en la tienda.

## Fuera de alcance (para los tres)

- No se agrega analítica ni conteo de vistas a la galería.
- No se agrega reordenamiento manual de fotos (arrastrar y soltar) — el orden es por
  fecha de subida.
- No se toca el sistema de expiración de pedidos pendientes ni se agregan nuevos
  eventos de notificación (cancelación, expiración próxima) — quedó fuera de la
  conversación con el usuario, se puede pedir como mejora aparte.
