# Calendario en el panel, enlace de reserva para la clienta, y borrado/filtro de reservas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un calendario mensual de reservas en el panel, un enlace propio por reserva que la clienta puede guardar/agregar a su calendario, y la posibilidad de ocultar reservas terminadas con un filtro por estado.

**Architecture:** Cada pedido gana un `token_acceso` no adivinable (independiente del `id` corto que ya existe) y una función pública `security definer` (mismo patrón que `alquiler_disponibilidad`) que devuelve los datos de esa reserva a quien tenga el token — sin exponer una política de `select` general sobre `alquiler_pedidos`. La tienda pública gana un componente nuevo, `MiReserva`, montado en vez de `Tienda` cuando la URL trae `?reserva=TOKEN`. El panel gana una columna `oculto` (ocultar sin borrar) y reutiliza la tarjeta de reserva actual, ahora extraída a su propio componente, tanto en la lista como en el calendario.

**Tech Stack:** JS/JSX sin bundler (compilado con `esbuild` vía `scripts/build-jsx.sh`), Supabase (Postgres/RLS/Edge Functions en Deno), GitHub Pages.

## Global Constraints

- **`token_acceso` nunca se devuelve en ningún select público ni en la propia función `alquiler_pedido_por_token`.** Es un secreto implícito: se conoce por tenerlo en la URL, no por consultarlo.
- **`alquiler_pedidos` sigue sin política de `select` pública.** El acceso de la clienta a su reserva pasa siempre por `alquiler_pedido_por_token`, `security definer`, igual que `alquiler_disponibilidad` ya hace hoy.
- **La clienta no puede cambiar fecha, artículos ni cantidad desde el enlace** — solo "Agregar a mi calendario" (descarga un `.ics`) y "Solicitar un cambio" (abre WhatsApp con un mensaje que menciona la fecha del evento, nunca el código interno del pedido — misma regla ya aplicada a los demás mensajes de cliente).
- **`oculto` es puramente de presentación.** No participa en `alquiler_disponibilidad` ni en `alquiler_ocupacion` — ocultar una reserva nunca libera ni bloquea stock, y el reporte de Ocupación sigue viendo el historial completo.
- **Solo se puede ocultar una reserva en estado `entregado`, `devuelto` o `cancelado`.** Si está `pendiente` o `confirmado`, el botón "Eliminar" no aparece.
- SQL idempotente: `if not exists` / `create or replace` / `drop policy if exists`.
- Tras editar cualquier `components/*.js`: correr `bash scripts/build-jsx.sh` y commitear `compiled/` en el MISMO commit que el fuente.
- Tras editar archivos referenciados desde los HTML: subir el `?v=` correspondiente (y `CACHE_NAME` en `sw.js` en la tarea final).
- Las migraciones SQL las corre el usuario a mano en el SQL Editor de Supabase; la tarea de SQL termina en un punto de pausa explícito.
- No hay framework de tests automatizados. La verificación es: SQL en el editor de Supabase, Edge Functions vía `curl`, y UI en el navegador con el servidor estático (`.claude/launch.json` → `romadetalles-static`).

---

## Task 1: Migración SQL — token de acceso, ocultar reservas, función pública por token

**Files:**
- Create: `sql/08-enlace-reserva-cliente.sql`

**Interfaces:**
- Produce:
  - `alquiler_pedidos.token_acceso text not null` (único, generado solo)
  - `alquiler_pedidos.oculto boolean not null default false`
  - `alquiler_pedido_por_token(p_token text) returns table (pedido_id text, fecha_evento date, fecha_inicio date, fecha_fin date, dias int, total numeric, anticipo numeric, estado text, moneda text, negocio_nombre text, negocio_whatsapp text, items jsonb)`
  - `alquiler_negocios.plantilla_solicitud` gana la variable `{enlace_reserva}` en su texto por defecto.

  Las Tareas 2, 3, 4 y 5 dependen de que esta migración esté aplicada en la base real.

- [ ] **Step 1: Escribir la migración**

```sql
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
```

- [ ] **Step 2: El usuario corre la migración en Supabase**

Pegar el SQL completo del Step 1 en el SQL Editor de Supabase (proyecto
`zorhclhvykikaachfrmp`) y ejecutarlo. Debe decir `Success. No rows returned`.

- [ ] **Step 3: Verificar que quedó bien aplicada**

El usuario corre esto en el mismo SQL Editor y pega el resultado:

```sql
select count(*) as pedidos_con_token
from alquiler_pedidos where token_acceso is not null and length(token_acceso) = 32;

select count(distinct token_acceso) = count(*) as todos_unicos
from alquiler_pedidos;

select proname from pg_proc where proname = 'alquiler_pedido_por_token';
```

Expected: `pedidos_con_token` = el total de pedidos que ya existan; `todos_unicos` = `true`;
`alquiler_pedido_por_token` aparece una vez.

- [ ] **Step 4: Commit**

```bash
git add sql/08-enlace-reserva-cliente.sql
git commit -m "sql: token de acceso por reserva, ocultar reservas, función pública por token"
```

---

## Task 2: Edge Function `crear-pedido-alquiler` — variable `{enlace_reserva}`

**Files:**
- Modify: `supabase/functions/crear-pedido-alquiler/index.ts`

**Interfaces:**
- Consume: `alquiler_pedidos.token_acceso` (Task 1, ya viene en el objeto que devuelve `alquiler_crear_pedido` porque esa función hace `returns alquiler_pedidos` — es decir, `pedido.token_acceso` ya está disponible sin tocar esa función SQL).
- Produce: `armarMensajeSolicitud` acepta un campo `enlaceReserva` nuevo; el texto por defecto y el mensaje final incluyen el enlace.

