import { describe, expect, it } from "vitest";
import { autoDistributeExercises, timeToMin, minToTime } from "./exerciseScheduler";
import type { Exercise } from "./types";

describe("exerciseScheduler", () => {
  it("timeToMin y minToTime convierten correctamente", () => {
    expect(timeToMin("11:00")).toBe(660);
    expect(minToTime(660)).toBe("11:00");
    expect(minToTime(660 + 80)).toBe("12:20");
  });

  it("distribuye 10 ejercicios dentro de 120 minutos (11:00 a 13:00) sin sobrepasar", () => {
    const mockExs: Exercise[] = [
      { id: "e1", day: "lunes", name: "Calentamiento", series_reps: "2 series", rest: "60 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e2", day: "lunes", name: "Bench Press", series_reps: "4x5", rest: "2-3 min", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e3", day: "lunes", name: "Pull-ups", series_reps: "4x6", rest: "2 min", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e4", day: "lunes", name: "Overhead Press", series_reps: "4x5", rest: "2 min", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e5", day: "lunes", name: "One-Arm Row", series_reps: "4x6", rest: "90 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e6", day: "lunes", name: "Face Pull", series_reps: "3x10", rest: "60 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e7", day: "lunes", name: "Triceps", series_reps: "3x8", rest: "60 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e8", day: "lunes", name: "Hammer Curl", series_reps: "3x8", rest: "60 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e9", day: "lunes", name: "Wrist Curl", series_reps: "3x12", rest: "45 seg", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
      { id: "e10", day: "lunes", name: "Estiramientos", series_reps: "8-10 min", rest: "—", video: "", video_path: "", how_to: "", has_video: false, video_name: "", muscles: { primary: [], secondary: [] } },
    ];

    const sched = autoDistributeExercises(mockExs, "11:00", 120);

    expect(sched["e1"]!.time).toBe("11:00");
    const last = sched["e10"]!;
    const endMin = timeToMin(last.end_time);
    expect(endMin).toBeLessThanOrEqual(13 * 60);

    // Verificar que cada ejercicio empieza después del anterior + descanso
    let prevEnd = timeToMin(sched["e1"]!.end_time) + (sched["e1"]!.rest_min || 0);
    for (let i = 1; i < mockExs.length; i++) {
      const it = sched[mockExs[i]!.id]!;
      expect(timeToMin(it.time)).toBe(prevEnd);
      prevEnd = timeToMin(it.end_time) + (it.rest_min || 0);
    }
  });
});

