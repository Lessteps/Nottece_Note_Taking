/**
 * Knowledge-base concept map generator — `tools/kb_canvas.ts`
 *
 * Rewritten from scratch (the old `tools/kb_canvas.py` died with the Python core).
 * Builds ONE canvas per concept note, from the note's own sections, and nothing
 * is ever hand-drawn:
 *
 *   <concept folder>/<number> <title> — mapa.canvas
 *
 * The canvas has exactly FOUR panels, left to right:
 *
 *   1. Requiere          — mandatory; one backlink card per prerequisite note,
 *                          or the card "Sin prerrequisitos." when there are none.
 *   2. Explicación       — `### Qué es` and `### Modelo mental`, one panel each.
 *   3. Ejemplos          — one group per example, each with its own four panels:
 *                          Contexto · Caso · Resultado esperado · Por qué funciona.
 *   4. Errores comunes   — one group per error, each its own panel with the four
 *                          fields: Error · Síntoma · Causa · Solución.
 *
 * Guarantees (all verified by `verifyCanvas`, see the checks at the bottom):
 *   - panel height = height of its whole text (no clipped text, no scrolling):
 *     sizes come from `boxSizing.requiredTextHeight`, the very same function the
 *     app's `fix_canvas_boxes` pass uses;
 *   - no two groups overlap and every group wraps its members: positions are
 *     computed bottom-up, each group is placed below the *real* bottom of the
 *     previous one, never from an estimate;
 *   - every arrow has a label that says why the two cards are connected.
 *
 * Usage (this repo runs TypeScript through vitest, see `src/core/canvas/kbCanvas.test.ts`):
 *
 *   KB_CANVAS_FOLDER="C:/PROGRAMMING/Matemáticas/<area>/<concept folder>" \
 *     npx vitest run src/core/canvas/kbCanvas.test.ts
 *
 * The generator keeps one visible canvas and backs up the previous version before replacing it.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as cf from "../src/core/canvas/canvasFormat";
import { archiveCanvasAlternates, backupCanvasVersion } from "../src/core/canvas/canvasVersions";
import { requiredTextHeight } from "../src/core/canvas/boxSizing";
import { parseFrontmatter } from "../src/core/frontmatter";
import { edgePath, type Side } from "../src/lib/canvas";

/* ── constants ───────────────────────────────────────────────────────────── */

/** Text panel width. `.nv-prose` caps its content at 820 px, so this is safe. */
const PANEL_W = 460;
/** "Qué es" holds the formal definitions; it gets the widest panel. */
const QUE_W = 620;
/** Link cards of the Requiere panel: navigation, not content. */
const LINK_W = 320;
const LINK_H = 150;
/** Horizontal gap between two panels, grown when a long label crosses it. */
const GAP_X_MIN = 260;
/** Vertical gap between two chained panels: room for one 28 px label line. */
const GAP_Y = 96;
/** Vertical gap between two groups in the same column. */
const GROUP_GAP = 120;
/** Extra gap between two blocks of panels sharing one column (Ejemplos|Errores). */
const BLOCK_GAP = 200;
/** The renderer draws every edge label in this box, centred on the curve midpoint. */
const LABEL_W = 180;
const LABEL_H = 28;
/** Group padding / space for the group label. */
const PAD = 24;
const TOP = 48;
/** Marker of the placeholder card drawn when a concept has no prerequisites. */
const ROLE_NO_PREREQ = "no-prerequisites";
/** Canvas colour presets. */
const C_CONCEPT = "6";
const C_DEFINITION = "5";
const C_EXAMPLE = "4";
const C_ERROR = "3";
/** Edge labels are words: plain "x → y" labels are rejected by verifyCanvas. */
const MAX_LABEL = 46;

const IGNORED_DIRS = new Set([
  ".git", ".trash", ".notevault", "node_modules", "dist", "build",
  "release", "attachments", "Demostraciones", "Ejercicios", "__pycache__", ".venv",
  // The app repo holds copies of notes under docs/knowledge_base/examples; a
  // prerequisite link must resolve to the vault's note, never to a copy.
  "PROJECTS",
]);

/* ── note parsing ────────────────────────────────────────────────────────── */

export interface NoteSection {
  title: string;
  level: number;
  body: string;
}

export interface Field {
  label: string;
  text: string;
}

export interface Example {
  title: string;
  fields: Field[];
}

export interface CommonError {
  title: string;
  fields: Field[];
}

export interface Prerequisite {
  label: string;
  reason: string;
  /** vault-relative path of the prerequisite note, when it exists */
  note?: string;
}

export type Lang = "es" | "en";

