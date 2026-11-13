import { create } from "zustand";

const PROOF_TYPES = new Set([
  "theorem",
  "teorema",
  "proof",
  "demostracion",
  "lemma",
  "lema",
  "proposition",
  "proposicion",
  "corollary",
  "corolario",
]);

/** A theorem note the ladder may practise (Python checks it has steps). */
export function isProofNote(fm: Record<string, unknown> | undefined): boolean {
  const t = String(fm?.type ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return PROOF_TYPES.has(t);
}

/** Notes currently shown as a ladder instead of their text. */
export const useLadder = create<{ open: Set<string>; set: (path: string, on: boolean) => void }>((set) => ({
  open: new Set(),
  set: (path, on) =>
    set((s) => {
      const open = new Set(s.open);
      if (on) open.add(path);
      else open.delete(path);
      return { open };
    }),
}));

