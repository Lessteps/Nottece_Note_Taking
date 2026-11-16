// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DailyAreaPractice } from "./DailyAreaPractice";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const statusState = vi.hoisted(() => ({ value: "en_curso" }));
vi.mock("./AreaPracticeBlock", () => ({ AreaPracticeBlock: ({ area }: any) => <div>Retos: {area.label}</div> }));
vi.mock("../../lib/areaPracticeSystem", () => ({ areaKataDates: () => ["2026-11-14", "2026-11-15"], kataForDay: (_a: string, n: number) => ({ title: `Kata ${n}` }) }));
vi.mock("../../lib/planChain", () => ({ chainSignalsOf: () => ({}), planChain: () => ({ months: [{ id: "m1", status: statusState.value, n: 1, start: "2026-11-01", end: "2026-11-30", title: "API mensual", goal: "Construir API", pct: 50, weeks: [{ id: "w1", week: 1, start: "2026-11-10", end: "2026-11-16", title: "API semanal", slice: "Primera parte", pct: 50, pieces: [{ id: "p1", areaIds: ["backend"], title: "Crear endpoint", date: "2026-11-14", done: true, slice: "Primer paso" }] }] }, { id: "m2", n: 2, status: "pendiente", title: "Proyecto siguiente", weeks: [] }] }) }));
afterEach(() => { document.body.innerHTML = ""; });
it("separa la vista informativa del mapa de prácticas y conserva el área elegida", async () => {
 const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
 const practice = { data: { areas: [{ areaId: "backend", label: "Backend", folderReady: true, level: 1, kata: { consumed: [], completedIndices: [1] } }, { areaId: "frontend", label: "Frontend", folderReady: true, level: 1, kata: { consumed: [], completedIndices: [] } }] }, loading: false, error: "", reload: vi.fn(), mark: vi.fn() };
 await act(async () => { root.render(<DailyAreaPractice plan={{ id: "p" } as never} data={{} as never} m={{ schedule: { byDate: new Map() }, today: "2026-11-14" } as never} practice={practice as never} onProjects={vi.fn()} />); });
 const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
 expect(host.textContent).toContain("Retos: Backend"); expect(host.querySelector('[data-testid="daily-practice-map"]')).toBeNull();
 expect(host.querySelector('[data-testid="daily-informative-projects"]')?.textContent).toContain("API mensual");
 await act(async () => button("Frontend").click()); expect(host.textContent).toContain("Retos: Frontend");
 await act(async () => button("Vista interactiva").click());
 expect(host.querySelector('[data-testid="daily-practice-map"]')).toBeTruthy(); expect(host.textContent).not.toContain("Retos: Frontend");
 expect(host.querySelectorAll('[data-testid="daily-map-node"]')).toHaveLength(4);
 expect(host.querySelectorAll('[data-testid="daily-map-project"]')).toHaveLength(1);
 expect(host.querySelectorAll('[data-testid="daily-map-week"]')).toHaveLength(1);
 expect(host.querySelectorAll('[data-testid="daily-map-edge"]')).toHaveLength(7);
 expect(host.querySelectorAll('[data-testid="daily-map-area-node"]')).toHaveLength(2);
 expect(button("Mes 2").disabled).toBe(true);
 expect(host.querySelector('[data-testid="daily-map-project"]')?.textContent).not.toContain("Proyecto siguiente");
 expect(host.querySelector('[data-testid="daily-map-week"]')?.textContent).toContain("API semanal");
 expect(host.querySelector('[data-testid="daily-map-project"]')?.textContent).toContain("API mensual");
 expect(host.querySelector('[data-testid="daily-map-detail"]')?.textContent).toContain("Frontend");
 expect(host.querySelector('[data-testid="daily-map-linked-project"]')?.textContent).toContain("API mensual");
 expect(host.querySelector('[data-testid="daily-map-linked-project"]')?.textContent).toContain("API semanal");
 expect(host.querySelector('[data-testid="daily-map-unlinked"]')).toBeNull();
 await act(async () => (host.querySelector('[data-area="backend"]') as HTMLButtonElement).click());
 await act(async () => (host.querySelector('[data-testid="daily-map-node"]') as HTMLButtonElement).click());
 expect(host.querySelector('[data-testid="daily-map-linked-project"]')?.textContent).toContain("API mensual");
 expect(host.querySelector('[data-testid="daily-map-linked-project"]')?.textContent).toContain("Crear endpoint");
 expect(host.querySelector('[data-testid="daily-map-linked-project"]')?.textContent).toContain("API semanal");
 await act(async () => (host.querySelector('[data-testid="daily-map-week"]') as HTMLButtonElement).click());
 expect(host.querySelectorAll('[data-testid="daily-map-node"]')).toHaveLength(4);
 expect([...host.querySelectorAll('[data-testid="daily-map-node"]')].every((n) => n.getAttribute("aria-label")?.includes("Kata"))).toBe(true);
 expect(host.textContent).not.toContain("2026-11-14");
 statusState.value = "hecho";
 await act(async () => { root.render(<DailyAreaPractice plan={{ id: "p" } as never} data={{} as never} m={{ schedule: { byDate: new Map() }, today: "2026-11-14" } as never} practice={practice as never} onProjects={vi.fn()} />); });
 expect(button("Mes 2").disabled).toBe(false);
 await act(async () => button("Mes 2").click());
 expect(host.querySelector('[data-testid="daily-map-project"]')?.textContent).toContain("Proyecto siguiente");
 await act(async () => button("Vista informativa").click()); expect(host.textContent).toContain("Retos: Backend");
 act(() => root.unmount());
});

