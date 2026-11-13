import { create } from "zustand";

/** Bumped when an attempt is recorded, so the study panel re-reads its area. */
export const useStudyVersion = create<{ v: number; bump: () => void }>((set) => ({
  v: 0,
  bump: () => set((s) => ({ v: s.v + 1 })),
}));

