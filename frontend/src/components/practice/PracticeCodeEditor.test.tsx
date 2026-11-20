// @vitest-environment jsdom
// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const okRun = {
  ok: true,
  stdout: "Result: 42\n",
  stderr: "",
  exit_code: 0,
  ms: 15,
  timed_out: false,
  truncated: false,
  runtime: "Python 3.13",
};

const invoke = vi.fn(async (method: string, ..._args: unknown[]) => {
  if (method === "code_run") return okRun;
  return {};
});
(window as unknown as { nv: unknown }).nv = { invoke: (m: string, a: unknown[]) => invoke(m, ...(a ?? [])) };

import { PracticeCodeEditor } from "./PracticeCodeEditor";

let container: HTMLElement;
let root: Root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (re: RegExp) => [...container.querySelectorAll("button")].find((b) => re.test(`${b.textContent} ${b.title}`))!;

beforeEach(() => {
  invoke.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PracticeCodeEditor", () => {
  it("renders code editor with line numbers and language badge", async () => {
    const code = "def add(a, b):\n    return a + b\n";
    act(() => {
      root.render(
        <PracticeCodeEditor
          value={code}
          onChange={vi.fn()}
          language="python"
          mode="implement"
        />,
      );
    });
    await flush();

    expect(container.textContent).toContain("Python");
    expect(container.textContent).toContain("Modo: implement");
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe(code);
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("2");
  });

  it("loads starter code into empty editor on click", async () => {
    const onChange = vi.fn();
    const starter = "def format_status():\n    pass";

    act(() => {
      root.render(
        <PracticeCodeEditor
          value=""
          onChange={onChange}
          language="python"
          starterCode={starter}
          mode="refactor"
        />,
      );
    });
    await flush();

    const loadBtn = button(/Cargar código del enunciado/);
    expect(loadBtn).toBeDefined();
    act(() => loadBtn.click());
    await flush();

    expect(onChange).toHaveBeenCalledWith(starter);
  });

  it("executes code via api.codeRun and displays stdout in live console", async () => {
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="print('Result: 42')"
          onChange={vi.fn()}
          language="python"
          mode="implement"
        />,
      );
    });
    await flush();

    const execBtn = button(/Ejecutar/);
    expect(execBtn).toBeDefined();
    act(() => execBtn.click());
    await flush();

    expect(invoke).toHaveBeenCalledWith("code_run", "python", "print('Result: 42')", "");
    expect(container.textContent).toContain("Result: 42");
    expect(container.textContent).toContain("Exit 0");
    expect(container.textContent).toContain("15ms");
  });

  it("displays stderr when code execution fails", async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      stdout: "",
      stderr: "SyntaxError: invalid syntax",
      exit_code: 1,
      ms: 10,
      timed_out: false,
      truncated: false,
      runtime: "python",
    });

    act(() => {
      root.render(
        <PracticeCodeEditor
          value="def oops("
          onChange={vi.fn()}
          language="python"
          mode="debug"
        />,
      );
    });
    await flush();

    const execBtn = button(/Ejecutar/);
    act(() => execBtn.click());
    await flush();

    expect(container.textContent).toContain("SyntaxError: invalid syntax");
    expect(container.textContent).toContain("Exit 1");
  });

  it("illuminates syntax tokens for Python, TypeScript, Java, and JavaScript", async () => {
    // Python test
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="def calculate(total: int) -> bool:\n    return True"
          onChange={vi.fn()}
          language="Python 3.12"
        />,
      );
    });
    await flush();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("def");

    // TypeScript test
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="interface User { name: string; age: number; }"
          onChange={vi.fn()}
          language="TypeScript 5 in strict mode"
        />,
      );
    });
    await flush();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("interface");

    // Java test
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="public class Solution { public static void main(String[] args) {} }"
          onChange={vi.fn()}
          language="Java 17"
        />,
      );
    });
    await flush();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("public");

    // JavaScript test
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="const add = (a, b) => a + b;"
          onChange={vi.fn()}
          language="modern JavaScript (ES2023, no types)"
        />,
      );
    });
    await flush();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("handles smart backspace on soft tab indentation", async () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="    "
          onChange={onChange}
          language="python"
        />,
      );
    });
    await flush();

    const textarea = container.querySelector("textarea")!;
    textarea.selectionStart = textarea.selectionEnd = 4;
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
      );
    });
    await flush();

    // Deleted all 4 spaces at once instead of leaving 3 spaces
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("deletes matching auto-closed bracket pair on backspace", async () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="foo()"
          onChange={onChange}
          language="python"
        />,
      );
    });
    await flush();

    const textarea = container.querySelector("textarea")!;
    // Cursor between ( and )
    textarea.selectionStart = textarea.selectionEnd = 4;
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
      );
    });
    await flush();

    // Deletes both '(' and ')'
    expect(onChange).toHaveBeenCalledWith("foo");
  });

  it("auto-closes brackets when typing opening pair", async () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PracticeCodeEditor
          value="def bar"
          onChange={onChange}
          language="python"
        />,
      );
    });
    await flush();

    const textarea = container.querySelector("textarea")!;
    textarea.selectionStart = textarea.selectionEnd = 7;
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "(", bubbles: true, cancelable: true }),
      );
    });
    await flush();

    // Auto-inserts matching closing bracket
    expect(onChange).toHaveBeenCalledWith("def bar()");
  });
});
