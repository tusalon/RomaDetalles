# Día del evento, anticipo configurable y datos de pago

Fecha: 2026-08-01
Estado: Aprobado, pendiente de plan de implementación

## Contexto

RomaDetalles alquila decoración para eventos. Hoy la clienta elige un **rango de
fechas** (desde/hasta) y el precio se calcula `precio_dia × cantidad × días`. Eso no
refleja cómo funciona el negocio de verdad: la clienta tiene **un evento, un día**, y
la logística de recogida/entrega es fija alrededor de ese día.

Además, hoy no hay forma de cobrar un anticipo ni de decirle a la clienta a qué tarjeta
transferirlo — la dueña lo resuelve a mano por WhatsApp en cada pedido.

Tres cambios, todos en el mismo flujo de reserva:

1. Selección de **un solo día de evento**, con las condiciones de recogida y entrega
   explicadas a la clienta.
2. **Anticipo configurable** por la dueña (porcentaje + redondeo).
3. **Datos de pago** (tarjeta y teléfono) visibles antes de confirmar la reserva.

## 1. Día del evento

### Qué ve la clienta

Un solo campo de fecha: **"¿Qué día es tu evento?"** (mínimo: mañana — si el evento
fuera hoy, la recogida habría sido ayer). Debajo, un bloque de condiciones fijo:

> **Recoges** el día antes de tu evento, después de las 5:00 PM.
> **Entregas** al día siguiente, antes de las 12:00 del mediodía.
> Si no entregas a tiempo, se cobra un **50% extra** del costo del alquiler.

Este texto es **fijo, igual para todos los negocios** (decisión explícita: los negocios
actuales comparten el mismo ritmo de trabajo; hacerlo configurable se puede añadir
después si un cliente futuro lo necesita).

### Cómo se guarda

Columna nueva `alquiler_pedidos.fecha_evento date not null`. El rango que ya existe se
deriva de ella y se sigue guardando:

- `fecha_inicio = fecha_evento - 1 día` (el día que recoge)
- `fecha_fin = fecha_evento` (el día del evento)
- `dias = 1` (siempre — es lo que se factura)

**Por qué este rango exactamente.** Físicamente el artículo está fuera desde las 5pm del
día anterior hasta el mediodía del día siguiente. Con el rango `[D-1, D]` y el
solapamiento que ya usa `alquiler_disponibilidad`, la disponibilidad da la respuesta
correcta sin tocar esa función:

| Caso | Realidad física | Rangos | Resultado |
|---|---|---|---|
| Eventos en días seguidos (D y D+1) | Se pisan la noche del D | `[D-1,D]` ∩ `[D,D+1]` = {D} | Bloqueado ✅ |
| Eventos con 2 días de diferencia (D y D+2) | No se pisan | `[D-1,D]` ∩ `[D+1,D+2]` = ∅ | Permitido ✅ |

### Precio

`alquiler_productos.precio_dia` pasa a significar **precio por evento**. La columna
**conserva su nombre** (está referenciada en el esquema, las funciones, la Edge Function
y ambos componentes; renombrarla es churn sin beneficio). Lo que cambia es la etiqueta
en el panel: "Precio por día" → **"Precio por evento"**, y el subtítulo en la tienda
deja de decir "/ día".

El total de un pedido pasa a ser `Σ (precio_dia × cantidad)` — sin multiplicar por días.

### Mínimo de días

`alquiler_negocios.dias_minimos` deja de tener sentido. La columna **se conserva** (no
se borra, para no romper filas ni el select existente) pero:

- Deja de validarse en `alquiler_crear_pedido`.
- Se quita el campo de la pestaña Configuración del panel.

### Funciones SQL afectadas

`alquiler_crear_pedido` y `alquiler_crear_pedido_manual` cambian de firma: reciben
`p_evento date` en lugar de `p_inicio date, p_fin date`. Internamente derivan el rango,
fijan `dias = 1`, calculan el total sin multiplicar por días, y calculan el anticipo
(ver sección 2).

Como Postgres no permite `create or replace` con firma distinta, la migración hace
`drop function ... ` primero. **Nota de despliegue:** aplicar el SQL y desplegar la Edge
Function seguido, porque entre una cosa y la otra la función vieja llamaría a una firma
que ya no existe.

`alquiler_disponibilidad` **no cambia** — sigue recibiendo un rango; la tienda la llama
con `(D-1, D)`.

`alquiler_ocupacion` **no cambia**. Contará 2 días por evento, que es honesto: el
artículo sí está fuera dos días de calendario.

### Pedidos existentes

La migración rellena `fecha_evento = fecha_inicio` en las filas que ya existen. Para
pedidos viejos de varios días esa fecha es aproximada, pero son pedidos históricos
(pendientes o ya cerrados) y su rango original se conserva intacto.

## 2. Anticipo configurable

### Configuración (por negocio)