- [ ] **Step 1: Agregar `enlaceReserva` al tipo de datos y a las sustituciones**

Reemplazar en la firma de `armarMensajeSolicitud`:

```ts
    tarjeta: string;
    telefonoPago: string;
  },
): string {
```

por:

```ts
    tarjeta: string;
    telefonoPago: string;
    enlaceReserva: string;
  },
): string {
```

Y en la cadena de sustituciones, agregar la línea nueva junto a las demás:

```ts
    .replaceAll("{telefono_pago}", datos.telefonoPago)
```

por:

```ts
    .replaceAll("{telefono_pago}", datos.telefonoPago)
    .replaceAll("{enlace_reserva}", datos.enlaceReserva)
```

- [ ] **Step 2: Actualizar la plantilla por defecto**

Reemplazar `PLANTILLA_SOLICITUD_POR_DEFECTO` completa:

```ts
const PLANTILLA_SOLICITUD_POR_DEFECTO =
  "Hola, deseo solicitar este alquiler:\n" +
  "📅 Evento: {fechas}\n" +
  "\n" +
  "{items}\n" +
  "\n" +
  "💰 Total: {total}\n" +
  "{anticipo}\n" +
  "👤 Cliente: {nombre}\n" +
  "{telefono}\n" +
  "{notas}\n" +
  "Quedo pendiente de confirmación. Gracias.";
```

por:

```ts
const PLANTILLA_SOLICITUD_POR_DEFECTO =
  "Hola, deseo solicitar este alquiler:\n" +
  "📅 Evento: {fechas}\n" +
  "\n" +
  "{items}\n" +
  "\n" +
  "💰 Total: {total}\n" +
  "{anticipo}\n" +
  "👤 Cliente: {nombre}\n" +
  "{telefono}\n" +
  "{notas}\n" +
  "Quedo pendiente de confirmación. Gracias.\n" +
  "🔗 Guarda tu reserva aquí: {enlace_reserva}";
```

- [ ] **Step 3: Pasar el enlace real en la llamada**

Reemplazar:

```ts
  const mensaje = armarMensajeSolicitud(negocio.plantilla_solicitud || "", {
    pedidoId: pedido.id,
    fechaEvento: fechaLarga(pedido.fecha_evento),
    items: lineas,
    total: Number(pedido.total),
    anticipo: Number(pedido.anticipo || 0),
    moneda,
    nombre,
    telefono,
    notas,
    tarjeta: negocio.pago_tarjeta || "",
    telefonoPago: negocio.pago_telefono || "",
  });
```

por:

```ts
  const mensaje = armarMensajeSolicitud(negocio.plantilla_solicitud || "", {
    pedidoId: pedido.id,
    fechaEvento: fechaLarga(pedido.fecha_evento),
    items: lineas,
    total: Number(pedido.total),
    anticipo: Number(pedido.anticipo || 0),
    moneda,
    nombre,
    telefono,
    notas,
    tarjeta: negocio.pago_tarjeta || "",
    telefonoPago: negocio.pago_telefono || "",
    enlaceReserva: `https://tusalon.github.io/RomaDetalles/index.html?reserva=${pedido.token_acceso}`,
  });
```

- [ ] **Step 4: Desplegar**

```bash
npx supabase functions deploy crear-pedido-alquiler --project-ref zorhclhvykikaachfrmp --no-verify-jwt
```

- [ ] **Step 5: Verificar con datos reales**

Buscar un negocio y un producto reales (lecturas públicas, sin efectos secundarios).
`$SUPABASE_ANON_KEY` es el valor de `SUPABASE_ANON_KEY` en `utils/supabase-config.js`:

```bash
curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_negocios?select=id,slug&activo=eq.true&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"

curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_productos?select=id,nombre&activo=eq.true&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Con esos datos, crear un pedido de prueba:

```bash
curl -s -X POST "https://zorhclhvykikaachfrmp.supabase.co/functions/v1/crear-pedido-alquiler" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"slug":"<SLUG_REAL>","cliente_nombre":"Prueba Enlace","cliente_telefono":"","notas":"",
       "fecha_evento":"2026-10-05",
       "items":[{"producto_id":"<PRODUCTO_ID_REAL>","cantidad":1}]}'
```

Expected: `201`. Decodificar el `text=` del `whatsapp_url` (por ejemplo con
`python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.argv[1]))" "<whatsapp_url>"`)
y confirmar que termina con una línea `🔗 Guarda tu reserva aquí:
https://tusalon.github.io/RomaDetalles/index.html?reserva=<32 caracteres hex>`.

Guardar ese token para reusarlo verificando la Tarea 1 desde el otro lado:

```bash
curl -s -X POST "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/rpc/alquiler_pedido_por_token" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_token":"<TOKEN_DEL_ENLACE>"}'
```

