// Shared cached topic progress for Mentor and generation prompts.
import { examSlug, listExamRecords } from "../../core/practice/exams.js";
import { loadAllAttempts } from "../../core/practice/ledger.js";
import { manifestsFromNotes, type TopicManifest } from "../../core/practice/topic.js";
import { snapshotTopics, type TopicSnap } from "../../core/mentor/topics.js";
import { vaultScan } from "../vaultScan.js";
import { cachedTopicSnaps } from "./topicSnapCache.js";
import type { AppState } from "../appState.js";

/**
 * Foto de todos los temas de la vault (misma fuente que `study_topic_dashboard`). Se reutiliza mientras no cambien el escaneo de la vault ni los
 * intentos y exámenes en disco (ver `topicSnapCache.ts`): el Mentor la pide en cada cambio de vista.
 */
export function topicSnaps(app: AppState): TopicSnap[] {
  const scan = vaultScan(app);
  return cachedTopicSnaps(app.root, scan, () => buildTopicSnaps(app, scan)).slice();
}

function buildTopicSnaps(app: AppState, scan: ReturnType<typeof vaultScan>): TopicSnap[] {
  const byFolder = new Map<string, { folder: string; manifest: TopicManifest }>();
  for (const found of manifestsFromNotes(scan.notes)) {
    const folder = app.rel(found.topicFolder).replace(/\\/g, "/");
    if (!byFolder.has(folder)) {
      byFolder.set(folder, { folder, manifest: { ...found.manifest, path: app.rel(found.manifestPath), folder } });
    }
  }
  const examMap = new Map<string, any>();
  for (const rec of listExamRecords(app.root)) {
    examMap.set(examSlug(rec.topic_or_group), rec);
  }
  const examFor = (manifest: TopicManifest) => {
    const byTitle = examMap.get(examSlug(manifest.title));
    if (byTitle?.passed) return byTitle;
    if (manifest.exam_group) {
      const byGroup = examMap.get(examSlug(manifest.exam_group));
      if (byGroup?.passed) return byGroup;
      if (byGroup && !byTitle) return byGroup;
    }
    return byTitle ?? null;
  };
  const snaps = snapshotTopics({
    manifests: [...byFolder.values()],
    exercises: scan.exercises,
    attempts: loadAllAttempts(app.root),
    noteRels: scan.notes.map((n) => n.rel),
    examFor,
  });
  return snaps;
}