- `alquiler_negocios.anticipo_porciento int not null default 0` — `check between 0 and 100`.
  0 significa "sin anticipo": la tienda no muestra nada de anticipo.
- `alquiler_negocios.anticipo_redondear boolean not null default true` — redondear a la
  centena más cercana.

### Cálculo

```
anticipo_bruto = total × (anticipo_porciento / 100)
anticipo       = redondear ? round(anticipo_bruto / 100) × 100 : round(anticipo_bruto)
```

Dos guardas, ambas obligatorias:

- **Nunca 0 por redondeo:** si `anticipo_porciento > 0` y el redondeo da 0, se usa
  `anticipo_bruto` sin redondear (un anticipo de 40 CUP no puede convertirse en "no
  pagues nada").
- **Nunca mayor que el total:** `anticipo = least(anticipo, total)`.

Se guarda en `alquiler_pedidos.anticipo numeric(12,2) not null default 0`, calculado en
`alquiler_crear_pedido` / `alquiler_crear_pedido_manual` — es decir, del lado del
servidor, donde la clienta no lo puede manipular.

La tienda **también** calcula el anticipo en JS para mostrarlo antes de enviar. Es una
duplicación deliberada de una fórmula de tres líneas (mismo criterio que el total, que
ya se calcula en ambos lados). Ambas implementaciones deben redondear igual: mitad hacia
arriba.

### Qué ve la clienta

En el cajón del pedido, bajo el total:

```
Total            12.400 CUP
Anticipo (30%)    3.700 CUP   ← lo que paga ahora
Resto al recoger  8.700 CUP
```

Si `anticipo_porciento = 0`, esas dos líneas no aparecen.

## 3. Datos de pago

### Configuración (por negocio)

- `alquiler_negocios.pago_tarjeta text not null default ''`
- `alquiler_negocios.pago_telefono text not null default ''`

### Dónde se muestran

**En la tienda**, dentro del cajón del pedido, justo antes del botón de enviar — solo si
hay anticipo configurado y la dueña llenó al menos la tarjeta:

> Para confirmar tu reserva, transfiere el anticipo a:
> **Tarjeta:** 9227 0699 1234 5678
> **Teléfono:** 5384 2336
> Tu reserva queda confirmada cuando la dueña reciba el anticipo.

**En el mensaje de WhatsApp**, mediante variables nuevas de plantilla (ver abajo), para
que la clienta tenga los datos a mano sin volver a la página.

### Variables nuevas de plantilla

`plantilla_solicitud` gana tres variables: `{anticipo}`, `{tarjeta}`, `{telefono_pago}`.

- `{anticipo}` se sustituye por el monto con moneda (ej. `3.700 CUP`), o por cadena
  vacía si el negocio no cobra anticipo.
- `{tarjeta}` y `{telefono_pago}` se sustituyen por el valor configurado, o cadena vacía
  si está en blanco.

El texto por defecto de `plantilla_solicitud` se actualiza para incluirlas, y `{fechas}`
pasa a renderizar **la fecha del evento** en lugar del rango. La ayuda bajo el textarea
en Configuración lista las variables nuevas.

Lo mismo aplica a `{fechas}` en `armarMensajeConfirmacion` (panel): pasa a mostrar la
fecha del evento.

## Alcance de los cambios por archivo

- `sql/06-*.sql` — columnas nuevas, backfill, y las dos funciones de creación de pedido
  con firma nueva.
- `supabase/functions/crear-pedido-alquiler/index.ts` — recibe `fecha_evento`, pasa la
  nueva firma al RPC, sustituye las variables nuevas, devuelve el anticipo.
- `components/Tienda.js` — un solo campo de fecha, bloque de condiciones, total sin
  días, anticipo y datos de pago en el cajón.
- `components/Panel.js` — Configuración (anticipo, redondeo, tarjeta, teléfono; fuera
  `dias_minimos`), Artículos ("Precio por evento"), Reservas (fecha del evento y
  anticipo), reserva manual con un solo campo de fecha.
- `utils/auth-alquiler.js` — el select del negocio necesita los cuatro campos nuevos.
- `styles.css` — estilos del bloque de condiciones y del desglose de anticipo.
- `index.html` / `admin.html` / `sw.js` — cache busting.

## Fuera de alcance

- El recargo del 50% es **solo texto informativo**. El sistema no lo calcula, no lo suma
  al pedido, y no hay un botón de "entregó tarde" en el panel. La dueña lo cobra por
  fuera si pasa.
- No se registra si el anticipo fue pagado: no hay estado "anticipo recibido" ni
  comprobantes. La dueña sigue confirmando la reserva a mano cuando le llega la
  transferencia, con el botón "Confirmar" que ya existe.
- No se integra ninguna pasarela de pago. La transferencia es por fuera
  (Transfermóvil/Enzona), como ya lo hace hoy.
- No se permite alquilar varios días seguidos. Un pedido = un evento = un día.
- El texto de condiciones no es editable por la dueña en esta versión.
