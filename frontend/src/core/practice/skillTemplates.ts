/**
 * The vault's own `_skills/` guidance notes: how a theory note, a practice file or
 * a canvas is shaped. They live in `<vault>/_skills` and in `<vault>/<subject>/_skills`
 * and are handed to the AI so what it writes follows the vault's conventions.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillTemplate {
  /** vault-relative path, POSIX */
  rel: string;
  /** file name without `.md` */
  title: string;
  content: string;
}

/** Templates from the vault root and from the subject folder of `folderRel` (whichever exist). */
export function readSkillTemplates(rootAbs: string, folderRel: string): SkillTemplate[] {
  const first = folderRel.replace(/\\/g, "/").split("/").filter(Boolean)[0];
  const dirs = [path.join(rootAbs, "_skills")];
  if (first && !first.startsWith("_")) dirs.push(path.join(rootAbs, first, "_skills"));
  if (first && !first.startsWith("_")) dirs.push(path.join(rootAbs, ".notevault", "skills", first));
  const out: SkillTemplate[] = [];
  for (const dir of dirs) {
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith(".md")) continue;
      try {
        const full = path.join(dir, f.name);
        out.push({
          rel: path.relative(rootAbs, full).split(path.sep).join("/"),
          title: f.name.replace(/\.md$/i, ""),
          content: fs.readFileSync(full, "utf-8"),
        });
      } catch {
        /* unreadable template: skip it */
      }
    }
  }
  return out;
}