/** Words of each language the note parser accepts and the canvas draws. Programming notes are written in English. */
export const LABELS: Record<Lang, {
  requires: string; noPrereq: string; explanation: string; whatItIs: string; mental: string; examples: string; errors: string;
  pending: string; baseConcept: string; priorConcept: string; understoodWith: string; then: string; appliedIn: string; failsWhen: string; anotherCase: string;
  exampleFields: string[]; errorFields: string[]; follows: string;
}> = {
  es: {
    requires: "Requiere", noPrereq: "Sin prerrequisitos.", explanation: "Explicación", whatItIs: "Qué es", mental: "Modelo mental", examples: "Ejemplos", errors: "Errores comunes",
    pending: "(pendiente)", baseConcept: "concepto base", priorConcept: "concepto previo", understoodWith: "se entiende con", then: "luego", appliedIn: "se aplica en", failsWhen: "se falla cuando", anotherCase: "otro caso",
    exampleFields: ["Contexto", "Caso", "Resultado esperado", "Por qué funciona"], errorFields: ["Error", "Síntoma", "Causa", "Solución"], follows: "sigue",
  },
  en: {
    requires: "Requires", noPrereq: "No prerequisites.", explanation: "Explanation", whatItIs: "What it is", mental: "Mental model", examples: "Examples", errors: "Common mistakes",
    pending: "(pending)", baseConcept: "base concept", priorConcept: "prior concept", understoodWith: "is understood with", then: "then", appliedIn: "applied in", failsWhen: "fails when", anotherCase: "another case",
    exampleFields: ["Context", "Case", "Expected result", "Why it works"], errorFields: ["Mistake", "Symptom", "Cause", "Fix"], follows: "follows",
  },
};

export interface Concept {
  lang: Lang;
  number: string;
  title: string;
  area: string;
  /** raw text of `## Requiere`, undefined when the section is missing */
  hasRequiereSection: boolean;
  prerequisites: Prerequisite[];
  queEs: string;
  /** the first module after «What it is» when it is «Mental model» (old notes); empty otherwise */
  modeloMental: string;
  /** every module of `## Explanation` after «What it is», in order (old notes: «Mental model»; new notes: «How it is organised», «How it works in the real world»…) */
  modules: Array<{ title: string; body: string }>;
  examples: Example[];
  errors: CommonError[];
  /** everything the note should have and does not, or has and should not */
  warnings: string[];
}

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** `## X` / `### X` blocks, in order. */
export function sections(markdown: string): NoteSection[] {
  const out: NoteSection[] = [];
  let current: NoteSection | null = null;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    // A `#` inside a fenced code block is code (a Python comment, a shell prompt), never a heading.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^(#{1,4})\s+(.*)$/.exec(line);
    if (m && m[1] && m[2]) {
      if (current) out.push(current);
      current = { title: m[2].trim(), level: m[1].length, body: "" };
      continue;
    }
    if (current) current.body += line + "\n";
  }
  if (current) out.push(current);
  for (const s of out) s.body = s.body.replace(/\s+$/, "");
  return out;
}

const top = (list: NoteSection[], names: string[]): NoteSection | undefined =>
  list.find((s) => s.level === 2 && names.some((n) => norm(s.title) === n));

const children = (section: NoteSection | undefined, all: NoteSection[]): NoteSection[] => {
  if (!section) return [];
  const i = all.indexOf(section);
  const out: NoteSection[] = [];
  for (let k = i + 1; k < all.length; k++) {
    const s = all[k];
    if (!s || s.level <= section.level) break;
    if (s.level === section.level + 1) out.push(s);
  }
  return out;
};

