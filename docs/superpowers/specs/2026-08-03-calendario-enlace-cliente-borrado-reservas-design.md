# Calendario en el panel, enlace de reserva para la clienta, y borrado/filtro de reservas

Fecha: 2026-08-03
Estado: Aprobado, pendiente de plan de implementación

## Contexto

Tres mejoras a la pestaña Reservas de RomaDetalles y a la tienda pública, todas
independientes entre sí pero agrupadas por tocar la misma área:

1. Un **calendario mensual** en el panel para ver las reservas colocadas en su día.
2. Un **enlace propio de cada reserva** para que la clienta lo guarde en su
   teléfono, agregue el evento a su calendario nativo, y pida cambios sin tener
   que escribir todo desde cero.
3. Poder **ocultar reservas** de la lista del panel (sin borrar el historial) y
   **filtrar** por Pendientes / Completadas / Canceladas.

## 1. Enlace de reserva para la clienta

### El problema de seguridad que resuelve el diseño

El identificador visible de un pedido (`RD-260802-C9C10`) tiene solo 5
caracteres hexadecimales de aleatoriedad después de la fecha — no sirve como
"contraseña" para dar acceso a los datos de una reserva por su cuenta. Se
necesita un identificador aparte, largo y no adivinable, que actúe como
capacidad de acceso: quien lo tiene, ve esa reserva; nadie más puede.

### Cómo se guarda

Columna nueva `alquiler_pedidos.token_acceso text not null default
encode(gen_random_bytes(16), 'hex')` (32 caracteres hex, generado por Postgres
mismo — ninguna de las dos funciones de creación de pedido necesita tocarlo).

### Cómo se consulta

Función nueva `alquiler_pedido_por_token(p_token text)`, `security definer`,
pública (grant a `anon`), que devuelve el pedido (fecha del evento, artículos,
total, anticipo, estado, nombre del negocio, whatsapp del negocio) si el token
existe, o ningún resultado si no. Sigue el mismo patrón ya usado por
`alquiler_disponibilidad`: pública mediante `security definer`, sin exponer
una policy de `select` directa sobre `alquiler_pedidos` a `anon` (esa tabla
sigue sin política pública, como hoy).

**Nunca se devuelve `token_acceso` en el propio resultado** ni en ningún otro
select público — es un secreto de un solo uso implícito (se conoce por tenerlo
en la URL, no por consultarlo).

### El enlace

`crear-pedido-alquiler` agrega una variable nueva a `armarMensajeSolicitud`:
`{enlace_reserva}`, que resuelve a
`https://tusalon.github.io/RomaDetalles/index.html?reserva={token}` (o el
origen que corresponda, calculado igual que ya se calcula `url` en el push).
Se añade al texto por defecto de `plantilla_solicitud` y a la lista de
variables disponibles en Configuración.

### Qué ve la clienta al abrir el enlace

`Tienda.js` detecta `?reserva=TOKEN` en la URL al cargar. Si está presente, en
vez de mostrar el catálogo completo, muestra una pantalla dedicada de "Mi
reserva": fecha del evento (con el mismo formato largo ya usado en el resto de
la tienda), lista de artículos, total, anticipo (si aplica), y un chip con el
estado en español (Pendiente / Confirmada / Entregada / Devuelta / Cancelada).

Dos acciones:

- **"Agregar a mi calendario"** — genera y descarga un archivo `.ics` (formato
  estándar `VCALENDAR`/`VEVENT`, sin librerías) con el evento en la fecha
  correspondiente. Es la acción que de verdad deja la cita guardada en el
  teléfono (Calendario de iPhone, Google Calendar, etc. lo abren nativo).
- **"Solicitar un cambio"** — abre `wa.me/{whatsapp del negocio}` con un
  mensaje pre-armado que menciona la fecha del evento (no el código interno
  del pedido, siguiendo la misma regla ya aplicada al resto de mensajes de
  cliente). No cambia ningún dato por sí sola; la dueña decide, exactamente
  como ya pasa con cada confirmación/cancelación en el panel.

Al cargar con éxito, el token se guarda en `localStorage` bajo una lista
(`romadetallesMisReservas`, un arreglo de `{token, negocio_slug}` — sin datos
sensibles, el token ya es el secreto). Si la clienta vuelve a la tienda sin el
parámetro `?reserva=` y esa lista tiene algo guardado, aparece un enlace "Mis
reservas" en el header. Siempre abre una lista (aunque tenga un solo elemento)
con la fecha de cada una; tocar una entrada navega a
`?reserva={su token}` y muestra la pantalla de detalle de esa reserva.

## 2. Calendario en el panel

Dentro de la pestaña Reservas ya existente (no una pestaña nueva): un
interruptor **Lista / Calendario** junto al título.

- **Calendario**: cuadrícula del mes actual (7 columnas, semanas como filas),
  con flechas para navegar mes anterior/siguiente. Cada celda de día muestra
  un contador si hay reservas cuya `fecha_evento` cae ahí. Al tocar un día, se
  abre un panel con las tarjetas de reserva de ese día — las mismas tarjetas
  que ya usa la vista Lista, filtradas.
- Como la vista Lista carga hasta 200 pedidos recientes (por `creado_en`, no
  por `fecha_evento`), el calendario hace su propia carga acotada al mes que
  se está viendo (`fecha_evento` entre el primer y último día del mes), para
  no depender de ese límite ni de qué tan reciente se creó cada pedido.

## 3. Ocultar y filtrar reservas

### Ocultar

Columna nueva `alquiler_pedidos.oculto boolean not null default false`. Botón
"Eliminar" en cada tarjeta de reserva (Lista y Calendario) que hace
`PATCH oculto=true` — nunca se borra la fila (el reporte de Ocupación necesita
el historial completo para calcular ingresos).

**Solo se puede eliminar una reserva en estado `entregado`, `devuelto` o
`cancelado`.** Si está `pendiente` o `confirmado`, el botón no aparece — hay
que resolverla primero (confirmar, entregar, devolver o cancelar). Esto evita
ocultar por error algo que todavía necesita seguimiento.

`oculto` es una columna puramente de presentación: no participa en
`alquiler_disponibilidad` ni en `alquiler_ocupacion`, que siguen mirando solo
`estado` como hasta ahora — ocultar una reserva nunca libera ni bloquea stock.

Tanto `cargarPedidos` (Lista) como la carga del Calendario agregan
`&oculto=eq.false` a su select.

### Filtrar

Tres chips sobre la lista: **Pendientes** (`pendiente` + `confirmado`),
**Completadas** (`entregado` + `devuelto`), **Canceladas** (`cancelado`).
Selección única, por defecto "Todas" (sin filtro). Se aplica en el cliente
sobre los pedidos ya cargados — no hace falta una consulta nueva por cada
cambio de filtro.

## Fuera de alcance

- La clienta no puede cambiar fecha, artículos ni cantidad desde el enlace —
  solo puede pedir el cambio por WhatsApp (decisión explícita del usuario).
- No hay integración con Google Calendar API ni notificación de recordatorio
  del lado del archivo `.ics` más allá de lo que el propio Calendario del
  teléfono decida hacer con el evento.
- El borrado sigue siendo un ocultamiento, nunca un `delete` de la fila.
- El calendario no permite crear ni editar reservas arrastrando o tocando un
  día vacío — solo muestra lo que ya existe. Crear una reserva manual sigue
  siendo el formulario ya existente en la pestaña Reservas.
- No se agrega paginación al calendario para pedidos con `oculto = true`
  ocultos ni un "ver eliminadas" — una vez oculta, solo es visible corriendo
  una consulta directa en Supabase si hiciera falta recuperarla.
