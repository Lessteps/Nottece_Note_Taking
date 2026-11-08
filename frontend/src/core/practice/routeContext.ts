/**
 * Where a topic sits in its route: the topics of the same area folder that come BEFORE it (natural order of their numbers).
 * The practice planner and the exercise generator use it so they never ask about something that is taught later
 * (no functions or classes in «2.1.1 Project structure…»).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { archetypeOf, numberOf, type PracticeArchetype } from "./programmingArchetype.js";

const cmpNumber = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
};

/** Titles of the topics before `topicAbs` in its area folder (at most `limit`, the closest ones last). Never throws. */
export function taughtBeforeOf(topicAbs: string, limit = 30): string[] {
  try {
    const name = path.basename(topicAbs);
    const own = numberOf(name);
    if (!own) return [];
    const siblings = fs
      .readdirSync(path.dirname(topicAbs), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_"))
      .map((d) => d.name)
      .filter((n) => numberOf(n) && n !== name && cmpNumber(numberOf(n), own) < 0)
      .sort((a, b) => cmpNumber(numberOf(a), numberOf(b)));
    return siblings.slice(-limit);
  } catch {
    return [];
  }
}

/** Archetype + route context of a programming topic folder. */
export function routeContextOf(topicAbs: string, title: string, topicType?: string): { archetype: PracticeArchetype; taughtBefore: string[] } {
  const taughtBefore = taughtBeforeOf(topicAbs);
  return { archetype: archetypeOf({ title: title || path.basename(topicAbs), topicType, taughtBefore }), taughtBefore };
}

