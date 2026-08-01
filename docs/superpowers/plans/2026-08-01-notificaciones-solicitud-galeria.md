# Notificaciones simples, mensaje de solicitud personalizable y galería de muestras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplificar el contenido de los avisos push, permitir que cada negocio personalice el mensaje de solicitud de WhatsApp, y agregar una galería de muestras pública/administrable.

**Architecture:** Todo vive en el stack estático ya existente de RomaDetalles (React+JSX precompilado con esbuild, Supabase Postgres+RLS+Edge Functions, Cloudinary para fotos). No se agrega ninguna dependencia nueva. La galería reutiliza al pie de la letra el patrón RLS de `alquiler_productos` y el patrón de subida de Cloudinary ya usado para fotos de producto/logo. El mensaje de solicitud reutiliza el patrón de plantilla-con-variables ya usado por `plantilla_confirmacion`/`plantilla_compartir`.

**Tech Stack:** JS/JSX (sin bundler, compilado con `esbuild` vía `scripts/build-jsx.sh`), Supabase (Postgres/RLS/Edge Functions en Deno), Cloudinary (subida sin firma), GitHub Pages (hosting estático).

## Global Constraints

- Nunca insertar pedidos ni escribir datos sensibles desde la tienda pública con la anon key — todo pasa por Edge Functions o RPCs `SECURITY DEFINER`, igual que hoy.
- Cero dependencias nuevas (ni npm ni CDN): seguir el mismo criterio de "cero bytes que no aporten" que ya sigue el proyecto (ver comentarios en `styles.css` y `sw.js`).
- SQL idempotente: todo con `if not exists` / `create or replace` / `drop policy if exists`, para poder correr el script más de una vez sin romper nada.
- Tras editar cualquier `components/*.js` o `*-app.js`: correr `bash scripts/build-jsx.sh` y commitear `compiled/` en el MISMO commit que el fuente.
- Tras editar cualquier archivo listado en `PRECARGA` de `sw.js` (`styles.css`, `utils/storage.js`, etc.) o cualquier script referenciado desde `index.html`/`admin.html`: subir el `CACHE_NAME` en `sw.js` y el `?v=` del archivo en el HTML correspondiente. Si no, los teléfonos siguen sirviendo la versión vieja.
- Las migraciones SQL las corre el usuario a mano en el SQL Editor de Supabase (así se ha hecho en todo el proyecto hasta ahora) — cada tarea de SQL termina con un punto de pausa explícito para que el usuario la corra y confirme el resultado antes de seguir.
- Este proyecto no tiene framework de tests automatizados para el stack estático (el único `npm test` que existe es del stack Next.js que se está retirando). La verificación de cada tarea es: SQL vía el SQL Editor de Supabase, Edge Functions vía `curl` contra el endpoint desplegado, y UI vía el servidor estático local (`.claude/launch.json` → `romadetalles-static`, puerto 5175) en el navegador.

---

## Task 1: Migración SQL — plantilla de solicitud y tabla de galería

**Files:**
- Create: `sql/05-mensaje-solicitud-galeria.sql`

**Interfaces:**
- Produce: columna `alquiler_negocios.plantilla_solicitud` (text, not null, default = mensaje actual convertido a plantilla). Tabla `alquiler_galeria(id, negocio_id, imagen_url, descripcion, creado_en)` con RLS: público lee fotos de negocios activos, dueño (`alquiler_es_admin(negocio_id)`) tiene CRUD completo sobre las suyas. Tareas 3, 5, 6 y 7 dependen de que esta migración ya esté aplicada en la base real antes de poder probarse de punta a punta.

- [ ] **Step 1: Escribir la migración**

```sql
-- =====================================================================
-- RomaDetalles — mensaje de solicitud personalizable y galería de
-- muestras
-- =====================================================================
-- Idempotente: usa IF NOT EXISTS / OR REPLACE en todo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mensaje de solicitud personalizable
-- ---------------------------------------------------------------------
-- Valor por defecto: reproduce tal cual el mensaje que hoy arma a mano
-- crear-pedido-alquiler/index.ts, para que ningún negocio existente
-- pierda su mensaje actual al desplegar esto.
alter table alquiler_negocios
  add column if not exists plantilla_solicitud text not null default
    'Hola, deseo solicitar este alquiler ({pedido_id}):' || chr(10) ||
    '📅 {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total estimado: {total}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.';

-- ---------------------------------------------------------------------
-- 2. Galería de muestras
-- ---------------------------------------------------------------------
create table if not exists alquiler_galeria (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references alquiler_negocios(id) on delete cascade,
  imagen_url  text not null,
  descripcion text not null default '',
  creado_en   timestamptz not null default now()
);

create index if not exists alquiler_galeria_negocio_idx
  on alquiler_galeria (negocio_id, creado_en desc);

alter table alquiler_galeria enable row level security;

-- Público: solo fotos de negocios activos.
drop policy if exists alquiler_galeria_lectura_publica on alquiler_galeria;
create policy alquiler_galeria_lectura_publica
  on alquiler_galeria for select
  using (
    exists (
      select 1 from alquiler_negocios n
      where n.id = negocio_id and n.activo = true
    )
  );

-- Dueño: ve las suyas aunque el negocio esté inactivo (ej. antes de
-- activar la tienda), igual que ya pasa con alquiler_productos.
drop policy if exists alquiler_galeria_lectura_dueno on alquiler_galeria;
create policy alquiler_galeria_lectura_dueno
  on alquiler_galeria for select
  using (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_galeria_insert_dueno on alquiler_galeria;
create policy alquiler_galeria_insert_dueno
  on alquiler_galeria for insert
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_galeria_update_dueno on alquiler_galeria;
create policy alquiler_galeria_update_dueno
  on alquiler_galeria for update
  using (alquiler_es_admin(negocio_id))
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_galeria_delete_dueno on alquiler_galeria;
create policy alquiler_galeria_delete_dueno
  on alquiler_galeria for delete
  using (alquiler_es_admin(negocio_id));
```

