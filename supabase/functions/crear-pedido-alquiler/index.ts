// supabase/functions/crear-pedido-alquiler/index.ts
//
// Único camino por el que se crea un pedido de alquiler.
//
// Por qué existe en vez de dejar que la tienda inserte directo con la anon key:
//   1. La anon key NO tiene permiso de INSERT en alquiler_pedidos ni de
//      ejecutar alquiler_crear_pedido(). Así nadie puede inventar pedidos
//      ni leer los datos de otras clientas.
//   2. El push al dueño se dispara aquí, del lado del servidor. La tienda
//      pública nunca toca `enviar-web-push`, así que no hereda el problema
//      de que cualquiera con la anon key pueda mandar avisos arbitrarios.
//   3. La reserva de stock queda atómica: alquiler_crear_pedido() toma un
//      lock por negocio, así dos clientas que envían a la vez por la última
//      unidad no pueden pasar las dos.
//
// Desplegar:
//   npx supabase functions deploy crear-pedido-alquiler \
//     --project-ref zorhclhvykikaachfrmp --no-verify-jwt
//
// (--no-verify-jwt porque la tienda es pública: la clienta no tiene cuenta.)

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

const dinero = (n: number) =>
  new Intl.NumberFormat("es", { maximumFractionDigits: 0 }).format(n);

// "sábado 15 de agosto" en vez de "2026-08-15". Mediodía UTC como ancla
// (misma técnica que usa diaAntes() en Tienda.js) para que el texto no
// se corra un día sin importar en qué huso horario corra este servidor.
const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * Traduce las excepciones de alquiler_crear_pedido() a algo que la clienta
 * entienda. Las que no reconocemos se vuelven un mensaje genérico: nunca
 * devolvemos el error crudo de Postgres al navegador.
 */
