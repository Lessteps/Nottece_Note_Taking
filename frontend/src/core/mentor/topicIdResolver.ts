/**
 * Resolvedor e indexador de temas por ID en la vault.
 *
 * Permite que el Mentor localice automáticamente las notas teóricas (`<tema>.md`), prácticas (`<tema>.practica.md`)
 * y mapas explicativos (`<tema> — mapa.canvas`) de cualquier tema de un plan aunque la vault se abra en otra carpeta
 * o cambie su estructura de directorios, y reconstruye al vuelo los mapas `.canvas` deterministas cuando existen las
 * notas teóricas pero el archivo `.canvas` no está en disco (p. ej. tras clonar un repositorio que ignoraba `*.canvas`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateConcept } from "../../../tools/kb_canvas.js";
import * as store from "../store.js";
import type { Plan } from "./plan.js";

export interface VaultTopicAssets {
  folder: string;
  topicId: string;
  title: string;
  frontmatterId?: string;
  extraIds?: string[];
  planId?: string;
  areaId?: string;
  theoryNote: string | null;
  practiceNote: string | null;
  canvasFile: string | null;
}

export interface ScannedVaultIndex {
  byId: Map<string, VaultTopicAssets>;
  byFolder: Map<string, VaultTopicAssets>;
  bySuffix: Map<string, VaultTopicAssets>;
  bySlug: Map<string, VaultTopicAssets>;
  all: VaultTopicAssets[];
}

export interface PlanVaultSyncStatus {
  planId: string;
  needsSync: boolean;
  relocatedCount: number;
  missingCanvasCount: number;
  unindexedCount: number;
  relocated: Array<{ oldFolder: string; newFolder: string; title: string; topicId: string }>;
  missingCanvases: Array<{ folder: string; title: string; topicId: string }>;
}

export interface TopicIdIndexFile {
  version: 1;
  updatedAt: string;
  entries: Record<
    string,
    {
      topicId: string;
      planId: string;
      subplanId: string;
      areaId?: string;
      folder: string;
      title: string;
    }
  >;
}

const IGNORED_DIRS = new Set([".git", "node_modules", ".notevault", ".obsidian", ".trash", ".venv", "dist", "release"]);

export function slugifyTopic(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function canonicalTopicId(areaId: string | undefined, folderOrTitle: string, frontmatterId?: string): string {
  if (frontmatterId && frontmatterId.trim()) {
    return frontmatterId.trim().toLowerCase();
  }
  const base = path.posix.basename(folderOrTitle.replace(/\\/g, "/"));
  const slug = slugifyTopic(base);
  const prefix = areaId ? slugifyTopic(areaId) : "topic";
  return `${prefix}.${slug}`;
}

function parseFrontmatterLiteFromBuffer(buf: Buffer, bytes: number): Record<string, string> {
  const head = buf.subarray(0, bytes).toString("utf-8").replace(/\r\n/g, "\n");
  if (!head.startsWith("---\n")) return {};
  const end = head.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const block = head.slice(4, end);
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (val) out[key] = val;
  }
  return out;
}

function parseFrontmatterLite(mdPath: string): Record<string, string> {
  try {
    const fd = fs.openSync(mdPath, "r");
    const buf = Buffer.alloc(2048);
    const bytes = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    return parseFrontmatterLiteFromBuffer(buf, bytes);
  } catch {
    return {};
  }
}

async function parseFrontmatterLiteAsync(mdPath: string): Promise<Record<string, string>> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(mdPath, "r");
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(buf, 0, 2048, 0);
    return parseFrontmatterLiteFromBuffer(buf, bytesRead);
  } catch {
    return {};
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function buildTopicAssets(
  normFolder: string,
  files: string[],
  fmPrimary: Record<string, string>,
  fmManifest: Record<string, string>,
  fallbackAreaId?: string,
): VaultTopicAssets | null {
  const folderBase = path.posix.basename(normFolder);
  const exactMd = files.find((f) => f === `${folderBase}.md`);
  const otherMd = files.find(
    (f) =>
      f.endsWith(".md") &&
      !f.endsWith(".practica.md") &&
      f !== "_tema.md" &&
      !f.startsWith("_") &&
      !/\bejercicio\b/i.test(f),
  );
  const theoryFile = exactMd ?? otherMd ?? null;
  const practiceFile = files.find((f) => f.endsWith(".practica.md")) ?? null;
  const canvasName =
    files.find((f) => f === `${folderBase} — mapa.canvas`) ??
    files.find((f) => f.endsWith(".canvas")) ??
    null;

  if (!theoryFile && !practiceFile && !canvasName && !files.includes("_tema.md")) {
    return null;
  }

  const fm = { ...fmManifest, ...fmPrimary };
  const extraIds = Array.from(
    new Set(
      [
        fmPrimary.nv_topic_id,
        fmPrimary.topic_id,
        fmPrimary.id,
        fmPrimary.curriculum_id,
        fmManifest.nv_topic_id,
        fmManifest.topic_id,
        fmManifest.id,
        fmManifest.curriculum_id,
      ]
        .map((v) => (v ? v.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
  const fmId = fm.nv_topic_id || fm.topic_id || fm.id || fm.curriculum_id || undefined;
  const areaId = fm.nv_area_id || fm.area || fallbackAreaId;
  const topicId = canonicalTopicId(areaId, normFolder, fmId);
  const title = fm.number && fm.title ? `${fm.number} ${fm.title}` : fm.title || folderBase;

  return {
    folder: normFolder,
    topicId,
    title,
    ...(fmId ? { frontmatterId: fmId } : {}),
    ...(extraIds.length ? { extraIds } : {}),
    ...(fm.nv_plan_id ? { planId: fm.nv_plan_id } : {}),
    ...(areaId ? { areaId } : {}),
    theoryNote: theoryFile ? `${normFolder}/${theoryFile}` : null,
    practiceNote: practiceFile ? `${normFolder}/${practiceFile}` : null,
    canvasFile: canvasName ? `${normFolder}/${canvasName}` : null,
  };
}

export function inspectTopicFolder(vaultRoot: string, relFolder: string, fallbackAreaId?: string, preloadedFiles?: string[]): VaultTopicAssets | null {
  const normFolder = relFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normFolder) return null;
  const abs = path.join(vaultRoot, normFolder);
  let files = preloadedFiles;
  if (!files) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return null;
    }
    files = entries.filter((e) => e.isFile()).map((e) => e.name);
  }
  const folderBase = path.posix.basename(normFolder);
  const exactMd = files.find((f) => f === `${folderBase}.md`);
  const otherMd = files.find(
    (f) =>
      f.endsWith(".md") &&
      !f.endsWith(".practica.md") &&
      f !== "_tema.md" &&
      !f.startsWith("_") &&
      !/\bejercicio\b/i.test(f),
  );
  const theoryFile = exactMd ?? otherMd ?? null;
  const practiceFile = files.find((f) => f.endsWith(".practica.md")) ?? null;
  const hasManifest = files.includes("_tema.md");
  const hasCanvas = files.some((f) => f.endsWith(".canvas"));
  if (!theoryFile && !practiceFile && !hasCanvas && !hasManifest) return null;

  const fmPrimary = theoryFile
    ? parseFrontmatterLite(path.join(abs, theoryFile))
    : practiceFile
      ? parseFrontmatterLite(path.join(abs, practiceFile))
      : {};
  const fmManifest = hasManifest ? parseFrontmatterLite(path.join(abs, "_tema.md")) : {};
  return buildTopicAssets(normFolder, files, fmPrimary, fmManifest, fallbackAreaId);
}

async function inspectTopicFolderAsync(vaultRoot: string, relFolder: string, files: string[], fallbackAreaId?: string): Promise<VaultTopicAssets | null> {
  const normFolder = relFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normFolder) return null;
  const folderBase = path.posix.basename(normFolder);
  const exactMd = files.find((f) => f === `${folderBase}.md`);
  const otherMd = files.find(
    (f) =>
      f.endsWith(".md") &&
      !f.endsWith(".practica.md") &&
      f !== "_tema.md" &&
      !f.startsWith("_") &&
      !/\bejercicio\b/i.test(f),
  );
  const theoryFile = exactMd ?? otherMd ?? null;
  const practiceFile = files.find((f) => f.endsWith(".practica.md")) ?? null;
  const hasManifest = files.includes("_tema.md");
  const hasCanvas = files.some((f) => f.endsWith(".canvas"));
  if (!theoryFile && !practiceFile && !hasCanvas && !hasManifest) return null;

  const abs = path.join(vaultRoot, normFolder);
  const primaryPath = theoryFile ? path.join(abs, theoryFile) : practiceFile ? path.join(abs, practiceFile) : null;
  const [fmPrimary, fmManifest] = await Promise.all([
    primaryPath ? parseFrontmatterLiteAsync(primaryPath) : Promise.resolve({}),
    hasManifest ? parseFrontmatterLiteAsync(path.join(abs, "_tema.md")) : Promise.resolve({}),
  ]);
  return buildTopicAssets(normFolder, files, fmPrimary, fmManifest, fallbackAreaId);
}

export function topicIdIndexPath(vaultRoot: string): string {
  return path.join(vaultRoot, ".notevault", "mentor", "topic_id_index.json");
}

export function loadTopicIdIndex(vaultRoot: string): TopicIdIndexFile {
  const raw = store.loadJson(topicIdIndexPath(vaultRoot)) as Record<string, any> | null;
  if (raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object") {
    return raw as TopicIdIndexFile;
  }
  return { version: 1, updatedAt: new Date().toISOString(), entries: {} };
}

export function saveTopicIdIndex(vaultRoot: string, indexFile: TopicIdIndexFile): void {
  store.writeJson(topicIdIndexPath(vaultRoot), indexFile);
}

const TOPIC_INDEX_TTL_MS = 300_000;
const _topicIndexCache = new Map<string, { index: ScannedVaultIndex; ts: number }>();
const _topicIndexInflight = new Map<string, Promise<ScannedVaultIndex>>();

export function clearTopicIndexCache(vaultRoot?: string): void {
  if (vaultRoot) {
    const key = path.resolve(vaultRoot);
    _topicIndexCache.delete(key);
    _topicIndexInflight.delete(key);
  } else {
    _topicIndexCache.clear();
    _topicIndexInflight.clear();
  }
}

function registerAssets(
  maps: {
    byId: Map<string, VaultTopicAssets>;
    byFolder: Map<string, VaultTopicAssets>;
    bySuffix: Map<string, VaultTopicAssets>;
    bySlug: Map<string, VaultTopicAssets>;
    all: VaultTopicAssets[];
  },
  assets: VaultTopicAssets,
): void {
  maps.all.push(assets);
  maps.byFolder.set(assets.folder, assets);
  maps.byId.set(assets.topicId.toLowerCase(), assets);
  if (assets.frontmatterId) {
    maps.byId.set(assets.frontmatterId.toLowerCase(), assets);
  }
  if (assets.extraIds) {
    for (const id of assets.extraIds) {
      if (!maps.byId.has(id)) maps.byId.set(id, assets);
    }
  }
  const parts = assets.folder.split("/");
  const base = parts[parts.length - 1]!;
  const slug = slugifyTopic(base);
  if (slug && !maps.bySlug.has(slug)) {
    maps.bySlug.set(slug, assets);
  }
  if (parts.length >= 1) {
    const s1 = parts.slice(-1).join("/").toLowerCase();
    if (!maps.bySuffix.has(s1)) maps.bySuffix.set(s1, assets);
  }
  if (parts.length >= 2) {
    const s2 = parts.slice(-2).join("/").toLowerCase();
    if (!maps.bySuffix.has(s2)) maps.bySuffix.set(s2, assets);
  }
  if (parts.length >= 3) {
    const s3 = parts.slice(-3).join("/").toLowerCase();
    if (!maps.bySuffix.has(s3)) maps.bySuffix.set(s3, assets);
  }
}

/**
 * Escanea recursivamente la vault y construye un índice en memoria por `topicId`, ruta relativa,
 * sufijo de ruta y slug del nombre del tema (cacheado 5 min e invalidado por FileWatcher).
 */