/** `- **Label:** text` bullets, tolerant of `- **Label**: text` and of missing bold. */
function labeledFields(body: string, labels: string[]): Field[] {
  const out: Field[] = [];
  const byLabel = new Map<string, Field>();
  for (const label of labels) byLabel.set(norm(label), { label, text: "" });
  let last: Field | null = null;
  let inFence = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const isFence = /^(```|~~~)/.test(line);
    // Inside a fenced code block every line is code: blank lines and line breaks are kept.
    if (last && (inFence || isFence)) {
      if (isFence) inFence = !inFence;
      last.text = `${last.text}\n${raw.replace(/\s+$/, "")}`;
      continue;
    }
    if (!line) continue;
    const m = /^[-*]\s+\*\*(.+?)\:?\*\*\s*\:?\s*(.*)$/.exec(line);
    if (m && m[1]) {
      const key = norm(m[1].replace(/\s*:\s*$/, ""));
      const field = byLabel.get(key);
      if (field) {
        field.text = (m[2] ?? "").trim();
        last = field;
        continue;
      }
    }
    // Numbered steps / sub-bullets keep their own line (step-by-step walkthroughs); prose lines are joined.
    if (last) last.text = `${last.text}${/^(\d+[.)]|[-*])\s/.test(line) ? "\n" : " "}${line}`.trim();
  }
  for (const label of labels) {
    const f = byLabel.get(norm(label));
    if (f && f.text) out.push(f);
  }
  return out;
}


function countFieldWarnings(kind: string, title: string, fields: Field[], expected: string[]): string[] {
  const missing = expected.filter((e) => !fields.some((f) => norm(f.label) === norm(e)));
  return missing.length ? [`${kind} "${title}": falta(n) ${missing.join(", ")}`] : [];
}

/** Reads the note and reports what is missing, without inventing anything. */
export function readConcept(folder: string, vaultRoot: string): Concept {
  const base = path.basename(path.resolve(folder));
  const notePath = path.join(path.resolve(folder), `${base}.md`);
  if (!fs.existsSync(notePath)) throw new Error(`no existe la nota: ${notePath}`);
  const raw = fs.readFileSync(notePath, "utf-8");
  const [fm, body] = parseFrontmatter(raw);
  const warnings: string[] = [];
  const all = sections(body);
  // Programming notes (and any note with English headings) are English; the rest keep Spanish.
  const heads = all.filter((s) => s.level === 2).map((s) => norm(s.title));
  const english = heads.some((h) => ["explanation", "examples", "example", "requires", "prerequisites", "common mistakes", "common errors"].includes(h));
  const spanish = heads.some((h) => ["explicacion", "ejemplos", "ejemplo", "requiere", "prerrequisitos", "errores comunes"].includes(h));
  // The headings decide; a note with none of them (yet) follows its subject: programming is written in English.
  const lang: Lang = english ? "en" : spanish ? "es" : String(fm["subject"] ?? "").toLowerCase() === "programming" ? "en" : "es";
  const L = LABELS[lang];

  const number = String(fm["number"] ?? base.split(" ")[0] ?? "");
  const title = String(fm["title"] ?? base.replace(/^\S+\s+/, ""));
  const area = String(fm["area"] ?? path.basename(path.dirname(path.resolve(folder))));

  /* 1. Requiere */
  const requiere = top(all, ["requiere", "requisitos", "prerrequisitos", "requires", "prerequisites", "requirements"]);
  if (!requiere) warnings.push(`falta la sección "## ${L.requires}" (es obligatoria)`);
  const prerequisites: Prerequisite[] = [];
  if (requiere) {
    const noPrereq = /(sin\s+prerrequisitos|no\s+prerequisites)/i.test(requiere.body);
    for (const raw of requiere.body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("-") && !line.startsWith("*")) continue;
      const link = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(line);
      if (!link || !link[1]) continue;
      const label = link[1].trim();
      const reason = line
        .replace(/\[\[[^\]]+\]\]/, "")
        .replace(/^[-*\s]+/, "")
        .replace(/^[—–-]\s*/, "")
        .trim();
      prerequisites.push({ label, reason: reason || L.priorConcept });
    }
    if (!prerequisites.length && !noPrereq) {
      warnings.push(`"## ${L.requires}" no tiene ningún \`- [[Concepto previo]]\` ni dice "${L.noPrereq.replace(/\.$/, "")}"`);
    }
  }
  for (const p of prerequisites) {
    const found = findNote(p.label, vaultRoot);
    if (found) p.note = found;
    else warnings.push(`el prerrequisito "${p.label}" no tiene nota en el vault (se dibuja como texto)`);
  }

  /* 2. Explicación */
  const explicacion = top(all, ["explicación", "explicacion", "explanation"]);
  const queEs = children(explicacion, all).find((s) => ["que es", "what it is", "what is it"].includes(norm(s.title)));
  const modelo = children(explicacion, all).find((s) => ["modelo mental", "mental model"].includes(norm(s.title)));
  // La explicación se reparte en MÓDULOS funcionales, cada uno con un solo objetivo: qué es, cómo se organiza, cómo actúa en el mundo real.
  // Las notas antiguas tienen «Qué es» + «Modelo mental»; se dibujan igual (el modelo mental es otro módulo).
  const modules = children(explicacion, all).filter((s) => s !== queEs).map((s) => ({ title: s.title.trim(), body: s.body.trim() }));
  if (!explicacion) warnings.push(`falta la sección "## ${L.explanation}"`);
  if (!queEs) warnings.push(`falta "### ${L.whatItIs}" dentro de "## ${L.explanation}"`);
  if (explicacion && !modules.length) warnings.push(`falta al menos un módulo después de "### ${L.whatItIs}" (p. ej. "### How it is organised" y "### How it works in the real world")`);

  /* 3. Ejemplos */
  const ejemplos = top(all, ["ejemplos", "ejemplo", "examples", "example"]);
  if (!ejemplos) warnings.push(`falta la sección "## ${L.examples}"`);
  const examples: Example[] = children(ejemplos, all).map((s) => {
    const fields = labeledFields(s.body, L.exampleFields);
    warnings.push(...countFieldWarnings("Ejemplo", s.title, fields, L.exampleFields));
    return { title: s.title, fields };
  });

  /* 4. Errores comunes */
  const errores = top(all, ["errores comunes", "errores frecuentes", "errores tipicos", "errores típicos", "common mistakes", "common errors", "typical mistakes", "pitfalls"]);
  if (!errores) warnings.push(`falta la sección "## ${L.errors}"`);
  const errors: CommonError[] = children(errores, all).map((s) => {
    const fields = labeledFields(s.body, L.errorFields);
    warnings.push(...countFieldWarnings("Error", s.title, fields, L.errorFields));
    return { title: s.title, fields };
  });
  if (errores && !errors.length) warnings.push(`"## ${L.errors}" no tiene ningún \`### Error N — …\``);

  return {
    lang, number, title, area,
    hasRequiereSection: Boolean(requiere),
    prerequisites,
    queEs: queEs?.body.trim() ?? "",
    modeloMental: modelo?.body.trim() ?? "",
    modules,
    examples,
    errors,
    warnings,
  };
}