Expected: un arreglo con un objeto que tiene `fecha_evento`, `items`, `total`, etc. — y que
**no** incluye ningún campo `token_acceso`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/crear-pedido-alquiler/index.ts
git commit -m "edge: agregar {enlace_reserva} al mensaje de solicitud"
```

---

## Task 3: Tienda pública — vista "Mi reserva"

**Files:**
- Modify: `components/Tienda.js`
- Modify: `tienda-app.js`
- Modify: `styles.css`

**Interfaces:**
- Consume: `alquiler_pedido_por_token(p_token)` (Task 1, ya aplicada).
- Produce: `window.MiReserva` — nuevo componente montado por `tienda-app.js` cuando la URL trae `?reserva=`. No lo consume ninguna otra tarea de este plan.

- [ ] **Step 1: Agregar el componente `MiReserva` a `components/Tienda.js`**

Agregar, después de la función `Tienda` y antes de `window.Tienda = Tienda;` (es decir, al final
del archivo):

```jsx
const ETIQUETA_ESTADO_CLIENTE = {
    pendiente: 'Pendiente',
    confirmado: 'Confirmada',
    entregado: 'Entregada',
    devuelto: 'Devuelta',
    cancelado: 'Cancelada'
};

function tokenDeLaUrl() {
    return new URLSearchParams(window.location.search).get('reserva') || '';
}

// Guarda el token en localStorage (hasta los últimos 10) para que
// "Mis reservas" pueda ofrecerlo de nuevo sin que la clienta tenga que
// volver a buscar el enlace de WhatsApp.
function guardarReservaLocal(token) {
    try {
        const clave = 'romadetallesMisReservas';
        const actual = JSON.parse(localStorage.getItem(clave) || '[]');
        if (!actual.includes(token)) {
            actual.push(token);
            localStorage.setItem(clave, JSON.stringify(actual.slice(-10)));
        }
    } catch (e) {
        console.warn('[MiReserva] no se pudo guardar en localStorage:', e);
    }
}

function tokensGuardados() {
    try {
        return JSON.parse(localStorage.getItem('romadetallesMisReservas') || '[]');
    } catch {
        return [];
    }
}

