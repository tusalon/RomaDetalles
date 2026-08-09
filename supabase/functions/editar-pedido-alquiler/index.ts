// supabase/functions/editar-pedido-alquiler/index.ts
//
// Único camino por el que la clienta edita su reserva desde el enlace.
//
// Existe por la misma razón que crear-pedido-alquiler: el push al dueño se
// dispara del lado del servidor. Si la tienda llamara al RPC directo, el
// negocio no se enteraría del cambio salvo mirando el panel, y no se puede
// exponer `enviar-web-push` a la anon key porque entonces cualquiera podría
// mandarle avisos arbitrarios al dueño.
//
// La dueña NO pasa por aquí: desde el panel llama a alquiler_editar_pedido
// directo, autenticada, y no tiene sentido notificarse a sí misma.
//
// Desplegar:
//   npx supabase functions deploy editar-pedido-alquiler \
//     --project-ref zorhclhvykikaachfrmp --no-verify-jwt
//
// (--no-verify-jwt porque la clienta no tiene cuenta: su credencial es el
// token del enlace, que valida alquiler_editar_pedido dentro de Postgres.)

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

const texto = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const esFecha = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * Traduce las excepciones de alquiler_editar_pedido() a algo que la clienta
 * entienda. Nunca devolvemos el error crudo de Postgres al navegador.
 */
function mensajeDeError(raw: string): { mensaje: string; status: number } {
  if (raw.includes("SIN_STOCK")) {
    // PostgREST manda el error como JSON de una sola línea, así que cortar
    // por salto de línea no separa nada y el nombre saldría con el `"}` del
    // JSON pegado detrás. Se corta en la comilla que cierra el mensaje.
    const nombre = raw.match(/SIN_STOCK:([^"\\]*)/)?.[1]?.trim();
    return {
      mensaje: nombre
        ? `Ese día ya no queda ${nombre} disponible. Prueba con otra fecha.`
        : "Ese día ya no queda disponible todo lo que reservaste. Prueba con otra fecha.",
      status: 409,
    };
  }
  if (raw.includes("RESERVA_NO_EDITABLE")) {
    return { mensaje: "Esta reserva ya no se puede cambiar. Escríbenos y lo vemos.", status: 409 };
  }
  if (raw.includes("FECHA_PASADA")) {
    return { mensaje: "Elige un día que todavía no haya pasado.", status: 400 };
  }
  if (raw.includes("PERIODO_INVALIDO")) {
    return { mensaje: "Elige el día de tu evento.", status: 400 };
  }
  if (raw.includes("NO_AUTORIZADO") || raw.includes("PEDIDO_NO_EXISTE")) {
    return { mensaje: "No encontramos esta reserva. Revisa el enlace.", status: 404 };
  }
  console.error("[editar-pedido-alquiler] error no reconocido:", raw);
  return { mensaje: "No se pudo guardar el cambio. Inténtalo otra vez.", status: 500 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Falta configuración del servidor." }, 500);
  }
  const auth = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Petición inválida." }, 400);

  const token = texto(body.token, 64);
  const telefono = texto(body.cliente_telefono, 40);
  const notas = texto(body.notas, 500);
  if (!token) return json({ error: "No encontramos esta reserva. Revisa el enlace." }, 400);
  if (!esFecha(body.fecha_evento)) return json({ error: "Elige el día de tu evento." }, 400);
  const fechaEvento = body.fecha_evento as string;

  // Se lee ANTES de editar para quedarnos con el día viejo: así el aviso
  // puede decir de qué día a qué día se movió, que es lo que el negocio
  // necesita saber de un vistazo. Con service_role porque alquiler_pedidos
  // no tiene lectura pública.
  const previoRes = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_pedidos` +
      `?token_acceso=eq.${encodeURIComponent(token)}` +
      `&select=id,negocio_id,cliente_nombre,fecha_evento`,
    { headers: auth },
  );
  const previos = previoRes.ok ? await previoRes.json() : [];
  const previo = previos[0];
  if (!previo) return json({ error: "No encontramos esta reserva. Revisa el enlace." }, 404);

  // El token viaja al RPC, que es quien de verdad autoriza. Aquí no se
  // decide nada de permisos: si el token no cuadra, Postgres lo rechaza.
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/alquiler_editar_pedido`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      p_pedido: previo.id,
      p_nombre: null,
      p_telefono: telefono,
      p_notas: notas,
      p_evento: fechaEvento,
      p_items: null,
      p_token: token,
    }),
  });

  if (!rpcRes.ok) {
    const raw = await rpcRes.text();
    const { mensaje, status } = mensajeDeError(raw);
    return json({ error: mensaje }, status);
  }

  // ---- Push al dueño --------------------------------------------------
  // No bloquea la respuesta: el cambio ya está guardado y la reserva ya
  // aparece en Pendientes del panel, así que un push perdido no pierde el
  // dato. El título lleva el nombre solo si es corto, para que no se corte
  // en una línea de notificación (mismo criterio que crear-pedido).
  const cambioDeDia = previo.fecha_evento !== fechaEvento;
  const nombre = String(previo.cliente_nombre || "");
  const tituloPush =
    nombre && nombre.length <= 20 ? `${nombre} cambió su reserva` : "Una reserva cambió";
  const cuerpoPush = cambioDeDia
    ? `Movida del ${fechaLarga(previo.fecha_evento)} al ${fechaLarga(fechaEvento)}. Confírmala en el panel.`
    : "Cambió sus datos de contacto. Confírmala en el panel.";

  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 5000);
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: auth,
      signal: controlador.signal,
      body: JSON.stringify({
        negocio_id: previo.negocio_id,
        role: "admin",
        title: tituloPush,
        body: cuerpoPush,
        url: `https://tusalon.github.io/RomaDetalles/admin.html?pedido=${previo.id}`,
      }),
    });
    clearTimeout(corte);
    if (!pushRes.ok) {
      console.warn("[editar-pedido-alquiler] push no enviado:", pushRes.status, await pushRes.text());
    }
  } catch (e) {
    console.warn("[editar-pedido-alquiler] push falló:", String(e));
  }

  return json({ ok: true }, 200);
});