/* ── vault lookup ────────────────────────────────────────────────────────── */

/**
 * Vault root = the folder that holds `.notevault` or `.obsidian` (highest ancestor if nested).
 * The user's home folder only counts when nothing below it is a vault: `~/.notevault` is the app's own
 * settings folder, not a vault, so a vault inside home wins over it.
 */
export function findVaultRoot(from: string): string {
  let dir = path.resolve(from);
  let found: string | null = null;
  let homeMarked = false;
  const home = path.resolve(os.homedir());
  for (;;) {
    if (fs.existsSync(path.join(dir, ".notevault")) || fs.existsSync(path.join(dir, ".obsidian"))) {
      if (dir === home) homeMarked = true;
      else found = dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (found) return found;
  if (homeMarked) return home;
  throw new Error(`no encuentro la raíz del vault (.notevault) desde ${from}`);
}

function walkNotes(root: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walkNotes(path.join(root, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(path.join(root, e.name));
    }
  }
  return out;
}

const noteIndexCache = new Map<string, Map<string, string>>();

/** Basename (lowercase, no extension) → vault-relative path. Walking 3.6k notes
 * once per process instead of once per prerequisite keeps a 40-map pass fast. */
function noteIndex(vaultRoot: string): Map<string, string> {
  const cached = noteIndexCache.get(vaultRoot);
  if (cached) return cached;
  const idx = new Map<string, string>();
  for (const file of walkNotes(vaultRoot)) {
    const base = path.basename(file, ".md").toLowerCase();
    if (!idx.has(base)) idx.set(base, path.relative(vaultRoot, file).split(path.sep).join("/"));
  }
  noteIndexCache.set(vaultRoot, idx);
  return idx;
}

/** `[[<number> <title>]]` → its note, by basename (the note is named after it). */
export function findNote(label: string, vaultRoot: string): string | undefined {
  const idx = noteIndex(vaultRoot);
  const wanted = label.trim().toLowerCase();
  const exact = idx.get(wanted);
  if (exact) return exact;
  for (const [base, rel] of idx) {
    if (base.startsWith(`${wanted} `)) return rel;
  }
  return undefined;
}

/* ── layout ──────────────────────────────────────────────────────────────── */

const labelWidth = (label: string): number => label.length * 6.4;

/** What each example panel receives from the panel above it. */
const ARROW_INTO: Record<string, string> = {
  contexto: "se plantea así",
  caso: "el caso concreto",
  "resultado esperado": "da como resultado",
  "por que funciona": "funciona porque",
  context: "is set up like this",
  case: "the concrete case",
  "expected result": "gives as a result",
  "why it works": "works because",
};

const arrowInto = (fieldLabel: string, lang: Lang): string => ARROW_INTO[norm(fieldLabel)] ?? LABELS[lang].follows;

/** Horizontal gap wide enough for the longest label crossing it. */
const gapFor = (labels: string[]): number =>
  Math.max(GAP_X_MIN, ...labels.map((l) => labelWidth(l) + 64));

/**
 * Width needed by a card: PANEL_W (460 px) for prose/math, or widened for code blocks up to 860 px so lines do not clip.
 */
export function cardWidth(text: string): number {
  const fenceMatch = /```[\s\S]*?```/g;
  let maxCodeLine = 0;
  for (const block of text.matchAll(fenceMatch)) {
    const lines = block[0].split(/\r?\n/).slice(1, -1);
    for (const line of lines) {
      if (line.length > maxCodeLine) maxCodeLine = line.length;
    }
  }
  if (maxCodeLine > 0) {
    // 13px mono font is ~8.4px/char. Add 56px for container padding and borders.
    const needed = Math.ceil(maxCodeLine * 8.4 + 56);
    return Math.max(PANEL_W, Math.min(860, needed));
  }
  return PANEL_W;
}

function group(label: string, members: cf.CanvasNode[], color: string, z: number): cf.CanvasNode {
  const x = Math.min(...members.map((m) => m.x)) - PAD;
  const y = Math.min(...members.map((m) => m.y)) - TOP;
  const right = Math.max(...members.map((m) => m.x + m.width)) + PAD;
  const bottom = Math.max(...members.map((m) => m.y + m.height)) + PAD;
  return new cf.CanvasNode({
    id: cf.newId(), type: "group", x, y, width: right - x, height: bottom - y,
    label, color, nv: { zIndex: z },
  });
}

class Builder {
  doc: cf.CanvasDoc;
  constructor() {
    this.doc = new cf.CanvasDoc();
  }
  text(x: number, y: number, w: number, md: string, color = ""): cf.CanvasNode {
    const n = new cf.CanvasNode({
      id: cf.newId(), type: "text", x, y, width: w,
      height: Math.ceil(requiredTextHeight(md, w)), text: md, color,
    });
    this.doc.nodes.push(n);
    return n;
  }
  link(x: number, y: number, vaultRel: string, w = LINK_W, h = LINK_H): cf.CanvasNode {
    const n = new cf.CanvasNode({ id: cf.newId(), type: "file", x, y, width: w, height: h, file: vaultRel });
    this.doc.nodes.push(n);
    return n;
  }
  add(node: cf.CanvasNode): cf.CanvasNode {
    this.doc.nodes.push(node);
    return node;
  }
  edge(a: cf.CanvasNode, b: cf.CanvasNode, label: string, fromSide = "right", toSide = "left"): void {
    if (!label.trim()) throw new Error("toda flecha necesita etiqueta");
    this.doc.edges.push(new cf.CanvasEdge({
      id: cf.newId(), fromNode: a.id, toNode: b.id,
      fromSide, toSide, label: label.slice(0, MAX_LABEL),
    }));
  }
}

/** The whole concept canvas: 4 panels, bottom-up, no overlap by construction. */
export function buildConceptCanvas(c: Concept): cf.CanvasDoc {
  const b = new Builder();
  const L = LABELS[c.lang];

  /* ── Panel 1 — Requiere (mandatory, immune to changes) ─────────────────── */
  const prereqCards: cf.CanvasNode[] = [];
  if (c.prerequisites.length) {
    c.prerequisites.forEach((p, i) => {
      const y = i * (LINK_H + 40);
      prereqCards.push(
        p.note
          ? b.link(0, y, p.note)
          : b.text(0, y, LINK_W, `**${p.label}**\n\n*${L.pending}*`, C_ERROR),
      );
    });
  } else {
    const card = b.text(0, 0, LINK_W, L.noPrereq, C_DEFINITION);
    card.nv = { role: ROLE_NO_PREREQ };
    prereqCards.push(card);
  }
  const requiereGroup = b.add(group(L.requires, prereqCards, "", -2));

  /* ── Panel 2 — Explicación: Qué es + Modelo mental ─────────────────────── */
  const toConceptLabels = c.prerequisites.length
    ? c.prerequisites.map((p) => p.reason)
    : [L.baseConcept];
  const xEx = requiereGroup.x + requiereGroup.width + gapFor(toConceptLabels);

  const que = b.text(xEx, 0, QUE_W, `## ${L.whatItIs}\n\n${c.queEs}`, C_DEFINITION);
  const moduleNodes: cf.CanvasNode[] = [];
  let yMod = que.height + GAP_Y;
  for (const m of c.modules) {
    const node = b.text(xEx, yMod, QUE_W, `## ${m.title}\n\n${m.body}`, C_CONCEPT);
    moduleNodes.push(node);
    yMod += node.height + GAP_Y;
  }
  const modelo = moduleNodes[0] ?? que; // the module the examples hang from: the first one after «What it is» keeps the old layout
  const explicacionGroup = b.add(group(L.explanation, [que, ...moduleNodes], C_CONCEPT, -2));

  for (const p of c.prerequisites) {
    const card = prereqCards[c.prerequisites.indexOf(p)];
    if (card) b.edge(card, que, p.reason);
  }
  moduleNodes.forEach((node, i) => b.edge(i === 0 ? que : moduleNodes[i - 1]!, node, i === 0 ? L.understoodWith : L.then, "bottom", "top"));

  /* ── Panels 3 and 4 — Ejemplos, and Errores comunes below them ─────────── */
  // Both hang from `Explicación`, so they share one column. An arrow from column
  // 2 to a fourth column would cross column 3 and drop its 180 px label on top
  // of column 3's labels: that is the defect the user reported on 2026-09-28.
  const crossLabels = [L.appliedIn, L.failsWhen, L.anotherCase];
  const x3 = explicacionGroup.x + explicacionGroup.width + gapFor(crossLabels);

  const exTexts = c.examples.flatMap((ex) => ex.fields.map((f) => f.text));
  const errTexts = c.errors.map((err) => err.fields.map((f) => `- **${f.label}:** ${f.text}`).join("\n"));
  const col3W = Math.max(PANEL_W, ...[...exTexts, ...errTexts].map(cardWidth));

  const exampleGroups: cf.CanvasNode[] = [];
  const exampleFirst: cf.CanvasNode[] = [];
  const exampleLast: cf.CanvasNode[] = [];
  let y3 = 0;

  for (const ex of c.examples) {
    const cards: Array<{ field: Field; node: cf.CanvasNode }> = [];
    let y = y3;
    for (const f of ex.fields) {
      const card = b.text(x3, y, col3W, `### ${f.label}\n\n${f.text}`);
      cards.push({ field: f, node: card });
      y = card.y + card.height + GAP_Y;
    }
    for (let i = 1; i < cards.length; i++) {
      const prev = cards[i - 1];
      const cur = cards[i];
      if (!prev || !cur) continue;
      b.edge(prev.node, cur.node, arrowInto(cur.field.label, c.lang), "bottom", "top");
    }
    const first = cards[0];
    const last = cards[cards.length - 1];
    if (!first || !last) continue;
    exampleFirst.push(first.node);
    exampleLast.push(last.node);
    exampleGroups.push(b.add(group(ex.title, cards.map((c) => c.node), C_EXAMPLE, -2)));
    y3 = last.node.y + last.node.height + GROUP_GAP;
  }
  if (exampleGroups.length) b.add(group(L.examples, exampleGroups, C_EXAMPLE, -10));

  /* ── Panel 4 — Errores comunes: one panel per error, below the examples ── */
  const errorCards: cf.CanvasNode[] = [];
  const errorGroups: cf.CanvasNode[] = [];
  let yErr = (c.examples.length ? y3 + BLOCK_GAP : 0);

  for (const err of c.errors) {
    const md =
      `**${err.title}**\n\n` +
      err.fields.map((f) => `- **${f.label}:** ${f.text}`).join("\n");
    const card = b.text(x3, yErr, col3W, md, C_ERROR);
    errorCards.push(card);
    errorGroups.push(b.add(group(err.title, [card], C_ERROR, -2)));
    yErr = card.y + card.height + GROUP_GAP;
  }
  if (errorGroups.length) b.add(group(L.errors, errorGroups, C_ERROR, -10));

  /* ── Arrows ────────────────────────────────────────────────────────────── */
  const firstExample = exampleFirst[0];
  if (firstExample) b.edge(moduleNodes[moduleNodes.length - 1] ?? modelo, firstExample, L.appliedIn);
  for (let i = 1; i < exampleFirst.length; i++) {
    const prev = exampleLast[i - 1];
    const cur = exampleFirst[i];
    if (prev && cur) b.edge(prev, cur, L.anotherCase, "bottom", "top");
  }
  for (const card of errorCards) b.edge(que, card, L.failsWhen);

  return b.doc;
}

/* ── verification ────────────────────────────────────────────────────────── */

interface Rect { x: number; y: number; width: number; height: number }

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/**
 * Everything the acceptance checklist demands, in code. Returns one string per
 * problem: an empty array means the canvas is correct.
 */
export function verifyCanvas(doc: cf.CanvasDoc): string[] {
  const problems: string[] = [];
  const nodes = doc.nodes;
  const groups = nodes.filter((n) => n.type === "group");
  const leaves = nodes.filter((n) => n.type !== "group");

  for (const n of leaves) {
    if (n.type === "text") {
      const need = requiredTextHeight(n.text ?? "", n.width);
      if (need > n.height + 1) {
        problems.push(`la tarjeta "${firstLine(n.text)}" mide ${n.height} y su texto necesita ${Math.ceil(need)}`);
      }
    }
  }
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const bb = leaves[j];
      if (a && bb && intersects(a, bb)) {
        problems.push(`dos tarjetas se solapan: "${firstLine(a.text || a.file)}" | "${firstLine(bb.text || bb.file)}"`);
      }
    }
  }
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const bb = groups[j];
      if (!a || !bb || !intersects(a, bb)) continue;
      // A parent group wraps its children on purpose: that is containment,
      // not overlap. Only two groups that cut into each other are a defect.
      if (contains(a, bb) || contains(bb, a)) continue;
      problems.push(`dos grupos se solapan: "${a.label}" | "${bb.label}"`);
    }
  }
  for (const g of groups) {
    const members = leaves.filter((n) => contains(g, n) || isInsideByCenter(g, n));
    const strays = members.filter((n) => !contains(g, n));
    for (const s of strays) {
      problems.push(`el grupo "${g.label}" no envuelve a "${firstLine(s.text || s.file)}"`);
    }
  }
  for (const ed of doc.edges) {
    if (!ed.label.trim()) problems.push(`flecha sin etiqueta: ${ed.fromNode} → ${ed.toNode}`);
    if (!doc.nodeById(ed.fromNode) || !doc.nodeById(ed.toNode)) {
      problems.push(`flecha rota: ${ed.fromNode} → ${ed.toNode}`);
    }
  }
  const connected = new Set(doc.edges.flatMap((ed) => [ed.fromNode, ed.toNode]));
  for (const n of leaves) {
    if (n.nv["role"] === ROLE_NO_PREREQ) continue; // placeholder, nothing to connect
    if (!connected.has(n.id)) problems.push(`tarjeta desconectada: "${firstLine(n.text || n.file)}"`);
  }

  // Where does each label land? Exactly where the renderer draws it: the app
  // centres a LABEL_W × LABEL_H box on the midpoint of the edge's cubic
  // (`edgePath(...).mid` in CanvasView). A label on a card, or two labels on top
  // of each other, is the defect the user reported on 2026-09-28. Overlapping a
  // *group* rectangle is fine: arrows live inside the group they belong to.
  const boxes = doc.edges.map((ed) => {
    const a = doc.nodeById(ed.fromNode);
    const c = doc.nodeById(ed.toNode);
    const mid = a && c ? edgePath(a, ed.fromSide as Side, c, ed.toSide as Side).mid : [0, 0];
    return {
      label: ed.label,
      rect: {
        x: Number(mid[0]) - LABEL_W / 2,
        y: Number(mid[1]) - LABEL_H / 2,
        width: LABEL_W,
        height: LABEL_H,
      },
    };
  });
  for (const box of boxes) {
    for (const card of leaves) {
      if (intersects(box.rect, card)) {
        problems.push(`la etiqueta "${box.label}" pisa la tarjeta "${firstLine(card.text || card.file)}"`);
      }
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const c = boxes[j];
      if (a && c && intersects(a.rect, c.rect)) {
        problems.push(`las etiquetas "${a.label}" y "${c.label}" se pisan`);
      }
    }
  }
  return problems;
}

