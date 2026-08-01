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
