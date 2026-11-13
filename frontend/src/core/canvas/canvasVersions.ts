import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/** Guarda una versión recuperable fuera del árbol visible de la vault. */
export function backupCanvasVersion(root: string, file: string): string {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("El mapa está fuera de la vault.");
  const dest = path.join(root, ".trash", "mapas", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  return dest;
}

/** Archiva una variante generada antigua solo cuando existe su mapa canónico. */
export function archiveCanvasAlternates(root: string, folder: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(" — mapa.nuevo.canvas")) continue;
    const alternate = path.join(folder, entry.name);
    const canonical = path.join(folder, entry.name.replace(/\.nuevo\.canvas$/, ".canvas"));
    if (!fs.existsSync(canonical) || !fs.statSync(canonical).isFile()) continue;
    backupCanvasVersion(root, alternate);
    fs.unlinkSync(alternate);
    count++;
  }
  return count;
}
