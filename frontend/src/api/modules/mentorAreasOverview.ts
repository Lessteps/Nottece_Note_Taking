// Mentor — «Áreas»: un índice de SOLO LECTURA del avance por espacio de estudio, área y tema, independiente de cualquier plan.
//
//  - mentor_areas_overview({ level?, space?, area? }) -> { level, rows, loading? }: UNA llamada por nivel con filas compactas.
//      level "spaces" (por defecto): una fila por espacio (primer segmento de la carpeta de los temas).
//      level "areas"  (con `space`): una fila por área del espacio.
//      level "topics" (con `space` y `area`): una fila por tema del área.
//    Reutiliza los datos del panel de estudio (`study_topic_dashboard`, el ledger de intentos y los repasos): no escribe nada ni guarda estado propio
//    salvo una caché de las filas, que se tira cuando el panel de estudio renueva sus datos.

import { loadAllAttempts } from "../../core/practice/ledger.js";
import { listReviews } from "../../core/practice/reviewFiles.js";
import { allAreaRows, areaRows, spaceRows, topicRows, topicsOf, type AreasLevel, type TopicDashboardItem, type TopicRow } from "../../lib/mentorAreasOverview.js";
import type { AppState } from "../appState.js";
import { vaultScan } from "../vaultScan.js";
import { studyApi } from "./study.js";

const isoToday = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

export function mentorAreasOverviewApi(app: AppState) {
  const study = studyApi(app);
  // las filas se rehacen solo cuando el panel de estudio devuelve un objeto nuevo (se invalida al escribir) o cambia el día
  let cache: { src: unknown; today: string; rows: TopicRow[] } | null = null;

  const lastByFolder = (items: ReadonlyArray<TopicDashboardItem>): Map<string, string> => {
    const out = new Map<string, string>();
    let scan: ReturnType<typeof vaultScan>;
    try {
      scan = vaultScan(app);
    } catch {
      return out;
    }
    const attempts = loadAllAttempts(app.root);
    const folderSet = new Set(items.map((i) => i.folder.replace(/[\\]/g, "/")));
    for (const ex of scan.exercises) {
      const p = String(ex.rel || ex.path).replace(/[\\]/g, "/");
      const entry = attempts[String(ex.note_id)];
      const list: Array<{ at?: unknown }> = Array.isArray(entry) ? entry : entry?.attempts ?? [];
      let last = "";
      for (const a of list) {
        const at = String(a.at ?? "").slice(0, 10);
        if (at > last) last = at;
      }
      if (!last) continue;
      // O(depth) lookup walking parent segments instead of O(folders) linear scan per exercise
      let cur = p;
      let idx = cur.lastIndexOf("/");
      while (idx > 0) {
        cur = cur.slice(0, idx);
        if (folderSet.has(cur)) {
          if (last > (out.get(cur) ?? "")) out.set(cur, last);
          break;
        }
        idx = cur.lastIndexOf("/");
      }
    }
    return out;
  };

  const rowsNow = async (): Promise<{ rows: TopicRow[]; loading: boolean }> => {
    const data = (await study.study_topic_dashboard()) as { topics: TopicDashboardItem[]; loading?: boolean };
    if (data.loading) return { rows: [], loading: true };
    const today = isoToday();
    if (cache && cache.src === data && cache.today === today) return { rows: cache.rows, loading: false };
    let reviews: Array<{ topicPath: string; next: string; inDays: number }> = [];
    try {
      reviews = listReviews(app.root, today);
    } catch {
      /* sin repasos legibles: el índice sigue valiendo */
    }
    const rows = topicRows({ items: data.topics, reviews, lastByFolder: lastByFolder(data.topics) });
    cache = { src: data, today, rows };
    return { rows, loading: false };
  };

  return {
    async mentor_areas_overview(opts?: unknown) {
      const o = (opts && typeof opts === "object" ? opts : {}) as Record<string, unknown>;
      const level: AreasLevel = o.level === "areas" || o.level === "topics" ? o.level : "spaces";
      const space = String(o.space ?? "");
      const area = String(o.area ?? "");
      const { rows, loading } = await rowsNow();
      const base = loading ? { loading: true as const } : {};
      if (level === "areas") return { level, space, rows: areaRows(rows, space), ...base };
      if (level === "topics") return { level, space, area, rows: topicsOf(rows, space, area), ...base };
      return { level, rows: spaceRows(rows), areas: allAreaRows(rows), ...base };
    },
  };
}
