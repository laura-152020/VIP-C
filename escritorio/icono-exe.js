// Después de empaquetar: pone el ícono de VIP-C y los datos del programa en VIP-C.exe (sin necesitar Wine).
const fs = require("fs"), path = require("path");
module.exports = async function (ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".exe");
  const res = R.NtExecutableResource.from(R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true }));
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "build", "icon.ico")));
  const grupos = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = grupos.length ? grupos[0].id : 1, lang = grupos.length ? grupos[0].lang : 1033;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
  const vers = R.Resource.VersionInfo.fromEntries(res.entries);
  const v = ctx.packager.appInfo.version.split(".").map(Number);
  vers.forEach((vi) => {
    vi.setFileVersion(v[0], v[1], v[2], 0); vi.setProductVersion(v[0], v[1], v[2], 0);
    vi.getAllLanguagesForStringValues().forEach((l) => vi.setStringValues(l, {
      FileDescription: "VIP-C · Visor interactivo de puntos críticos", ProductName: "VIP-C",
      CompanyName: "Gobernación de Antioquia", LegalCopyright: "Gobernación de Antioquia",
      OriginalFilename: "VIP-C.exe", InternalName: "VIP-C" }));
    vi.outputToResourceEntries(res.entries);
  });
  const nuevo = R.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  res.outputResource(nuevo);
  fs.writeFileSync(exe, Buffer.from(nuevo.generate()));
  console.log("  • ícono y datos de VIP-C aplicados a", path.basename(exe));

  // Seguridad del ejecutable: nadie puede usar VIP-C.exe para correr código propio ni abrir un depurador
  const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,                         // sin ELECTRON_RUN_AS_NODE
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // sin NODE_OPTIONS
    [FuseV1Options.EnableNodeCliInspectArguments]: false,     // sin --inspect
    [FuseV1Options.OnlyLoadAppFromAsar]: true,                // solo carga la app empaquetada
    [FuseV1Options.EnableCookieEncryption]: true              // cookies cifradas en el disco
  });
  console.log("  • protecciones del ejecutable activadas");
};
