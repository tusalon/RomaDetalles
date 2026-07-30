import { requireAdminApi } from "@/lib/admin-auth";
import { getAppBindings } from "@/lib/bindings";

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const data = await request.formData();
  const file = data.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 8_000_000) {
    return Response.json({ error: "Usa una imagen de hasta 8 MB." }, { status: 400 });
  }
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  const key = `products/${crypto.randomUUID()}.${extension}`;
  await getAppBindings().BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000" },
  });
  return Response.json({ url: `/api/image?key=${encodeURIComponent(key)}` }, { status: 201 });
}