const firstLine = (text: string | undefined): string =>
  `${(text ?? "").replace(/^#+\s*/gm, "").split("\n").find((l) => l.trim()) ?? ""}`.trim().slice(0, 48);

const isInsideByCenter = (g: Rect, n: Rect): boolean => {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height;
};

/* ── writing, with the manifest guard ────────────────────────────────────── */

const MANIFEST_REL = path.join(".notevault", "estudio", "kb_canvas_manifest.json");

interface Manifest { [vaultRel: string]: string }

function readManifest(vaultRoot: string): Manifest {
  const p = path.join(vaultRoot, MANIFEST_REL);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Manifest;
  } catch {
    return {};
  }
}

function writeManifest(vaultRoot: string, m: Manifest): void {
  const p = path.join(vaultRoot, MANIFEST_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2), "utf-8");
}

const sha256 = (file: string): string =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Guarda la versión anterior en la papelera y mantiene un solo mapa visible. */
export function writeGenerated(target: string, doc: cf.CanvasDoc, vaultRoot: string): string {
  const rel = path.relative(vaultRoot, target).split(path.sep).join("/");
  const tmp = `${target}.tmp`;
  cf.dump(tmp, doc);
  const hash = sha256(tmp);
  const manifest = readManifest(vaultRoot);
  if (fs.existsSync(target) && sha256(target) !== hash) backupCanvasVersion(vaultRoot, target);
  archiveCanvasAlternates(vaultRoot, path.dirname(target));
  fs.renameSync(tmp, target);
  manifest[rel] = hash;
  writeManifest(vaultRoot, manifest);
  recordCanvasSkillVersion(vaultRoot, rel);
  return `written ${target}`;
}