- [ ] **Step 2: El usuario corre la migración en Supabase**

Pega el SQL del Step 1 completo en el SQL Editor de Supabase (proyecto `zorhclhvykikaachfrmp`) y ejecútalo. Debe decir `Success. No rows returned`.

- [ ] **Step 3: Verificar que quedó bien aplicada**

El usuario corre esta consulta en el mismo SQL Editor y pega el resultado:

```sql
select column_name from information_schema.columns
where table_name = 'alquiler_negocios' and column_name = 'plantilla_solicitud';

select policyname from pg_policies where tablename = 'alquiler_galeria' order by policyname;
```

Expected: la primera devuelve 1 fila (`plantilla_solicitud`); la segunda devuelve 5 filas
(`alquiler_galeria_delete_dueno`, `alquiler_galeria_insert_dueno`, `alquiler_galeria_lectura_dueno`,
`alquiler_galeria_lectura_publica`, `alquiler_galeria_update_dueno`).

- [ ] **Step 4: Commit**

```bash
git add sql/05-mensaje-solicitud-galeria.sql
git commit -m "sql: plantilla_solicitud y tabla alquiler_galeria"
```

---

## Task 2: Helper de subida — foto de galería

**Files:**
- Modify: `utils/storage.js:196-208` (justo después de `window.subirLogoNegocio`)

**Interfaces:**
- Consume: `subirImagenACloudinary(file, opciones)` ya definida en el mismo archivo (`utils/storage.js:95`), que devuelve `{ url, publicId, width, height, bytes }` o `null`.
- Produce: `window.subirFotoGaleria(file, negocioId) → Promise<{url,...}|null>`. La Tarea 6 lo usa.

- [ ] **Step 1: Agregar el helper**

En `utils/storage.js`, justo después del bloque de `window.subirLogoNegocio` (después de la línea 208), agregar:

```js
// Foto de la galería de muestras (trabajos ya hechos). 1200px: la foto
// ES el contenido de esta sección, mismo criterio que la foto de
// producto — vale la pena algo más de detalle que una miniatura.
window.subirFotoGaleria = function(file, negocioId) {
    return subirImagenACloudinary(file, {
        folder: CLOUDINARY_FOLDER_PRODUCTOS.replace('/productos', '/galeria'),
        etiqueta: negocioId || 'galeria',
        tags: 'romadetalles,galeria',
        maxDimension: 1200
    });
};
```

- [ ] **Step 2: Verificar que el archivo sigue siendo JS válido**

Run: `node --check utils/storage.js`
Expected: sin salida (sin errores de sintaxis).

- [ ] **Step 3: Commit**

```bash
git add utils/storage.js
git commit -m "storage: agregar subirFotoGaleria para la galería de muestras"
```

---

## Task 3: Edge Function `crear-pedido-alquiler` — plantilla de solicitud + push simplificado

**Files:**
- Modify: `supabase/functions/crear-pedido-alquiler/index.ts`

**Interfaces:**
- Consume: columna `alquiler_negocios.plantilla_solicitud` (Task 1, ya debe estar aplicada en la base real).
- Produce: sin cambios en el contrato HTTP — sigue devolviendo `{ pedido_id, total, moneda, dias, expira_en, whatsapp_url }` con status 201. Lo único que cambia es el CONTENIDO del mensaje dentro de `whatsapp_url` y del push.

- [ ] **Step 1: Incluir `plantilla_solicitud` en el select del negocio**

En `supabase/functions/crear-pedido-alquiler/index.ts:147`, cambiar:

```ts
    `${supabaseUrl}/rest/v1/alquiler_negocios?${filtro}&activo=eq.true&select=id,nombre,whatsapp,moneda`,
```

por:

```ts
    `${supabaseUrl}/rest/v1/alquiler_negocios?${filtro}&activo=eq.true&select=id,nombre,whatsapp,moneda,plantilla_solicitud`,
```

- [ ] **Step 2: Reemplazar el armado fijo del mensaje por una función con plantilla**

En `supabase/functions/crear-pedido-alquiler/index.ts`, agregar esta función antes de `Deno.serve(...)` (después de `mensajeDeError`, línea 80):

