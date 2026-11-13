// @vitest-environment jsdom
//
// «Tareas externas (N)»: reabrir tras reiniciar las tareas para Antigravity / Claude Code guardadas en la vault.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { nv: unknown }).nv = { invoke: async () => ({}) };

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../../lib/bridge";
import * as clipboard from "../../lib/clipboard";
import type { RegenHandoff } from "../../lib/types";
import { useRegenEngine } from "../../store/regenEngine";
import { ExternalTasks } from "./ExternalTasks";

const task = (id: string, over: Partial<RegenHandoff> = {}): RegenHandoff => ({
  id, what: "theory", createdAt: "2026-10-23T10:20:30.000Z", task: `P/_handoff/regenerar/${id}.md`, taskAbs: `C:/v/${id}.md`, resultDir: "r", folder: "f",
  prompt: `Read ${id}.md and execute it.`, status: "waiting", log: [], ready: { found: 0, expected: 1 },
  topics: [{ folder: "P/A", title: "Tema A", backup: "b", state: "pending", done: [], problems: [], created: [], restored: false }], ...over,
});

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const byTest = (id: string) => host.querySelector<HTMLElement>(`[data-testid=${id}]`);

beforeEach(() => {
  useRegenEngine.setState({ handoffs: {} });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("ExternalTasks", () => {
  it("en el panel recupera una tarea pendiente y no permite ocultarla antes de validar", async () => {
    vi.spyOn(api, "studyTopicRegenerateHandoffList").mockResolvedValue([task("saved")]);
    await act(async () => { root.render(<ExternalTasks panel />); });
    await flush();
    expect(byTest("external-task")?.textContent).toContain("Tema A");
    expect(byTest("handoff-regen-validate")).not.toBeNull();
    expect(byTest("handoff-regen-close")).toBeNull();
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<ExternalTasks panel />); });
    await flush();
    expect(byTest("handoff-regen-validate")).not.toBeNull();
  });
  it("no aparece si no hay tareas guardadas", async () => {
    const list = vi.spyOn(api, "studyTopicRegenerateHandoffList").mockResolvedValue([]);
    await act(async () => { root.render(<ExternalTasks />); });
    await flush();
    expect(byTest("external-tasks")).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("lista las tareas con su estado (pendiente / validada), plegado al principio, y permite copiar y validar", async () => {
    vi.spyOn(api, "studyTopicRegenerateHandoffList").mockResolvedValue([task("h2"), task("h1", { status: "validated" })]);
    vi.spyOn(api, "studyTopicRegenerateHandoffStatus").mockResolvedValue(task("h2"));
    const validate = vi.spyOn(api, "studyTopicRegenerateValidate").mockResolvedValue(task("h2", { status: "validated" }));
    const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue(true);
    await act(async () => { root.render(<ExternalTasks />); });
    await flush(); await flush();
    expect(byTest("external-tasks-toggle")!.textContent).toContain("Tareas externas (2)");
    expect(byTest("external-tasks-list")).toBeNull();
    await act(async () => { byTest("external-tasks-toggle")!.click(); });
    const items = [...host.querySelectorAll<HTMLElement>("[data-testid=external-task]")];
    expect(items.map((i) => i.querySelector("[data-testid=external-task-status]")!.textContent)).toEqual(["pendiente", "validada"]);
    await act(async () => { items[0]!.querySelector<HTMLElement>("[data-testid=handoff-regen-copy]")!.click(); });
    expect(copy).toHaveBeenCalledWith("Read h2.md and execute it.");
    await act(async () => { items[0]!.querySelector<HTMLElement>("[data-testid=handoff-regen-validate]")!.click(); });
    await flush();
    expect(validate).toHaveBeenCalledWith("h2", false);
    expect(host.querySelectorAll("[data-testid=external-task]")[0]!.getAttribute("data-status")).toBe("validated");
  });
});
