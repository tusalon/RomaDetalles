# Día del evento, anticipo configurable y datos de pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cambiar la reserva de rango-de-fechas a un solo día de evento, con anticipo configurable por negocio y datos de pago visibles antes de confirmar.

**Architecture:** La clienta elige una fecha (`fecha_evento`). El pedido guarda además el rango derivado `[fecha_evento - 1, fecha_evento]`, que es la ventana real de ocupación (recoge la tarde anterior, entrega la mañana siguiente) — así `alquiler_disponibilidad` sigue funcionando sin cambios y da la respuesta correcta para eventos consecutivos y para eventos separados por 2 días. El anticipo se calcula en Postgres (fuente de verdad, guardado en el pedido) y se replica en JS solo para mostrarlo antes de enviar.

**Tech Stack:** JS/JSX sin bundler (compilado con `esbuild` vía `scripts/build-jsx.sh`), Supabase (Postgres/RLS/Edge Functions en Deno), GitHub Pages.

## Global Constraints

- **`precio_dia` conserva su nombre en la base de datos** aunque ahora signifique "precio por evento". Solo cambian las etiquetas visibles. No renombrar la columna en ninguna tarea.
- **El total ya no se multiplica por días:** `total = Σ (precio_dia × cantidad)`.
- **El rango derivado es exactamente `[fecha_evento - 1, fecha_evento]`.** No `[D-1, D+1]` ni `[D, D]` — ese rango es el que hace correcta la detección de solapamiento.
- **Redondeo del anticipo:** a la centena más cercana, mitad hacia arriba. Dos guardas obligatorias en TODA implementación (SQL y JS): (a) si el redondeo da 0 pero el anticipo real es > 0, se usa el valor sin redondear; (b) el anticipo nunca puede superar el total.
- **El texto de condiciones (5pm / 12pm / 50%) es fijo, igual para todos los negocios.** No es configurable en esta versión.
- **El recargo del 50% es solo informativo.** Ninguna tarea calcula, suma ni registra ese recargo.
- **`dias_minimos` deja de validarse y se quita del panel**, pero la columna NO se borra.
- SQL idempotente: `if not exists` / `create or replace` / `drop ... if exists`.
- Tras editar cualquier `components/*.js`: correr `bash scripts/build-jsx.sh` y commitear `compiled/` en el MISMO commit que el fuente.
- Tras editar archivos referenciados desde los HTML: subir el `?v=` correspondiente (y `CACHE_NAME` en `sw.js` en la tarea final).
- Las migraciones SQL las corre el usuario a mano en el SQL Editor de Supabase; cada tarea de SQL termina en un punto de pausa explícito.
- No hay framework de tests automatizados. La verificación es: SQL en el editor de Supabase, Edge Functions vía `curl`, y UI en el navegador con el servidor estático (`.claude/launch.json` → `romadetalles-static`).

---

## Task 1: Migración SQL — fecha de evento, anticipo y datos de pago

**Files:**
- Create: `sql/06-dia-evento-anticipo.sql`

**Interfaces:**
- Produce:
  - `alquiler_pedidos.fecha_evento date not null`, `alquiler_pedidos.anticipo numeric(12,2) not null default 0`
  - `alquiler_negocios.anticipo_porciento int not null default 0`, `alquiler_negocios.anticipo_redondear boolean not null default true`, `alquiler_negocios.pago_tarjeta text not null default ''`, `alquiler_negocios.pago_telefono text not null default ''`
  - `alquiler_anticipo(p_total numeric, p_porciento int, p_redondear boolean) returns numeric`
  - `alquiler_crear_pedido(p_negocio uuid, p_nombre text, p_telefono text, p_notas text, p_evento date, p_items jsonb, p_minutos_reserva int default 30) returns alquiler_pedidos`
  - `alquiler_crear_pedido_manual(p_negocio uuid, p_nombre text, p_telefono text, p_notas text, p_evento date, p_items jsonb) returns alquiler_pedidos`

  Las Tareas 2, 3 y 4 dependen de que esta migración esté aplicada en la base real.

- [ ] **Step 1: Escribir la migración**

Crear `sql/06-dia-evento-anticipo.sql` con este contenido exacto:

