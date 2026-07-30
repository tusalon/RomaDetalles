import { getAvailability } from "@/lib/store";

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { startDate?: unknown; endDate?: unknown };
    if (!isDate(body.startDate) || !isDate(body.endDate) || body.endDate < body.startDate) {
      return Response.json({ error: "Selecciona fechas válidas." }, { status: 400 });
    }
    return Response.json({
      availability: await getAvailability(body.startDate, body.endDate),
    });
  } catch {
    return Response.json({ error: "No se pudo comprobar la disponibilidad." }, { status: 500 });
  }
}
