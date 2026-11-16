import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ApiError } from "../../core/errors.js";
import { AppConfig } from "../appConfig.js";
import type { AppState } from "../appState.js";

export const CODE_MARKERS = new Set([
  "package.json",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Makefile",
  "CMakeLists.txt",
  ".git",
]);

export function scanVaultDir(folder: string, cap = 400) {
  const info = {
    markdown: 0,
    folders: 0,
    code_markers: 0,
    truncated: false,
    obsidian: false,
  };
  try {
    const obs = path.join(folder, ".obsidian");
    if (fs.existsSync(obs) && fs.statSync(obs).isDirectory()) {
      info.obsidian = true;
    }
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    for (const entry of entries.slice(0, cap)) {
      try {
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) {
            info.folders += 1;
          }
        } else if (entry.name.toLowerCase().endsWith(".md")) {
          info.markdown += 1;
        }
        if (CODE_MARKERS.has(entry.name)) {
          info.code_markers += 1;
        }
      } catch {
        continue;
      }
    }
    info.truncated = entries.length > cap;
  } catch {
    return info;
  }
  return info;
}

export function vaultsApi(app: AppState) {
  const pickedVaults = new Set<string>();

  function vaultPickInternal(): Record<string, unknown> {
    const win = app.window as any;
    if (!win) {
      return { ok: false, fallback: true };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron") as {
        dialog?: {
          showOpenDialogSync(w: unknown, opts: Record<string, unknown>): string[] | undefined;
        };
      };
      if (electron?.dialog?.showOpenDialogSync) {
        const result = electron.dialog.showOpenDialogSync(app.window, {
          title: "Elige la carpeta de tu vault",
          properties: ["openDirectory", "createDirectory"],
          defaultPath: os.homedir(),
        });
        const chosen = result?.[0];
        if (!chosen) return { ok: false };
        const folder = path.resolve(String(chosen));
        pickedVaults.add(folder);
        return {
          ok: true,
          path: folder,
          name: path.basename(folder),
          ...scanVaultDir(folder),
        };
      }
    } catch {
      // ignore
    }

    if (typeof win.create_file_dialog === "function") {
      const chosen = win.create_file_dialog(2, os.homedir());
      if (!chosen) {
        return { ok: false };
      }
      const raw = Array.isArray(chosen) ? chosen[0] : chosen;
      const folder = path.resolve(String(raw));
      pickedVaults.add(folder);
      return {
        ok: true,
        path: folder,
        name: path.basename(folder),
        ...scanVaultDir(folder),
      };
    }
    return { ok: false, fallback: true };
  }

  return {
    vault_list() {
      const out: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      const recents = AppConfig.get_recent_vaults();

      for (const p of [app.root, ...recents]) {
        const key = path.resolve(p);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        let isDir = false;
        try {
          isDir = fs.existsSync(key) && fs.statSync(key).isDirectory();
        } catch {
          // ignore
        }
        const info = scanVaultDir(key);
        out.push({
          path: key,
          name: path.basename(key),
          current: key === app.root,
          exists: isDir,
          ...info,
        });
      }
      return out;
    },

    vault_pick() {
      return vaultPickInternal();
    },

    vault_create(name: string) {
      const clean = String(name || "")
        .replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ")
        .trim()
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 80);
      if (!clean) {
        throw new ApiError("La vault necesita un nombre.");
      }
      const picked = vaultPickInternal();
      if (!picked.ok) {
        return picked;
      }
      const folder = path.join(String(picked.path), clean);
      try {
        fs.mkdirSync(folder, { recursive: true });
        const welcome = path.join(folder, "Bienvenida.md");
        if (!fs.existsSync(welcome)) {
          fs.writeFileSync(
            welcome,
            `# ${clean}\n\nEsta es tu nueva vault. Crea notas y carpetas desde el explorador.\n\n` +
              "Enlaza otras notas escribiendo [[Nombre de la nota]].\n",
            "utf-8"
          );
        }
      } catch (e) {
        throw new ApiError(
          `No se pudo crear: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      const resolved = path.resolve(folder);
      pickedVaults.add(resolved);
      return { ok: true, path: resolved, name: clean };
    },

    vault_open(vaultPath: string) {
      let raw = String(vaultPath || "");
      if (raw.startsWith("~")) {
        raw = path.join(os.homedir(), raw.slice(1));
      }
      let folder: string;
      try {
        folder = path.resolve(raw);
      } catch {
        throw new ApiError("Carpeta no válida.");
      }
      const recent = new Set(
        AppConfig.get_recent_vaults().map((p) => path.resolve(p))
      );
      const allowed =
        folder === path.resolve(app.root) ||
        recent.has(folder) ||
        pickedVaults.has(folder) ||
        app.window === null ||
        app.window === undefined;
      if (!allowed) {
        throw new ApiError("Elige la carpeta con el diálogo del sistema.");
      }
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new ApiError(`No existe la carpeta: ${folder}`);
      }
      app.open(folder);
      AppConfig.set_active_vault(folder);
      return { ok: true, name: path.basename(folder), path: folder };
    },
  };
}
