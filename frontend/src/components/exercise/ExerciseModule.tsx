// Ejercicio: la rutina por días, el registro diario y el catálogo.
//
// La estructura imita la de Hábitos a propósito: pestañas de periodo, el panel
// de estadísticas al pie de la barra lateral y los dashboards circulares en la
// vista general.

import { useEffect, useState } from "react";
import {
  CalendarRange,
  ChevronLeft,
  Dumbbell,
  ExternalLink,
  LayoutGrid,

  X,
} from "lucide-react";
import { api } from "../../lib/bridge";
import { todayIso } from "../../lib/tasks";
import { useExercise } from "../../store/exercise";
import { usePersistedNav } from "../../store/navState";
import type { Exercise } from "../../lib/types";
import { ModuleSidebar } from "../ModuleSidebar";
import { useFail } from "./parts";

import { Exercises } from "./Exercises";
import { Overview } from "./Overview";
import { Progress } from "./Progress";
import { RestTimerBar } from "./RestTimerBar";
import { SideStats } from "./parts";
import { WorkoutTimerModal } from "./WorkoutTimerModal";
import { WorkoutTimerBar } from "./WorkoutTimerBar";

/** El reproductor del módulo: el video se ajusta a la tarjeta, sin desbordar. */
function VideoPlayer({ ex, onBack }: { ex: Exercise; onBack: () => void }) {
  const fail = useFail();
  const [src, setSrc] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    api.exVideoUrl(ex.id).then(setSrc).catch((e) => {
      fail(e);
      onBack();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
      <div className="flex items-center gap-2">
        <GhostBack onBack={onBack} />
        <span className="text-[15px] font-semibold text-text">{ex.name}</span>
        <span className="flex-1" />
        <GhostButton onClick={() => void api.exOpenVideo(ex.id).catch(fail)}>
          <ExternalLink size={13} /> Abrir en el reproductor del sistema
        </GhostButton>
      </div>
      {/* El video se letterboxea dentro de la tarjeta: `object-contain` sobre una
          caja que mide exactamente el marco evita que un clip 4:3 se salga. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
        {src && <video key={src.url} src={src.url} controls autoPlay className="h-full w-full object-contain" />}
      </div>
      <div className="flex flex-wrap gap-4 text-[12.5px] text-dim">
        {ex.series_reps && <span>📊 {ex.series_reps}</span>}
        {ex.rest && <span>⏱ {ex.rest}</span>}
        <span className="text-faint">{src?.name}</span>
      </div>
      {ex.how_to && <p className="text-[12.5px] leading-relaxed text-dim">{ex.how_to}</p>}
    </div>
  );
}

function GhostBack({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1 rounded-lg border border-transparent px-1.5 py-1.5 text-[12.5px] text-dim hover:bg-hover hover:text-text"
    >
      <ChevronLeft size={14} /> Volver
    </button>
  );
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-dim hover:bg-hover hover:text-text"
    >
      {children}
    </button>
  );
}

export function ExerciseModule() {
  const load = useExercise((s) => s.load);
  const loaded = useExercise((s) => s.loaded);
  const error = useExercise((s) => s.error);
  const list = useExercise((s) => s.list);
  const stats = useExercise((s) => s.stats);
  // Su vista interna (general / diaria / …) se recuerda entre pestañas.
const [storedView, setView] = usePersistedNav("ejercicio.view", "general");
  const [video, setVideo] = useState<Exercise | null>(null);
  // El día abierto en Vista general. Vive aquí y no en `Overview` para dos
  // cosas: las flechas sobreviven a un cambio de pantalla, y «Ir a hoy» desde
  // Tu programa puede volver a él.
  const [date, setDate] = useState(() => todayIso());
  // La barra lateral se colapsa a solo iconos: en pantallas estrechas los
  // anillos del SideStats se apilan en vertical (una columna).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Antes el módulo tenía semanal/mensual/anual sueltos y biblioteca y gestión
  // por separado. Quien tenga una de esas vistas guardadas cae en la general en
  // vez de quedarse en una pantalla que ya no existe.
  const VIEWS = ["general", "progreso", "ejercicios"];
  const view = VIEWS.includes(storedView) ? storedView : "general";

  useEffect(() => {
    void load();
  }, [load]);

  const pendingToday = stats ? Math.max(0, stats.today.total - stats.today.done) : 0;

  // El programa es el molde y Vista general la sesión del día que tengas
  // abierto. Estos dos atajos hacen el viaje entre ellas sin pasar por el
  // sidebar.
  const goToday = () => {
    setDate(todayIso());
    setView("general");
    setVideo(null);
  };
  const goProgram = () => {
    setView("ejercicios");
    setVideo(null);
  };

  return (
    <div className="flex min-w-0 flex-1">
      <ModuleSidebar
        title="Ejercicio"
        active={view}
        collapsible
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        onSelect={(id) => {
          setView(id);
          setVideo(null);
        }}
        items={[
          { id: "general", label: "Vista general", hint: "Rachas y la sesión del día", icon: <LayoutGrid />, badge: pendingToday },
          { id: "progreso", label: "Progreso", hint: "Rejilla · músculos · año", icon: <CalendarRange /> },
          { id: "ejercicios", label: "Ejercicios", hint: `${list.length} en la rutina · 302 en la biblioteca`, icon: <Dumbbell /> },
        ]}
      >
        <SideStats collapsed={sidebarCollapsed} />
      </ModuleSidebar>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {video ? (
          <VideoPlayer ex={video} onBack={() => setVideo(null)} />
        ) : !loaded ? (
          <div className="grid flex-1 place-items-center text-[13px] text-faint">Cargando ejercicios…</div>
        ) : error ? (
          <div className="grid flex-1 place-items-center text-[13px] text-danger">{error}</div>
        ) : view === "general" ? (
          <Overview date={date} onDate={setDate} onGoProgram={goProgram} onVideo={setVideo} />
        ) : view === "progreso" ? (
          <Progress />
        ) : (
          <Exercises onGoToday={goToday} />
        )}
      </main>
      <RestTimerBar />
      <WorkoutTimerBar />
      <WorkoutTimerModal />
    </div>
  );
}

export { X };