// Archivo .ics mínimo (formato VCALENDAR/VEVENT) — sin librerías. Es lo
// que de verdad deja la cita guardada en el Calendario nativo del
// teléfono (iPhone, Android, Google Calendar la abren directo).
function armarICS(reserva) {
    const fecha = reserva.fecha_evento.replace(/-/g, '');
    const items = (reserva.items || [])
        .map((i) => `${i.cantidad} x ${i.producto_nombre}`)
        .join(', ');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//RomaDetalles//Reserva//ES',
        'BEGIN:VEVENT',
        `UID:${reserva.pedido_id}@romadetalles`,
        `DTSTART;VALUE=DATE:${fecha}`,
        `SUMMARY:Evento — ${reserva.negocio_nombre}`,
        `DESCRIPTION:${items}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

function descargarICS(reserva) {
    const blob = new Blob([armarICS(reserva)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reserva-${reserva.fecha_evento}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function MiReserva({ token }) {
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [reserva, setReserva] = useState(null);
    const [otrasGuardadas, setOtrasGuardadas] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const filas = await window.supaRpc('alquiler_pedido_por_token', { p_token: token });
                if (!filas.length) {
                    setError('No encontramos esta reserva. Revisa el enlace.');
                    setCargando(false);
                    return;
                }
                setReserva(filas[0]);
                guardarReservaLocal(token);
            } catch (e) {
                console.error('[MiReserva] error cargando:', e);
                setError('No se pudo cargar tu reserva. Revisa tu conexión.');
            } finally {
                setCargando(false);
            }
        })();
    }, [token]);

    // Otras reservas guardadas en este teléfono, para el enlace "Ver
    // mis otras reservas" — se resuelven en paralelo, cada una con su
    // propio RPC (la lista es corta, como mucho 10).
    useEffect(() => {
        const tokens = tokensGuardados().filter((t) => t !== token);
        if (!tokens.length) return;
        let vigente = true;
        Promise.all(
            tokens.map((t) =>
                window.supaRpc('alquiler_pedido_por_token', { p_token: t })
                    .then((filas) => (filas[0] ? { token: t, fecha_evento: filas[0].fecha_evento } : null))
                    .catch(() => null)
            )
        ).then((resultados) => {
            if (vigente) setOtrasGuardadas(resultados.filter(Boolean));
        });
        return () => { vigente = false; };
    }, [token]);

    if (cargando) {
        return (
            <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
                <span>✦</span>
                <h3>Cargando tu reserva…</h3>
            </div>
        );
    }

    if (error || !reserva) {
        return (
            <div className="empty" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
                <span>✦</span>
                <h3>{error || 'No encontramos esta reserva.'}</h3>
            </div>
        );
    }

    const moneda = reserva.moneda || 'CUP';
    const etiqueta = ETIQUETA_ESTADO_CLIENTE[reserva.estado] || reserva.estado;

    function solicitarCambio() {
        const numero = (reserva.negocio_whatsapp || '').replace(/\D/g, '');
        const mensaje = `Hola, quiero pedir un cambio en mi reserva del ${fechaLarga(reserva.fecha_evento)}.`;
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
    }

    return (
        <main>
            <header className="header">
                <a className="brand" href="#"><span>✦</span> {reserva.negocio_nombre}</a>
            </header>
            <section className="shell" style={{ paddingBlock: '60px' }}>
                <div className="admin-card" style={{ margin: '0 auto', maxWidth: '480px', padding: '28px' }}>
                    <span className={`order-chip ${reserva.estado}`}>{etiqueta}</span>
                    <h1 style={{ color: 'var(--burgundy)', fontFamily: 'var(--serif)', margin: '14px 0 4px' }}>
                        {fechaLarga(reserva.fecha_evento)}
                    </h1>
                    <p style={{ color: 'var(--muted)' }}>
                        Recoges el {fechaLarga(reserva.fecha_inicio)} después de las 5:00 PM
                    </p>
                    <ul>
                        {(reserva.items || []).map((item, i) => (
                            <li key={i}>{item.cantidad} × {item.producto_nombre}</li>
                        ))}
                    </ul>
                    <p><strong>Total: {dinero(reserva.total)} {moneda}</strong></p>
                    {Number(reserva.anticipo) > 0 && (
                        <p>Anticipo: {dinero(reserva.anticipo)} {moneda}</p>
                    )}
                    <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
                        <button className="primary" onClick={() => descargarICS(reserva)}>
                            Agregar a mi calendario
                        </button>
                        <button className="secondary" onClick={solicitarCambio}>
                            Solicitar un cambio
                        </button>
                    </div>
                    {otrasGuardadas.length > 0 && (
                        <div className="mis-reservas-otras">
                            <small>Tus otras reservas guardadas:</small>
                            {otrasGuardadas.map((r) => (
                                <a key={r.token} href={`?reserva=${r.token}`}>{fechaLarga(r.fecha_evento)}</a>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}

window.MiReserva = MiReserva;
```

- [ ] **Step 2: Montar `MiReserva` cuando la URL trae `?reserva=`**

Reemplazar el contenido completo de `tienda-app.js`:

```js
// tienda-app.js — Monta la tienda pública.

const raizTienda = document.getElementById('root');
ReactDOM.createRoot(raizTienda).render(React.createElement(window.Tienda));
```

por:

```js
// tienda-app.js — Monta la tienda pública, o la vista de "Mi reserva"
// si la URL trae ?reserva=TOKEN.

const raizTienda = document.getElementById('root');
const tokenReserva = new URLSearchParams(window.location.search).get('reserva');
ReactDOM.createRoot(raizTienda).render(
    tokenReserva
        ? React.createElement(window.MiReserva, { token: tokenReserva })
        : React.createElement(window.Tienda)
);
```

- [ ] **Step 3: CSS de "otras reservas guardadas"**

En `styles.css`, después de la regla `.datos-pago small`, agregar:

```css
.mis-reservas-otras { border-top:1px solid var(--border); display:grid; gap:6px; margin-top:18px; padding-top:14px; }
.mis-reservas-otras small { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
.mis-reservas-otras a { color:var(--purple); font-size:13px; text-decoration:underline; text-underline-offset:3px; }
```

- [ ] **Step 4: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 5: Verificar en el navegador**

Con el servidor estático (`romadetalles-static`) corriendo, y usando el token real obtenido en
la Tarea 2 (Step 5):

1. Abrir `index.html?reserva=<TOKEN_REAL>`. Confirmar que se ve la pantalla de "Mi reserva" (no
   el catálogo): fecha del evento en formato largo, artículos, total, chip de estado
   "Pendiente".
2. Pulsar "Agregar a mi calendario": debe descargarse un archivo `.ics`. Abrirlo con un editor
   de texto y confirmar que tiene `BEGIN:VCALENDAR` / `DTSTART;VALUE=DATE:` con la fecha
   correcta / `END:VCALENDAR`.
3. Pulsar "Solicitar un cambio": debe abrir WhatsApp con un mensaje que mencione la fecha del
   evento, sin ningún código tipo `RD-`.
4. Abrir `index.html?reserva=token-invalido-cualquiera` y confirmar que dice "No encontramos
   esta reserva."
5. Consola sin errores en ninguno de los dos casos.

- [ ] **Step 6: Commit**

```bash
git add components/Tienda.js tienda-app.js styles.css compiled/
git commit -m "tienda: vista Mi reserva — agregar a calendario, solicitar cambio, guardado local"
```

---

## Task 4: Panel — extraer `TarjetaReserva`, filtro por estado, ocultar reservas

**Files:**
- Modify: `components/Panel.js`
- Modify: `styles.css`

**Interfaces:**
- Consume: `alquiler_pedidos.oculto` (Task 1, ya aplicada).
- Produce: `TarjetaReserva({ pedido, moneda, onCambiarEstado, onEliminar })` — componente nuevo
  que la Tarea 5 (calendario) reutiliza tal cual, sin cambiarlo.

- [ ] **Step 1: Extraer `TarjetaReserva`**

Agregar, después de la función `TarjetaAvisos` (justo antes del comentario
`// Panel principal`):

```jsx
// ---------------------------------------------------------------------
// Tarjeta de una reserva — la usan tanto la Lista como el Calendario
// ---------------------------------------------------------------------
function TarjetaReserva({ pedido, moneda, onCambiarEstado, onEliminar }) {
    const puedeEliminar =
        pedido.estado === 'entregado' || pedido.estado === 'devuelto' || pedido.estado === 'cancelado';

    return (
        <article className="admin-order admin-card">
            <div>
                <span className={`order-chip ${pedido.estado}`}>
                    {ETIQUETA_ESTADO[pedido.estado] || pedido.estado}
                </span>
                <h3>{pedido.cliente_nombre}</h3>
                {pedido.dias > 1
                    ? <p>{pedido.id} · Reserva anterior: {fechaLargaPanel(pedido.fecha_inicio)} al {fechaLargaPanel(pedido.fecha_fin)} · {pedido.dias} días</p>
                    : <p>{pedido.id} · Evento: {fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio)}</p>}
                {pedido.dias <= 1 && (
                    <p>Recoge el {fechaLargaPanel(pedido.fecha_inicio)} después de las 5:00 PM</p>
                )}
                {pedido.cliente_telefono && (
                    <p>📞 <a href={`tel:${pedido.cliente_telefono}`}>{pedido.cliente_telefono}</a></p>
                )}
                {pedido.notas && <p>📝 {pedido.notas}</p>}
            </div>
            <ul>
                {(pedido.alquiler_pedido_items || []).map((item) => (
                    <li key={item.id}>{item.cantidad} × {item.producto_nombre}</li>
                ))}
            </ul>
            <div className="order-importes">
                <strong>{dineroPanel(pedido.total)} {moneda}</strong>
                {Number(pedido.anticipo) > 0 && (
                    <small>Anticipo: {dineroPanel(pedido.anticipo)} {moneda}</small>
                )}
            </div>
            <div>
                {pedido.estado === 'pendiente' && (
                    <button onClick={() => onCambiarEstado(pedido, 'confirmado')}>Confirmar</button>
                )}
                {pedido.estado === 'confirmado' && (
                    <button onClick={() => onCambiarEstado(pedido, 'entregado')}>Entregada</button>
                )}
                {pedido.estado === 'entregado' && (
                    <button onClick={() => onCambiarEstado(pedido, 'devuelto')}>Devuelta</button>
                )}
                {pedido.estado !== 'cancelado' && pedido.estado !== 'devuelto' && (
                    <button className="danger" onClick={() => onCambiarEstado(pedido, 'cancelado')}>Cancelar</button>
                )}
                {puedeEliminar && (
                    <button className="danger" onClick={() => onEliminar(pedido)}>Eliminar</button>
                )}
            </div>
        </article>
    );
}
```

- [ ] **Step 2: Handler de eliminar y excluir `oculto` de la carga**

En `cargarPedidos`, reemplazar:

```js
                `alquiler_pedidos?negocio_id=eq.${negocio.id}` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
```

por:

```js
                `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
```

Después de `cambiarEstado` (la función que ya existe), agregar:

```js
    async function eliminarReserva(pedido) {
        if (!window.confirm('¿Quitar esta reserva de la lista? No se borra del historial de Ocupación.')) return;
        try {
            const res = await fetch(
                `${window.SUPABASE_URL}/rest/v1/alquiler_pedidos?id=eq.${pedido.id}`,
                {
                    method: 'PATCH',
                    headers: window.supaHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({ oculto: true, actualizado_en: new Date().toISOString() })
                }
            );
            if (res.ok) {
                setPedidos((actual) => actual.filter((p) => p.id !== pedido.id));
                notificar('Reserva quitada de la lista.');
            } else {
                notificar('No se pudo eliminar la reserva.');
            }
        } catch (e) {
            console.error('[Panel] error eliminando reserva:', e);
            notificar('No se pudo eliminar la reserva.');
        }
    }
```

- [ ] **Step 3: Filtro por estado**

Agregar el estado del filtro junto a los demás `useState` del componente `Panel`
(junto a `reservaManual`):

```js
    const [filtroReservas, setFiltroReservas] = useState('todas');
```

Después de `mensajeDeErrorReserva` (fuera del componente `Panel`, a nivel de módulo, junto a las
otras funciones puras), agregar:

```js
function cumpleFiltroReserva(estado, filtro) {
    if (filtro === 'todas') return true;
    if (filtro === 'pendientes') return estado === 'pendiente' || estado === 'confirmado';
    if (filtro === 'completadas') return estado === 'entregado' || estado === 'devuelto';
    if (filtro === 'canceladas') return estado === 'cancelado';
    return true;
}
```

- [ ] **Step 4: Reemplazar la lista de Reservas para usar `TarjetaReserva` y el filtro**

Reemplazar el bloque completo desde `<TarjetaAvisos ... />` hasta el cierre de
`.admin-orders`:

```jsx
                            <TarjetaAvisos negocioId={negocio.id} />

                            <div className="admin-orders">
                                {!pedidos.length && (
                                    <div className="admin-card empty-orders">
                                        Todavía no hay solicitudes.
                                    </div>
                                )}
                                {pedidos.map((pedido) => (
                                    <article className="admin-order admin-card" key={pedido.id}>
                                        <div>
                                            <span className={`order-chip ${pedido.estado}`}>
                                                {ETIQUETA_ESTADO[pedido.estado] || pedido.estado}
                                            </span>
                                            <h3>{pedido.cliente_nombre}</h3>
                                            {pedido.dias > 1
                                                ? <p>{pedido.id} · Reserva anterior: {fechaLargaPanel(pedido.fecha_inicio)} al {fechaLargaPanel(pedido.fecha_fin)} · {pedido.dias} días</p>
                                                : <p>{pedido.id} · Evento: {fechaLargaPanel(pedido.fecha_evento || pedido.fecha_inicio)}</p>}
                                            {pedido.dias <= 1 && (
                                                <p>Recoge el {fechaLargaPanel(pedido.fecha_inicio)} después de las 5:00 PM</p>
                                            )}
                                            {pedido.cliente_telefono && (
                                                <p>📞 <a href={`tel:${pedido.cliente_telefono}`}>{pedido.cliente_telefono}</a></p>
                                            )}
                                            {pedido.notas && <p>📝 {pedido.notas}</p>}
                                        </div>
                                        <ul>
                                            {(pedido.alquiler_pedido_items || []).map((item) => (
                                                <li key={item.id}>{item.cantidad} × {item.producto_nombre}</li>
                                            ))}
                                        </ul>
                                        <div className="order-importes">
                                            <strong>{dineroPanel(pedido.total)} {moneda}</strong>
                                            {Number(pedido.anticipo) > 0 && (
                                                <small>Anticipo: {dineroPanel(pedido.anticipo)} {moneda}</small>
                                            )}
                                        </div>
                                        <div>
                                            {pedido.estado === 'pendiente' && (
                                                <button onClick={() => cambiarEstado(pedido, 'confirmado')}>Confirmar</button>
                                            )}
                                            {pedido.estado === 'confirmado' && (
                                                <button onClick={() => cambiarEstado(pedido, 'entregado')}>Entregada</button>
                                            )}
                                            {pedido.estado === 'entregado' && (
                                                <button onClick={() => cambiarEstado(pedido, 'devuelto')}>Devuelta</button>
                                            )}
                                            {pedido.estado !== 'cancelado' && pedido.estado !== 'devuelto' && (
                                                <button className="danger" onClick={() => cambiarEstado(pedido, 'cancelado')}>Cancelar</button>
                                            )}
                                        </div>
                                    </article>
                                ))}
                            </div>
```

por:

```jsx
                            <TarjetaAvisos negocioId={negocio.id} />

                            <div className="reserva-filtros">
                                {[
                                    ['todas', 'Todas'],
                                    ['pendientes', 'Pendientes'],
                                    ['completadas', 'Completadas'],
                                    ['canceladas', 'Canceladas']
                                ].map(([valor, etiqueta]) => (
                                    <button key={valor}
                                        className={filtroReservas === valor ? 'active' : ''}
                                        onClick={() => setFiltroReservas(valor)}>
                                        {etiqueta}
                                    </button>
                                ))}
                            </div>

                            <div className="admin-orders">
                                {!pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).length && (
                                    <div className="admin-card empty-orders">
                                        {pedidos.length ? 'Ninguna reserva con ese filtro.' : 'Todavía no hay solicitudes.'}
                                    </div>
                                )}
                                {pedidos
                                    .filter((p) => cumpleFiltroReserva(p.estado, filtroReservas))
                                    .map((pedido) => (
                                        <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                            onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva} />
                                    ))}
                            </div>