```sql
-- =====================================================================
-- RomaDetalles — día del evento, anticipo configurable y datos de pago
-- =====================================================================
-- Idempotente.
--
-- OJO AL DESPLEGAR: este script cambia la FIRMA de alquiler_crear_pedido
-- y alquiler_crear_pedido_manual (reciben p_evento en vez de
-- p_inicio/p_fin). Entre correr esto y desplegar la Edge Function nueva,
-- la Edge Function vieja llamaría a una firma que ya no existe. Correr
-- el SQL y desplegar la función seguido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
-- fecha_evento: el día del evento de la clienta. El rango
-- fecha_inicio/fecha_fin se sigue guardando, derivado de esta fecha,
-- porque es la ventana real en que el artículo está fuera y es lo que
-- usa alquiler_disponibilidad para detectar solapamientos.
alter table alquiler_pedidos
  add column if not exists fecha_evento date;

-- Relleno para pedidos que ya existen. Para pedidos viejos de varios
-- días la fecha es aproximada, pero son históricos y su rango original
-- se conserva intacto.
update alquiler_pedidos
   set fecha_evento = fecha_inicio
 where fecha_evento is null;

alter table alquiler_pedidos
  alter column fecha_evento set not null;

alter table alquiler_pedidos
  add column if not exists anticipo numeric(12,2) not null default 0;

alter table alquiler_negocios
  add column if not exists anticipo_porciento int not null default 0;

do $$
begin
  alter table alquiler_negocios
    add constraint alquiler_negocios_anticipo_pct
    check (anticipo_porciento between 0 and 100);
exception
  when duplicate_object then null;
end $$;

alter table alquiler_negocios
  add column if not exists anticipo_redondear boolean not null default true;

alter table alquiler_negocios
  add column if not exists pago_tarjeta text not null default '';

alter table alquiler_negocios
  add column if not exists pago_telefono text not null default '';

-- ---------------------------------------------------------------------
-- 2. Cálculo del anticipo — una sola fuente de verdad
-- ---------------------------------------------------------------------
-- Dos guardas que importan:
--   · Nunca 0 por redondeo: un anticipo real de 40 CUP no puede
--     convertirse en "no pagues nada" al redondear a la centena.
--   · Nunca mayor que el total.
create or replace function alquiler_anticipo(
  p_total     numeric,
  p_porciento int,
  p_redondear boolean
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_porciento, 0) <= 0 or coalesce(p_total, 0) <= 0 then 0::numeric
    when coalesce(p_redondear, true) then
      least(
        p_total,
        case
          when round((p_total * p_porciento / 100.0) / 100) * 100 = 0
            then round(p_total * p_porciento / 100.0, 2)
          else round((p_total * p_porciento / 100.0) / 100) * 100
        end
      )
    else least(p_total, round(p_total * p_porciento / 100.0, 2))
  end::numeric(12,2);
$$;

grant execute on function alquiler_anticipo(numeric,int,boolean)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Creación de pedido — ahora por día de evento
-- ---------------------------------------------------------------------
-- Postgres no permite CREATE OR REPLACE con firma distinta, así que hay
-- que soltar las versiones viejas. Al soltarlas se pierden sus grants,
-- por eso se vuelven a otorgar más abajo.
drop function if exists alquiler_crear_pedido(uuid,text,text,text,date,date,jsonb,int);
drop function if exists alquiler_crear_pedido_manual(uuid,text,text,text,date,date,jsonb);

create or replace function alquiler_crear_pedido(
  p_negocio    uuid,
  p_nombre     text,
  p_telefono   text,
  p_notas      text,
  p_evento     date,
  p_items      jsonb,
  p_minutos_reserva int default 30
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  select * into v_negocio
  from alquiler_negocios
  where id = p_negocio and activo = true;

  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  -- La ventana real de ocupación: la clienta recoge la tarde anterior y
  -- entrega la mañana siguiente. Guardarla como [evento-1, evento] hace
  -- que el solapamiento que ya usa alquiler_disponibilidad acierte en
  -- los dos casos que importan: dos eventos en días seguidos se pisan
  -- (bloqueado), dos eventos separados por 2 días no (permitido).
  v_inicio := p_evento - 1;
  v_fin    := p_evento;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'pendiente', coalesce(p_notas, ''),
    now() + make_interval(mins => p_minutos_reserva)
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio
      and activo = true;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (v_pedido_id, v_prod.id, v_prod.nombre, v_prod.precio_dia, v_pedida);

    -- Un evento = un precio. Ya no se multiplica por días.
    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb,int)
  from public, anon, authenticated;
grant execute on function alquiler_crear_pedido(uuid,text,text,text,date,jsonb,int)
  to service_role;

-- Hermana de la anterior, para la reserva que el dueño crea a mano.
-- Nace 'confirmado' porque el trato ya se cerró en persona.
create or replace function alquiler_crear_pedido_manual(
  p_negocio  uuid,
  p_nombre   text,
  p_telefono text,
  p_notas    text,
  p_evento   date,
  p_items    jsonb
)
returns alquiler_pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_negocio   alquiler_negocios;
  v_inicio    date;
  v_fin       date;
  v_total     numeric(12,2) := 0;
  v_pedido_id text;
  v_pedido    alquiler_pedidos;
  v_item      jsonb;
  v_prod      alquiler_productos;
  v_pedida    int;
  v_disp      int;
begin
  if not alquiler_es_admin(p_negocio) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select * into v_negocio
  from alquiler_negocios
  where id = p_negocio;

  if not found then
    raise exception 'NEGOCIO_NO_DISPONIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  if p_evento is null then
    raise exception 'PERIODO_INVALIDO';
  end if;

  v_inicio := p_evento - 1;
  v_fin    := p_evento;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_evento, fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_evento, v_inicio, v_fin, 1, 0, 'confirmado', coalesce(p_notas, ''),
    now()
  )
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_pedida := greatest(1, coalesce((v_item->>'cantidad')::int, 1));

    select * into v_prod
    from alquiler_productos
    where id = (v_item->>'producto_id')::uuid
      and negocio_id = p_negocio;

    if not found then
      raise exception 'PRODUCTO_NO_EXISTE';
    end if;

    select greatest(0, v_prod.cantidad - v_prod.fuera_de_servicio - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio <= v_fin
      and ped.fecha_fin    >= v_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      );

    if v_pedida > v_disp then
      raise exception 'SIN_STOCK:%', v_prod.nombre;
    end if;

    insert into alquiler_pedido_items
      (pedido_id, producto_id, producto_nombre, precio_dia, cantidad)
    values
      (v_pedido_id, v_prod.id, v_prod.nombre, v_prod.precio_dia, v_pedida);

    v_total := v_total + (v_prod.precio_dia * v_pedida);
  end loop;

  update alquiler_pedidos
     set total = v_total,
         anticipo = alquiler_anticipo(
           v_total, v_negocio.anticipo_porciento, v_negocio.anticipo_redondear
         ),
         actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function alquiler_crear_pedido_manual(uuid,text,text,text,date,jsonb)
  from public, anon;
grant execute on function alquiler_crear_pedido_manual(uuid,text,text,text,date,jsonb)
  to authenticated;

-- ---------------------------------------------------------------------
-- 4. Plantilla de solicitud — nuevas variables
-- ---------------------------------------------------------------------
-- Se cambia el DEFAULT (para negocios nuevos) y se actualizan solo las
-- filas que todavía tienen el texto por defecto viejo palabra por
-- palabra, es decir, las que nunca lo personalizaron. Un negocio que sí
-- lo editó conserva el suyo intacto.
alter table alquiler_negocios
  alter column plantilla_solicitud set default
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

update alquiler_negocios
   set plantilla_solicitud =
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
    'Quedo pendiente de confirmación. Gracias.'
 where plantilla_solicitud =
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
```

- [ ] **Step 2: El usuario corre la migración en Supabase**

Pegar el SQL completo del Step 1 en el SQL Editor de Supabase (proyecto
`zorhclhvykikaachfrmp`) y ejecutarlo. Debe decir `Success. No rows returned`.

- [ ] **Step 3: Verificar que quedó bien aplicada**

El usuario corre esto en el mismo SQL Editor y pega el resultado:

```sql
select count(*) as pedidos_sin_fecha_evento
from alquiler_pedidos where fecha_evento is null;

select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in ('alquiler_crear_pedido','alquiler_crear_pedido_manual','alquiler_anticipo')
order by proname;

-- Guardas del anticipo: 0 (sin anticipo), 40 sin redondear a 0, tope al total
select alquiler_anticipo(12400, 30, true)  as debe_dar_3700,
       alquiler_anticipo(400, 10, true)    as debe_dar_40,
       alquiler_anticipo(1000, 0, true)    as debe_dar_0,
       alquiler_anticipo(50, 100, true)    as debe_dar_50;
```

Expected:
- `pedidos_sin_fecha_evento` = 0
- tres funciones, con `alquiler_crear_pedido` y `alquiler_crear_pedido_manual` mostrando
  `p_evento date` (y NO `p_inicio date, p_fin date`)
