import { requireAdminApi } from "@/lib/admin-auth";
import { getAppBindings } from "@/lib/bindings";

export async function PATCH(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json()) as { id?: unknown; status?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id || !["confirmed", "cancelled", "pending_whatsapp"].includes(status)) {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }
  await getAppBindings().DB.prepare("UPDATE orders SET status=?1, updated_at=?2 WHERE id=?3")
    .bind(status, new Date().toISOString(), id)
    .run();
  return Response.json({ ok: true });
}
