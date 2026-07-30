import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { products, settings } from "@/db/schema";
import { getAvailability, rentalDays } from "@/lib/store";
import { getAppBindings } from "@/lib/bindings";

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      customerName?: unknown;
      customerPhone?: unknown;
      notes?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      items?: Array<{ productId?: unknown; quantity?: unknown }>;
    };
    const customerName = clean(body.customerName, 100);
    const customerPhone = clean(body.customerPhone, 50);
    const notes = clean(body.notes, 500);
    if (!customerName || !isDate(body.startDate) || !isDate(body.endDate)) {
      return Response.json({ error: "Completa tu nombre y las fechas." }, { status: 400 });
    }
    const days = rentalDays(body.startDate, body.endDate);
    if (days < 1 || days > 60 || !Array.isArray(body.items) || !body.items.length) {
      return Response.json({ error: "El pedido o el período no es válido." }, { status: 400 });
    }
    const quantities = new Map<number, number>();
    for (const item of body.items) {
      const id = Number(item.productId);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1) {
        return Response.json({ error: "Uno de los artículos no es válido." }, { status: 400 });
      }
      quantities.set(id, (quantities.get(id) ?? 0) + quantity);
    }
    const db = getDb();
    const selected = await db.select().from(products).where(inArray(products.id, [...quantities.keys()]));
    const available = new Map(
      (await getAvailability(body.startDate, body.endDate)).map((item) => [item.productId, item.available]),
    );
    const conflict = selected.find((product) => (quantities.get(product.id) ?? 0) > (available.get(product.id) ?? 0));
    if (selected.length !== quantities.size || conflict) {
      return Response.json(
        { error: conflict ? `${conflict.name} ya está reservado o no tiene suficiente cantidad para esas fechas.` : "Uno de los artículos ya no existe." },
        { status: 409 },
      );
    }
    const total = selected.reduce(
      (sum, product) => sum + product.pricePerDay * (quantities.get(product.id) ?? 0) * days,
      0,
    );
    const orderId = `AF-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { DB } = getAppBindings();
    await DB.batch([
      DB.prepare(
        `INSERT INTO orders (id, customer_name, customer_phone, start_date, end_date, rental_days, total, status, notes, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending_whatsapp', ?8, ?9, ?10, ?10)`,
      ).bind(orderId, customerName, customerPhone, body.startDate, body.endDate, days, total, notes, expiresAt, now),
      ...selected.map((product) =>
        DB.prepare(
          `INSERT INTO order_items (order_id, product_id, product_name, price_per_day, quantity)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(orderId, product.id, product.name, product.pricePerDay, quantities.get(product.id) ?? 1),
      ),
    ]);
    const [store] = await db.select().from(settings).limit(1);
    const currency = store?.currency || "CUP";
    const lines = selected.map((product) => {
      const quantity = quantities.get(product.id) ?? 1;
      return `• ${quantity} × ${product.name} — ${new Intl.NumberFormat("es").format(product.pricePerDay * quantity * days)} ${currency}`;
    });
    const message = [
      `Hola, deseo solicitar este alquiler (${orderId}):`,
      `📅 ${body.startDate} al ${body.endDate} (${days} días)`,
      "",
      ...lines,
      "",
      `💰 Total estimado: ${new Intl.NumberFormat("es").format(total)} ${currency}`,
      `👤 Cliente: ${customerName}`,
      customerPhone ? `📞 ${customerPhone}` : "",
      notes ? `📝 ${notes}` : "",
      "Quedo pendiente de confirmación. Gracias.",
    ].filter(Boolean).join("\n");
    const number = (store?.whatsappNumber || "").replace(/\D/g, "");
    return Response.json(
      { orderId, whatsappUrl: number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null, expiresAt },
      { status: 201 },
    );
  } catch {
    return Response.json({ error: "No se pudo guardar el pedido." }, { status: 500 });
  }
}
