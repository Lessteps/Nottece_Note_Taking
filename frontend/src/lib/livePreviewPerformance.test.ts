// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { expect, it, vi } from "vitest";
const counters = vi.hoisted(() => ({ scans: 0 }));
vi.mock("./blockScan", async (load) => {
  const actual = await load<typeof import("./blockScan")>();
  return { ...actual, scanBlocks: (...args: Parameters<typeof actual.scanBlocks>) => { counters.scans++; return actual.scanBlocks(...args); } };
});
import { livePreviewBlocks } from "./livePreviewBlocks";
it("no vuelve a analizar 20 000 líneas durante la escritura normal", () => {
  counters.scans = 0;
  let state = EditorState.create({ doc: ("Línea normal con texto\n").repeat(20000), extensions: livePreviewBlocks });
  expect(counters.scans).toBe(1);
  for (let i = 0; i < 100; i++) state = state.update({ changes: { from: 5, insert: "a" } }).state;
  expect(counters.scans).toBe(1);
  state = state.update({ changes: { from: 5, insert: "|" } }).state;
  expect(counters.scans).toBe(2);
});
