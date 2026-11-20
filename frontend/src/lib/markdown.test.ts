// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown, toggleTaskAt } from "./markdown";

function dom(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("callouts", () => {
  it("admite dimensiones de imágenes al estilo Obsidian", () => {
    const el = dom(renderMarkdown("![[foto.png|240x120]]"));
    expect(el.querySelector("img")?.getAttribute("width")).toBe("240");
    expect(el.querySelector("img")?.getAttribute("height")).toBe("120");
  });

  it("conserva rutas de imágenes con porcentajes literales", () => {
    const el = dom(renderMarkdown("![foto](foto%25.png)"));
    expect(el.querySelector("img")?.dataset.embed).toBe("foto%.png");
  });

  it("turns > [!type] Title into a callout box", () => {
    const el = dom(renderMarkdown("> [!warning] Cuidado\n> Cuerpo del aviso."));
    const box = el.querySelector(".callout");
    expect(box?.getAttribute("data-callout")).toBe("warning");
    expect(box?.querySelector(".callout-title")?.textContent).toBe("Cuidado");
    expect(box?.querySelector(".callout-body")?.textContent).toContain("Cuerpo del aviso.");
    expect(el.querySelector("blockquote")).toBeNull();
  });

  it("uses the type as title when none is given, and keeps plain quotes", () => {
    const el = dom(renderMarkdown("> [!note]\n> hola\n\n> cita normal"));
    expect(el.querySelector(".callout-title")?.textContent).toBe("Note");
    expect(el.querySelector("blockquote")?.textContent).toContain("cita normal");
  });
});

describe("wikilinks and embeds", () => {
  it("renders [[target|alias]] as an internal link", () => {
    const a = dom(renderMarkdown("Ver [[Mi Nota|la nota]]")).querySelector("a.wikilink");
    expect(a?.getAttribute("data-target")).toBe("Mi Nota");
    expect(a?.textContent).toBe("la nota");
    expect(a?.getAttribute("href")).toBeNull();
  });

  it("marks image embeds for the bridge to load, notes as embeds", () => {
    const el = dom(renderMarkdown("![[pic.png]]\n\n![[Otra nota]]"));
    expect(el.querySelector("img")?.getAttribute("data-embed")).toBe("pic.png");
    expect(el.querySelector("[data-note-embed]")?.getAttribute("data-note-embed")).toBe("Otra nota");
  });

  it("never fetches remote images", () => {
    const el = dom(renderMarkdown("![x](https://tracker.example/p.png)"));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://tracker.example/p.png");
  });
});

describe("tasks", () => {
  it("renders checkboxes with their source line", () => {
    const el = dom(renderMarkdown("# T\n\n- [x] hecho\n- [ ] pendiente"));
    const boxes = el.querySelectorAll<HTMLInputElement>("input.task-box");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[0]!.dataset.line).toBe("2");
    expect(boxes[1]!.dataset.line).toBe("3");
    expect(el.querySelector("li.done .task-text")?.textContent).toBe("hecho");
  });

  it("toggles the right line and keeps CRLF", () => {
    const body = "# T\r\n\r\n- [ ] a\r\n- [x] b\r\n";
    const out = toggleTaskAt(body, 2);
    expect(out).toBe("# T\r\n\r\n- [x] a\r\n- [x] b\r\n");
    expect(toggleTaskAt(out, 3)).toBe("# T\r\n\r\n- [x] a\r\n- [ ] b\r\n");
    expect(toggleTaskAt(body, 0)).toBe(body);
  });
});

describe("look", () => {
  it("wraps fenced code in a window with language and highlighting", () => {
    const el = dom(renderMarkdown("```python\nimport asyncio\n```"));
    expect(el.querySelector(".code-block .code-lang")?.textContent).toBe("python");
    expect(el.querySelector("pre code .hljs-keyword")?.textContent).toBe("import");
  });

  it("shows ALL_CAPS status cells as badges", () => {
    const el = dom(renderMarkdown("| a | s |\n|---|---|\n| x | VALIDATED |\n| y | IN_PROGRESS |"));
    const badges = el.querySelectorAll(".badge");
    expect(badges[0]?.className).toContain("ok");
    expect(badges[1]?.className).toContain("progress");
  });

  it("leaves other capitalised cells alone", () => {
    const el = dom(renderMarkdown("| id | s |\n|---|---|\n| SKL-PY-010 | TODO |"));
    expect(el.querySelectorAll(".badge")).toHaveLength(1);
    expect(el.querySelector("td")?.textContent).toBe("SKL-PY-010");
  });

  it("renders math with KaTeX", () => {
    const el = dom(renderMarkdown("$$\nE = mc^2\n$$\n\nInline $a^2$."));
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });
});

describe("source lines", () => {
  it("tags top-level blocks with their line", () => {
    const el = dom(renderMarkdown("# A\n\ntexto\n\n## B"));
    expect(el.querySelector("h1")?.getAttribute("data-src-line")).toBe("0");
    expect(el.querySelector("h2")?.getAttribute("data-src-line")).toBe("4");
  });
});

describe("security", () => {
  const attacks = [
    "<script>window.__pwned = 1</script>",
    '<img src="x" onerror="window.__pwned=1">',
    '<a href="javascript:window.__pwned=1">x</a>',
    "[x](javascript:window.__pwned=1)",
    '<iframe src="https://evil.example"></iframe>',
    '<svg><script>window.__pwned=1</script></svg>',
    '<form action="https://evil.example"><button>go</button></form>',
    '<div style="background:url(https://evil.example/t.png)">x</div>',
    "<style>body{display:none}</style>",
    '<object data="x.swf"></object>',
    '<a href="#" onclick="window.__pwned=1">c</a>',
  ];

  it.each(attacks)("neutralises %s", (attack) => {
    const el = dom(renderMarkdown(`texto\n\n${attack}\n`));
    expect(el.querySelector("script, iframe, form, object, style")).toBeNull();
    for (const node of el.querySelectorAll("*")) {
      for (const attr of node.getAttributeNames()) {
        expect(attr.startsWith("on")).toBe(false);
      }
      const href = node.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("escapes wikilink targets and callout titles", () => {
    const el = dom(renderMarkdown('[["><img src=x onerror=alert(1)>]]\n\n> [!note] <img src=x onerror=alert(1)>\n> b'));
    expect(el.querySelector("img[onerror]")).toBeNull();
    expect(el.querySelector(".callout-title")?.textContent).toContain("<img");
  });
});

describe("media links", () => {
  it("keeps nv:// timestamp links and still drops scripts", async () => {
    const { renderMarkdown } = await import("./markdown");
    const html = renderMarkdown("[01:05](nv://media?file=Pelis/a.mp4&t=65) [x](javascript:alert(1)) <a href=\"javascript:alert(1)\">y</a>");
    expect(html).toContain('href="nv://media?file=Pelis/a.mp4&amp;t=65"');
    expect(html).not.toMatch(/href="javascript/i);
  });
});