/**
 * Un mapa es JSON Canvas (sin frontmatter), así que la versión de su skill (`mapa_skill.md`: 8 primeros hex del sha1 del texto con LF, igual que
 * `skillVersionOf` de la API) se guarda aparte, en `.notevault/estudio/canvas_versions.json`: { "<ruta del mapa>": "<versión>" }. Nunca lanza.
 */
export function recordCanvasSkillVersion(vaultRoot: string, rel: string): void {
  try {
    const subject = rel.split("/")[0] ?? "";
    const text = fs.readFileSync(path.join(vaultRoot, subject, "_skills", "mapa_skill.md"), "utf8");
    const version = crypto.createHash("sha1").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 8);
    const file = path.join(vaultRoot, ".notevault", "estudio", "canvas_versions.json");
    let all: Record<string, string> = {};
    try {
      all = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      /* primera vez */
    }
    all[rel] = version;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
  } catch {
    /* sin skill o sin permiso: el mapa se juzga por fecha */
  }
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

export interface GenerateResult {
  canvasPath: string;
  lines: string[];
  problems: string[];
  warnings: string[];
  written: string;
}

/** Generates the canvas of one concept folder and verifies it. */
export function generateConcept(folder: string, opts: { dryRun?: boolean } = {}): GenerateResult {
  const vaultRoot = findVaultRoot(folder);
  const concept = readConcept(folder, vaultRoot);
  const doc = buildConceptCanvas(concept);
  const problems = verifyCanvas(doc);
  const canvasPath = path.join(path.resolve(folder), `${path.basename(path.resolve(folder))} — mapa.canvas`);
  const written = problems.length
    ? "not written (fix the problems first)"
    : opts.dryRun
      ? "dry run: nothing written"
      : writeGenerated(canvasPath, doc, vaultRoot);
  return {
    canvasPath,
    lines: [
      `concepto ${concept.number} ${concept.title}`,
      `prerrequisitos: ${concept.prerequisites.length}`,
      `ejemplos: ${concept.examples.length} · errores: ${concept.errors.length}`,
      `nodos: ${doc.nodes.length} (${doc.nodes.filter((n) => n.type === "group").length} grupos) · flechas: ${doc.edges.length}`,
    ],
    problems,
    warnings: concept.warnings,
    written,
  };
}