it("genera los meses a partir de las fechas reales del plan e incluye meses adicionales si la ruta añade más práctica", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  const practice = { data: { areas: [{ areaId: "backend", label: "Backend", folderReady: true, level: 1, kata: { consumed: [], completedIndices: [1] } }] }, loading: false, error: "", reload: vi.fn(), mark: vi.fn() };
  // Plan de 3 meses: noviembre 2026 a enero 2027 (el mock de planChain solo devuelve 2 meses, m1 y m2)
  const plan = { id: "p-3m", start: "2026-11-01", end: "2027-01-31" };
  const schedule = {
    days: [
      { date: "2026-11-15", week: 1 },
      { date: "2026-12-15", week: 5 },
      { date: "2027-01-15", week: 9 },
    ],
    byDate: new Map(),
  };

  await act(async () => {
    root.render(
      <DailyAreaPractice
        plan={plan as never}
        data={{} as never}
        m={{ schedule, today: "2026-11-14" } as never}
        practice={practice as never}
        onProjects={vi.fn()}
      />
    );
  });

  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(text));

  // Cambiar a vista interactiva
  await act(async () => button("Vista interactiva")?.click());

  // Debe tener los 3 meses reales del plan
  const nav = host.querySelector('nav[aria-label="Elegir mes del proyecto"]');
  expect(nav).toBeTruthy();
  expect(button("Mes 1")).toBeTruthy();
  expect(button("Mes 2")).toBeTruthy();
  expect(button("Mes 3")).toBeTruthy();

  // No debe tener emojis de candado "🔒", sino diseño limpio
  expect(nav?.textContent).not.toContain("🔒");

  // Botón para añadir mes de práctica disponible en la ruta
  const addMonthBtn = button("Añadir mes");
  expect(addMonthBtn).toBeTruthy();

  act(() => root.unmount());
});

it("garantiza que todas las prácticas diarias tienen proyecto vinculado sin cuadrículas huérfanas ni prácticas sin vincular", async () => {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
  const practice = {
    data: {
      areas: [
        { areaId: "backend", label: "Backend", folderReady: true, level: 1, kata: { consumed: [], completedIndices: [] } },
        { areaId: "frontend", label: "Frontend", folderReady: true, level: 1, kata: { consumed: [], completedIndices: [] } }
      ]
    },
    loading: false,
    error: "",
    reload: vi.fn(),
    mark: vi.fn()
  };
  await act(async () => {
    root.render(
      <DailyAreaPractice
        plan={{ id: "p-all-linked" } as never}
        data={{} as never}
        m={{ schedule: { byDate: new Map() }, today: "2026-11-14" } as never}
        practice={practice as never}
        onProjects={vi.fn()}
      />
    );
  });
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  await act(async () => button("Vista interactiva").click());

  // En ningún caso debe existir "Prácticas sin proyecto vinculado" ni el mensaje de error de desvinculación
  expect(host.textContent).not.toContain("Prácticas sin proyecto vinculado");
  expect(host.querySelector('[data-testid="daily-map-unlinked"]')).toBeNull();

  // El detalle debe mostrar la vinculación explícita al proyecto semanal y mensual
  const linkedSection = host.querySelector('[data-testid="daily-map-linked-project"]');
  expect(linkedSection).toBeTruthy();
  expect(linkedSection?.textContent).toContain("API mensual");
  expect(linkedSection?.textContent).toContain("API semanal");
  expect(linkedSection?.textContent).not.toContain("Esta práctica todavía no tiene una aportación");

  // El aviso inferior se puede minimizar para que no ocupe espacio innecesario
  const toggleBtn = host.querySelector('[data-testid="daily-map-detail-toggle"]') as HTMLButtonElement;
  expect(toggleBtn).toBeTruthy();
  expect(toggleBtn.textContent).toContain("Minimizar");
  await act(async () => toggleBtn.click());
  expect(toggleBtn.textContent).toContain("Proyecto");
  expect(host.querySelector('[data-testid="daily-map-linked-project"]')).toBeNull();
  await act(async () => toggleBtn.click());
  expect(host.querySelector('[data-testid="daily-map-linked-project"]')).toBeTruthy();

  act(() => root.unmount());
});