export function scanVaultTopics(vaultRoot: string, force = false): ScannedVaultIndex {
  const key = path.resolve(vaultRoot);
  const hit = _topicIndexCache.get(key);
  if (!force && hit && Date.now() - hit.ts < TOPIC_INDEX_TTL_MS) {
    return hit.index;
  }

  const maps = {
    byId: new Map<string, VaultTopicAssets>(),
    byFolder: new Map<string, VaultTopicAssets>(),
    bySuffix: new Map<string, VaultTopicAssets>(),
    bySlug: new Map<string, VaultTopicAssets>(),
    all: [] as VaultTopicAssets[],
  };

  const walk = (absDir: string, relDir: string, depth: number): void => {
    if (depth > 7) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    if (relDir) {
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      const inspected = inspectTopicFolder(vaultRoot, relDir, undefined, files);
      if (inspected) registerAssets(maps, inspected);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name === "Ejercicios" || entry.name === "attachments" || entry.name === "assets") continue;
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      walk(path.join(absDir, entry.name), childRel, depth + 1);
    }
  };

  walk(vaultRoot, "", 0);
  _topicIndexCache.set(key, { index: maps, ts: Date.now() });
  return maps;
}

/** Versión no bloqueante de `scanVaultTopics` usando `fs.promises` y pausas para no congelar Electron en Windows. */
export async function scanVaultTopicsAsync(vaultRoot: string, force = false): Promise<ScannedVaultIndex> {
  const key = path.resolve(vaultRoot);
  const hit = _topicIndexCache.get(key);
  if (!force && hit && Date.now() - hit.ts < TOPIC_INDEX_TTL_MS) {
    return hit.index;
  }
  const existing = _topicIndexInflight.get(key);
  if (!force && existing) return existing;

  const task = (async (): Promise<ScannedVaultIndex> => {
    const maps = {
      byId: new Map<string, VaultTopicAssets>(),
      byFolder: new Map<string, VaultTopicAssets>(),
      bySuffix: new Map<string, VaultTopicAssets>(),
      bySlug: new Map<string, VaultTopicAssets>(),
      all: [] as VaultTopicAssets[],
    };
    const queue: Array<{ absDir: string; relDir: string; depth: number }> = [
      { absDir: vaultRoot, relDir: "", depth: 0 },
    ];

    while (queue.length) {
      const batch = queue.splice(0, 32);
      await Promise.all(
        batch.map(async ({ absDir, relDir, depth }) => {
          if (depth > 7) return;
          let entries: fs.Dirent[];
          try {
            entries = await fs.promises.readdir(absDir, { withFileTypes: true });
          } catch {
            return;
          }
          if (relDir) {
            const files = entries.filter((e) => e.isFile()).map((e) => e.name);
            const inspected = await inspectTopicFolderAsync(vaultRoot, relDir, files);
            if (inspected) registerAssets(maps, inspected);
          }
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
            if (entry.name === "Ejercicios" || entry.name === "attachments" || entry.name === "assets") continue;
            const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
            queue.push({ absDir: path.join(absDir, entry.name), relDir: childRel, depth: depth + 1 });
          }
        }),
      );
    }

    _topicIndexCache.set(key, { index: maps, ts: Date.now() });
    return maps;
  })();

  _topicIndexInflight.set(key, task);
  try {
    return await task;
  } finally {
    if (_topicIndexInflight.get(key) === task) _topicIndexInflight.delete(key);
  }
}