```

- [ ] **Step 5: CSS de los chips de filtro**

En `styles.css`, después de la regla `.empty-orders`, agregar:

```css
.reserva-filtros { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
.reserva-filtros button { background:white; border:1px solid var(--border); border-radius:999px; cursor:pointer; font-size:12px; font-weight:700; min-height:38px; padding:0 16px; }
.reserva-filtros button.active { background:var(--burgundy); border-color:var(--burgundy); color:white; }
```

- [ ] **Step 6: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 7: Verificar en el navegador**

Con el servidor estático corriendo, entrar a `admin.html` con la cuenta de prueba:

1. Reservas: aparecen los 4 chips (Todas / Pendientes / Completadas / Canceladas). Tocar cada
   uno filtra la lista correctamente.
2. En una reserva `pendiente` o `confirmada`: no aparece el botón "Eliminar".
3. Crear una reserva manual de prueba, cancelarla (botón "Cancelar" ya existente), confirmar
   que AHORA sí aparece "Eliminar". Pulsarlo, confirmar el diálogo, y verificar que desaparece
   de la lista.
4. Recargar la página y confirmar que la reserva eliminada sigue sin aparecer (quedó
   `oculto=true` en la base, no reaparece).
5. Consola sin errores.

- [ ] **Step 8: Commit**

```bash
git add components/Panel.js styles.css compiled/
git commit -m "panel: filtro de reservas por estado y ocultar reservas terminadas"
```

---

## Task 5: Panel — calendario mensual dentro de Reservas

**Files:**
- Modify: `components/Panel.js`
- Modify: `styles.css`

**Interfaces:**
- Consume: `TarjetaReserva` (Task 4, ya aprobada — no se modifica, solo se reutiliza).
- Produce: nada que otra tarea consuma.

- [ ] **Step 1: Estado y carga del mes**

Junto a `filtroReservas` (agregado en la Tarea 4), agregar:

```js
    const [vistaReservas, setVistaReservas] = useState('lista');
    const [mesCalendario, setMesCalendario] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [pedidosMes, setPedidosMes] = useState([]);
    const [diaSeleccionado, setDiaSeleccionado] = useState(null);
```

Después de `cargarPedidos` (el `useCallback` ya existente), agregar:

```js
    const cargarPedidosDelMes = useCallback(async () => {
        const [anio, mes] = mesCalendario.split('-').map(Number);
        const desde = `${mesCalendario}-01`;
        const hasta = `${mesCalendario}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
        try {
            const filas = await window.supaGet(
                `alquiler_pedidos?negocio_id=eq.${negocio.id}&oculto=eq.false` +
                `&fecha_evento=gte.${desde}&fecha_evento=lte.${hasta}` +
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
                `alquiler_pedido_items(id,producto_nombre,cantidad)` +
                `&order=fecha_evento.asc`
            );
            setPedidosMes(filas);
        } catch (e) {
            console.error('[Panel] error cargando calendario:', e);
            notificar('No se pudo cargar el calendario.');
        }
    }, [negocio.id, mesCalendario]);
```

Junto al `useEffect` que ya llama `cargarProductos`/`cargarPedidos`, agregar:

```js
    useEffect(() => {
        if (pestana === 'reservas' && vistaReservas === 'calendario') cargarPedidosDelMes();
    }, [pestana, vistaReservas, cargarPedidosDelMes]);
```

- [ ] **Step 2: Helpers de mes/día (fuera del componente `Panel`, junto a `cumpleFiltroReserva`)**

```js
const NOMBRES_MES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Cuadrícula del mes: null para los huecos antes del día 1 (para que
// el primer día caiga en su columna real de domingo a sábado).
function diasDelMesPanel(mesStr) {
    const [anio, mes] = mesStr.split('-').map(Number);
    const primerDia = new Date(anio, mes - 1, 1);
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const celdas = [];
    for (let i = 0; i < primerDia.getDay(); i++) celdas.push(null);
    for (let d = 1; d <= ultimoDia; d++) {
        celdas.push(`${mesStr}-${String(d).padStart(2, '0')}`);
    }
    return celdas;
}
```

- [ ] **Step 3: Handler de navegación de mes**

Junto a `eliminarReserva` (agregado en la Tarea 4), agregar:

```js
    function cambiarMesCalendario(delta) {
        const [anio, mes] = mesCalendario.split('-').map(Number);
        const d = new Date(anio, mes - 1 + delta, 1);
        setMesCalendario(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        setDiaSeleccionado(null);
    }
```

- [ ] **Step 4: Interruptor Lista/Calendario y vista de calendario**

Reemplazar el `<div className="admin-title">` de Reservas:

```jsx
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Agenda y disponibilidad</p>
                                    <h1>Reservas</h1>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {!reservaManual && (
                                        <button onClick={abrirReservaManual}>+ Reserva manual</button>
                                    )}
                                    <button onClick={cargarPedidos}>Actualizar</button>
                                </div>
                            </div>
```

por:

```jsx
                            <div className="admin-title">
                                <div>
                                    <p className="eyebrow">Agenda y disponibilidad</p>
                                    <h1>Reservas</h1>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div className="vista-toggle">
                                        <button className={vistaReservas === 'lista' ? 'active' : ''}
                                            onClick={() => setVistaReservas('lista')}>Lista</button>
                                        <button className={vistaReservas === 'calendario' ? 'active' : ''}
                                            onClick={() => setVistaReservas('calendario')}>Calendario</button>
                                    </div>
                                    {!reservaManual && (
                                        <button onClick={abrirReservaManual}>+ Reserva manual</button>
                                    )}
                                    <button onClick={vistaReservas === 'calendario' ? cargarPedidosDelMes : cargarPedidos}>
                                        Actualizar
                                    </button>
                                </div>
                            </div>
```

Después del cierre de `.admin-orders` (el `</div>` que la Tarea 4 dejó, justo antes del `</>`
final de la pestaña Reservas), agregar la vista de calendario, envolviendo la vista de lista
existente en una condición y agregando la nueva:

Reemplazar:

```jsx
                            <div className="admin-orders">
                                {!pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).length && (
                                    <div className="admin-card empty-orders">
                                        {pedidos.length ? 'Ninguna reserva con ese filtro.' : 'Todavía no hay solicitudes.'}
                                    </div>
                                )}
                                {pedidos
                                    .filter((p) => cumpleFiltroReserva(p.estado, filtroReservas))
                                    .map((pedido) => (
                                        <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                            onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva} />
                                    ))}
                            </div>
```

por:

```jsx
                            {vistaReservas === 'lista' ? (
                                <div className="admin-orders">
                                    {!pedidos.filter((p) => cumpleFiltroReserva(p.estado, filtroReservas)).length && (
                                        <div className="admin-card empty-orders">
                                            {pedidos.length ? 'Ninguna reserva con ese filtro.' : 'Todavía no hay solicitudes.'}
                                        </div>
                                    )}
                                    {pedidos
                                        .filter((p) => cumpleFiltroReserva(p.estado, filtroReservas))
                                        .map((pedido) => (
                                            <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                                onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva} />
                                        ))}
                                </div>
                            ) : (
                                <>
                                    <div className="calendario-nav">
                                        <button onClick={() => cambiarMesCalendario(-1)}>←</button>
                                        <strong>
                                            {NOMBRES_MES[Number(mesCalendario.split('-')[1]) - 1]} {mesCalendario.split('-')[0]}
                                        </strong>
                                        <button onClick={() => cambiarMesCalendario(1)}>→</button>
                                    </div>
                                    <div className="calendario-grid">
                                        {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((d, i) => (
                                            <span className="calendario-dow" key={i}>{d}</span>
                                        ))}
                                        {diasDelMesPanel(mesCalendario).map((dia, i) => {
                                            const enEsteDia = dia ? pedidosMes.filter((p) => p.fecha_evento === dia) : [];
                                            return (
                                                <button key={i}
                                                    className={`calendario-dia${dia ? '' : ' vacio'}${diaSeleccionado === dia ? ' activo' : ''}`}
                                                    disabled={!dia}
                                                    onClick={() => setDiaSeleccionado(dia)}>
                                                    {dia && <span>{Number(dia.split('-')[2])}</span>}
                                                    {enEsteDia.length > 0 && <b>{enEsteDia.length}</b>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {diaSeleccionado && (
                                        <div className="admin-orders" style={{ marginTop: '20px' }}>
                                            <h3>{fechaLargaPanel(diaSeleccionado)}</h3>
                                            {!pedidosMes.filter((p) => p.fecha_evento === diaSeleccionado).length && (
                                                <div className="admin-card empty-orders">
                                                    No hay reservas ese día.
                                                </div>
                                            )}
                                            {pedidosMes
                                                .filter((p) => p.fecha_evento === diaSeleccionado)
                                                .map((pedido) => (
                                                    <TarjetaReserva key={pedido.id} pedido={pedido} moneda={moneda}
                                                        onCambiarEstado={cambiarEstado} onEliminar={eliminarReserva} />
                                                ))}
                                        </div>
                                    )}
                                </>
                            )}
```

- [ ] **Step 5: CSS del calendario**

En `styles.css`, después de la regla `.reserva-filtros button.active`, agregar:

```css
.vista-toggle { background:var(--cream); border-radius:10px; display:flex; gap:2px; padding:3px; }
.vista-toggle button { background:transparent; border:0; border-radius:8px; cursor:pointer; font-size:12px; font-weight:700; min-height:36px; padding:0 14px; }
.vista-toggle button.active { background:var(--burgundy); color:white; }
.calendario-nav { align-items:center; display:flex; gap:16px; justify-content:center; margin-bottom:16px; }
.calendario-nav button { background:var(--cream); border:0; border-radius:50%; cursor:pointer; font-size:16px; height:36px; width:36px; }
.calendario-nav strong { color:var(--burgundy); font-family:var(--serif); font-size:18px; text-transform:capitalize; }
.calendario-grid { display:grid; gap:6px; grid-template-columns:repeat(7,1fr); }
.calendario-dow { color:var(--muted); font-size:10px; font-weight:800; text-align:center; text-transform:uppercase; }
.calendario-dia { aspect-ratio:1; background:white; border:1px solid var(--border); border-radius:10px; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:4px; position:relative; }
.calendario-dia.vacio { background:transparent; border-color:transparent; cursor:default; }
.calendario-dia.activo { border-color:var(--burgundy); border-width:2px; }
.calendario-dia b { background:var(--burgundy); border-radius:999px; color:white; font-size:10px; min-width:16px; padding:1px 5px; }
```

- [ ] **Step 6: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 7: Verificar en el navegador**

Con el servidor estático corriendo, entrar a `admin.html` con la cuenta de prueba, ir a
Reservas:

1. Tocar "Calendario": se ve la cuadrícula del mes actual, con los días de la semana arriba
   (D L M M J V S) y los números alineados correctamente (el día 1 cae en su columna real).
2. Crear una reserva manual de prueba para una fecha del mes que se está viendo. Confirmar que
   el día correspondiente muestra un número (contador) tras pulsar "Actualizar" o recargar.
3. Tocar ese día: se abre el detalle debajo con la tarjeta de esa reserva (misma tarjeta que en
   Lista, con sus botones de estado).
4. Navegar al mes siguiente y anterior con las flechas: la cuadrícula cambia y el día
   seleccionado se limpia.
5. Cancelar y eliminar la reserva de prueba desde el detalle del calendario (los mismos botones
   que en Lista) y confirmar que desaparece de ahí también.
6. Consola sin errores.

- [ ] **Step 8: Commit**

```bash
git add components/Panel.js styles.css compiled/
git commit -m "panel: calendario mensual de reservas dentro de la pestaña Reservas"
```

---

## Task 6: Cache-busting y verificación final integrada

**Files:**
- Modify: `index.html`, `admin.html`, `sw.js`

**Interfaces:**
- Consume: todos los archivos modificados en las Tareas 3, 4 y 5.

- [ ] **Step 1: Subir el `CACHE_NAME`**

En `sw.js`, cambiar el valor actual de `CACHE_NAME` (verificar cuál es antes de editar — a esta
altura del proyecto debería ser `romadetalles-v5`) al siguiente número de versión, por ejemplo:

```js
const CACHE_NAME = 'romadetalles-v6';
```

- [ ] **Step 2: Subir el `?v=` de los archivos que cambiaron**

Usar una marca nueva (por ejemplo `20260803-1`) en:

- `admin.html`: `styles.css`, `compiled/components/Panel.js`
- `index.html`: `styles.css`, `compiled/components/Tienda.js`, `compiled/tienda-app.js`

No tocar el `?v=` de los archivos que no cambiaron en este plan.

- [ ] **Step 3: Verificación integrada, incluyendo la comprobación de seguridad clave**

Con el servidor estático corriendo:

1. Desregistrar el service worker viejo
   (`navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`
   en la consola) y recargar fuerte.
2. **Flujo completo de clienta**: en `index.html?s=<slug>`, hacer un pedido real, abrir el
   enlace de WhatsApp resultante, copiar el token de `?reserva=` del enlace, y abrirlo en una
   pestaña nueva — confirmar que la vista "Mi reserva" carga bien y que "Agregar a mi
   calendario" descarga el `.ics`.
3. **Panel**: confirmar en Reservas (Lista) que la reserva recién creada aparece; probar el
   filtro; confirmar y cancelar una reserva de prueba y eliminarla; confirmar que aparece
   también en el Calendario del mes correspondiente.
4. **Comprobación de seguridad** (la que importa de verdad en este plan): con la anon key,
   confirmar que ningún select público devuelve `token_acceso`:

```bash
curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_negocios?select=*&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" | python3 -c "import json,sys; d=json.load(sys.stdin); print('token_acceso' in d[0] if d else 'sin filas')"
```

   Y separadamente, confirmar que `alquiler_pedido_por_token` con un token válido nunca incluye
   la clave `token_acceso` en su respuesta (repetir la verificación de la Tarea 2, Step 5, y
   revisar el JSON completo a simple vista).

5. Sin 404 en la pestaña de red para los archivos versionados, y sin errores de consola.

- [ ] **Step 4: Commit**

```bash
git add index.html admin.html sw.js
git commit -m "cache: subir versión de assets tras calendario, enlace de reserva y borrado"
```

- [ ] **Step 5: Push**

Confirmar con el usuario antes de este paso — es lo que publica el cambio en GitHub Pages
para negocios reales.

```bash
git push
```