```ts
const PLANTILLA_SOLICITUD_POR_DEFECTO =
  "Hola, deseo solicitar este alquiler ({pedido_id}):\n" +
  "📅 {fechas}\n" +
  "\n" +
  "{items}\n" +
  "\n" +
  "💰 Total estimado: {total}\n" +
  "👤 Cliente: {nombre}\n" +
  "{telefono}\n" +
  "{notas}\n" +
  "Quedo pendiente de confirmación. Gracias.";

/**
 * Rellena la plantilla de solicitud (editable por el negocio en
 * Configuración) con los datos reales del pedido. {telefono} y {notas}
 * llevan su propio prefijo ("📞 ", "📝 ") y quedan vacíos si el dato no
 * vino — por eso al final se colapsan los saltos de línea de sobra, sin
 * exigirle al negocio que arme una plantilla "perfecta" sin esos campos.
 */
function armarMensajeSolicitud(
  plantilla: string,
  datos: {
    pedidoId: string;
    fechaInicio: string;
    fechaFin: string;
    dias: number;
    items: Array<{ producto_nombre: string; precio_dia: number; cantidad: number }>;
    total: number;
    moneda: string;
    nombre: string;
    telefono: string;
    notas: string;
  },
): string {
  const base = plantilla && plantilla.trim() ? plantilla : PLANTILLA_SOLICITUD_POR_DEFECTO;
  const fechas = `${datos.fechaInicio} al ${datos.fechaFin} (${datos.dias} ${datos.dias === 1 ? "día" : "días"})`;
  const items = datos.items
    .map(
      (l) =>
        `• ${l.cantidad} × ${l.producto_nombre} — ${dinero(Number(l.precio_dia) * l.cantidad * datos.dias)} ${datos.moneda}`,
    )
    .join("\n");

  const texto = base
    .replaceAll("{pedido_id}", datos.pedidoId)
    .replaceAll("{fechas}", fechas)
    .replaceAll("{items}", items)
    .replaceAll("{total}", `${dinero(datos.total)} ${datos.moneda}`)
    .replaceAll("{nombre}", datos.nombre)
    .replaceAll("{telefono}", datos.telefono ? `📞 ${datos.telefono}` : "")
    .replaceAll("{notas}", datos.notas ? `📝 ${datos.notas}` : "");

  return texto.replace(/\n{3,}/g, "\n\n").trim();
}
```

Luego, en el bloque `// ---- Mensaje de WhatsApp -----------------------------------------`
(líneas 192-209), reemplazar todo el bloque:

```ts
  // ---- Mensaje de WhatsApp -----------------------------------------
  const mensaje = [
    `Hola, deseo solicitar este alquiler (${pedido.id}):`,
    `📅 ${pedido.fecha_inicio} al ${pedido.fecha_fin} (${dias} ${dias === 1 ? "día" : "días"})`,
    "",
    ...lineas.map(
      (l) =>
        `• ${l.cantidad} × ${l.producto_nombre} — ${dinero(Number(l.precio_dia) * l.cantidad * dias)} ${moneda}`,
    ),
    "",
    `💰 Total estimado: ${dinero(Number(pedido.total))} ${moneda}`,
    `👤 Cliente: ${nombre}`,
    telefono ? `📞 ${telefono}` : "",
    notas ? `📝 ${notas}` : "",
    "Quedo pendiente de confirmación. Gracias.",
  ]
    .filter(Boolean)
    .join("\n");
```

por:

```ts
  // ---- Mensaje de WhatsApp -----------------------------------------
  const mensaje = armarMensajeSolicitud(negocio.plantilla_solicitud || "", {
    pedidoId: pedido.id,
    fechaInicio: pedido.fecha_inicio,
    fechaFin: pedido.fecha_fin,
    dias,
    items: lineas,
    total: Number(pedido.total),
    moneda,
    nombre,
    telefono,
    notas,
  });
```

- [ ] **Step 3: Simplificar título y cuerpo del push**

En el bloque `// ---- Push al dueño ------------------------------------------------`
(líneas 216-249), eliminar el cálculo de `resumen` (ya no se usa) y cambiar `title`/`body`.

Reemplazar:

```ts
  const resumen = lineas
    .map((l) => `${l.cantidad} × ${l.producto_nombre}`)
    .join(", ")
    .slice(0, 160);

  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 5000);
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: auth,
      signal: controlador.signal,
      body: JSON.stringify({
        negocio_id: negocio.id,
        role: "admin",
        title: `Nuevo pedido de ${nombre}`,
        body: `${pedido.fecha_inicio} al ${pedido.fecha_fin} · ${dinero(Number(pedido.total))} ${moneda}\n${resumen}`,
        url: `https://tusalon.github.io/RomaDetalles/admin.html?pedido=${pedido.id}`,
      }),
    });
```

por:

```ts
  // El título lleva el nombre de la clienta solo si es corto (cabe en
  // una línea de notificación sin cortarse); si no, cae a un genérico.
  // El cuerpo YA NO mete fecha/artículos/total: en pedidos largos esos
  // datos se cortaban a media palabra al forzar los 160 caracteres. El
  // detalle completo se ve dentro del panel, donde sí cabe.
  const tituloPush =
    nombre && nombre.length <= 20 ? `Nueva solicitud de ${nombre}` : "Tienes una solicitud nueva";

  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 5000);
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: auth,
      signal: controlador.signal,
      body: JSON.stringify({
        negocio_id: negocio.id,
        role: "admin",
        title: tituloPush,
        body: "Toca para ver los detalles en el panel.",
        url: `https://tusalon.github.io/RomaDetalles/admin.html?pedido=${pedido.id}`,
      }),
    });