export function resolveTopicInIndex(
  index: ScannedVaultIndex,
  query: { folder: string; topicId?: string; title?: string; areaId?: string },
): VaultTopicAssets | null {
  const normFolder = query.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (query.topicId) {
    const byExplicitId = index.byId.get(query.topicId.toLowerCase());
    if (byExplicitId) return byExplicitId;
  }
  const exact = index.byFolder.get(normFolder);
  if (exact) return exact;

  // Probar con el ID canónico derivado de areaId + carpeta
  const candidateId = canonicalTopicId(query.areaId, normFolder);
  const byCandidateId = index.byId.get(candidateId.toLowerCase());
  if (byCandidateId) return byCandidateId;

  // Probar también con el prefijo estándar "programming.<slug>" que usan las notas de la KB
  const baseSlug = slugifyTopic(path.posix.basename(normFolder));
  const byProgId = index.byId.get(`programming.${baseSlug}`);
  if (byProgId) return byProgId;

  // Sufijos de ruta (de más específico a menos específico)
  const parts = normFolder.split("/");
  for (const count of [3, 2, 1]) {
    if (parts.length >= count) {
      const suffix = parts.slice(-count).join("/").toLowerCase();
      const hit = index.bySuffix.get(suffix);
      if (hit) return hit;
    }
  }

  // Slug del nombre de carpeta o del título
  if (baseSlug) {
    const hit = index.bySlug.get(baseSlug);
    if (hit) return hit;
  }
  if (query.title) {
    const titleSlug = slugifyTopic(query.title);
    const hit = index.bySlug.get(titleSlug);
    if (hit) return hit;
  }

  return null;
}

