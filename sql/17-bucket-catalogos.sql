-- =====================================================================
-- RomaDetalles — espacio de almacenamiento para el catálogo en PDF
-- =====================================================================
-- Por qué: el catálogo se genera en el teléfono, pero dentro de la APK
-- (Capacitor) ningún enlace de descarga hace nada — la APK no tiene
-- manejador de descargas (MainActivity.java sin DownloadListener). Y en
-- el navegador, el clic automático caduca mientras se arman 40 fotos.
-- Medido además: Cloudinary devuelve 401 al servir PDFs en esta cuenta.
--
-- Solución: el panel sube el PDF aquí y muestra un enlace a
-- supabase.co. Al ser otro dominio, la APK lo abre fuera, en Chrome, y
-- Chrome sí lo descarga. El mismo enlace sirve para mandarlo por WhatsApp.
--
-- Seguridad: bucket público de SOLO LECTURA (el catálogo es la misma
-- info que ya muestra la tienda pública, sin datos de pago ni de
-- clientas). Solo sube quien administra ese negocio: la carpeta debe ser
-- su negocio_id, comprobado con alquiler_es_admin(). Solo PDF, máx. 20 MB.
--
-- Idempotente.
-- =====================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogos', 'catalogos', true, 20971520, array['application/pdf'])
on conflict (id) do update
   set public = true,
       file_size_limit = 20971520,
       allowed_mime_types = array['application/pdf'];

drop policy if exists catalogos_subida_admin on storage.objects;
create policy catalogos_subida_admin
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'catalogos'
    and alquiler_es_admin(((storage.foldername(name))[1])::uuid)
  );

commit;

-- Comprobación: debe devolver una fila con public = true
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'catalogos';
