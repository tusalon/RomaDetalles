-- =====================================================================
-- RomaDetalles — activar los dos crons que quedaron pendientes
-- =====================================================================
-- Documentados desde sql/04 y sql/11 pero nunca programados: el bloque
-- vivía comentado porque necesita la extensión pg_cron, que no se activa
-- sola. Requisito antes de correr esto:
--
--   Dashboard de Supabase → Database → Extensions → buscar "pg_cron" →
--   activarla.
--
-- Los dos jobs son idempotentes (se desprograman antes de reprogramarse),
-- así que este archivo se puede correr de nuevo sin duplicar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recordatorio diario: "mañana tienes N entregas" — 5pm hora Cuba
-- ---------------------------------------------------------------------
select cron.unschedule('romadetalles-recordatorio-manana')
 where exists (select 1 from cron.job
                where jobname = 'romadetalles-recordatorio-manana');

select cron.schedule(
  'romadetalles-recordatorio-manana',
  '0 21 * * *',  -- 21:00 UTC = 17:00 Cuba (UTC-4). Ajustar si cambia el horario de verano.
  $$
  select net.http_post(
    url := 'https://zorhclhvykikaachfrmp.supabase.co/functions/v1/recordatorio-reservas-manana',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvcmhjbGh2eWtpa2FhY2hmcm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDQzMzUsImV4cCI6MjA4NzcyMDMzNX0.reauF3UfNTFJFZ3Mnzf8ctYH1d5p7C3msi7AvYJUaos',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvcmhjbGh2eWtpa2FhY2hmcm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDQzMzUsImV4cCI6MjA4NzcyMDMzNX0.reauF3UfNTFJFZ3Mnzf8ctYH1d5p7C3msi7AvYJUaos'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- 2. Vencer solas las reservas pendientes que nunca pagaron el anticipo
-- ---------------------------------------------------------------------
-- El margen de 1 hora sobre expira_en evita cancelarle la reserva a una
-- clienta justo mientras la dueña la está confirmando. El stock ya se
-- libera solo al vencer (alquiler_disponibilidad no cuenta las
-- pendientes caducadas) — esto no arregla stock, solo evita que las
-- abandonadas se acumulen para siempre en la pestaña Pendientes. Y con
-- sql/14, si la clienta sí quiere pagar después, "Reactivar" en el panel
-- la vuelve a abrir sin que rehaga el pedido.
select cron.unschedule('romadetalles-vencer-pendientes')
 where exists (select 1 from cron.job
                where jobname = 'romadetalles-vencer-pendientes');

select cron.schedule(
  'romadetalles-vencer-pendientes',
  '7 * * * *',
  $cron$
  update alquiler_pedidos
     set estado = 'cancelado', actualizado_en = now()
   where estado = 'pendiente'
     and expira_en < now() - interval '1 hour';
  $cron$
);
