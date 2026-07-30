-- =====================================================================
-- Permitir que RomaDetalles use la tabla push_suscripciones compartida
-- =====================================================================
--
-- PROBLEMA: push_suscripciones.negocio_id tenía
--     references public.negocios(id) on delete cascade
-- es decir, exigía que el negocio existiera en la tabla de SALONES de
-- rservasroma. Un negocio de alquiler vive en `alquiler_negocios`, así que
-- al intentar guardar su suscripción Postgres devolvía 23503.
--
-- DECISIÓN: quitar la llave foránea. Así `negocio_id` pasa a ser un UUID
-- libre y la misma tabla sirve para los tres productos (salones, RomaHub,
-- alquiler) sin duplicar la Edge Function `enviar-web-push`, que consulta
-- push_suscripciones sin unirla nunca a `negocios`.
--
-- LO QUE SE PIERDE, a sabiendas:
--   · Al borrar un salón de `negocios` sus suscripciones ya NO se borran
--     en cascada. Quedan huérfanas: inofensivas (nadie manda push a un
--     negocio que no existe) pero acumulan filas. Ver la consulta de
--     limpieza al final.
--   · Un negocio_id mal escrito ya no da error, se acepta en silencio.
--     Si un push "no llega", sospecha primero de esto.
--
-- rservasroma y RomaHub siguen funcionando exactamente igual: sus inserts
-- ya cumplían la restricción, y quitarla no invalida ninguna fila.
-- =====================================================================

-- Ver el nombre real de la restricción antes de tocarla
--   select conname from pg_constraint
--   where conrelid = 'public.push_suscripciones'::regclass and contype = 'f';

alter table public.push_suscripciones
  drop constraint if exists push_suscripciones_negocio_id_fkey;

-- ---------------------------------------------------------------------
-- Limpieza de huérfanas (opcional, correr de vez en cuando)
-- ---------------------------------------------------------------------
-- Ahora que no hay cascada, esto es lo que antes pasaba solo. Desactiva
-- (no borra) las suscripciones cuyo negocio ya no existe en NINGUNA de
-- las dos tablas.
--
--   update public.push_suscripciones s
--      set activo = false, updated_at = now()
--    where s.activo = true
--      and not exists (select 1 from public.negocios n          where n.id = s.negocio_id)
--      and not exists (select 1 from public.alquiler_negocios a where a.id = s.negocio_id);
