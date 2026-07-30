import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, products, settings } from "@/db/schema";
import { getAppBindings } from "@/lib/bindings";

export const defaultSettings = {
  id: 1,
  businessName: "Alquila Fácil",
  welcomeTitle: "Haz de tu evento un momento inolvidable",
  welcomeText:
    "Elige tus decoraciones favoritas, selecciona las fechas y comprueba su disponibilidad antes de enviar el pedido.",
  whatsappNumber: "",
  currency: "CUP",
  instagramUrl: "",
  facebookUrl: "",
};

export const defaultProducts = [
  { id: 1, name: "Arco Terracota", description: "Arco curvo, globos y dos pedestales acanalados.", category: "Fondos", pricePerDay: 3500, stock: 1, imageUrl: "/images/producto-arco.png", active: true },
  { id: 2, name: "Pedestales Aura", description: "Juego de tres pedestales en crema, coral y lavanda.", category: "Mobiliario", pricePerDay: 2200, stock: 2, imageUrl: "/images/producto-arco.png", active: true },
  { id: 3, name: "Candelabros Ámbar", description: "Seis portavelas de cristal con alturas variadas.", category: "Mesa", pricePerDay: 1200, stock: 3, imageUrl: "/images/producto-mesa.png", active: true },
  { id: 4, name: "Bases Doradas", description: "Cuatro bases para dulces y pasteles en latón.", category: "Mesa", pricePerDay: 1600, stock: 2, imageUrl: "/images/producto-mesa.png", active: true },
  { id: 5, name: "Combo Celebración", description: "Arco, pedestales, bases y candelabros coordinados.", category: "Combos", pricePerDay: 6500, stock: 1, imageUrl: "/images/hero-evento.png", active: true },
  { id: 6, name: "Estación Coral", description: "Barra, dispensador y accesorios para bebidas.", category: "Estaciones", pricePerDay: 2800, stock: 1, imageUrl: "/images/hero-evento.png", active: true },
];

export async function seedStore() {
  const db = getDb();
  await db.insert(settings).values(defaultSettings).onConflictDoNothing({ target: settings.id });
  await db.insert(products).values(defaultProducts).onConflictDoNothing({ target: products.id });
}

export async function getStorefrontData() {
  try {
    await seedStore();
    const db = getDb();
    const [storeSettings] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    const storeProducts = await db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.id));
    return {
      settings: storeSettings ?? defaultSettings,
      products: storeProducts.length ? storeProducts : defaultProducts,
    };
  } catch {
    return { settings: defaultSettings, products: defaultProducts };
  }
}

export async function getAvailability(startDate: string, endDate: string) {
  const db = getDb();
  const stockRows = await db.select({ id: products.id, stock: products.stock }).from(products).where(eq(products.active, true));
  const result = await getAppBindings().DB.prepare(
    `SELECT oi.product_id AS productId, SUM(oi.quantity) AS reserved
     FROM order_items oi INNER JOIN orders o ON o.id = oi.order_id
     WHERE o.start_date <= ?1 AND o.end_date >= ?2
       AND (o.status = 'confirmed' OR (o.status = 'pending_whatsapp' AND o.expires_at > ?3))
     GROUP BY oi.product_id`,
  ).bind(endDate, startDate, new Date().toISOString()).all<{ productId: number; reserved: number }>();
  const reserved = new Map(result.results.map((row) => [Number(row.productId), Number(row.reserved)]));
  return stockRows.map((row) => ({
    productId: row.id,
    stock: row.stock,
    reserved: reserved.get(row.id) ?? 0,
    available: Math.max(0, row.stock - (reserved.get(row.id) ?? 0)),
  }));
}

export async function getAdminData() {
  await seedStore();
  const db = getDb();
  const [storeSettings, storeProducts, recentOrders, recentItems] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)).limit(1),
    db.select().from(products).orderBy(asc(products.id)),
    db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100),
    db.select().from(orderItems).orderBy(desc(orderItems.id)).limit(500),
  ]);
  return {
    settings: storeSettings[0] ?? defaultSettings,
    products: storeProducts,
    orders: recentOrders.map((order) => ({ ...order, items: recentItems.filter((item) => item.orderId === order.id) })),
  };
}

export function rentalDays(start: string, end: string) {
  return Math.floor((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}