/**
 * Localiza un tema en la vault (incluso si su carpeta cambió de ruta) y, si `ensureCanvas` es true y existe
 * la nota teórica `<tema>.md` pero falta el `.canvas`, genera determinísticamente `<tema> — mapa.canvas`.
 */
export function resolveAndEnsureTopicAssets(
  vaultRoot: string,
  query: { folder: string; topicId?: string; title?: string; areaId?: string; ensureCanvas?: boolean },
): {
  found: boolean;
  folder: string;
  topicId: string;
  relocated: boolean;
  theoryNote: string | null;
  practiceNote: string | null;
  canvasFile: string | null;
  canvasGenerated: boolean;
} {
  const normFolder = query.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  let assets: VaultTopicAssets | null = null;
  let relocated = false;

  // Resolver SIEMPRE primero por ID en el índice vivo de la vault (en lugar de depender de rutas guardadas).
  if (query.topicId) {
    const index = scanVaultTopics(vaultRoot);
    assets = resolveTopicInIndex(index, query);
    if (assets && assets.folder !== normFolder) {
      relocated = true;
    }
  }
  if (!assets) {
    assets = inspectTopicFolder(vaultRoot, normFolder, query.areaId);
  }
  if (!assets) {
    const index = scanVaultTopics(vaultRoot);
    assets = resolveTopicInIndex(index, query);
    if (assets && assets.folder !== normFolder) {
      relocated = true;
    }
  }

  if (!assets) {
    return {
      found: false,
      folder: normFolder,
      topicId: query.topicId || canonicalTopicId(query.areaId, normFolder),
      relocated: false,
      theoryNote: null,
      practiceNote: null,
      canvasFile: null,
      canvasGenerated: false,
    };
  }

  let canvasGenerated = false;
  if (query.ensureCanvas && !assets.canvasFile && assets.theoryNote) {
    try {
      const absTopicDir = path.join(vaultRoot, assets.folder);
      const gen = generateConcept(absTopicDir);
      const relCanvas = path.relative(vaultRoot, gen.canvasPath).replace(/\\/g, "/");
      if (fs.existsSync(gen.canvasPath)) {
        assets = { ...assets, canvasFile: relCanvas };
        canvasGenerated = true;
      }
    } catch {
      // Si la nota teórica no cumple el contrato de secciones, se ignora sin romper el flujo
    }
  }

  return {
    found: true,
    folder: assets.folder,
    topicId: assets.topicId,
    relocated,
    theoryNote: assets.theoryNote,
    practiceNote: assets.practiceNote,
    canvasFile: assets.canvasFile,
    canvasGenerated,
  };
}

