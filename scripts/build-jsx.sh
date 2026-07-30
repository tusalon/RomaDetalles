#!/usr/bin/env bash
# Compila el JSX de RomaDetalles a JS plano en compiled/.
#
# Mismo patrón que rservasroma: el navegador no carga Babel (3.1 MB +
# transpilar en el teléfono), carga JS ya compilado. En conexiones cubanas
# la diferencia en la primera carga es grande.
#
# REGLA DE ORO: tras editar cualquier componente o *-app.js, correr este
# script y commitear compiled/ JUNTO con el código fuente, en el MISMO
# commit. Si no, GitHub Pages sirve la versión vieja y el cambio no llega.
# Acuérdate también de subir el ?v= del archivo en el HTML.
#
# --tsconfig-raw='{}' es OBLIGATORIO aquí (rservasroma no lo necesita porque
# no tiene tsconfig.json): mientras quede el tsconfig.json heredado del
# scaffold de Next.js con "jsx":"react-jsx", esbuild lo detecta solo y
# compila con el runtime automático (import de react/jsx-runtime), que es
# un import de módulo ES dentro de un <script> normal — el navegador lo
# rechaza en silencio, sin ejecutar nada del archivo y sin error visible en
# consola. (Ojo: --jsx=transform NO sirve para esto, esbuild lo ignora
# calladamente si hay tsconfig.json cerca; hay que anular el tsconfig con
# --tsconfig-raw, que fuerza el createElement clásico de toda la vida.)
#
# Uso:  bash scripts/build-jsx.sh
set -euo pipefail
cd "$(dirname "$0")/.."

npx --yes esbuild@0.24.0 \
  tienda-app.js \
  admin-app.js \
  components/*.js \
  --loader:.js=jsx \
  --tsconfig-raw={} \
  --charset=utf8 \
  --outdir=compiled \
  --outbase=. \
  --log-level=warning

echo "OK: JSX compilado en compiled/"
