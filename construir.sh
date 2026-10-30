#!/bin/sh
# Prepara la carpeta dist/ que publica Cloudflare Pages: solo la página, con el JavaScript ofuscado.
# La carpeta backend/ y el README no se publican.
set -e
rm -rf dist && mkdir -p dist/js
cp -r index.html css img _headers manifest.webmanifest sw.js dist/
cp js/config.js js/municipios.js dist/js/          # datos y configuración: se copian tal cual
for f in app ocr lectorpdf capas proteccion app-instalable; do
  npx --yes javascript-obfuscator@4.1.1 "js/$f.js" --output "dist/js/$f.js" --config ofuscar.json
done
echo "Listo: dist/ preparada"