function computePlanVaultSync(index: ScannedVaultIndex, plan: Plan): PlanVaultSyncStatus {
  const relocated: Array<{ oldFolder: string; newFolder: string; title: string; topicId: string }> = [];
  const missingCanvases: Array<{ folder: string; title: string; topicId: string }> = [];
  let unindexedCount = 0;

  const seenKeys = new Set<string>();
  for (const sub of plan.subplans) {
    for (const t of sub.topics) {
      if (t.route === "skipped") continue;
      const dedupKey = (t.topicId || t.folder).toLowerCase();
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      // Resolver SIEMPRE por ID primero; la ruta guardada en el plan es solo fallback.
      const resolved = resolveTopicInIndex(index, {
        folder: t.folder,
        topicId: t.topicId,
        title: t.title,
        areaId: sub.areaId ?? sub.id,
      });

      if (!t.topicId) {
        unindexedCount++;
      }

      if (resolved && resolved.folder !== t.folder) {
        relocated.push({
          oldFolder: t.folder,
          newFolder: resolved.folder,
          title: t.title,
          topicId: resolved.topicId,
        });
      }
    }
  }

  return {
    planId: plan.id,
    // No reportar falsos positivos de «faltan canvas»: solo sincronizar cuando un ID real cambió de carpeta.
    needsSync: relocated.length > 0,
    relocatedCount: relocated.length,
    missingCanvasCount: 0,
    unindexedCount,
    relocated,
    missingCanvases,
  };
}

