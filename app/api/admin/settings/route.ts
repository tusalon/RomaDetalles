import { requireAdminApi } from "@/lib/admin-auth";
import { getAppBindings } from "@/lib/bindings";

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function PUT(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const businessName = clean(body.businessName, 100);
  const welcomeTitle = clean(body.welcomeTitle, 160);
  if (!businessName || !welcomeTitle) return Response.json({ error: "Faltan datos" }, { status: 400 });
  await getAppBindings().DB.prepare(
    `UPDATE settings SET business_name=?1, welcome_title=?2, welcome_text=?3,
     whatsapp_number=?4, currency=?5, instagram_url=?6, facebook_url=?7,
     updated_at=?8 WHERE id=1`,
  ).bind(
    businessName,
    welcomeTitle,
    clean(body.welcomeText, 500),
    clean(body.whatsappNumber, 40),
    clean(body.currency, 12) || "CUP",
    clean(body.instagramUrl, 300),
    clean(body.facebookUrl, 300),
    new Date().toISOString(),
  ).run();
  return Response.json({ ok: true });
}
