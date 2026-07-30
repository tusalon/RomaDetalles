-- =====================================================================
-- RomaDetalles / Alquila Fácil — esquema de alquiler por días
-- Proyecto Supabase compartido: zorhclhvykikaachfrmp
-- =====================================================================
--
-- Por qué tablas nuevas con prefijo `alquiler_` en vez de reusar `negocios`:
-- el alquiler por días es un modelo distinto al de reservas de turnos
-- (aquí se bloquea un objeto físico durante un rango de fechas, no una
-- franja horaria de una profesional). Compartir el proyecto Supabase nos
-- da gratis la Edge Function `enviar-web-push` y la tabla
-- `push_suscripciones`; compartir las TABLAS nos daría solo dolores.
--
-- REGLA DE ESTE ARCHIVO: RLS cerrada desde el día uno. Estas tablas NO
-- copian el patrón `using(true)` del resto del proyecto. En particular:
--   · el público NO puede leer pedidos (llevan nombre y teléfono)
--   · el público NO inserta pedidos: eso pasa por la Edge Function
--     `crear-pedido-alquiler`, que usa service_role
--   · el dueño solo ve y toca lo de SU negocio, vía auth.uid()
--
-- Correr en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Negocios de alquiler
-- ---------------------------------------------------------------------
create table if not exists alquiler_negocios (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  nombre            text not null,
  titulo_bienvenida text not null default 'Haz de tu evento un momento inolvidable',
  texto_bienvenida  text not null default 'Elige tus decoraciones favoritas, selecciona las fechas y comprueba su disponibilidad antes de enviar el pedido.',
  whatsapp          text not null default '',
  moneda            text not null default 'CUP',
  instagram_url     text not null default '',
  facebook_url      text not null default '',
  -- Reglas del negocio que hoy no existen en la app y sí hacen falta:
  dias_minimos      int  not null default 1,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Quién puede administrar cada negocio (Supabase Auth → negocio)
-- ---------------------------------------------------------------------
create table if not exists alquiler_usuarios (
  user_id     uuid not null references auth.users(id) on delete cascade,
  negocio_id  uuid not null references alquiler_negocios(id) on delete cascade,
  rol         text not null default 'dueno',   -- dueno | empleado
  creado_en   timestamptz not null default now(),
  primary key (user_id, negocio_id)
);

create index if not exists alquiler_usuarios_negocio_idx
  on alquiler_usuarios (negocio_id);

-- Helper: ¿el usuario autenticado administra este negocio?
-- SECURITY DEFINER para que las policies no entren en recursión al
-- consultar alquiler_usuarios desde una policy de alquiler_usuarios.
create or replace function alquiler_es_admin(p_negocio uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from alquiler_usuarios
    where negocio_id = p_negocio
      and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Catálogo
-- ---------------------------------------------------------------------
create table if not exists alquiler_productos (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references alquiler_negocios(id) on delete cascade,
  nombre         text not null,
  descripcion    text not null default '',
  categoria      text not null default 'Decoración',
  precio_dia     numeric(12,2) not null default 0 check (precio_dia >= 0),
  cantidad       int not null default 1 check (cantidad >= 0),
  foto_url       text not null default '',
  activo         boolean not null default true,
  orden          int not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists alquiler_productos_negocio_idx
  on alquiler_productos (negocio_id, activo);

-- ---------------------------------------------------------------------
-- 4. Pedidos
-- ---------------------------------------------------------------------
create table if not exists alquiler_pedidos (
  id               text primary key,               -- RD-260730-A1B2C
  negocio_id       uuid not null references alquiler_negocios(id) on delete cascade,
  cliente_nombre   text not null,
  cliente_telefono text not null default '',
  fecha_inicio     date not null,
  fecha_fin        date not null,
  dias             int  not null check (dias >= 1),
  total            numeric(12,2) not null default 0,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','confirmado','cancelado','entregado','devuelto')),
  notas            text not null default '',
  -- Reserva blanda: el pedido bloquea el stock hasta esta hora mientras
  -- la clienta está en WhatsApp. Si el negocio no confirma, expira solo
  -- y el stock se libera — sin cron, la consulta de disponibilidad
  -- simplemente ignora los pendientes vencidos.
  expira_en        timestamptz not null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint alquiler_pedidos_fechas check (fecha_fin >= fecha_inicio)
);

create index if not exists alquiler_pedidos_negocio_idx
  on alquiler_pedidos (negocio_id, creado_en desc);

-- Índice para la consulta de disponibilidad (la más caliente de la app)
create index if not exists alquiler_pedidos_rango_idx
  on alquiler_pedidos (negocio_id, fecha_inicio, fecha_fin, estado);

create table if not exists alquiler_pedido_items (
  id              bigserial primary key,
  pedido_id       text not null references alquiler_pedidos(id) on delete cascade,
  producto_id     uuid not null references alquiler_productos(id),
  producto_nombre text not null,          -- congelado: si luego renombran el producto, el pedido histórico no cambia
  precio_dia      numeric(12,2) not null, -- congelado: el precio del día que se pidió
  cantidad        int not null default 1 check (cantidad >= 1)
);

create index if not exists alquiler_pedido_items_pedido_idx
  on alquiler_pedido_items (pedido_id);

create index if not exists alquiler_pedido_items_producto_idx
  on alquiler_pedido_items (producto_id);

-- =====================================================================
-- DISPONIBILIDAD
-- =====================================================================
-- Pública (la tienda la necesita sin login) pero SECURITY DEFINER y
-- devolviendo solo agregados: cantidad total, reservada y disponible.
-- Nunca expone quién reservó.
--
-- Un pedido bloquea stock si:
--   · está confirmado / entregado, o
--   · está pendiente y todavía no expiró
-- y su rango de fechas se solapa con el consultado.
create or replace function alquiler_disponibilidad(
  p_negocio uuid,
  p_inicio  date,
  p_fin     date
)
returns table (
  producto_id uuid,
  cantidad    int,
  reservado   int,
  disponible  int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.cantidad,
    coalesce(r.reservado, 0)::int,
    greatest(0, p.cantidad - coalesce(r.reservado, 0))::int
  from alquiler_productos p
  left join (
    select i.producto_id, sum(i.cantidad) as reservado
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where ped.negocio_id = p_negocio
      and ped.fecha_inicio <= p_fin
      and ped.fecha_fin    >= p_inicio
      and (
        ped.estado in ('confirmado','entregado')
        or (ped.estado = 'pendiente' and ped.expira_en > now())
      )
    group by i.producto_id
  ) r on r.producto_id = p.id
  where p.negocio_id = p_negocio
    and p.activo = true
  order by p.orden, p.creado_en;
$$;

-- =====================================================================
-- CREACIÓN DE PEDIDO — atómica
-- =====================================================================
-- Toma un lock por negocio antes de comprobar disponibilidad, así dos
-- clientas que envían a la vez por la última unidad no pueden pasar las
-- dos. (En la versión Cloudflare esto era una carrera real.)
--
-- p_items: jsonb [{"producto_id":"uuid","cantidad":2}, ...]
--
-- Devuelve el pedido creado. Lanza excepción con mensaje legible si algo
-- ya no está disponible, para que la Edge Function lo pase a la clienta.
create or replace function alquiler_crear_pedido(
  p_negocio    uuid,
  p_nombre     text,
  p_telefono   text,
  p_notas      text,
  p_inicio     date,
  p_fin        date,
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
  v_dias      int;
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

  -- Serializa la comprobación de stock por negocio. Dos pedidos del mismo
  -- negocio se ordenan; pedidos de negocios distintos no se estorban.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 0));

  v_dias := (p_fin - p_inicio) + 1;

  if v_dias < 1 or v_dias > 60 then
    raise exception 'PERIODO_INVALIDO';
  end if;

  if v_dias < v_negocio.dias_minimos then
    raise exception 'MINIMO_DIAS:%', v_negocio.dias_minimos;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'PEDIDO_VACIO';
  end if;

  v_pedido_id :=
    'RD-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into alquiler_pedidos (
    id, negocio_id, cliente_nombre, cliente_telefono,
    fecha_inicio, fecha_fin, dias, total, estado, notas, expira_en
  ) values (
    v_pedido_id, p_negocio, p_nombre, coalesce(p_telefono, ''),
    p_inicio, p_fin, v_dias, 0, 'pendiente', coalesce(p_notas, ''),
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

    -- Disponibilidad excluyendo este pedido, que ya está insertado
    select greatest(0, v_prod.cantidad - coalesce(sum(i.cantidad), 0))::int
      into v_disp
    from alquiler_pedido_items i
    join alquiler_pedidos ped on ped.id = i.pedido_id
    where i.producto_id = v_prod.id
      and ped.id <> v_pedido_id
      and ped.negocio_id = p_negocio
      and ped.fecha_inicio <= p_fin
      and ped.fecha_fin    >= p_inicio
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

    v_total := v_total + (v_prod.precio_dia * v_pedida * v_dias);
  end loop;

  update alquiler_pedidos
     set total = v_total, actualizado_en = now()
   where id = v_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

-- =====================================================================
-- OCUPACIÓN — el número que le vende el servicio al dueño
-- =====================================================================
-- Cuántos días estuvo alquilado cada artículo en un rango. Le dice qué
-- comprar más y qué le está ocupando espacio sin producir.
create or replace function alquiler_ocupacion(
  p_negocio uuid,
  p_desde   date,
  p_hasta   date
)
returns table (
  producto_id     uuid,
  producto_nombre text,
  veces_alquilado bigint,
  dias_alquilado  bigint,
  ingreso         numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.nombre,
    count(distinct ped.id),
    coalesce(sum(
      (least(ped.fecha_fin, p_hasta) - greatest(ped.fecha_inicio, p_desde) + 1)
      * i.cantidad
    ), 0),
    coalesce(sum(i.precio_dia * i.cantidad * ped.dias), 0)
  from alquiler_productos p
  left join alquiler_pedido_items i on i.producto_id = p.id
  left join alquiler_pedidos ped
         on ped.id = i.pedido_id
        and ped.estado in ('confirmado','entregado','devuelto')
        and ped.fecha_inicio <= p_hasta
        and ped.fecha_fin    >= p_desde
  where p.negocio_id = p_negocio
  group by p.id, p.nombre
  order by 4 desc nulls last;
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table alquiler_negocios     enable row level security;
alter table alquiler_usuarios     enable row level security;
alter table alquiler_productos    enable row level security;
alter table alquiler_pedidos      enable row level security;
alter table alquiler_pedido_items enable row level security;

-- --- Negocios -------------------------------------------------------
-- La tienda pública necesita leer el negocio activo por slug.
drop policy if exists alquiler_negocios_lectura_publica on alquiler_negocios;
create policy alquiler_negocios_lectura_publica
  on alquiler_negocios for select
  using (activo = true);

drop policy if exists alquiler_negocios_update_dueno on alquiler_negocios;
create policy alquiler_negocios_update_dueno
  on alquiler_negocios for update
  using (alquiler_es_admin(id))
  with check (alquiler_es_admin(id));

-- Crear/borrar negocios: solo service_role (sin policy = solo él pasa).

-- --- Usuarios -------------------------------------------------------
-- Cada quien ve solo sus propias filas. Altas y bajas por service_role.
drop policy if exists alquiler_usuarios_lectura_propia on alquiler_usuarios;
create policy alquiler_usuarios_lectura_propia
  on alquiler_usuarios for select
  using (user_id = auth.uid());

-- --- Productos ------------------------------------------------------
-- Público: solo activos de negocios activos.
drop policy if exists alquiler_productos_lectura_publica on alquiler_productos;
create policy alquiler_productos_lectura_publica
  on alquiler_productos for select
  using (
    activo = true
    and exists (
      select 1 from alquiler_negocios n
      where n.id = negocio_id and n.activo = true
    )
  );

-- Dueño: lo ve todo de su negocio, incluidos los ocultos.
drop policy if exists alquiler_productos_lectura_dueno on alquiler_productos;
create policy alquiler_productos_lectura_dueno
  on alquiler_productos for select
  using (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_productos_insert_dueno on alquiler_productos;
create policy alquiler_productos_insert_dueno
  on alquiler_productos for insert
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_productos_update_dueno on alquiler_productos;
create policy alquiler_productos_update_dueno
  on alquiler_productos for update
  using (alquiler_es_admin(negocio_id))
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_productos_delete_dueno on alquiler_productos;
create policy alquiler_productos_delete_dueno
  on alquiler_productos for delete
  using (alquiler_es_admin(negocio_id));

-- --- Pedidos --------------------------------------------------------
-- SIN policy de lectura pública, a propósito: los pedidos llevan nombre
-- y teléfono de la clienta. La tienda pública NO los lee nunca.
-- Tampoco hay policy de INSERT: los crea la Edge Function con
-- service_role, vía alquiler_crear_pedido().
drop policy if exists alquiler_pedidos_lectura_dueno on alquiler_pedidos;
create policy alquiler_pedidos_lectura_dueno
  on alquiler_pedidos for select
  using (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_pedidos_update_dueno on alquiler_pedidos;
create policy alquiler_pedidos_update_dueno
  on alquiler_pedidos for update
  using (alquiler_es_admin(negocio_id))
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_items_lectura_dueno on alquiler_pedido_items;
create policy alquiler_items_lectura_dueno
  on alquiler_pedido_items for select
  using (
    exists (
      select 1 from alquiler_pedidos ped
      where ped.id = pedido_id
        and alquiler_es_admin(ped.negocio_id)
    )
  );

-- =====================================================================
-- PERMISOS DE EJECUCIÓN
-- =====================================================================
-- La tienda pública (anon) solo puede consultar disponibilidad.
-- Crear pedidos NO se expone a anon: pasa por la Edge Function.
revoke all on function alquiler_crear_pedido(uuid,text,text,text,date,date,jsonb,int) from public, anon, authenticated;
grant  execute on function alquiler_crear_pedido(uuid,text,text,text,date,date,jsonb,int) to service_role;

grant execute on function alquiler_disponibilidad(uuid,date,date) to anon, authenticated, service_role;
grant execute on function alquiler_ocupacion(uuid,date,date)      to authenticated, service_role;
grant execute on function alquiler_es_admin(uuid)                 to authenticated, service_role;

-- =====================================================================
-- COMPROBACIONES (correr después, deben dar lo indicado)
-- =====================================================================
-- Con la anon key, desde el navegador o curl:
--   SELECT de alquiler_pedidos        → 0 filas (nunca error, RLS filtra)
--   INSERT en alquiler_pedidos        → 42501 permission denied
--   SELECT de alquiler_productos      → solo activos
--   rpc alquiler_crear_pedido         → 42501 permission denied
--   rpc alquiler_disponibilidad       → funciona
