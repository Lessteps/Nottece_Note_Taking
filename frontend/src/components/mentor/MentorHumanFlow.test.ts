import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "../../api/appState.js";
import { PlanStore } from "../../core/mentor/plan.js";
import { mentorApi } from "../../api/modules/mentor.js";
import { checkPlanVaultSync, reconcilePlanWithVault, resolveAndEnsureTopicAssets } from "../../core/mentor/topicIdResolver.js";
import { buildSchedule } from "../../lib/planSchedule.js";
import { evaluateAreaMethodology } from "../../lib/planAreas.js";
import { normalizeUrl } from "../../lib/webUrl.js";
import { MentorCalendarSource } from "../../core/mentor/mentorCalendarSource.js";

let dir: string;
let app: AppState;
let planStore: PlanStore;
const PLAN_ID = "2026-10-06_2027-04-05";

const BASE_PLAN = {
  id: PLAN_ID,
  start: "2026-10-06",
  end: "2027-04-05",
  structure: "areas" as const,
  areaMode: "together" as const,
  subplans: [
    {
      id: "backend",
      area: "Backend",
      areaId: "backend",
      objective: "Servidores y APIs",
      groups: [
        { id: "core", title: "Conocimientos de backend", kind: "knowledge" as const, order: 30 },
      ],
      phase: { fromWeek: 1, toWeek: 26 },
      topics: [
        { folder: "Programación/4 Backend/4.1 What the backend is", title: "4.1 What the backend is", estMinutes: 140, group: "core", targetWeek: 1 },
        { folder: "Programación/4 Backend/4.2 Clients and servers", title: "4.2 Clients and servers", estMinutes: 140, group: "core", targetWeek: 1 },
        { folder: "Programación/4 Backend/4.3 Protocols", title: "4.3 Protocols", estMinutes: 140, group: "core", targetWeek: 2 },
        { folder: "Programación/4 Backend/4.4 HTTP overview", title: "4.4 HTTP overview", estMinutes: 140, group: "core", targetWeek: 2 },
        { folder: "Programación/4 Backend/4.5 REST APIs", title: "4.5 REST APIs", estMinutes: 140, group: "core", targetWeek: 2 },
        { folder: "Programación/4 Backend/4.6 JSON format", title: "4.6 JSON format", estMinutes: 140, group: "core", targetWeek: 3 },
      ],
      weeks: [],
      requiredGoals: [],
    },
  ],
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv_human_flow_"));
  app = new AppState(dir);
  planStore = new PlanStore(dir);
  planStore.save(BASE_PLAN as never);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Mentor — Flujo completo de usuario (Áreas, Asignaturas, Temas, Calendario y Progresión)", () => {
  it("Flujo 1: Agregar nueva área, crear asignatura, agregar temas y modificar estado y calendario", () => {
    const api = mentorApi(app, vi.fn());

    // 1. Agregar una nueva área (ej. "DevOps")
    const createRes = api.mentor_plan_area_create({
      planId: PLAN_ID,
      name: "DevOps",
      objective: "CI/CD e infraestructura",
      fromWeek: 3,
      toWeek: 10,
    });
    expect(createRes.subplan.area).toBe("DevOps");
    expect(createRes.subplan.phase).toEqual({ fromWeek: 3, toWeek: 10 });

    // 2. Crear una nueva asignatura en DevOps ("Docker y Contenedores")
    const grpRes = api.mentor_plan_group_create({
      planId: PLAN_ID,
      subplanId: "devops",
      title: "Docker y Contenedores",
    });
    expect(grpRes.group.title).toBe("Docker y Contenedores");

    // 3. Agregar temas a la nueva asignatura
    const addRes = api.mentor_plan_subject_add_topics({
      planId: PLAN_ID,
      subplanId: "devops",
      groupId: grpRes.group.id,
      topics: [
        { title: "Introducción a Docker", estMinutes: 60 },
        { title: "Dockerfile y Buenas Prácticas", estMinutes: 90 },
      ],
    });
    expect(addRes.added).toBe(2);

    // 4. Modificar el estado y la semana objetivo de un tema
    const loadedPlan = planStore.load(PLAN_ID)!;
    const devopsSub = loadedPlan.subplans.find((s) => s.id === "devops")!;
    const topicToUpdate = devopsSub.topics[0]!;

    const updateTopicRes = api.mentor_plan_topic_update({
      planId: PLAN_ID,
      subplanId: "devops",
      folder: topicToUpdate.folder,
      targetWeek: 5,
      completed: true,
    });
    expect(updateTopicRes.topic.targetWeek).toBe(5);
    expect(updateTopicRes.topic.completedAt).toBeDefined();

    // 5. Modificar semanas del área en el calendario y verificar autosincronización
    const updateAreaRes = api.mentor_plan_area_update({
      planId: PLAN_ID,
      subplanId: "devops",
      fromWeek: 6,
      toWeek: 12,
    });
    expect(updateAreaRes.subplan.phase).toEqual({ fromWeek: 6, toWeek: 12 });
  });

  it("Flujo 2: Progresión dinámica en Modo Ejecución proyecta temas diferentes en días sucesivos", () => {
    const plan = planStore.load(PLAN_ID)!;
    const schedule = buildSchedule(plan as never);

    const studyDays = schedule.days.filter((d) => d.study && d.topics.length > 0);
    expect(studyDays.length).toBeGreaterThanOrEqual(3);

    const day1Topics = studyDays[0]!.topics.map((t) => t.folder);
    const day2Topics = studyDays[1]!.topics.map((t) => t.folder);

    // Gracias a la rotación de cola activa por bloques de estudio, el día 2 proyecta temas siguientes
    expect(day1Topics).not.toEqual(day2Topics);
  });

  it("Flujo 3: Resolución de temas por ID y reconciliación ante cambios en la estructura de carpetas de la vault", () => {
    // Simulamos que la carpeta de un tema cambió de nombre o estructura
    // De: Programación/4 Backend/4.1 What the backend is
    // A:  Backend/Fundamentos/4.1 What the backend is
    const newRelativeDir = "Backend/Fundamentos/4.1 What the backend is";
    const absNewDir = path.join(dir, newRelativeDir);
    fs.mkdirSync(absNewDir, { recursive: true });

    // Creamos la nota teórica con su frontmatter ID
    const mdContent = `---
id: programming.4-1-what-the-backend-is
number: "4.1"
title: "What the backend is"
---
# 4.1 What the backend is
Contenido de prueba.
`;
    fs.writeFileSync(path.join(absNewDir, "4.1 What the backend is.md"), mdContent, "utf-8");

    // 1. Resolver activos por ID
    const resolved = resolveAndEnsureTopicAssets(dir, {
      folder: "Programación/4 Backend/4.1 What the backend is",
      topicId: "programming.4-1-what-the-backend-is",
      ensureCanvas: false,
    });
    expect(resolved.found).toBe(true);
    expect(resolved.relocated).toBe(true);
    expect(resolved.folder).toBe(newRelativeDir);
    expect(resolved.theoryNote).toBe(`${newRelativeDir}/4.1 What the backend is.md`);

    // 2. Verificar detección de desincronización
    const plan = planStore.load(PLAN_ID)!;
    const syncStatus = checkPlanVaultSync(dir, plan as never);
    expect(syncStatus.needsSync).toBe(true);
    expect(syncStatus.relocatedCount).toBeGreaterThan(0);

    // 3. Reconciliar el plan
    const reconcileRes = reconcilePlanWithVault(dir, plan as never, { generateCanvases: false });
    expect(reconcileRes.changedPlan).toBe(true);
    const updatedSub = reconcileRes.plan.subplans.find((s) => s.id === "backend")!;
    expect(updatedSub.topics[0]!.folder).toBe(newRelativeDir);
  });

  it("Flujo 4: Funcionalidades añadidas (normalizeUrl, metodología HTML/CSS y MentorCalendarSource)", () => {
    // 1. Verificación de normalizeUrl
    expect(normalizeUrl("https://")).toBe("https://www.google.com");
    expect(normalizeUrl("")).toBe("https://www.google.com");
    expect(normalizeUrl("github.com")).toBe("https://github.com");

    // 2. Verificación de evaluateAreaMethodology
    const frontendSubplan = {
      id: "frontend",
      area: "Frontend",
      areaId: "frontend",
      topics: [
        { folder: "Programación/5 Frontend/5.1 Browser", title: "5.1 Browser", group: "core" },
        { folder: "Programación/5 Frontend/5.2 CSS", title: "5.2 CSS", group: "css" },
      ],
    };
    const warnings = evaluateAreaMethodology(frontendSubplan);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.groupId === "html")).toBe(true);
    expect(warnings.some((w) => w.groupId === "css")).toBe(true);

    // 3. Verificación de MentorCalendarSource
    const calSource = new MentorCalendarSource(dir);
    const occs = calSource.occurrences(new Date("2026-10-06"), new Date("2026-10-12"));
    expect(Object.keys(occs).length).toBeGreaterThan(0);
    const firstDayOccs = Object.values(occs)[0]!;
    expect(firstDayOccs.some((o) => o.kind === "integrated_block" || o.kind === "mentor_study")).toBe(true);
  });
});
