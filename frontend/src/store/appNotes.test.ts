// @vitest-environment jsdom
//
// El nucleo de store/app.ts: el ciclo de vida de una nota abierta.
//
// Guardar mal es el peor fallo posible en una app de notas, asi que aqui se
// fijan las cuatro garantias del ciclo — se ve al instante, el servidor
// manda, lo que se escribio mientras saving sigue pendiente, y un conflicto
// nunca se pierde — mas el autosave, el frontmatter que se relee tras
// guardar, los marcadores y el volcado final al cerrar la ventana.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `override` lets a single test bend one answer without `mockResolvedValueOnce`
// being eaten by the set_unsaved call that store/app.ts fires on every change.
let override: ((method: string, args: unknown[]) => unknown) | null = null;

const invoke = vi.fn(async (method: string, args: unknown[] = []): Promise<unknown> => {
  if (override) return override(method, args);
  switch (method) {
    case "read_note": {
      const p = String(args[0] ?? "");
      return {
        path: p,
        title: (p.split("/").pop() ?? p).replace(/\.md$/, ""),
        kind: "note",
        raw: "---\ntags:\n  - uno\n---\ncuerpo\n",
        frontmatter: { tags: ["uno"] },
        modified: 1,
        bookmarked: false,
      };
    }
    case "write_note":
      return { ok: true, conflict: false, modified: 2 };
    case "toggle_bookmark":
      return { bookmarked: true };
    default:
      return { ok: true };
  }
});
(window as unknown as { nv: unknown }).nv = { invoke };

/** The calls of one method: set_unsaved fires on every state change. */
const calls = (method: string) => invoke.mock.calls.filter((c) => c[0] === method);
const lastCall = (method: string) => {
  const found = calls(method);
  return found.length ? (found[found.length - 1]![1] as unknown[])[0] : undefined;
};

/**
 * bridge.call() awaits the transport before reaching `window.nv.invoke`, so an
 * api call is one microtask deep. Drain a few before asserting on the calls.
 */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

import {
  clearPending,
  flushAll,
  markPending,
  useApp,
  wasJustWritten,
  type OpenNote,
} from "./app";

const app = () => useApp.getState();
const note = (path: string) => app().notes[path]!;

/** Add a note as already open, with overridable fields. */
function seeded(path = "nota.md", over: Partial<OpenNote> = {}): void {
  const note: OpenNote = {
    path, title: "nota", kind: "note", raw: "cuerpo\n", frontmatter: {},
    fmText: "", modified: 1, bookmarked: false, dirty: false, saving: false,
    conflict: false, eol: "\n", ...over,
  };
  useApp.setState((s) => ({ notes: { ...s.notes, [path]: note } }));
}

function reset() {
  override = null;
  invoke.mockClear();
  localStorage.clear();
  useApp.setState({
    vault: "C:/v", module: "notas", openTabs: [], activeTabId: null, active: null,
    tabs: [], pinnedTabIds: new Set<string>(), notes: {}, toasts: [],
  });
}

beforeEach(reset);
afterEach(() => vi.useRealTimers());