- `3700`, `40`, `0`, `50` — el `40` es la guarda de "nunca 0 por redondeo" y el `50` la
  de "nunca mayor que el total"

- [ ] **Step 4: Commit**

```bash
git add sql/06-dia-evento-anticipo.sql
git commit -m "sql: día del evento, anticipo configurable y datos de pago"
```

---

## Task 2: Edge Function `crear-pedido-alquiler`

**Files:**
- Modify: `supabase/functions/crear-pedido-alquiler/index.ts`

**Interfaces:**
- Consume: `alquiler_crear_pedido(p_negocio, p_nombre, p_telefono, p_notas, p_evento, p_items, p_minutos_reserva)` y las columnas nuevas de `alquiler_negocios` (Task 1, ya aplicada en la base real).
- Produce: la función acepta `fecha_evento` en el body (ya no `fecha_inicio`/`fecha_fin`) y devuelve `{ pedido_id, total, anticipo, moneda, dias, expira_en, whatsapp_url }`. La Tarea 3 (`Tienda.js`) envía y consume ese contrato.

- [ ] **Step 1: Cambiar la validación de entrada**

Reemplazar el bloque de validación de fechas (el que hoy comprueba `body.fecha_inicio` /
`body.fecha_fin`):

```ts
  if (!esFecha(body.fecha_inicio) || !esFecha(body.fecha_fin)) {
    return json({ error: "Selecciona fechas válidas." }, 400);
  }
  if (body.fecha_fin < body.fecha_inicio) {
    return json({ error: "La fecha final no puede ser antes de la inicial." }, 400);
  }
```

por:

```ts
  if (!esFecha(body.fecha_evento)) {
    return json({ error: "Selecciona el día de tu evento." }, 400);
  }
```

- [ ] **Step 2: Quitar el mensaje de MINIMO_DIAS**

`alquiler_crear_pedido` ya no valida `dias_minimos`, así que esa excepción no puede
volver a producirse. En `mensajeDeError`, borrar este bloque completo:

```ts
  if (raw.includes("MINIMO_DIAS")) {
    const dias = raw.split("MINIMO_DIAS:")[1]?.split("\n")[0]?.trim();
    return {
      mensaje: `Este negocio alquila por un mínimo de ${dias || "varios"} día(s).`,
      status: 400,
    };
  }
```

- [ ] **Step 3: Traer los campos nuevos del negocio**

En el fetch del negocio, cambiar el `select`. Nota: `anticipo_porciento`/`anticipo_redondear`
NO se agregan aquí — el cálculo del anticipo lo hace `alquiler_crear_pedido` por dentro
(consulta el negocio ella misma), así que la Edge Function solo necesita los datos de
pago para armar el mensaje:

```ts
    `${supabaseUrl}/rest/v1/alquiler_negocios?${filtro}&activo=eq.true&select=id,nombre,whatsapp,moneda,plantilla_solicitud`,
```

por:

```ts
    `${supabaseUrl}/rest/v1/alquiler_negocios?${filtro}&activo=eq.true&select=id,nombre,whatsapp,moneda,plantilla_solicitud,pago_tarjeta,pago_telefono`,
```

- [ ] **Step 4: Llamar al RPC con la firma nueva**

Cambiar el body del `fetch` a `rpc/alquiler_crear_pedido`:

```ts
    body: JSON.stringify({
      p_negocio: negocio.id,
      p_nombre: nombre,
      p_telefono: telefono,
      p_notas: notas,
      p_inicio: body.fecha_inicio,
      p_fin: body.fecha_fin,
      p_items: items,
    }),
```

por:

```ts
    body: JSON.stringify({
      p_negocio: negocio.id,
      p_nombre: nombre,
      p_telefono: telefono,
      p_notas: notas,
      p_evento: body.fecha_evento,
      p_items: items,
    }),
```

- [ ] **Step 5: Actualizar el armado del mensaje**

Reemplazar la constante `PLANTILLA_SOLICITUD_POR_DEFECTO` y la función
`armarMensajeSolicitud` completas por:

```ts
const PLANTILLA_SOLICITUD_POR_DEFECTO =
  "Hola, deseo solicitar este alquiler ({pedido_id}):\n" +
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

/**
 * Rellena la plantilla de solicitud (editable por el negocio en
 * Configuración) con los datos reales del pedido. {telefono}, {notas} y
 * {anticipo} llevan su propio prefijo y quedan vacíos si el dato no
 * aplica — por eso al final se colapsan los saltos de línea de sobra, sin
 * exigirle al negocio una plantilla "perfecta" sin esos campos.
 */
function armarMensajeSolicitud(
  plantilla: string,
  datos: {
    pedidoId: string;
    fechaEvento: string;
    items: Array<{ producto_nombre: string; precio_dia: number; cantidad: number }>;
    total: number;
    anticipo: number;
    moneda: string;
    nombre: string;
    telefono: string;
    notas: string;
    tarjeta: string;
    telefonoPago: string;
  },
): string {
  const base = plantilla && plantilla.trim() ? plantilla : PLANTILLA_SOLICITUD_POR_DEFECTO;

  const items = datos.items
    .map(
      (l) =>
        `• ${l.cantidad} × ${l.producto_nombre} — ${dinero(Number(l.precio_dia) * l.cantidad)} ${datos.moneda}`,
    )
    .join("\n");

  // El bloque de anticipo se arma entero aquí (o queda vacío): así el
  // negocio solo pone {anticipo} en su plantilla y no tiene que saber
  // condicionar nada.
  const lineasAnticipo: string[] = [];
  if (datos.anticipo > 0) {
    lineasAnticipo.push(`💳 Anticipo a pagar: ${dinero(datos.anticipo)} ${datos.moneda}`);
    if (datos.tarjeta) lineasAnticipo.push(`Tarjeta: ${datos.tarjeta}`);
    if (datos.telefonoPago) lineasAnticipo.push(`Teléfono: ${datos.telefonoPago}`);
  }

  const texto = base
    .replaceAll("{pedido_id}", datos.pedidoId)
    .replaceAll("{fechas}", datos.fechaEvento)
    .replaceAll("{items}", items)
    .replaceAll("{total}", `${dinero(datos.total)} ${datos.moneda}`)
    .replaceAll("{anticipo}", lineasAnticipo.join("\n"))
    .replaceAll("{tarjeta}", datos.tarjeta)
    .replaceAll("{telefono_pago}", datos.telefonoPago)
    .replaceAll("{nombre}", datos.nombre)
    .replaceAll("{telefono}", datos.telefono ? `📞 ${datos.telefono}` : "")
    .replaceAll("{notas}", datos.notas ? `📝 ${datos.notas}` : "");

  return texto.replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 6: Actualizar la llamada a `armarMensajeSolicitud`**

Reemplazar:

```ts
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

