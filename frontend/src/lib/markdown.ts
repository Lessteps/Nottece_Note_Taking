// Markdown -> safe HTML for the reading view.
//
// markdown-it does the parsing; a handful of small plugins add what an
// Obsidian vault uses (callouts, [[wikilinks]], ![[embeds]], task lists) and
// the redesign's look (code windows, status badges in tables, boxed math).
// The result always goes through DOMPurify: notes can contain raw HTML, and
// this page can reach the vault through the Python bridge, so nothing a note
// contains may ever run as script.

import MarkdownItCtor from "markdown-it";
import type { MarkdownIt, StateCore, StateInline } from "markdown-it";
import katexModule from "@vscode/markdown-it-katex";
import DOMPurify, { type Config as PurifyConfig } from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, lang] of Object.entries({
  bash, c, cpp, css, go, java, javascript, json, markdown: markdownLang, python,
  rust, sql, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Syntax-highlight a code buffer with the same language registry used by Markdown fences. */
export function highlightCode(source: string, language: string): string {
  const lang = String(language || "").toLowerCase();
  const aliases: Record<string, string> = { py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", postgres: "sql", postgresql: "sql", mysql: "sql", node: "javascript" };
  const normalized = aliases[lang] || lang;
  if (!normalized || !hljs.getLanguage(normalized)) return escapeHtml(source);
  return hljs.highlight(source, { language: normalized, ignoreIllegals: true }).value;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Callout icons (Lucide paths, stroke-based) ────────────────────────────

const ICON: Record<string, string> = {
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  tip: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15 14c.2-1 .7-1.7 1.5-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>',
  warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  danger: '<path d="M4 14a1 1 0 0 1-.8-1.6l9.9-10.2a.5.5 0 0 1 .9.5l-1.9 6a1 1 0 0 0 .9 1.3h7a1 1 0 0 1 .8 1.6l-9.9 10.2a.5.5 0 0 1-.9-.5l1.9-6a1 1 0 0 0-.9-1.3z"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  example: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  bug: '<path d="m8 2 1.9 1.9"/><path d="M14.1 3.9 16 2"/><path d="M9 7.1v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/>',
};

const ICON_ALIAS: Record<string, string> = {
  abstract: "example", summary: "example", tldr: "example", todo: "success",
  hint: "tip", important: "tip", check: "success", done: "success",
  help: "question", faq: "question", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", error: "danger", cite: "quote",
};

function calloutIcon(type: string): string {
  const key = ICON[type] ? type : (ICON_ALIAS[type] ?? "note");
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</svg>`;
}

// ── Plugins ────────────────────────────────────────────────────────────────

/** > [!type] Title  →  a styled callout box. */
function callouts(md: MarkdownIt) {
  md.core.ruler.after("block", "nv_callouts", (state: StateCore) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      const open = toks[i]!;
      if (open.type !== "blockquote_open") continue;
      const p = toks[i + 1];
      const inline = toks[i + 2];
      if (p?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const [first = "", ...rest] = inline.content.split("\n");
      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/.exec(first);
      if (!m) continue;
      const type = m[1]!.toLowerCase();
      const title = m[3]!.trim() || type.charAt(0).toUpperCase() + type.slice(1);
      open.meta = { callout: type, title };
      for (let j = i + 1, depth = 0; j < toks.length; j++) {
        const t = toks[j]!;
        if (t.type === "blockquote_open") depth++;
        if (t.type === "blockquote_close") {
          if (depth === 0) {
            t.meta = { callout: type };
            break;
          }
          depth--;
        }
      }
      inline.content = rest.join("\n");
      if (!inline.content.trim()) {
        p.hidden = true;
        const close = toks[i + 3];
        if (close?.type === "paragraph_close") close.hidden = true;
      }
    }
  });
  const openDefault = md.renderer.rules.blockquote_open;
  const closeDefault = md.renderer.rules.blockquote_close;
  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    const meta = tokens[idx]!.meta as { callout?: string; title?: string } | null;
    if (meta?.callout) {
      return (
        `<div class="callout" data-callout="${escapeHtml(meta.callout)}">` +
        `<div class="callout-title">${calloutIcon(meta.callout)}<span>${escapeHtml(meta.title ?? "")}</span></div>` +
        `<div class="callout-body">`
      );
    }
    return openDefault ? openDefault(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.blockquote_close = (tokens, idx, opts, env, self) => {
    if ((tokens[idx]!.meta as { callout?: string } | null)?.callout) return "</div></div>\n";
    return closeDefault ? closeDefault(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };
}

/** [[Note]], [[Note|alias]], [[Note#Section]] and ![[embed]]. */
function wikilinks(md: MarkdownIt) {
  md.inline.ruler.before("link", "nv_wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    const embed = src.charCodeAt(start) === 0x21 /* ! */;
    const open = embed ? start + 1 : start;
    if (!src.startsWith("[[", open)) return false;
    const close = src.indexOf("]]", open + 2);
    if (close < 0) return false;
    const inner = src.slice(open + 2, close);
    if (!inner.trim() || inner.includes("\n")) return false;
    if (!silent) {
      const bar = inner.indexOf("|");
      const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
      const alias = bar >= 0 ? inner.slice(bar + 1).trim() : "";
      const token = state.push(embed ? "nv_embed" : "nv_wikilink", "", 0);
      token.meta = { target, alias };
    }
    state.pos = close + 2;
    return true;
  });
  md.renderer.rules.nv_wikilink = (tokens, idx) => {
    const { target, alias } = tokens[idx]!.meta as { target: string; alias: string };
    const label = alias || target.replace(/#/, " › ");
    return `<a class="wikilink" data-target="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
  };
  md.renderer.rules.nv_embed = (tokens, idx) => {
    const { target, alias } = tokens[idx]!.meta as { target: string; alias: string };
    if (IMAGE_EXT.test(target.split("#")[0]!)) {
      const width = /^\d+$/.test(alias) ? ` width="${alias}"` : "";
      return `<img data-embed="${escapeHtml(target)}" alt="${escapeHtml(/^\d+$/.test(alias) ? "" : alias)}"${width}>`;
    }
    return `<div class="note-embed" data-note-embed="${escapeHtml(target)}"></div>`;
  };
  // Plain ![alt](path): local files load through the bridge; remote images
  // are not fetched (privacy, and the CSP forbids them) — shown as a link.
  md.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx]!;
    const src = String(t.attrGet("src") ?? "");
    const alt = t.content;
    if (/^https?:\/\//i.test(src)) {
      return `<span class="embed-missing">Imagen remota: <a href="${escapeHtml(src)}">${escapeHtml(alt || src)}</a></span>`;
    }
    if (src.startsWith("data:")) return "";
    return `<img data-embed="${escapeHtml(decodeURI(src))}" alt="${escapeHtml(alt)}">`;
  };
}

/** - [ ] / - [x] list items become clickable checkboxes that know their
 *  source line, so the view can toggle them in the file. */
function taskLists(md: MarkdownIt) {
  md.core.ruler.after("inline", "nv_tasks", (state: StateCore) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      const item = toks[i]!;
      if (item.type !== "list_item_open") continue;
      const inline = toks[i + 2];
      if (toks[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const m = /^\[([ xX])\][ \t]/.exec(inline.content);
      if (!m) continue;
      const done = m[1] !== " ";
      item.attrJoin("class", done ? "task done" : "task");
      const first = inline.children?.[0];
      if (first?.type === "text") first.content = first.content.replace(/^\[[ xX]\][ \t]/, "");
      const line = item.map?.[0] ?? -1;
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" class="task-box" data-line="${line}"${done ? " checked" : ""}><span class="task-text">`;
      const end = new state.Token("html_inline", "", 0);
      end.content = "</span>";
      inline.children = [box, ...(inline.children ?? []), end];
    }
  });
}

const BADGE_CLASS: Array<[RegExp, string]> = [
  [/^(VALIDATED|DONE|PASSED|PASS|OK|COMPLETE|COMPLETED|MASTERED|ACTIVE|LIVE|APPROVED)$/, "ok"],
  [/^(IN_PROGRESS|IN PROGRESS|WIP|DOING|REVIEW|REVIEWING|LEARNING|RUNNING)$/, "progress"],
  [/^(FAILED|FAIL|BLOCKED|ERROR|REJECTED|BROKEN)$/, "bad"],
  [/^(PENDING|TODO|STAGED|DRAFT|PAUSED|WAITING)$/, "warn"],
];

/** A table cell holding only a status word (VALIDATED, IN_PROGRESS…) shows as a badge. */
function tableBadges(md: MarkdownIt) {
  md.core.ruler.after("inline", "nv_badges", (state: StateCore) => {
    const toks = state.tokens;
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.type !== "inline" || toks[i - 1]!.type !== "td_open") continue;
      const text = t.content.trim();
      // Only known status words: an ID such as SKL-PY-010 stays plain text.
      const cls = BADGE_CLASS.find(([rx]) => rx.test(text))?.[1];
      if (!cls) continue;
      const tok = new state.Token("html_inline", "", 0);
      tok.content = `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
      t.children = [tok];
    }
  });
}

/** Fenced code: a small window with the language and a copy button. */
function codeWindows(md: MarkdownIt) {
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx]!;
    const lang = t.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const known = lang && hljs.getLanguage(lang);
    const body = known
      ? hljs.highlight(t.content, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(t.content);
    return (
      `<div class="code-block"><div class="code-head">` +
      `<span class="code-dots"><i></i><i></i><i></i></span>` +
      `<span class="code-lang">${escapeHtml(lang || "text")}</span>` +
      `<button class="code-copy" data-copy="1" type="button">Copiar</button></div>` +
      `<pre><code class="hljs">${body}</code></pre></div>\n`
    );
  };
}

/** Every top-level block carries its source line (0-based, body-relative),
 *  so the view can scroll to a search hit or an outline heading. */
function sourceLines(md: MarkdownIt) {
  md.core.ruler.push("nv_src_lines", (state: StateCore) => {
    for (const t of state.tokens) {
      if (t.map && t.nesting === 1 && t.level === 0) t.attrSet("data-src-line", String(t.map[0]));
    }
  });
}

// ── Assembly ──────────────────────────────────────────────────────────────

const md = new MarkdownItCtor({ html: true, linkify: true, breaks: false });
// The package is CommonJS (exports.default); depending on the bundler the
// default import is the plugin itself or the module object around it.
const katexPlugin = ((katexModule as unknown as { default?: unknown }).default
  ?? katexModule) as typeof katexModule;
md.use(katexPlugin, { throwOnError: false, enableFencedBlocks: true });
md.use(callouts);
md.use(wikilinks);
md.use(taskLists);
md.use(tableBadges);
md.use(codeWindows);
md.use(sourceLines);

const PURIFY: PurifyConfig = {
  ADD_ATTR: ["data-target", "data-embed", "data-line", "data-callout", "data-copy",
    "data-note-embed"],
  FORBID_TAGS: ["style", "iframe", "frame", "form", "object", "embed", "link", "meta",
    "base", "script", "audio", "video", "source", "track"],
  FORBID_ATTR: ["srcset", "formaction", "action", "background", "ping"],
  ALLOW_UNKNOWN_PROTOCOLS: false,
  // DOMPurify's default list plus nv: (timestamp links to vault media).
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|nv):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

const cache = new Map<string, string>();
const CACHE_MAX = 64;

/** Render a note body (frontmatter already removed) to sanitized HTML. */
export function renderMarkdown(body: string): string {
  const hit = cache.get(body);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = String(DOMPurify.sanitize(md.render(body), PURIFY));
  } catch (e) {
    // Una nota que el parser no traga tiene que abrirse igual: se muestra en crudo
    // en vez de tumbar la ventana (la vista de lectura pinta lo que se devuelva).
    console.warn("[NoteVault] renderMarkdown falló; se muestra en texto plano:", e);
    html = `<pre class="nv-render-fallback">${escapeHtml(body)}</pre>`;
  }
  cache.set(body, html);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return html;
}

/**
 * Flip the checkbox of the task item that starts on `line` (0-based, as
 * reported by data-line) and return the new body. Line endings are kept.
 */
export function toggleTaskAt(body: string, line: number): string {
  const lines = body.split("\n");
  const src = lines[line];
  if (src === undefined) return body;
  const next = src.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_m, lead: string, mark: string) =>
    `${lead}[${mark === " " ? "x" : " "}]`,
  );
  if (next === src) return body;
  lines[line] = next;
  return lines.join("\n");
}