/**
 * Comprueba si el plan actual tiene temas cuya ubicación en la vault cambió (resolviendo por ID).
 */
export function checkPlanVaultSync(vaultRoot: string, plan: Plan): PlanVaultSyncStatus {
  const index = scanVaultTopics(vaultRoot);
  return computePlanVaultSync(index, plan);
}

/** Versión no bloqueante de `checkPlanVaultSync` para no congelar Electron al abrir el Mentor. */
export async function checkPlanVaultSyncAsync(vaultRoot: string, plan: Plan): Promise<PlanVaultSyncStatus> {
  const index = await scanVaultTopicsAsync(vaultRoot);
  return computePlanVaultSync(index, plan);
}

/** Versión no bloqueante de `reconcilePlanWithVault` que resuelve por IDs vivos de la vault. */
export async function reconcilePlanWithVaultAsync(
  vaultRoot: string,
  plan: Plan,
  opts?: { generateCanvases?: boolean },
): Promise<{
  plan: Plan;
  changedPlan: boolean;
  relocatedCount: number;
  generatedCanvases: number;
  indexedCount: number;
}> {
  const generateCanvases = opts?.generateCanvases === true;
  const index = await scanVaultTopicsAsync(vaultRoot, true);

  let changedPlan = false;
  let relocatedCount = 0;
  let generatedCanvases = 0;
  let indexedCount = 0;
  const folderRemap = new Map<string, string>();
  const processedCanvases = new Set<string>();
  const canvasQueue: string[] = [];

  const nextSubplans = plan.subplans.map((sub) => {
    const areaKey = sub.areaId ?? sub.id;
    const nextTopics = sub.topics.map((t) => {
      const resolved = resolveTopicInIndex(index, {
        folder: t.folder,
        topicId: t.topicId,
        title: t.title,
        areaId: areaKey,
      });

      const nextFolder = resolved ? resolved.folder : t.folder;
      const nextTopicId = resolved ? resolved.topicId : t.topicId || canonicalTopicId(areaKey, t.folder);

      if (nextFolder !== t.folder) {
        relocatedCount++;
        changedPlan = true;
        folderRemap.set(t.folder, nextFolder);
      }
      if (nextTopicId !== t.topicId) {
        changedPlan = true;
      }
      indexedCount++;

      if (generateCanvases && resolved && resolved.theoryNote && !resolved.canvasFile && !processedCanvases.has(resolved.folder)) {
        processedCanvases.add(resolved.folder);
        canvasQueue.push(resolved.folder);
      }

      return {
        ...t,
        folder: nextFolder,
        topicId: nextTopicId,
      };
    });

    const nextWeeks = sub.weeks.map((w) => ({
      ...w,
      topics: w.topics.map((f) => folderRemap.get(f) ?? f),
    }));

    return {
      ...sub,
      topics: nextTopics,
      weeks: nextWeeks,
    };
  });

  // Generar canvases opcionales cediendo al event loop para no congelar nunca la ventana.
  for (const relFolder of canvasQueue) {
    try {
      const gen = generateConcept(path.join(vaultRoot, relFolder));
      if (fs.existsSync(gen.canvasPath)) generatedCanvases++;
    } catch {
      // Ignorar notas que no tengan formato de mapa conceptual
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const nextExtraTopics = plan.extraTopics?.map((et) => ({
    ...et,
    folder: folderRemap.get(et.folder) ?? et.folder,
  }));

  const updatedPlan: Plan = changedPlan
    ? {
        ...plan,
        updatedAt: new Date().toISOString(),
        subplans: nextSubplans,
        ...(nextExtraTopics ? { extraTopics: nextExtraTopics } : {}),
      }
    : plan;

  return {
    plan: updatedPlan,
    changedPlan,
    relocatedCount,
    generatedCanvases,
    indexedCount,
  };
}

/**
 * Escanea todos los temas de la vault por ID, actualiza las carpetas movidas en el plan,
 * guarda `.notevault/mentor/topic_id_index.json` y genera los mapas `.canvas` explicativos que falten.
 */
export function reconcilePlanWithVault(
  vaultRoot: string,
  plan: Plan,
  opts?: { generateCanvases?: boolean },
): {
  plan: Plan;
  changedPlan: boolean;
  relocatedCount: number;
  generatedCanvases: number;
  indexedCount: number;
} {
  const generateCanvases = opts?.generateCanvases !== false;
  const index = scanVaultTopics(vaultRoot);
  const indexFile = loadTopicIdIndex(vaultRoot);

  let changedPlan = false;
  let relocatedCount = 0;
  let generatedCanvases = 0;
  let indexedCount = 0;
  const folderRemap = new Map<string, string>();
  const processedCanvases = new Set<string>();

  const nextSubplans = plan.subplans.map((sub) => {
    const areaKey = sub.areaId ?? sub.id;
    const nextTopics = sub.topics.map((t) => {
      const resolved = resolveTopicInIndex(index, {
        folder: t.folder,
        topicId: t.topicId,
        title: t.title,
        areaId: areaKey,
      });

      const nextFolder = resolved ? resolved.folder : t.folder;
      const nextTopicId = resolved ? resolved.topicId : t.topicId || canonicalTopicId(areaKey, t.folder);

      if (nextFolder !== t.folder) {
        relocatedCount++;
        changedPlan = true;
        folderRemap.set(t.folder, nextFolder);
      }
      if (nextTopicId !== t.topicId) {
        changedPlan = true;
      }

      indexFile.entries[nextTopicId] = {
        topicId: nextTopicId,
        planId: plan.id,
        subplanId: sub.id,
        ...(sub.areaId ? { areaId: sub.areaId } : {}),
        folder: nextFolder,
        title: t.title,
      };
      indexedCount++;

      if (generateCanvases && resolved && resolved.theoryNote && !resolved.canvasFile && !processedCanvases.has(resolved.folder)) {
        processedCanvases.add(resolved.folder);
        try {
          const gen = generateConcept(path.join(vaultRoot, resolved.folder));
          if (fs.existsSync(gen.canvasPath)) {
            generatedCanvases++;
          }
        } catch {
          // Ignorar notas que no tengan formato de mapa conceptual
        }
      }

      return {
        ...t,
        folder: nextFolder,
        topicId: nextTopicId,
      };
    });

    const nextWeeks = sub.weeks.map((w) => ({
      ...w,
      topics: w.topics.map((f) => folderRemap.get(f) ?? f),
    }));

    return {
      ...sub,
      topics: nextTopics,
      weeks: nextWeeks,
    };
  });

  indexFile.updatedAt = new Date().toISOString();
  saveTopicIdIndex(vaultRoot, indexFile);

  const nextExtraTopics = plan.extraTopics?.map((et) => ({
    ...et,
    folder: folderRemap.get(et.folder) ?? et.folder,
  }));

  const updatedPlan: Plan = changedPlan
    ? {
        ...plan,
        updatedAt: new Date().toISOString(),
        subplans: nextSubplans,
        ...(nextExtraTopics ? { extraTopics: nextExtraTopics } : {}),
      }
    : plan;

  return {
    plan: updatedPlan,
    changedPlan,
    relocatedCount,
    generatedCanvases,
    indexedCount,
  };
}