```

- [ ] **Step 4: Desplegar**

```bash
npx supabase functions deploy crear-pedido-alquiler --project-ref zorhclhvykikaachfrmp --no-verify-jwt
```

- [ ] **Step 5: Verificar con datos reales**

Primero, buscar un negocio y un producto reales (lectura pública, sin efectos secundarios):

```bash
curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_negocios?select=id,slug,plantilla_solicitud&activo=eq.true&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" | head -c 2000

curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_productos?select=id,nombre&activo=eq.true&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

(`$SUPABASE_ANON_KEY` es el valor de `SUPABASE_ANON_KEY` en `utils/supabase-config.js:8`.)

Con el `slug` y el `id` de producto obtenidos, crear un pedido de prueba:

```bash
curl -s -X POST "https://zorhclhvykikaachfrmp.supabase.co/functions/v1/crear-pedido-alquiler" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"slug":"<SLUG_REAL>","cliente_nombre":"Prueba Plan","cliente_telefono":"","notas":"",
       "fecha_inicio":"2026-09-01","fecha_fin":"2026-09-02",
       "items":[{"producto_id":"<PRODUCTO_ID_REAL>","cantidad":1}]}'
```

Expected: `201`, con `whatsapp_url` presente. Decodificar el `text=` de esa URL (por ejemplo con
`python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.argv[1]))" "<whatsapp_url>"`)
y confirmar que el mensaje sigue la plantilla por defecto (o la personalizada, si el negocio de
prueba ya tiene una en `plantilla_solicitud`). Confirmar además, en el panel del negocio de
prueba, que llegó un aviso con título `Nueva solicitud de Prueba Plan` y cuerpo
`Toca para ver los detalles en el panel.`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crear-pedido-alquiler/index.ts
git commit -m "edge: mensaje de solicitud personalizable y push sin detalle del pedido"
```

---

## Task 4: Edge Function `recordatorio-reservas-manana` — push simplificado

**Files:**
- Modify: `supabase/functions/recordatorio-reservas-manana/index.ts`

**Interfaces:**
- Sin cambios en el contrato HTTP (`{ ok, fecha, negocios_avisados, errores }`).

- [ ] **Step 1: Quitar el detalle por artículo del select y del cuerpo del push**

En `supabase/functions/recordatorio-reservas-manana/index.ts:56-59`, cambiar:

```ts
  const res = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_pedidos?fecha_inicio=eq.${manana}` +
    `&estado=in.(confirmado,entregado)&select=negocio_id,cliente_nombre,cliente_telefono,` +
    `alquiler_pedido_items(producto_nombre,cantidad)`,
    { headers },
  );
```

por:

```ts
  const res = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_pedidos?fecha_inicio=eq.${manana}` +
    `&estado=in.(confirmado,entregado)&select=negocio_id,cliente_nombre,cliente_telefono`,
    { headers },
  );
```

Luego, en el bloque del `for` (líneas 79-101), quitar el cálculo de `lineas` (ya no se usa) y
fijar el `body` del push. Reemplazar:

```ts
  for (const [negocioId, reservas] of Object.entries(porNegocio)) {
    const lineas = reservas.map((r: any) => {
      const items = (r.alquiler_pedido_items || [])
        .map((i: any) => `${i.cantidad}× ${i.producto_nombre}`)
        .join(", ");
      return `• ${r.cliente_nombre}${items ? " — " + items : ""}`;
    });

    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        negocio_id: negocioId,
        role: "admin",
        title: `Mañana tienes ${reservas.length} ${reservas.length === 1 ? "entrega" : "entregas"}`,
        body: lineas.join("\n"),
        url: "https://tusalon.github.io/RomaDetalles/admin.html",
      }),
    });
```

por:

```ts
  for (const [negocioId, reservas] of Object.entries(porNegocio)) {
    // El cuerpo ya no lista cliente por cliente ni artículo por
    // artículo: con varias entregas mañana esa lista se hacía larga y
    // se cortaba. El detalle completo está en la pestaña Reservas.
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        negocio_id: negocioId,
        role: "admin",
        title: `Mañana tienes ${reservas.length} ${reservas.length === 1 ? "entrega" : "entregas"}`,
        body: "Toca para ver el detalle en el panel.",
        url: "https://tusalon.github.io/RomaDetalles/admin.html",
      }),
    });