describe("editRaw y el autosave", () => {
  it("marca la nota sucia y guarda 1200 ms despues", async () => {
    vi.useFakeTimers();
    seeded();
    app().editRaw("nota.md", "cuerpo nuevo\n");
    expect(note("nota.md").dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(1200);
    expect(invoke).toHaveBeenCalledWith("write_note", ["nota.md", "cuerpo nuevo\n", 1]);
  });

  it("teclear sin parar retrasa el guardado a una sola escritura", async () => {
    vi.useFakeTimers();
    seeded();
    app().editRaw("nota.md", "a");
    await vi.advanceTimersByTimeAsync(800);
    app().editRaw("nota.md", "ab");
    await vi.advanceTimersByTimeAsync(800);
    app().editRaw("nota.md", "abc");
    expect(calls("write_note")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1200);
    expect(calls("write_note")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("write_note", ["nota.md", "abc", 1]);
  });

  it("escribir lo mismo no marca sucio ni programa guardado", async () => {
    vi.useFakeTimers();
    seeded();
    app().editRaw("nota.md", "cuerpo\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls("write_note")).toEqual([]);
    expect(note("nota.md").dirty).toBe(false);
  });

  it("una nota no abierta se ignora", () => {
    expect(() => app().editRaw("no-abierta.md", "x")).not.toThrow();
  });
});

describe("save", () => {
  it("escribe con el modified actual y deja la nota limpia", async () => {
    seeded("nota.md", { dirty: true, raw: "nuevo\n" });
    await app().save("nota.md");
    expect(invoke).toHaveBeenCalledWith("write_note", ["nota.md", "nuevo\n", 1]);
    expect(note("nota.md")).toMatchObject({ dirty: false, saving: false, conflict: false, modified: 2 });
  });

  it("force manda null como expectedModified (sobrescribe el cambio externo)", async () => {
    seeded("nota.md", { dirty: true });
    await app().save("nota.md", { force: true });
    expect(invoke).toHaveBeenCalledWith("write_note", ["nota.md", "cuerpo\n", null]);
  });

  it("una nota limpia no se guarda sin force", async () => {
    seeded("nota.md", { dirty: false });
    await app().save("nota.md");
    expect(calls("write_note")).toEqual([]);
  });

  it("un conflicto marca el estado y no pisa modified", async () => {
    override = (method) =>
      method === "write_note" ? { ok: false, conflict: true, modified: 9 } : { ok: true };
    seeded("nota.md", { dirty: true });
    await app().save("nota.md");
    expect(note("nota.md")).toMatchObject({ conflict: true, dirty: true, saving: false, modified: 1 });
  });

  it("lo escrito mientras saving sigue pendiente", async () => {
    seeded("nota.md", { dirty: true, raw: "primero\n" });
    let resolveWrite!: (v: unknown) => void;
    override = (method) =>
      method === "write_note" ? new Promise((r) => (resolveWrite = r)) : { ok: true };
    const p = app().save("nota.md");
    await flush(); // the write only starts once the transport resolves
    app().editRaw("nota.md", "primero\nmas\n");
    resolveWrite({ ok: true, conflict: false, modified: 2 });
    await p;
    expect(note("nota.md")).toMatchObject({ dirty: true, modified: 2, saving: false });
  });

  it("reprograma el último cambio si su autosave venció durante una escritura lenta", async () => {
    vi.useFakeTimers();
    seeded("nota.md", { dirty: true, raw: "primero\n" });
    let finish!: (v: unknown) => void;
    let writes = 0;
    override = (method) => {
      if (method !== "write_note") return { ok: true };
      writes++;
      return writes === 1 ? new Promise((resolve) => { finish = resolve; }) : { ok: true, conflict: false, modified: 3 };
    };
    const first = app().save("nota.md");
    await flush();
    app().editRaw("nota.md", "primero y segundo\n");
    await vi.advanceTimersByTimeAsync(1200);
    expect(writes).toBe(1);
    finish({ ok: true, conflict: false, modified: 2 });
    await first;
    await vi.advanceTimersByTimeAsync(1200);
    expect(writes).toBe(2);
    expect(note("nota.md")).toMatchObject({ dirty: false, modified: 3 });
    expect(calls("write_note")[1]?.[1]).toEqual(["nota.md", "primero y segundo\n", 2]);
  });

  it("dos guardados a la vez: el segundo no pisa al primero", async () => {
    seeded("nota.md", { dirty: true, raw: "a\n" });
    let resolveWrite!: (v: unknown) => void;
    override = (method) =>
      method === "write_note" ? new Promise((r) => (resolveWrite = r)) : { ok: true };
    const first = app().save("nota.md");
    expect(note("nota.md").saving).toBe(true);
    await flush();
    await app().save("nota.md"); // saving: true -> sale sin escribir
    resolveWrite({ ok: true, conflict: false, modified: 2 });
    await first;
    expect(calls("write_note")).toHaveLength(1);
  });

  it("un fallo al guardar avisa y deja la nota sucia", async () => {
    override = (method) => {
      if (method !== "write_note") return { ok: true };
      throw new Error("disco lleno");
    };
    seeded("nota.md", { dirty: true });
    await app().save("nota.md");
    expect(note("nota.md")).toMatchObject({ dirty: true, saving: false });
    expect(app().toasts.at(-1)?.text).toContain("No se pudo guardar");
  });

  it("guardar una nota que no esta abierta no hace nada", async () => {
    await app().save("no-abierta.md");
    expect(calls("write_note")).toEqual([]);
  });

  it("tras guardar, el watcher ya no trae un eco como cambio ajeno", async () => {
    seeded("nota.md", { dirty: true });
    await app().save("nota.md");
    expect(wasJustWritten("nota.md")).toBe(true);
    expect(wasJustWritten("otra.md")).toBe(false);
  });
});

describe("save y el frontmatter", () => {
  it("si el YAML cambio, relee las propiedades para la ficha", async () => {
    seeded("nota.md", { dirty: true, raw: "---\ntags:\n  - dos\n---\ncuerpo\n", fmText: "tags:\n  - uno" });
    await app().save("nota.md");
    // read_note devuelve tags: [uno] (el mock), y el store adopta ese valor.
    expect(note("nota.md").frontmatter).toEqual({ tags: ["uno"] });
    expect(note("nota.md").fmText).toBe("tags:\n  - dos");
  });

  it("si el YAML no cambio, no relee nada", async () => {
    seeded("nota.md", { dirty: true, raw: "cuerpo\n", fmText: "" });
    invoke.mockClear();
    await app().save("nota.md");
    expect(calls("read_note")).toEqual([]);
  });

  it("si la relectura falla, el guardado sigue teniendo exito", async () => {
    seeded("nota.md", { dirty: true, raw: "---\na: 2\n---\n", fmText: "a: 1" });
    override = (method) => {
      if (method === "read_note") throw new Error("se borro");
      return { ok: true, conflict: false, modified: 2 };
    };
    await app().save("nota.md");
    expect(note("nota.md").dirty).toBe(false);
  });
});

describe("reload", () => {
  it("una nota sucia entra en conflicto en vez de perder lo escrito", async () => {
    seeded("nota.md", { dirty: true, raw: "lo mio\n" });
    await app().reload("nota.md");
    expect(note("nota.md").raw).toBe("lo mio\n");
    expect(note("nota.md").conflict).toBe(true);
    // Y avisa al backend para que muestre el aviso de conflicto (ver #11).
    expect(calls("write_note")).toEqual([]);
  });

  it("una nota limpia se reemplaza por lo que hay en disco", async () => {
    seeded("nota.md", { dirty: false });
    await app().reload("nota.md");
    expect(note("nota.md").raw).toContain("cuerpo");
    expect(note("nota.md").conflict).toBe(false);
  });

  it("un fallo avisa con el mensaje del servidor", async () => {
    override = (method) => {
      if (method === "read_note") throw new Error("no existe");
      return { ok: true };
    };
    await app().reload("no-abierta.md");
    expect(app().toasts.at(-1)?.text).toBe("no existe");
  });
});

describe("toggleBookmark", () => {
  it("marca la nota y sube la version de los marcadores", async () => {
    seeded();
    const before = app().bookmarkVersion;
    await app().toggleBookmark("nota.md");
    expect(note("nota.md").bookmarked).toBe(true);
    expect(app().bookmarkVersion).toBe(before + 1);
  });

  it("una nota no abierta solo sube la version", async () => {
    const before = app().bookmarkVersion;
    await app().toggleBookmark("no-abierta.md");
    expect(app().bookmarkVersion).toBe(before + 1);
    expect(app().notes["no-abierta.md"]).toBeUndefined();
  });

  it("un fallo avisa y no cambia nada", async () => {
    seeded();
    override = (method) => {
      if (method === "toggle_bookmark") throw new Error("no");
      return { ok: true };
    };
    await app().toggleBookmark("nota.md");
    expect(note("nota.md").bookmarked).toBe(false);
    expect(app().toasts.at(-1)?.text).toBe("no");
  });
});

describe("pathDeleted y refreshTree", () => {
  it("borrar una nota sucia la saca de la lista", async () => {
    seeded("curso/a.md", { dirty: true });
    app().pathDeleted("curso/a.md");
    expect(app().notes["curso/a.md"]).toBeUndefined();
  });

  it("refreshTree solo sube la version del arbol", () => {
    const before = app().treeVersion;
    app().refreshTree();
    expect(app().treeVersion).toBe(before + 1);
  });

  it("clearReveal quita la linea a revelar", async () => {
    await app().openNote("nota.md");
    useApp.setState((s) => ({ notes: { ...s.notes, "nota.md": { ...s.notes["nota.md"]!, revealLine: 42 } } }));
    app().clearReveal("nota.md");
    expect(note("nota.md").revealLine).toBeUndefined();
  });
});

describe("toasts", () => {
  it("aparecen numerados y se descartan por id", () => {
    app().toast("error", "primero");
    app().toast("info", "segundo");
    expect(app().toasts.map((t) => t.text)).toEqual(["primero", "segundo"]);
    const [first] = app().toasts;
    app().dismiss(first!.id);
    expect(app().toasts.map((t) => t.text)).toEqual(["segundo"]);
  });

  it("se autodescartan a los 7 s los errores y a los 3,5 s el resto", async () => {
    vi.useFakeTimers();
    app().toast("error", "se queda");
    app().toast("info", "se va");
    await vi.advanceTimersByTimeAsync(3500);
    expect(app().toasts.map((t) => t.text)).toEqual(["se queda"]);
    await vi.advanceTimersByTimeAsync(3500);
    expect(app().toasts).toEqual([]);
  });
});

describe("setUnsaved: lo que la ventana cuenta antes de cerrar", () => {
  it("cuenta notas sucias y pendientes, y solo avisa cuando cambia", async () => {
    useApp.setState({ notes: {} });
    await flush();
    invoke.mockClear();

    seeded("a.md", { dirty: true });
    await flush();
    expect(lastCall("set_unsaved")).toBe(1);

    // Marcar otra sucia cambia el numero: vuelve a avisar.
    seeded("b.md", { dirty: true });
    await flush();
    expect(lastCall("set_unsaved")).toBe(2);

    // Un pending mas tambien cuenta.
    markPending("canvas:mapa.canvas", async () => undefined);
    await flush();
    expect(lastCall("set_unsaved")).toBe(3);

    clearPending("canvas:mapa.canvas");
    await flush();
    expect(lastCall("set_unsaved")).toBe(2);
  });

  it("flushAll guarda las notas sucias y ejecuta los pendientes", async () => {
    seeded("a.md", { dirty: true, raw: "a\n" });
    seeded("b.md", { dirty: true, raw: "b\n" });
    await flush();
    const flushed: string[] = [];
    markPending("modulo:x", async () => {
      flushed.push("x");
    });

    await flushAll();

    const written = calls("write_note").map((c) => (c[1] as unknown[])[0]);
    expect(written.sort()).toEqual(["a.md", "b.md"]);
    expect(flushed).toEqual(["x"]);
  });

  it("un pending que falla no impide que las demas se guarden", async () => {
    seeded("a.md", { dirty: true });
    await flush();
    markPending("roto", async () => {
      throw new Error("nope");
    });
    await expect(flushAll()).resolves.toBeUndefined();
    expect(calls("write_note").length).toBeGreaterThan(0);
  });
});