function mensajeDeError(raw: string): { mensaje: string; status: number } {
  if (raw.includes("SIN_STOCK")) {
    // PostgREST manda el error como JSON de una sola línea, así que cortar
    // por salto de línea no separa nada y el nombre saldría con el `"}` del
    // JSON pegado detrás. Se corta en la comilla que cierra el mensaje.
    const nombre = raw.match(/SIN_STOCK:([^"\\]*)/)?.[1]?.trim();
    return {
      mensaje: nombre
        ? `${nombre} ya no está disponible ese día. Prueba con otra fecha o quítalo del pedido.`
        : "Uno de los artículos ya no está disponible ese día.",
      status: 409,
    };
  }
  if (raw.includes("PERIODO_INVALIDO")) {
    return { mensaje: "Ese día no es válido.", status: 400 };
  }
  if (raw.includes("PEDIDO_VACIO")) {
    return { mensaje: "Tu pedido está vacío.", status: 400 };
  }
  if (raw.includes("PRODUCTO_NO_EXISTE")) {
    return { mensaje: "Uno de los artículos ya no está en el catálogo.", status: 409 };
  }
  if (raw.includes("NEGOCIO_NO_DISPONIBLE")) {
    return { mensaje: "Esta tienda no está disponible ahora mismo.", status: 404 };
  }
  console.error("[crear-pedido-alquiler] error no reconocido:", raw);
  return { mensaje: "No se pudo guardar el pedido. Inténtalo de nuevo.", status: 500 };
}

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
    enlaceReserva: string;
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
    .replaceAll("{enlace_reserva}", datos.enlaceReserva)
    .replaceAll("{nombre}", datos.nombre)
    .replaceAll("{telefono}", datos.telefono ? `📞 ${datos.telefono}` : "")
    .replaceAll("{notas}", datos.notas ? `📝 ${datos.notas}` : "");

  return texto.replace(/\n{3,}/g, "\n\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Variables de entorno no configuradas" }, 503);
  }
  const auth = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // ---- Entrada ------------------------------------------------------
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Cuerpo inválido" }, 400);

  const slug = texto(body.slug, 80);
  const negocioIdEntrada = texto(body.negocio_id, 40);
  const nombre = texto(body.cliente_nombre, 100);
  const telefono = texto(body.cliente_telefono, 40);
  const notas = texto(body.notas, 500);

  if (!nombre) return json({ error: "Escribe tu nombre para continuar." }, 400);
  if (!esFecha(body.fecha_evento)) {
    return json({ error: "Selecciona el día de tu evento." }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ error: "Tu pedido está vacío." }, 400);
  }
  if (body.items.length > 50) {
    return json({ error: "Demasiados artículos en un solo pedido." }, 400);
  }

  // Normaliza los items y suma cantidades repetidas del mismo producto
  const cantidades = new Map<string, number>();
  for (const item of body.items) {
    const id = texto(item?.producto_id, 40);
    const cantidad = Number(item?.cantidad);
    if (!id || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
      return json({ error: "Uno de los artículos no es válido." }, 400);
    }
    cantidades.set(id, (cantidades.get(id) ?? 0) + cantidad);
  }
  const items = [...cantidades].map(([producto_id, cantidad]) => ({
    producto_id,
    cantidad,
  }));

  // ---- Negocio ------------------------------------------------------
  // Acepta slug (lo normal desde la tienda) o negocio_id directo.
  const filtro = negocioIdEntrada
    ? `id=eq.${encodeURIComponent(negocioIdEntrada)}`
    : `slug=eq.${encodeURIComponent(slug)}`;

  if (!negocioIdEntrada && !slug) {
    return json({ error: "Falta identificar la tienda." }, 400);
  }

  const negocioRes = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_negocios?${filtro}&activo=eq.true&select=id,nombre,whatsapp,moneda,plantilla_solicitud,pago_tarjeta,pago_telefono`,
    { headers: auth },
  );
  const negocios = negocioRes.ok ? await negocioRes.json() : [];
  const negocio = negocios[0];
  if (!negocio) return json({ error: "Esta tienda no está disponible." }, 404);

  // ---- Crear el pedido (atómico) ------------------------------------
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/alquiler_crear_pedido`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      p_negocio: negocio.id,
      p_nombre: nombre,
      p_telefono: telefono,
      p_notas: notas,
      p_evento: body.fecha_evento,
      p_items: items,
    }),
  });

  if (!rpcRes.ok) {
    const raw = await rpcRes.text();
    const { mensaje, status } = mensajeDeError(raw);
    return json({ error: mensaje }, status);
  }

  const pedido = await rpcRes.json();
  if (!pedido?.id) {
    console.error("[crear-pedido-alquiler] rpc sin id:", JSON.stringify(pedido));
    return json({ error: "No se pudo guardar el pedido." }, 500);
  }

  // ---- Líneas del pedido (para WhatsApp y para el push) -------------
  const itemsRes = await fetch(
    `${supabaseUrl}/rest/v1/alquiler_pedido_items?pedido_id=eq.${encodeURIComponent(pedido.id)}&select=producto_nombre,precio_dia,cantidad`,
    { headers: auth },
  );
  const lineas: Array<{ producto_nombre: string; precio_dia: number; cantidad: number }> =
    itemsRes.ok ? await itemsRes.json() : [];

  const moneda = negocio.moneda || "CUP";
  const dias = pedido.dias;

  // ---- Mensaje de WhatsApp -----------------------------------------
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

  const numero = (negocio.whatsapp || "").replace(/\D/g, "");
  const whatsappUrl = numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`
    : null;

  // ---- Push al dueño ------------------------------------------------
  // A propósito NO bloquea la respuesta: si el push falla, la clienta ya
  // tiene su pedido guardado y su enlace de WhatsApp. El pedido siempre
  // queda en el panel, así que un push perdido no pierde la venta.
  //
  // Este aviso es lo que arregla el hueco de la versión anterior, donde
  // el negocio solo se enteraba si la clienta pulsaba enviar en WhatsApp.
  // El título lleva el nombre de la clienta solo si es corto (cabe en
  // una línea de notificación sin cortarse); si no, cae a un genérico.
  // El cuerpo YA NO mete fecha/artículos/total: en pedidos largos esos
  // datos se cortaban a media palabra al forzar los 160 caracteres. El
  // detalle completo se ve dentro del panel, donde sí cabe.
  const tituloPush =
    nombre && nombre.length <= 20 ? `Nueva solicitud de ${nombre}` : "Tienes una solicitud nueva";

  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 5000);
    const pushRes = await fetch(`${supabaseUrl}/functions/v1/enviar-web-push`, {
      method: "POST",
      headers: auth,
      signal: controlador.signal,
      body: JSON.stringify({
        negocio_id: negocio.id,
        role: "admin",
        title: tituloPush,
        body: "Toca para ver los detalles en el panel.",
        url: `https://tusalon.github.io/RomaDetalles/admin.html?pedido=${pedido.id}`,
      }),
    });
    clearTimeout(corte);
    if (!pushRes.ok) {
      console.warn("[crear-pedido-alquiler] push no enviado:", pushRes.status, await pushRes.text());
    }
  } catch (e) {
    console.warn("[crear-pedido-alquiler] push falló:", String(e));
  }

  return json(
    {
      pedido_id: pedido.id,
      total: Number(pedido.total),
      anticipo: Number(pedido.anticipo || 0),
      moneda,
      dias,
      expira_en: pedido.expira_en,
      whatsapp_url: whatsappUrl,
    },
    201,
  );
});
