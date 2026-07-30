import { requireAdminApi } from "@/lib/admin-auth";
import { getAppBindings } from "@/lib/bindings";

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function productValues(body: Record<string, unknown>) {
  return {
    name: clean(body.name, 120),
    description: clean(body.description, 500),
    category: clean(body.category, 80) || "Decoración",
    pricePerDay: Math.max(0, Number(body.pricePerDay) || 0),
    stock: Math.max(0, Math.floor(Number(body.stock) || 0)),
    imageUrl: clean(body.imageUrl, 500),
    active: body.active === false ? 0 : 1,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const values = productValues((await request.json()) as Record<string, unknown>);
  if (!values.name) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
  const result = await getAppBindings().DB.prepare(
    `INSERT INTO products (name, description, category, price_per_day, stock, image_url, active, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) RETURNING id`,
  ).bind(values.name, values.description, values.category, values.pricePerDay, values.stock, values.imageUrl, values.active, new Date().toISOString()).first<{ id: number }>();
  return Response.json({ product: { id: result?.id, ...values, active: Boolean(values.active) } }, { status: 201 });
}

export async function PUT(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = Number(body.id);
  const values = productValues(body);
  if (!Number.isInteger(id) || !values.name) return Response.json({ error: "Datos inválidos" }, { status: 400 });
  await getAppBindings().DB.prepare(
    `UPDATE products SET name=?1, description=?2, category=?3, price_per_day=?4,
     stock=?5, image_url=?6, active=?7, updated_at=?8 WHERE id=?9`,
  ).bind(values.name, values.description, values.category, values.pricePerDay, values.stock, values.imageUrl, values.active, new Date().toISOString(), id).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "ID inválido" }, { status: 400 });
  await getAppBindings().DB.prepare("UPDATE products SET active=0, updated_at=?1 WHERE id=?2").bind(new Date().toISOString(), id).run();
  return Response.json({ ok: true });
}
