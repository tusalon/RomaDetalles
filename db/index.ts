import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { getAppBindings } from "@/lib/bindings";

export function getDb() {
  return drizzle(getAppBindings().DB, { schema });
}