```

- [ ] **Step 2: Desplegar**

```bash
npx supabase functions deploy recordatorio-reservas-manana --project-ref zorhclhvykikaachfrmp --no-verify-jwt
```

- [ ] **Step 3: Verificar**

```bash
curl -s -X POST "https://zorhclhvykikaachfrmp.supabase.co/functions/v1/recordatorio-reservas-manana" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Expected: `{"ok":true,"fecha":"...",...}`. Si algún negocio tiene una reserva confirmada que
empieza mañana, revisar en su panel que el aviso llegó con cuerpo
`Toca para ver el detalle en el panel.` (si no hay ninguna reserva así hoy, basta con confirmar
que la función respondió sin error — el cambio de copy ya quedó verificado por lectura del
código en el Step 1).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/recordatorio-reservas-manana/index.ts
git commit -m "edge: recordatorio de mañana con aviso simplificado"
```

---

## Task 5: Panel.js — mensaje de solicitud en Configuración (+ arreglo de carga de plantillas)

**Files:**
- Modify: `utils/auth-alquiler.js:150-151`
- Modify: `components/Panel.js` (`guardarConfiguracion`, líneas 245-273; JSX de Configuración, líneas 912-921)

**Interfaces:**
- Consume: columna `alquiler_negocios.plantilla_solicitud` (Task 1).
- Produce: `negocio.plantilla_solicitud` disponible en el estado del panel, igual que
  `negocio.plantilla_confirmacion`.

Nota: al revisar `utils/auth-alquiler.js:150-151` para agregar `plantilla_solicitud` al select,
se encontró que ese select YA le faltaban `logo_url`, `plantilla_confirmacion` y
`plantilla_compartir` — es decir, el panel nunca cargaba esos tres campos al abrir, solo los
mandaba de vuelta (vacíos, si el dueño no los había tocado en esa sesión) al pulsar
"Guardar cambios". Eso significa que cualquier "Guardar cambios" que no fuera justo después de
escribirlos podía borrar en silencio un mensaje de confirmación o de compartir ya guardado. Se
arregla en el mismo Step por ser exactamente el mismo select que hay que tocar para
`plantilla_solicitud`.

- [ ] **Step 1: Arreglar el select del negocio (incluir los 4 campos)**

En `utils/auth-alquiler.js:150-151`, cambiar:

```js
        const negocios = await window.supaGet(
            `alquiler_negocios?id=eq.${vinculos[0].negocio_id}` +
            `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos,activo`
        );
```

por:

```js
        const negocios = await window.supaGet(
            `alquiler_negocios?id=eq.${vinculos[0].negocio_id}` +
            `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos,activo,` +
            `logo_url,plantilla_confirmacion,plantilla_compartir,plantilla_solicitud`
        );
```

- [ ] **Step 2: Incluir `plantilla_solicitud` al guardar Configuración**

En `components/Panel.js:245-273` (`guardarConfiguracion`), dentro del `body: JSON.stringify({...})`,
agregar la línea después de `plantilla_compartir`:

```js
                        plantilla_confirmacion: negocio.plantilla_confirmacion || '',
                        plantilla_compartir: negocio.plantilla_compartir || '',
                        plantilla_solicitud: negocio.plantilla_solicitud || '',
```

- [ ] **Step 3: Agregar el textarea en Configuración**

En `components/Panel.js`, después del bloque `Mensaje para compartir tu tienda`
(línea 917-921), agregar:

```jsx
                                <label className="wide">Mensaje de solicitud (de la clienta a ti)
                                    <textarea value={negocio.plantilla_solicitud || ''}
                                        onChange={(e) => setNegocio({ ...negocio, plantilla_solicitud: e.target.value })} />
                                    <small>Variables disponibles: {'{nombre}'}, {'{fechas}'}, {'{items}'}, {'{total}'}, {'{telefono}'}, {'{notas}'}, {'{pedido_id}'}. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.</small>
                                </label>
```

- [ ] **Step 4: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 5: Verificar en el navegador**

Con el servidor estático corriendo (`romadetalles-static`, puerto 5175):
1. Entrar a `admin.html`, iniciar sesión con una cuenta de negocio real.
2. Ir a Configuración y confirmar que, si ese negocio ya tenía un mensaje de confirmación
   guardado antes de este cambio, ahora aparece cargado en el textarea (antes aparecía vacío —
   así se confirma el arreglo del Step 1).
3. Escribir algo en "Mensaje de solicitud", pulsar "Guardar cambios", refrescar la página y
   confirmar que el texto sigue ahí.

- [ ] **Step 6: Commit**

```bash
git add utils/auth-alquiler.js components/Panel.js compiled/
git commit -m "panel: mensaje de solicitud personalizable y arreglo de carga de plantillas"
```

---

## Task 6: Panel.js — pestaña Galería

**Files:**
- Modify: `components/Panel.js` (nuevo estado, cargas, handlers, tab nav, JSX)
- Modify: `styles.css` (clases nuevas para la grilla de galería del panel)

**Interfaces:**
- Consume: tabla `alquiler_galeria` (Task 1), `window.subirFotoGaleria(file, negocioId)` (Task 2),
  `window.supaGet`/`window.supaHeaders` (`utils/supabase-config.js`, ya existentes).
- Produce: pestaña "Galería" funcional — no la consume ninguna otra tarea de este plan (Tienda.js
  lee la tabla directo, no pasa por el panel).

- [ ] **Step 1: Estado y carga**

En `components/Panel.js:170-184`, agregar al estado del componente `Panel`:

```js
    const [galeria, setGaleria] = useState([]);
    const [subiendoFotoGaleria, setSubiendoFotoGaleria] = useState(false);
