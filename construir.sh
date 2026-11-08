#!/bin/sh
# Prepara la carpeta dist/ que publica Cloudflare Pages: solo la página, con el JavaScript ofuscado
# y bloqueado al dominio vip-c.pages.dev (copiado a otro sitio, deja de funcionar).
# La carpeta backend/, escritorio/ y el README no se publican.
set -e
rm -rf dist && mkdir -p dist/js
cp -r index.html css img descargas _headers manifest.webmanifest sw.js robots.txt dist/
cp js/municipios.js js/inicio.js dist/js/             # datos públicos / sin lógica sensible: se copian tal cual
for f in app ocr lectorpdf capas proteccion app-instalable config; do
  npx --yes javascript-obfuscator@4.1.1 "js/$f.js" --output "dist/js/$f.js" --config ofuscar.json
done
echo "Listo: dist/ preparada"
