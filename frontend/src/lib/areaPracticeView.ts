// Lo que el renderer ve del Sistema de práctica por área (`mentor_area_practice`): tipos puros compartidos entre la API y la pestaña «Práctica».
// El estado se deriva en `core/mentor/areaPracticeState.ts`.

import type { AreaSkill } from "./planAreaPractice.js";
import type { AreaKata, KataLevel } from "./areaPracticeSystem.js";

export interface AreaSkillProgress {
  id: string;
  name: string;
  why: string;
  measure: string;
  levels: AreaSkill["levels"];
  /** katas de esta habilidad ya hechos / que tocaban hasta hoy */
  done: number;
  planned: number;
  pct: number;
}

export interface AreaWeekDay {
  date: string;
  /** 1 = lunes … 7 = domingo */
  dow: number;
  planned: boolean;
  state: "done" | "skipped" | "pending" | "none";
  today: boolean;
  /** nº de kata del área ese día */
  index?: number;
}

export interface AreaWeeklyRow {
  week: number;
  start: string;
  end: string;
  title: string;
  /** habilidades que practican los katas de esa semana */
  skills: string[];
  /** el proyecto full stack de esa semana tiene el foco en esta área */
  focus: boolean;
  current: boolean;
  doneKatas: number;
  katas: number;
}

/** Un kata que tocaba hasta hoy (el de hoy y los atrasados): lo que el panel del área lista, no solo el de hoy. */
export interface AreaKataDue {
  day: number;
  date: string;
  state: "done" | "skipped" | "pending";
  today: boolean;
  title: string;
  skillName: string;
  level: KataLevel;
  minutes: number;
  summary: string;
  rel: string;
  fileReady: boolean;
}

export interface AreaPracticeView {
  areaId: string;
  label: string;
  /** carpeta del área dentro de `programming_practice` */
  folder: string;
  /** la carpeta del área ya existe en la vault */
  folderReady: boolean;
  purpose: string;
  name: string;
  languages: string[];
  ledgerSkill: string;
  level: KataLevel;
  levelSource: "declared" | "measured";
  skills: AreaSkillProgress[];
  kata: {
    plannedDays: number;
    doneDays: number;
    /** índices de retos completados, para conservar su identidad al avanzar fuera de orden */
    completedIndices?: number[];
    streak: number;
    todayPlanned: boolean;
    todayDone: boolean;
    todayIndex: number;
    /** el kata de hoy (o el siguiente que toca) con su ruta en la vault */
    next: { kata: AreaKata; date: string; rel: string; fileReady: boolean; summary: string } | null;
    week: AreaWeekDay[];
    /** ¿se puede saltar un kata? Solo con el 70 % de los katas que tocaban hasta hoy hechos y verificados */
    skip: { allowed: boolean; pct: number; neededPct: number };
    /** los katas de hoy y los atrasados (pendientes o saltados), con hoy primero y luego del más antiguo al más reciente */
    due: AreaKataDue[];
    /** fechas de katas que ya se hicieron ADELANTADOS (en otro día): en su fecha original ya no se listan ni cuentan */
    consumed: string[];
  };
  weekly: { title: string; description: string; week: number | null; focus: boolean };
  weeks: AreaWeeklyRow[];
  monthly: { title: string; description: string; blocks: Array<{ fromWeek: number; toWeek: number; theme?: string }> };
}