por:

```ts
  const mensaje = armarMensajeSolicitud(negocio.plantilla_solicitud || "", {
    pedidoId: pedido.id,
    fechaEvento: pedido.fecha_evento,
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

- [ ] **Step 7: Devolver el anticipo en la respuesta**

En el `return json({...}, 201)` final, agregar `anticipo` después de `total`:

```ts
      pedido_id: pedido.id,
      total: Number(pedido.total),
      anticipo: Number(pedido.anticipo || 0),
      moneda,
```

- [ ] **Step 8: Desplegar**

```bash
npx supabase functions deploy crear-pedido-alquiler --project-ref zorhclhvykikaachfrmp --no-verify-jwt
```

- [ ] **Step 9: Verificar con datos reales**

Buscar un negocio y un producto reales (lecturas públicas, sin efectos secundarios).
`$SUPABASE_ANON_KEY` es el valor de `SUPABASE_ANON_KEY` en `utils/supabase-config.js`:

```bash
curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_negocios?select=id,slug,anticipo_porciento,pago_tarjeta&activo=eq.true&limit=3" \
  -H "apikey: $SUPABASE_ANON_KEY"

curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_productos?select=id,nombre,precio_dia&activo=eq.true&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Con esos datos, crear un pedido de prueba (crea una fila real y dispara un push real al
dueño — es como se ha verificado todo este proyecto):

```bash
curl -s -X POST "https://zorhclhvykikaachfrmp.supabase.co/functions/v1/crear-pedido-alquiler" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"slug":"<SLUG_REAL>","cliente_nombre":"Prueba Evento","cliente_telefono":"","notas":"",
       "fecha_evento":"2026-09-15",
       "items":[{"producto_id":"<PRODUCTO_ID_REAL>","cantidad":2}]}'
```

Expected: `201`, con `total` = `precio_dia × 2` (NO multiplicado por días) y `anticipo`
coherente con el `anticipo_porciento` de ese negocio. Decodificar el `text=` del
`whatsapp_url` y confirmar que dice `📅 Evento: 2026-09-15` (una sola fecha, no un rango).

Confirmar además el rango derivado:

```bash
curl -s "https://zorhclhvykikaachfrmp.supabase.co/rest/v1/alquiler_pedidos?id=eq.<PEDIDO_ID>&select=fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

(Si RLS no deja leerlo con anon, pedirle al usuario que lo consulte en el SQL Editor.)
Expected: `fecha_inicio` = `2026-09-14`, `fecha_fin` = `2026-09-15`, `dias` = 1.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/crear-pedido-alquiler/index.ts
git commit -m "edge: pedido por día de evento, con anticipo y datos de pago"
```

---

## Task 3: Tienda pública — un solo día, condiciones, anticipo y datos de pago

**Files:**
- Modify: `components/Tienda.js`
- Modify: `styles.css`

**Interfaces:**
- Consume: la Edge Function con `fecha_evento` y respuesta `{ pedido_id, total, anticipo, ... }` (Task 2); `alquiler_disponibilidad(p_negocio, p_inicio, p_fin)` sin cambios; las columnas nuevas de `alquiler_negocios`.
- Produce: nada que otra tarea consuma.

- [ ] **Step 1: Traer los campos nuevos del negocio**

En la carga inicial, cambiar el `select` del negocio:

```js
                    `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos`
```

por:

```js
                    `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,` +
                    `anticipo_porciento,anticipo_redondear,pago_tarjeta,pago_telefono`
```

- [ ] **Step 2: Reemplazar los helpers de fecha**

Borrar la función `diasEntre` completa:

```js
function diasEntre(inicio, fin) {
    if (!inicio || !fin) return 0;
    const ms = new Date(`${fin}T12:00:00Z`) - new Date(`${inicio}T12:00:00Z`);
    return Math.max(0, Math.floor(ms / 86400000) + 1);
}
```

Borrar también `hoyISO` completa — sus dos únicos usos eran los `min=` de los campos
"Desde" y "Hasta", que desaparecen en el Step 8, y `mananaISO` la reemplaza:

