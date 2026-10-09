-- =====================================================================
-- RomaDetalles — servicios cotizables: catering, cakes y dulces
-- =====================================================================
-- Por qué: la dueña quiere ofrecer servicios además de alquilar artículos
-- (catering, cakes, mesa de dulces). Un servicio NO es un artículo: no se
-- alquila ni se devuelve, no tiene stock ni ventana de 3 días, y su precio
-- depende del evento. Por eso va en su propia tabla y no entra en
-- alquiler_disponibilidad ni en el total del pedido: la clienta lo marca
-- al pedir y la admin lo cotiza por WhatsApp (igual que el domicilio).
--
-- Medido antes de escribir esto: alquiler_servicios no existe (404 en la
-- API) y las 3 tiendas tienen plantilla_solicitud igual al default vigente
-- de sql/15, así que el update de abajo las alcanza a las tres.
--
-- Fotos: hasta 6 por servicio, en un arreglo de URLs de Cloudinary.
-- Seguridad: igual que alquiler_galeria (sql/05) — el público ve solo
-- servicios activos de negocios activos; cada dueña toca solo los suyos.
--
-- Idempotente.
-- =====================================================================

begin;

create table if not exists alquiler_servicios (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references alquiler_negocios(id) on delete cascade,
  nombre         text not null,
  descripcion    text not null default '',
  categoria      text not null default 'Catering',
  precio_desde   numeric(12,2) check (precio_desde is null or precio_desde >= 0),
  fotos          text[] not null default '{}',
  activo         boolean not null default true,
  orden          int not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint alquiler_servicios_max_fotos check (coalesce(array_length(fotos, 1), 0) <= 6)
);

create index if not exists alquiler_servicios_negocio_idx
  on alquiler_servicios (negocio_id, activo, orden);

alter table alquiler_servicios enable row level security;

drop policy if exists alquiler_servicios_lectura_publica on alquiler_servicios;
create policy alquiler_servicios_lectura_publica
  on alquiler_servicios for select
  using (
    activo = true
    and exists (select 1 from alquiler_negocios n where n.id = negocio_id and n.activo = true)
  );

drop policy if exists alquiler_servicios_lectura_dueno on alquiler_servicios;
create policy alquiler_servicios_lectura_dueno
  on alquiler_servicios for select
  using (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_servicios_insert_dueno on alquiler_servicios;
create policy alquiler_servicios_insert_dueno
  on alquiler_servicios for insert
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_servicios_update_dueno on alquiler_servicios;
create policy alquiler_servicios_update_dueno
  on alquiler_servicios for update
  using (alquiler_es_admin(negocio_id))
  with check (alquiler_es_admin(negocio_id));

drop policy if exists alquiler_servicios_delete_dueno on alquiler_servicios;
create policy alquiler_servicios_delete_dueno
  on alquiler_servicios for delete
  using (alquiler_es_admin(negocio_id));

-- En el pedido se guardan los NOMBRES (congelados, como producto_nombre en
-- alquiler_pedido_items): si la dueña luego borra o renombra un servicio,
-- la solicitud histórica sigue diciendo qué se pidió cotizar.
alter table alquiler_pedidos
  add column if not exists servicios_solicitados text[] not null default '{}';

-- ---------------------------------------------------------------------
-- Plantilla de solicitud — variable {servicios}
-- ---------------------------------------------------------------------
-- Mismo criterio que sql/05-08, 13 y 15: cambia el default y se
-- actualizan solo las filas que siguen con el texto anterior exacto.
alter table alquiler_negocios
  alter column plantilla_solicitud set default
    'Hola, deseo solicitar este alquiler:' || chr(10) ||
    '📅 Evento: {fechas}' || chr(10) ||
    chr(10) ||
    '{items}' || chr(10) ||
    chr(10) ||
    '💰 Total: {total}' || chr(10) ||
    '{anticipo}' || chr(10) ||
    '{servicios}' || chr(10) ||
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
    '{servicios}' || chr(10) ||
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
    '{domicilio}' || chr(10) ||
    '👤 Cliente: {nombre}' || chr(10) ||
    '{telefono}' || chr(10) ||
    '{notas}' || chr(10) ||
    'Quedo pendiente de confirmación. Gracias.' || chr(10) ||
    '🔗 Guarda tu reserva aquí: {enlace_reserva}';

commit;

-- Comprobación: tabla vacía lista y las 3 plantillas con {servicios}.
select (select count(*) from alquiler_servicios) as servicios,
       (select count(*) from alquiler_negocios where plantilla_solicitud like '%{servicios}%') as plantillas_con_servicios,
       (select count(*) from alquiler_negocios) as negocios;
