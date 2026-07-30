// supabase/functions/recordatorio-reservas-manana/index.ts
//
// Aviso push a cada dueña, una vez al día, con las reservas confirmadas
// de MAÑANA (hora de Cuba). Pensado para correr a las 5pm vía pg_cron —
// ver sql/04-comercializacion.sql.
//
// Por qué push y no otra cosa: es el único canal que ya existe (mismo
// que usa crear-pedido-alquiler). No hay envío de email/SMS integrado.
//
// Desplegar:
//   npx supabase functions deploy recordatorio-reservas-manana \
//     --project-ref zorhclhvykikaachfrmp --no-verify-jwt

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fecha de "mañana" en el calendario de La Habana, no en UTC — a las
// 5pm en Cuba puede ser ya otro día en UTC, y el cálculo ingenuo con
// `new Date()` + 1 día en UTC daría la fecha equivocada la mitad del año.
function mananaEnHabana(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const hoy = formatter.format(new Date()); // YYYY-MM-DD
  const [y, m, d] = hoy.split("-").map(Number);
  const manana = new Date(Date.UTC(y, m - 1, d + 1));
  return manana.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Variables de entorno no configuradas" }, 503);
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const manana = mananaEnHabana();

  // Reservas confirmadas o entregadas cuyo alquiler ARRANCA mañana —
  // eso es lo que la dueña necesita tener listo, no las que solo siguen
  // en curso.
  const res = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_pedidos?fecha_inicio=eq.${manana}` +
    `&estado=in.(confirmado,entregado)&select=negocio_id,cliente_nombre,cliente_telefono,` +
    `alquiler_pedido_items(producto_nombre,cantidad)`,
    { headers },
  );
  if (!res.ok) return json({ error: "Error consultando reservas" }, 500);
  const pedidos = await res.json();

  if (!pedidos.length) {
    return json({ ok: true, fecha: manana, negocios_avisados: 0, mensaje: "Sin reservas para mañana" });
  }

  // Agrupar por negocio: una dueña con 3 reservas mañana recibe UN aviso,
  // no tres.
  const porNegocio: Record<string, typeof pedidos> = {};
  for (const p of pedidos) {
    (porNegocio[p.negocio_id] ??= []).push(p);
  }

  let enviados = 0;
  const errores: string[] = [];

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

    if (pushRes.ok) enviados++;
    else errores.push(`negocio ${negocioId}: ${pushRes.status}`);
  }

  return json({ ok: true, fecha: manana, negocios_avisados: enviados, errores });
});