```js
function hoyISO() {
    // Fecha local, no UTC: en Cuba (UTC-4/-5) usar toISOString() haría que
    // después de las 19:00 el mínimo del calendario saltara al día siguiente.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

y agregar en su lugar:

```js
// El evento más cercano posible es mañana: si fuera hoy, la recogida
// (la tarde anterior) ya habría pasado.
function mananaISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Día de recogida: la tarde anterior al evento. El mediodía UTC evita
// que un cambio de horario mueva la fecha un día.
function diaAntes(iso) {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// Espejo en JS de alquiler_anticipo() en Postgres. La fuente de verdad
// es la de Postgres (se guarda en el pedido); esta solo sirve para
// mostrarle el número a la clienta antes de enviar. Las dos guardas
// tienen que ser iguales en ambas: nunca 0 por redondeo, nunca mayor
// que el total.
function calcularAnticipo(total, porciento, redondear) {
    const pct = Number(porciento) || 0;
    if (pct <= 0 || total <= 0) return 0;
    const bruto = total * pct / 100;
    const exacto = Math.round(bruto * 100) / 100;
    if (redondear === false) return Math.min(total, exacto);
    const redondeado = Math.round(bruto / 100) * 100;
    return Math.min(total, redondeado === 0 ? exacto : redondeado);
}
```

- [ ] **Step 3: Cambiar el estado de fechas**

Reemplazar:

```js
    const [inicio, setInicio] = useState('');
    const [fin, setFin] = useState('');
```

por:

```js
    const [fechaEvento, setFechaEvento] = useState('');
```

Y reemplazar:

```js
    const dias = diasEntre(inicio, fin);
```

por:

```js
    const hayFecha = Boolean(fechaEvento);
    // Ventana real de ocupación: recoge la tarde anterior, entrega la
    // mañana siguiente. Es el rango que entiende alquiler_disponibilidad.
    const inicioRango = hayFecha ? diaAntes(fechaEvento) : '';
```

- [ ] **Step 4: Actualizar la comprobación de disponibilidad**

Reemplazar el `useEffect` de disponibilidad completo:

```js
    useEffect(() => {
        if (!negocio || !inicio || !fin || fin < inicio) return;
        let vigente = true;
        setComprobando(true);

        window.supaRpc('alquiler_disponibilidad', {
            p_negocio: negocio.id,
            p_inicio: inicio,
            p_fin: fin
        })
```

por:

```js
    useEffect(() => {
        if (!negocio || !fechaEvento) return;
        let vigente = true;
        setComprobando(true);

        window.supaRpc('alquiler_disponibilidad', {
            p_negocio: negocio.id,
            p_inicio: diaAntes(fechaEvento),
            p_fin: fechaEvento
        })
```

y su array de dependencias:

```js
    }, [negocio, inicio, fin]);
```

por:

```js
    }, [negocio, fechaEvento]);
```

- [ ] **Step 5: Total sin días, y anticipo**

Reemplazar:

```js
    const totalDiario = productos.reduce(
        (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0), 0
    );
```

por:

```js
    // Un evento = un precio. El total ya no se multiplica por días.
    const totalPedido = productos.reduce(
        (s, p) => s + Number(p.precio_dia) * (carrito[p.id] || 0), 0
    );
```

- [ ] **Step 6: Cambiar las guardas que usaban `dias`**

Reemplazar `disponibleDe`:

```js
    const disponibleDe = useCallback((producto) => {
        if (!dias) return producto.cantidad;
        return disponibilidad[producto.id] ?? producto.cantidad;
    }, [dias, disponibilidad]);
```

por:

```js
    const disponibleDe = useCallback((producto) => {
        if (!hayFecha) return producto.cantidad;
        return disponibilidad[producto.id] ?? producto.cantidad;
    }, [hayFecha, disponibilidad]);
```

Y en `agregar`, reemplazar:

```js
        if (!dias) {
            document.getElementById('fechas')?.scrollIntoView({ behavior: 'smooth' });
            return;
        }
```

por:

```js
        if (!hayFecha) {
            document.getElementById('fechas')?.scrollIntoView({ behavior: 'smooth' });
            return;
        }
```

- [ ] **Step 7: Actualizar el envío del pedido**

En `enviarPedido`, borrar esta validación completa (ya no existe el mínimo de días):

```js
        if (dias < (negocio.dias_minimos || 1)) {
            setAviso(`El alquiler mínimo es de ${negocio.dias_minimos} día(s).`);
            return;
        }
```

y agregar en su lugar:

```js
        if (!fechaEvento) {
            setAviso('Elige el día de tu evento.');
            return;
        }
```

Reemplazar en el body del fetch:

```js
                        fecha_inicio: inicio,
                        fecha_fin: fin,
```

por:

```js
                        fecha_evento: fechaEvento,
```

Y en el refresco tras un 409, reemplazar:

```js
                    const filas = await window.supaRpc('alquiler_disponibilidad', {
                        p_negocio: negocio.id, p_inicio: inicio, p_fin: fin
                    });
```

por:

```js
                    const filas = await window.supaRpc('alquiler_disponibilidad', {
                        p_negocio: negocio.id, p_inicio: diaAntes(fechaEvento), p_fin: fechaEvento
                    });
```

- [ ] **Step 8: Un solo campo de fecha + condiciones en el hero**

Reemplazar el bloque `.hero-check` completo (desde `<div className="hero-check" id="fechas">`
hasta su `</div>` de cierre, incluyendo `.date-title`, `.dates` y el `.available`) por:

```jsx
                    <div className="hero-check" id="fechas">
                        <div className="date-title">
                            <span>◫</span>
                            <div>
                                <strong>¿Qué día es tu evento?</strong>
                                <small>
                                    {comprobando ? 'Comprobando…'
                                        : hayFecha ? 'Disponibilidad actualizada'
                                        : 'Elige la fecha para ver qué está libre'}
                                </small>
                            </div>
                        </div>
                        <div className="dates dates-una">
                            <label>
                                Día del evento
                                <input type="date" value={fechaEvento} min={mananaISO()}
                                    onChange={(e) => setFechaEvento(e.target.value)} />
                            </label>
                        </div>
                        {hayFecha && (
                            <p className="available">● Revisado para el {fechaEvento}</p>
                        )}
                        <ul className="condiciones">
                            <li><b>Recoges</b> el día antes de tu evento, después de las 5:00 PM.</li>
                            <li><b>Entregas</b> al día siguiente, antes de las 12:00 del mediodía.</li>
                            <li>Si no entregas a tiempo, se cobra un <b>50% extra</b> del costo del alquiler.</li>
                        </ul>
                    </div>
```

- [ ] **Step 9: Ajustar los textos que hablaban de días**

Reemplazar:

```jsx
                    <p className="benefits">
                        Reserva por días <i>•</i> Combina productos <i>•</i> Pedido por WhatsApp
                    </p>
```

por:

```jsx
                    <p className="benefits">
                        Reserva por evento <i>•</i> Combina productos <i>•</i> Pedido por WhatsApp
                    </p>
```

Reemplazar:

```jsx
                        <p>Agrega varios artículos y forma tu combo. El total se calcula según los días seleccionados.</p>
```

por:

```jsx
                        <p>Agrega varios artículos y forma tu combo. El total es por el día de tu evento.</p>
```

- [ ] **Step 10: Tarjeta de producto sin "/ día"**

Reemplazar:

```jsx
                                                    <p>
                                                        <strong>{dinero(producto.precio_dia)} {moneda}</strong>
                                                        <small>/ día</small>
                                                    </p>
```

por:

```jsx
                                                    <p>
                                                        <strong>{dinero(producto.precio_dia)} {moneda}</strong>
                                                        <small>por evento</small>
                                                    </p>
```

Y en el mismo bloque, reemplazar las tres apariciones de `dias` por `hayFecha`:

```jsx
                                    const agotado = dias > 0 && disp < 1;
                                    const estado = dias === 0 ? '' : (agotado ? 'agotado' : 'libre');
```

por:

```jsx
                                    const agotado = hayFecha && disp < 1;
                                    const estado = !hayFecha ? '' : (agotado ? 'agotado' : 'libre');
```

y:

```jsx
                                                {dias > 0 && (
                                                    <b className={agotado ? 'reserved' : ''}>
```

por:

```jsx
                                                {hayFecha && (
                                                    <b className={agotado ? 'reserved' : ''}>
```

y el botón:

```jsx
                                                <button disabled={agotado} onClick={() => agregar(producto)}>
                                                    {dias
                                                        ? (agotado ? 'No disponible' : 'Agregar al pedido +')
                                                        : 'Elegir fechas'}
                                                </button>
```

por:

```jsx
                                                <button disabled={agotado} onClick={() => agregar(producto)}>
                                                    {hayFecha
                                                        ? (agotado ? 'No disponible' : 'Agregar al pedido +')
                                                        : 'Elegir fecha'}
                                                </button>
```

- [ ] **Step 11: Barra flotante "Continuar"**

Reemplazar:

```jsx
                    <span>{totalArticulos} {totalArticulos === 1 ? 'artículo' : 'artículos'} · {dinero(totalDiario * dias)} {moneda}</span>
```

por:

```jsx
                    <span>{totalArticulos} {totalArticulos === 1 ? 'artículo' : 'artículos'} · {dinero(totalPedido)} {moneda}</span>
```

- [ ] **Step 12: Cajón del pedido — fecha, precios, anticipo y datos de pago**

Reemplazar:

```jsx
                    {dias > 0 && (
                        <p className="drawer-date">◫ {inicio} — {fin} · {dias} {dias === 1 ? 'día' : 'días'}</p>
                    )}
```

por:

```jsx
                    {hayFecha && (
                        <p className="drawer-date">◫ Evento: {fechaEvento} · recoges el {inicioRango} después de las 5:00 PM</p>
                    )}
```

Reemplazar la línea de precio por unidad:

```jsx
                                        <small>{dinero(producto.precio_dia)} {moneda} / día</small>
```

por:

```jsx
                                        <small>{dinero(producto.precio_dia)} {moneda}</small>
```

Reemplazar el bloque `.total` completo:

```jsx
                            <div className="total">
                                <span>Total estimado</span>
                                <strong>{dinero(totalDiario * dias)} {moneda}</strong>
                            </div>
```

por:

```jsx
                            <div className="total">
                                <span>Total</span>
                                <strong>{dinero(totalPedido)} {moneda}</strong>
                            </div>
                            {anticipo > 0 && (
                                <div className="anticipo-desglose">
                                    <p>
                                        <span>Anticipo ({negocio.anticipo_porciento}%)</span>
                                        <strong>{dinero(anticipo)} {moneda}</strong>
                                    </p>
                                    <p>
                                        <span>Resto al recoger</span>
                                        <strong>{dinero(totalPedido - anticipo)} {moneda}</strong>
                                    </p>
                                </div>
                            )}
                            {anticipo > 0 && negocio.pago_tarjeta && (
                                <div className="datos-pago">
                                    <strong>Para confirmar tu reserva, transfiere el anticipo a:</strong>
                                    <p>Tarjeta: <b>{negocio.pago_tarjeta}</b></p>
                                    {negocio.pago_telefono && <p>Teléfono: <b>{negocio.pago_telefono}</b></p>}
                                    <small>Tu reserva queda confirmada cuando el negocio reciba el anticipo.</small>
                                </div>
                            )}
```

Y agregar el cálculo del anticipo junto a `totalPedido` (arriba, con los demás derivados):

```js
    const anticipo = calcularAnticipo(
        totalPedido,
        negocio?.anticipo_porciento,
        negocio?.anticipo_redondear
    );
```

**Ojo:** `negocio` puede ser `null` durante la carga inicial, por eso el `?.`. Colocar
esta línea DESPUÉS de `totalPedido` y ANTES del `return`.

- [ ] **Step 13: CSS**

En `styles.css`, después de la regla `.available` (la del `--libre`), agregar:

```css
/* Una sola fecha: el rango desapareció, el evento es un día. */
.dates-una { grid-template-columns:1fr; }
.condiciones { border-top:1px solid var(--border); color:var(--muted); font-size:11px; line-height:1.7; list-style:none; margin:14px 0 0; padding:14px 0 0; }
.condiciones li { padding-left:14px; position:relative; }
.condiciones li::before { color:var(--coral); content:'•'; left:0; position:absolute; }
.condiciones b { color:var(--ink); }
```

Y después de la regla `.total strong`, agregar:

```css
/* Desglose del anticipo: lo que paga ahora vs. lo que paga al recoger. */
.anticipo-desglose { display:grid; gap:8px; margin-top:10px; }
.anticipo-desglose p { align-items:center; display:flex; font-size:12px; justify-content:space-between; margin:0; }
.anticipo-desglose span { color:var(--muted); }
.anticipo-desglose strong { color:var(--burgundy); font-variant-numeric:tabular-nums; }
.datos-pago { background:var(--lilac); border-radius:12px; margin-top:14px; padding:14px 16px; }
.datos-pago strong { color:var(--purple); display:block; font-size:12px; }
.datos-pago p { color:var(--ink); font-size:13px; margin:8px 0 0; }
.datos-pago b { font-variant-numeric:tabular-nums; }
.datos-pago small { color:var(--muted); display:block; font-size:10px; margin-top:10px; }
```

- [ ] **Step 14: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 15: Verificar en el navegador**

Con el servidor estático (`romadetalles-static`) corriendo, abrir
`index.html?s=roma-detalles`:

1. Hay **un solo** campo de fecha, y su mínimo es mañana (intentar elegir hoy no debe
   dejar).
2. Las tres condiciones se ven bajo el campo.
3. Antes de elegir fecha, los botones de los artículos dicen "Elegir fecha".
4. Al elegir una fecha, aparecen las etiquetas de disponibilidad y los botones cambian a
   "Agregar al pedido +".
5. El precio de la tarjeta dice "por evento", no "/ día".
6. Al agregar 2 unidades de un artículo de precio P, el total es `2 × P` (no
   multiplicado por días).
7. Si ese negocio tiene `anticipo_porciento > 0`, en el cajón se ven "Anticipo (N%)" y
   "Resto al recoger", y si tiene tarjeta configurada, el bloque de datos de pago.
8. Consola sin errores.

Si el negocio de prueba tiene el anticipo en 0, ponerlo temporalmente en 30 desde el
panel (pestaña Configuración — se implementa en la Tarea 4; si aún no existe ese campo,
el usuario puede correr
`update alquiler_negocios set anticipo_porciento = 30 where slug = 'roma-detalles';`
en el SQL Editor) y confirmar que el desglose aparece.

- [ ] **Step 16: Commit**

```bash
git add components/Tienda.js styles.css compiled/
git commit -m "tienda: reserva por día de evento, con condiciones y anticipo"
```

---

## Task 4: Panel — configuración de anticipo y pago, precio por evento, fecha de evento

**Files:**
- Modify: `utils/auth-alquiler.js`
- Modify: `components/Panel.js`

**Interfaces:**
- Consume: las columnas nuevas de `alquiler_negocios` y `alquiler_pedidos`, y
  `alquiler_crear_pedido_manual(p_negocio, p_nombre, p_telefono, p_notas, p_evento, p_items)` (Task 1).
- Produce: nada que otra tarea consuma.

- [ ] **Step 1: Traer los campos nuevos del negocio**

En `utils/auth-alquiler.js`, en `negocioDelUsuario()`, reemplazar:

```js
            `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos,activo,` +
            `logo_url,plantilla_confirmacion,plantilla_compartir,plantilla_solicitud`
```

por:

```js
            `&select=id,slug,nombre,titulo_bienvenida,texto_bienvenida,whatsapp,moneda,instagram_url,facebook_url,dias_minimos,activo,` +
            `logo_url,plantilla_confirmacion,plantilla_compartir,plantilla_solicitud,` +
            `anticipo_porciento,anticipo_redondear,pago_tarjeta,pago_telefono`
```

- [ ] **Step 2: Guardar los campos nuevos en Configuración**

En `components/Panel.js`, en `guardarConfiguracion`, dentro del `body: JSON.stringify({...})`,
reemplazar:

```js
                        dias_minimos: Math.max(1, Number(negocio.dias_minimos) || 1),
```

por:

```js
                        anticipo_porciento: Math.min(100, Math.max(0, Math.floor(Number(negocio.anticipo_porciento) || 0))),
                        anticipo_redondear: negocio.anticipo_redondear !== false,
                        pago_tarjeta: negocio.pago_tarjeta || '',
                        pago_telefono: negocio.pago_telefono || '',
```

(`dias_minimos` deja de enviarse: ya no se valida en ningún lado y su campo sale del
formulario en el Step 4.)

- [ ] **Step 3: Mensaje de confirmación con la fecha del evento**

Reemplazar en `armarMensajeConfirmacion`:

```js
    const fechas = `${pedido.fecha_inicio} al ${pedido.fecha_fin} (${pedido.dias} ${pedido.dias === 1 ? 'día' : 'días'})`;
```

por:

```js
    const fechas = pedido.fecha_evento || pedido.fecha_inicio;
```

- [ ] **Step 4: Configuración — quitar mínimo de días, agregar anticipo y pago**

Reemplazar el bloque del mínimo de días:

```jsx
                                <label>Mínimo de días por alquiler
                                    <input type="number" min="1" inputMode="numeric" value={negocio.dias_minimos}
                                        onChange={(e) => setNegocio({ ...negocio, dias_minimos: e.target.value })} />
                                </label>
```

por:

```jsx
                                <label>Anticipo (%)
                                    <input type="number" min="0" max="100" inputMode="numeric"
                                        value={negocio.anticipo_porciento ?? 0}
                                        onChange={(e) => setNegocio({ ...negocio, anticipo_porciento: e.target.value })} />
                                    <small>0 = sin anticipo. La clienta ve cuánto paga ahora y cuánto al recoger.</small>
                                </label>
                                <label className="check-linea">
                                    <input type="checkbox"
                                        checked={negocio.anticipo_redondear !== false}
                                        onChange={(e) => setNegocio({ ...negocio, anticipo_redondear: e.target.checked })} />
                                    {' '}Redondear el anticipo a la centena
                                </label>
                                <label>Tarjeta para el anticipo
                                    <input placeholder="Ej. 9227 0699 1234 5678" inputMode="numeric"
                                        value={negocio.pago_tarjeta || ''}
                                        onChange={(e) => setNegocio({ ...negocio, pago_tarjeta: e.target.value })} />
                                </label>
                                <label>Teléfono asociado a la tarjeta
                                    <input placeholder="Ej. 53842336" inputMode="tel"
                                        value={negocio.pago_telefono || ''}
                                        onChange={(e) => setNegocio({ ...negocio, pago_telefono: e.target.value })} />
                                </label>
```

- [ ] **Step 5: Ayuda de la plantilla de solicitud**

Reemplazar el `<small>` bajo el textarea de "Mensaje de solicitud":

```jsx
                                    <small>Variables disponibles: {'{nombre}'}, {'{fechas}'}, {'{items}'}, {'{total}'}, {'{telefono}'}, {'{notas}'}, {'{pedido_id}'}. {'{telefono}'} y {'{notas}'} ya vienen con su propio emoji (📞 y 📝) y desaparecen del todo si el dato no llegó — ponlas en su propia línea. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.</small>
```

por:

```jsx
                                    <small>Variables disponibles: {'{nombre}'}, {'{fechas}'} (el día del evento), {'{items}'}, {'{total}'}, {'{anticipo}'}, {'{tarjeta}'}, {'{telefono_pago}'}, {'{telefono}'}, {'{notas}'}, {'{pedido_id}'}. {'{telefono}'}, {'{notas}'} y {'{anticipo}'} ya vienen con su propio emoji y desaparecen del todo si el dato no aplica — ponlas en su propia línea. Es el mensaje que le llega a WhatsApp cuando una clienta pide un alquiler desde tu tienda.</small>
```

- [ ] **Step 6: Artículos — precio por evento**

En el formulario de artículo nuevo, reemplazar:

```jsx
                                        <label>Precio por día
                                            <input type="number" min="0" inputMode="numeric" value={productoNuevo.precio_dia}
                                                onChange={(e) => setProductoNuevo({ ...productoNuevo, precio_dia: e.target.value })} />
                                        </label>
```

por:

```jsx
                                        <label>Precio por evento
                                            <input type="number" min="0" inputMode="numeric" value={productoNuevo.precio_dia}
                                                onChange={(e) => setProductoNuevo({ ...productoNuevo, precio_dia: e.target.value })} />
                                        </label>
```

Y en la tarjeta de edición de artículo, reemplazar:

```jsx
                                                <label>Precio por día
                                                    <input type="number" min="0" inputMode="numeric" value={producto.precio_dia}
```

por:

```jsx
                                                <label>Precio por evento
                                                    <input type="number" min="0" inputMode="numeric" value={producto.precio_dia}
```

- [ ] **Step 7: Reservas — traer y mostrar la fecha del evento y el anticipo**

En `cargarPedidos`, reemplazar:

```js
                `&select=id,cliente_nombre,cliente_telefono,fecha_inicio,fecha_fin,dias,total,estado,notas,creado_en,` +
```

por:

```js
                `&select=id,cliente_nombre,cliente_telefono,fecha_evento,fecha_inicio,fecha_fin,dias,total,anticipo,estado,notas,creado_en,` +
```

En la lista de reservas, reemplazar:

```jsx
                                            <p>{pedido.id} · {pedido.fecha_inicio} al {pedido.fecha_fin} · {pedido.dias} {pedido.dias === 1 ? 'día' : 'días'}</p>
```

por:

```jsx
                                            <p>{pedido.id} · Evento: {pedido.fecha_evento || pedido.fecha_inicio}</p>
                                            <p>Recoge el {pedido.fecha_inicio} después de las 5:00 PM</p>
```

Y reemplazar el total de la reserva:

```jsx
                                        <strong>{dineroPanel(pedido.total)} {moneda}</strong>
```

por:

```jsx
                                        <div className="order-importes">
                                            <strong>{dineroPanel(pedido.total)} {moneda}</strong>
                                            {Number(pedido.anticipo) > 0 && (
                                                <small>Anticipo: {dineroPanel(pedido.anticipo)} {moneda}</small>
                                            )}
                                        </div>
```

- [ ] **Step 8: Reserva manual — un solo campo de fecha**

Reemplazar el estado inicial en `abrirReservaManual`:

```js
        setReservaManual({ cliente_nombre: '', cliente_telefono: '', notas: '', fecha_inicio: '', fecha_fin: '', items: {} });
```

por:

```js
        setReservaManual({ cliente_nombre: '', cliente_telefono: '', notas: '', fecha_evento: '', items: {} });
```

Reemplazar la validación en `crearReservaManual`:

```js
        if (!reservaManual.fecha_inicio || !reservaManual.fecha_fin) {
            notificar('Elige las fechas del alquiler.');
            return;
        }
```

por:

```js
        if (!reservaManual.fecha_evento) {
            notificar('Elige el día del evento.');
            return;
        }
```

Reemplazar los argumentos del RPC:

```js
                p_inicio: reservaManual.fecha_inicio,
                p_fin: reservaManual.fecha_fin,
```

por:

```js
                p_evento: reservaManual.fecha_evento,
```

Y reemplazar los dos campos de fecha del formulario:

```jsx
                                    <div className="producto-form-fila">
                                        <label>Desde
                                            <input type="date" required value={reservaManual.fecha_inicio}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_inicio: e.target.value, fecha_fin: reservaManual.fecha_fin && reservaManual.fecha_fin < e.target.value ? e.target.value : reservaManual.fecha_fin })} />
                                        </label>
                                        <label>Hasta
                                            <input type="date" required min={reservaManual.fecha_inicio} value={reservaManual.fecha_fin}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_fin: e.target.value })} />
                                        </label>
                                    </div>