```

Después de `cargarOcupacion` (línea 221-232), agregar:

```js
    const cargarGaleria = useCallback(async () => {
        try {
            setGaleria(await window.supaGet(
                `alquiler_galeria?negocio_id=eq.${negocio.id}` +
                `&select=id,imagen_url,descripcion,creado_en&order=creado_en.desc`
            ));
        } catch (e) {
            console.error('[Panel] error cargando galería:', e);
            notificar('No se pudo cargar la galería.');
        }
    }, [negocio.id]);
```

Y cambiar el `useEffect` de la línea 235:

```js
    useEffect(() => { if (pestana === 'ocupacion') cargarOcupacion(); }, [pestana, cargarOcupacion]);
```

por:

```js
    useEffect(() => { if (pestana === 'ocupacion') cargarOcupacion(); }, [pestana, cargarOcupacion]);
    useEffect(() => { if (pestana === 'galeria') cargarGaleria(); }, [pestana, cargarGaleria]);
```

- [ ] **Step 2: Handlers de subir / editar descripción / eliminar**

Después de `subirFoto` (`components/Panel.js:388-401`), agregar:

```js
    // ---- Galería de muestras -------------------------------------------
    async function agregarFotoGaleria(evento) {
        const archivo = evento.target.files?.[0];
        if (!archivo) return;
        setSubiendoFotoGaleria(true);
        const subida = await window.subirFotoGaleria(archivo, negocio.id);
        setSubiendoFotoGaleria(false);
        if (!subida) return;

        try {
            const res = await fetch(`${window.SUPABASE_URL}/rest/v1/alquiler_galeria`, {
                method: 'POST',
                headers: window.supaHeaders({ Prefer: 'return=representation' }),
                body: JSON.stringify({ negocio_id: negocio.id, imagen_url: subida.url, descripcion: '' })
            });
            if (!res.ok) throw new Error(await res.text());
            const [creada] = await res.json();
            setGaleria((actual) => [creada, ...actual]);
            notificar('Foto agregada a la galería.');
        } catch (e) {
            console.error('[Panel] error guardando foto de galería:', e);
            notificar('La foto se subió pero no se pudo guardar. Inténtalo de nuevo.');
        }
    }

    async function guardarDescripcionGaleria(foto) {
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ descripcion: foto.descripcion })
                }
            );
            notificar(res.ok ? 'Descripción guardada.' : 'No se pudo guardar.');
        } catch (e) {
            console.error('[Panel] error guardando descripción:', e);
            notificar('No se pudo guardar.');
        }
    }

    async function eliminarFotoGaleria(foto) {
        if (!window.confirm('¿Quitar esta foto de la galería?')) return;
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_galeria?id=eq.${foto.id}`,
                { method: 'DELETE', headers: window.supaHeaders({ Prefer: 'return=minimal' }) }
            );
            if (res.ok) {
                setGaleria((actual) => actual.filter((f) => f.id !== foto.id));
                notificar('Foto eliminada.');
            }
        } catch (e) {
            console.error('[Panel] error eliminando foto de galería:', e);
        }
    }
```

- [ ] **Step 3: Botón de pestaña en `admin-nav`**

En `components/Panel.js:545-556`, cambiar:

```jsx
                    <button className={pestana === 'ocupacion' ? 'active' : ''}
                        onClick={() => setPestana('ocupacion')}>Ocupación</button>
                    <button className={pestana === 'config' ? 'active' : ''}
                        onClick={() => setPestana('config')}>Configuración</button>
```

por:

```jsx
                    <button className={pestana === 'ocupacion' ? 'active' : ''}
                        onClick={() => setPestana('ocupacion')}>Ocupación</button>
                    <button className={pestana === 'galeria' ? 'active' : ''}
                        onClick={() => setPestana('galeria')}>Galería</button>
                    <button className={pestana === 'config' ? 'active' : ''}
                        onClick={() => setPestana('config')}>Configuración</button>
```

- [ ] **Step 4: JSX de la pestaña**

En `components/Panel.js`, entre el cierre de la pestaña Ocupación (línea 858, `)}`) y el
comentario `{/* ---- Configuración ---- */}` (línea 860), agregar:

```jsx
                    {/* ---- Galería ---- */}
                    {pestana === 'galeria' && (
                        <>
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Tu portafolio</p>
                                    <h1>Galería</h1>
                                </div>
                                <label className="upload galeria-add">
                                    {subiendoFotoGaleria ? 'Subiendo…' : '+ Agregar foto'}
                                    <input type="file" accept="image/*" disabled={subiendoFotoGaleria}
                                        onChange={agregarFotoGaleria} />
                                </label>
                            </div>
                            <p className="producto-form-nota">
                                Estas fotos se ven en tu tienda pública, en la sección
                                "Nuestros trabajos" — son la prueba de lo que ya has hecho.
                            </p>
                            <div className="admin-galeria">
                                {!galeria.length && (
                                    <div className="admin-card empty-orders">
                                        Todavía no tienes fotos. Pulsa «+ Agregar foto» para empezar.
                                    </div>
                                )}
                                {galeria.map((foto) => (
                                    <article className="admin-galeria-item admin-card" key={foto.id}>
                                        <img src={foto.imagen_url} alt="" />
                                        <textarea placeholder="Descripción corta (opcional)"
                                            value={foto.descripcion}
                                            onChange={(e) => setGaleria((actual) => actual.map((f) =>
                                                f.id === foto.id ? { ...f, descripcion: e.target.value } : f))} />
                                        <div className="admin-galeria-item-acciones">
                                            <button onClick={() => guardarDescripcionGaleria(foto)}>Guardar</button>
                                            <button className="danger" onClick={() => eliminarFotoGaleria(foto)}>Eliminar</button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </>
                    )}

```

- [ ] **Step 5: CSS de la grilla del panel**

En `styles.css`, después de la sección `/* --- Avisos push ... */` (después de la línea 269),
agregar:

```css
/* --- Galería de muestras (panel) -------------------------------------- */
.galeria-add { background:var(--lilac); border-radius:9px; color:var(--purple); cursor:pointer; font-size:12px; font-weight:800; padding:0 16px; min-height:42px; display:inline-flex; align-items:center; }
.galeria-add input { display:none; }
.admin-galeria { display:grid; gap:15px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); margin-top:20px; }
.admin-galeria-item { padding:14px; }
.admin-galeria-item img { aspect-ratio:4/3; border-radius:10px; object-fit:cover; width:100%; }
.admin-galeria-item textarea { background:white; border:1px solid var(--border); border-radius:8px; font-size:12px; margin-top:10px; min-height:56px; padding:8px 10px; resize:vertical; width:100%; }
.admin-galeria-item-acciones { display:flex; gap:8px; margin-top:10px; }
.admin-galeria-item-acciones button { flex:1; }
```

- [ ] **Step 6: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 7: Verificar en el navegador**

Con el servidor estático corriendo: entrar a `admin.html`, ir a la pestaña Galería, subir una
foto, confirmar que aparece en la grilla, escribirle una descripción y pulsar Guardar, refrescar
y confirmar que la descripción sigue ahí, y por último eliminarla y confirmar que desaparece.

- [ ] **Step 8: Commit**

```bash
git add components/Panel.js styles.css compiled/
git commit -m "panel: pestaña Galería de muestras"
```

---

## Task 7: Tienda.js — sección pública "Nuestros trabajos" + lightbox

**Files:**
- Modify: `components/Tienda.js` (carga de datos, estado del lightbox, sección nueva)
- Modify: `styles.css` (clases nuevas para la sección pública y el lightbox)

**Interfaces:**
- Consume: tabla `alquiler_galeria` (Task 1), vía `window.supaGet` (ya usado en el resto del
  archivo).
- Produce: nada que otra tarea de este plan consuma — es la última pieza visible.

- [ ] **Step 1: Cargar la galería junto con los productos**

En `components/Tienda.js:39-58`, agregar al estado:

```js
    const [galeria, setGaleria] = useState([]);
```

En `components/Tienda.js:88-89`, cambiar:

```js
                setProductos(items);
            } catch (e) {
```

por:

```js
                setProductos(items);

                const fotos = await window.supaGet(
                    `alquiler_galeria?negocio_id=eq.${neg.id}` +
                    `&select=id,imagen_url,descripcion&order=creado_en.desc`
                );
                setGaleria(fotos);
            } catch (e) {
```

- [ ] **Step 2: Estado del lightbox**

En el mismo bloque de estado (junto a `galeria`), agregar:

```js
    const [fotoAmpliada, setFotoAmpliada] = useState(null);
```

- [ ] **Step 3: Sección pública, entre "Tres pasos" y el footer**

En `components/Tienda.js`, entre el cierre de `</section>` de la sección `.how`
(línea 425) y `<footer` (línea 427), agregar:

```jsx
            {galeria.length > 0 && (
                <section className="galeria-publica shell" id="trabajos">
                    <div className="center-head">
                        <p className="eyebrow">Prueba de lo que hacemos</p>
                        <h2>Nuestros trabajos</h2>
                    </div>
                    <div className="galeria-publica-grid">
                        {galeria.map((foto) => (
                            <button className="galeria-publica-item" key={foto.id}
                                onClick={() => setFotoAmpliada(foto)}>
                                <img src={foto.imagen_url} alt={foto.descripcion || ''} />
                                {foto.descripcion && <span>{foto.descripcion}</span>}
                            </button>
                        ))}
                    </div>
                </section>
            )}

```

- [ ] **Step 4: Lightbox**

En `components/Tienda.js`, justo antes del cierre `</main>` final (línea 500), agregar:

```jsx
            {fotoAmpliada && (
                <>
                    <button className="overlay" aria-label="Cerrar" onClick={() => setFotoAmpliada(null)} />
                    <div className="lightbox">
                        <button className="lightbox-cerrar" aria-label="Cerrar"
                            onClick={() => setFotoAmpliada(null)}>×</button>
                        <img src={fotoAmpliada.imagen_url} alt={fotoAmpliada.descripcion || ''} />
                        {fotoAmpliada.descripcion && <p>{fotoAmpliada.descripcion}</p>}
                    </div>
                </>
            )}
```

- [ ] **Step 5: CSS de la sección pública y el lightbox**

En `styles.css`, después de la regla `.footer a {...}` (después de la línea 163, antes de
`.overlay`), agregar:

```css
/* --- Galería de muestras (tienda pública) ----------------------------- */
.galeria-publica { padding-block:100px; }
.galeria-publica-grid { column-gap:18px; columns:3; margin-top:50px; }
.galeria-publica-item { background:none; border:0; break-inside:avoid; cursor:pointer; display:block; margin-bottom:18px; padding:0; position:relative; width:100%; }
.galeria-publica-item img { border-radius:16px; display:block; width:100%; }
.galeria-publica-item span { background:linear-gradient(to top,rgba(38,29,41,.75),transparent); border-radius:0 0 16px 16px; bottom:0; color:white; font-size:12px; left:0; padding:24px 14px 12px; position:absolute; right:0; text-align:left; }

.lightbox { display:flex; flex-direction:column; align-items:center; gap:14px; inset:5vh 5vw; position:fixed; z-index:70; }
.lightbox img { border-radius:14px; max-height:80vh; max-width:100%; object-fit:contain; }
.lightbox p { background:rgba(38,29,41,.75); border-radius:999px; color:white; font-size:13px; margin:0; padding:8px 18px; }
.lightbox-cerrar { align-self:flex-end; background:white; border:0; border-radius:50%; cursor:pointer; font-size:22px; height:38px; width:38px; }
```

Y agregar el ajuste responsive, dentro de la media query ya existente `@media(max-width:800px)`
(línea 314):

```css
@media(max-width:800px){.section-head{align-items:start;flex-direction:column}.steps{grid-template-columns:1fr}.footer{grid-template-columns:1fr}.footer p{text-align:left}.galeria-publica-grid{columns:2}}
```

- [ ] **Step 6: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 7: Verificar en el navegador**

Con el servidor estático corriendo: abrir `index.html?s=<slug-de-un-negocio-con-fotos-en-galeria>`
(usar el mismo negocio de prueba de la Tarea 6, que ya debería tener al menos una foto subida),
confirmar que aparece la sección "Nuestros trabajos" con la foto, hacer clic y confirmar que abre
el lightbox con la foto en grande y su descripción, y cerrarlo. Abrir también la tienda de un
negocio SIN fotos en la galería y confirmar que la sección no aparece (sin hueco vacío).

- [ ] **Step 8: Commit**

```bash
git add components/Tienda.js styles.css compiled/
git commit -m "tienda: sección pública de galería de muestras con lightbox"
```

---

## Task 8: Cache-busting y verificación final integrada

**Files:**
- Modify: `index.html`, `admin.html` (bump de `?v=`)
- Modify: `sw.js` (bump de `CACHE_NAME`)

**Interfaces:**
- Consume: todos los archivos modificados en las Tareas 2, 5, 6 y 7 (`utils/storage.js`,
  `utils/auth-alquiler.js`, `styles.css`, `components/Panel.js`, `components/Tienda.js`).

- [ ] **Step 1: Subir el `CACHE_NAME` del service worker**

En `sw.js:10`, cambiar:

```js
const CACHE_NAME = 'romadetalles-v2';
```

por:

```js
const CACHE_NAME = 'romadetalles-v3';
```

- [ ] **Step 2: Subir el `?v=` de los archivos que cambiaron**

Elegir una marca de versión nueva (por ejemplo la fecha de hoy: `20260801-1`) y aplicarla:

En `admin.html`, actualizar las líneas de:
- `styles.css?v=...`
- `utils/storage.js?v=...`
- `utils/auth-alquiler.js?v=...` (si no llevaba `?v=`, agregárselo)
- `compiled/components/Panel.js?v=...`
- `compiled/admin-app.js?v=...`

En `index.html`, actualizar las líneas de:
- `styles.css?v=...`
- `compiled/components/Tienda.js?v=...`
- `compiled/tienda-app.js?v=...`

Todas a la misma marca nueva, por ejemplo `?v=20260801-1`.

- [ ] **Step 3: Verificación final en el navegador**

Con el servidor estático (`romadetalles-static`, puerto 5175) corriendo:
1. Abrir las herramientas de desarrollo → Application → Service Workers, forzar "Update" o
   desregistrar el anterior si quedó uno viejo del puerto 5175 de una prueba previa.
2. Repetir el recorrido completo: Configuración → mensaje de solicitud personalizado se guarda y
   recarga bien; pestaña Galería → subir/editar/eliminar foto; tienda pública → sección
   "Nuestros trabajos" visible con lightbox.
3. Confirmar en la consola que no hay errores 404 de archivos (`styles.css`, `Panel.js`,
   `Tienda.js`, `storage.js`, `auth-alquiler.js`) — un 404 ahí normalmente significa que el
   `?v=` no quedó igual en el HTML y el nombre del archivo referenciado.

- [ ] **Step 4: Commit**

```bash
git add index.html admin.html sw.js
git commit -m "cache: subir versión de assets tras notificaciones/solicitud/galería"
```

- [ ] **Step 5: Push**

```bash
git push
```

(Confirmar con el usuario antes de este paso — es lo que hace visible el cambio en GitHub Pages
para negocios reales.)
