// Copia el instalador recién construido (dist/VIP-C-Instalador.exe) a la página, en partes de 20 MB,
// para que el botón «Instalar software» lo descargue desde vip-c.pages.dev. Uso: node publicar-instalador.js
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const exe = path.join(__dirname, "dist", "VIP-C-Instalador.exe");
const destino = path.join(__dirname, "..", "descargas");
const version = require("./package.json").version;
const datos = fs.readFileSync(exe), PARTE = 20 * 1024 * 1024;
fs.rmSync(destino, { recursive: true, force: true }); fs.mkdirSync(destino);
const partes = [];
for (let i = 0; i * PARTE < datos.length; i++) {
  const nombre = `VIP-C-${version}.parte${i}`;
  fs.writeFileSync(path.join(destino, nombre), datos.subarray(i * PARTE, (i + 1) * PARTE)); partes.push(nombre);
}
fs.writeFileSync(path.join(destino, "instalador.json"), JSON.stringify({
  version, nombre: "VIP-C-Instalador.exe", tamano: datos.length,
  sha256: crypto.createHash("sha256").update(datos).digest("hex"), partes }, null, 2));
console.log(`Listo: ${partes.length} partes de VIP-C ${version} en descargas/. Ahora: git add -A, commit y push.`);