```

por:

```jsx
                                    <div className="producto-form-fila">
                                        <label>Día del evento
                                            <input type="date" required value={reservaManual.fecha_evento}
                                                onChange={(e) => setReservaManual({ ...reservaManual, fecha_evento: e.target.value })} />
                                        </label>
                                    </div>
```

- [ ] **Step 9: CSS de los dos elementos nuevos del panel**

En `styles.css`, después de la regla `.producto-disponible-ahora`, agregar:

```css
/* Checkbox en línea dentro del formulario de Configuración. */
.check-linea { align-items:center; display:flex; gap:6px; padding-top:22px; }
.check-linea input { margin:0; min-height:auto; width:auto; }
/* Importe de la reserva con su anticipo debajo. */
.order-importes { text-align:right; white-space:nowrap; }
.order-importes strong { color:var(--burgundy); font-variant-numeric:tabular-nums; }
.order-importes small { color:var(--muted); display:block; font-size:10px; margin-top:3px; }
```

- [ ] **Step 10: Compilar**

```bash
bash scripts/build-jsx.sh
```

Expected: `OK: JSX compilado en compiled/`, sin errores.

- [ ] **Step 11: Verificar en el navegador**

Con el servidor estático corriendo, entrar a `admin.html` con la cuenta de prueba:

1. **Configuración**: ya no está "Mínimo de días". Están "Anticipo (%)", el interruptor
   de redondeo, "Tarjeta para el anticipo" y "Teléfono asociado". Poner 30% con redondeo
   activado, tarjeta y teléfono, pulsar "Guardar cambios", recargar y confirmar que
   siguen ahí.
2. **Artículos**: los dos campos de precio dicen "Precio por evento".
3. **Reservas**: cada reserva muestra "Evento: AAAA-MM-DD" y "Recoge el ... después de
   las 5:00 PM", y el anticipo bajo el total en las que lo tengan.
4. **Reserva manual**: hay un solo campo de fecha. Crear una reserva de prueba con un
   artículo, confirmar que se crea sin error y aparece en la lista con la fecha correcta.
   Después cancelarla (botón "Cancelar") para no dejar basura.
5. Consola sin errores.

- [ ] **Step 12: Commit**

```bash
git add utils/auth-alquiler.js components/Panel.js styles.css compiled/
git commit -m "panel: anticipo y datos de pago, precio por evento, fecha de evento"
```

---

## Task 5: Cache-busting y verificación integrada

**Files:**
- Modify: `index.html`, `admin.html`, `sw.js`

**Interfaces:**
- Consume: todos los archivos modificados en las Tareas 3 y 4.

- [ ] **Step 1: Subir el `CACHE_NAME`**

En `sw.js`, cambiar:

```js
const CACHE_NAME = 'romadetalles-v3';
```

por:

```js
const CACHE_NAME = 'romadetalles-v4';
```

- [ ] **Step 2: Subir el `?v=` de los archivos que cambiaron**

Usar la marca `20260801-3` en:

- `admin.html`: `styles.css`, `utils/auth-alquiler.js`, `compiled/components/Panel.js`
- `index.html`: `styles.css`, `compiled/components/Tienda.js`

No tocar el `?v=` de los archivos que no cambiaron en este plan (`utils/storage.js`,
`utils/supabase-config.js`, `utils/push-config.js`, `utils/push-alquiler.js`,
`compiled/admin-app.js`, `compiled/tienda-app.js`).

- [ ] **Step 3: Verificación integrada**

Con el servidor estático corriendo:

1. Desregistrar el service worker viejo
   (`navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`
   en la consola) y recargar fuerte, para no estar probando contra caché vieja.
2. **Flujo completo de clienta** en `index.html?s=roma-detalles`: elegir el día del
   evento, agregar dos artículos, abrir el cajón, confirmar que se ven total, anticipo,
   resto y datos de pago; llenar nombre y enviar. Confirmar que el pedido se crea y el
   mensaje de WhatsApp que se abre dice "Evento: <fecha>" (una sola fecha) y trae el
   bloque de anticipo con la tarjeta.
3. **Panel**: la reserva recién creada aparece en Reservas con su fecha de evento y su
   anticipo.
4. **Prueba del solapamiento** (lo que hace correcto todo el diseño): con un artículo de
   cantidad 1, crear una reserva para el día D. Luego, en la tienda, elegir el día D+1 y
   confirmar que ese artículo sale como **no disponible** (se pisan la noche del D). Por
   último elegir D+2 y confirmar que sale como **disponible**. Cancelar la reserva de
   prueba desde el panel al terminar.
5. Sin 404 en la pestaña de red para los archivos versionados, y sin errores de consola.

- [ ] **Step 4: Commit**

```bash
git add index.html admin.html sw.js
git commit -m "cache: subir versión de assets tras día de evento y anticipo"
```

- [ ] **Step 5: Push**

Confirmar con el usuario antes de este paso — es lo que publica el cambio en GitHub Pages
para negocios reales.

```bash
git push
```