export interface BatchResult {
  folders: number;
  written: number;
  kept: number;
  blocked: string[];
  warnings: string[];
  lines: string[];
}

const CONCEPT_SKIP = new Set(["Demostraciones", "Ejercicios", "attachments", "__pycache__"]);

/** Every concept folder under `root`: one that holds a note named like itself. */
export function findConceptFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || CONCEPT_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (fs.existsSync(path.join(full, `${e.name}.md`))) out.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  return out.sort();
}

/** Generates (or dry-runs) the concept map of every concept under `root`. */
export function generateAll(root: string, opts: { dryRun?: boolean } = {}): BatchResult {
  const folders = findConceptFolders(root);
  const res: BatchResult = { folders: folders.length, written: 0, kept: 0, blocked: [], warnings: [], lines: [] };
  for (const folder of folders) {
    const r = generateConcept(folder, { dryRun: opts.dryRun });
    const name = path.basename(folder);
    if (r.problems.length) {
      res.blocked.push(name);
      for (const p of r.problems) res.lines.push(`problem @ ${name}: ${p}`);
    } else if (r.written.startsWith("kept")) {
      res.kept += 1;
    } else if (!opts.dryRun) {
      res.written += 1;
    }
    for (const w of r.warnings) res.warnings.push(`${name}: ${w}`);
    res.lines.push(`${name}: ${r.problems.length ? "BLOQUEADO" : "ok"} · ${r.written}`);
  }
  return res;
}

function main(argv: string[]): number {
  const folder = argv[0];
  if (!folder) {
    process.stderr.write("uso: node tools/kb_canvas.ts <carpeta del concepto>\n");
    return 2;
  }
  const r = generateConcept(folder, { dryRun: process.env.KB_CANVAS_DRY === "1" });
  for (const l of r.lines) process.stdout.write(`${l}\n`);
  for (const w of r.warnings) process.stdout.write(`warning: ${w}\n`);
  for (const p of r.problems) process.stdout.write(`problem: ${p}\n`);
  process.stdout.write(`problems: ${r.problems.length}\n${r.written}\n`);
  return r.problems.length ? 1 : 0;
}

if (process.argv[1] && /kb_canvas\.(ts|js)$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
