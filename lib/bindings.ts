export type AppBindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

declare global {
  var __ALQUILA_FACIL_BINDINGS__: AppBindings | undefined;
}

export function setAppBindings(bindings: AppBindings) {
  globalThis.__ALQUILA_FACIL_BINDINGS__ = bindings;
}

export function getAppBindings(): AppBindings {
  const bindings = globalThis.__ALQUILA_FACIL_BINDINGS__;
  if (!bindings?.DB || !bindings?.BUCKET) {
    throw new Error("Los recursos de almacenamiento todavía no están disponibles.");
  }
  return bindings;
}
