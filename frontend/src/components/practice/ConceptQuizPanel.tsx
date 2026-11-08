// Interactive quiz and true/false assessment panel for conceptual programming exercises.
// Parses statement lines into structured questions and updates the answer text with selections and justifications.

import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, HelpCircle, ToggleLeft, PenLine } from "lucide-react";
import { cn } from "../ui";

export interface QuizQuestion {
  id: number;
  prompt: string;
  kind: "multiple_choice" | "true_false";
  options: Array<{ letter: string; text: string }>;
}

export function parseStatementQuestions(statement: string, isTrueFalse: boolean): QuizQuestion[] {
  const lines = statement.split("\n").map((l) => l.trim());
  const questions: QuizQuestion[] = [];
  let current: Partial<QuizQuestion> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;

    // Detect question start: "1. What is..." or "**1.** ..." or "1) ..."
    const qMatch = /^(\*\*|\b)?(\d+)[\.\)](\*\*)?\s+(.*)/.exec(line);
    // Avoid mistaking code comments or options for question headers
    const optMatch = /^([A-Da-d])[\.\)]\s+(.*)/.exec(line);

    if (qMatch && !optMatch) {
      if (current && current.prompt) {
        questions.push(current as QuizQuestion);
      }
      const qNum = parseInt(qMatch[2]!, 10);
      current = {
        id: qNum,
        prompt: qMatch[4]!.replace(/\*\*/g, "").trim(),
        kind: isTrueFalse ? "true_false" : "multiple_choice",
        options: [],
      };
      continue;
    }

    if (optMatch && current && current.kind === "multiple_choice") {
      current.options = current.options || [];
      current.options.push({
        letter: optMatch[1]!.toUpperCase(),
        text: optMatch[2]!.trim(),
      });
      continue;
    }

    // Accumulate multi-line prompt if no options started yet
    if (current && (!current.options || current.options.length === 0)) {
      if (!line.startsWith("```") && !line.startsWith("#")) {
        current.prompt += " " + line;
      }
    }
  }

  if (current && current.prompt) {
    questions.push(current as QuizQuestion);
  }

  return questions;
}

interface UserChoice {
  verdict: string; // "A"|"B"|"C"|"D" or "Verdadero"|"Falso"
  reason: string;
}

export function ConceptQuizPanel({
  statement,
  mode,
  value,
  disabled,
  onChange,
}: {
  statement: string;
  mode: string;
  value: string;
  disabled: boolean;
  onChange: (nextAnswer: string) => void;
}) {
  const isTrueFalse = mode === "pg_true_false" || mode === "true_false";
  const questions = useMemo(() => parseStatementQuestions(statement, isTrueFalse), [statement, isTrueFalse]);

  // Initialise local state parsed from `value`
  const [choices, setChoices] = useState<Record<number, UserChoice>>({});

  useEffect(() => {
    // Parse existing answer into choices if any
    const lines = value.split("\n");
    const map: Record<number, UserChoice> = {};
    for (const l of lines) {
      const m = /^(\d+)[\.\)]\s*([A-Da-d]|Verdadero|Falso|True|False)\b(?:\s*[:—\-]\s*(.*))?/i.exec(l.trim());
      if (m) {
        const id = parseInt(m[1]!, 10);
        map[id] = {
          verdict: m[2]!.toUpperCase() === "TRUE" ? "Verdadero" : m[2]!.toUpperCase() === "FALSE" ? "Falso" : m[2]!.toUpperCase(),
          reason: m[3] || "",
        };
      }
    }
    setChoices(map);
  }, []);

  const handleUpdate = (id: number, verdict: string, reason: string) => {
    const next = { ...choices, [id]: { verdict, reason } };
    setChoices(next);

    // Serialize to standard text
    const serialized = questions
      .map((q) => {
        const c = next[q.id];
        if (!c || !c.verdict) return null;
        return `${q.id}. ${c.verdict}${c.reason.trim() ? ` — ${c.reason.trim()}` : ""}`;
      })
      .filter(Boolean)
      .join("\n\n");

    onChange(serialized);
  };

  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-text">
          <HelpCircle size={14} /> {isTrueFalse ? "Cuestionario Verdadero / Falso" : "Preguntas de Opción Múltiple (A–D)"}
        </span>
        <span className="text-[11.5px] text-faint">
          {Object.keys(choices).length} de {questions.length} respondidas
        </span>
      </div>

      <div className="flex flex-col gap-5">
        {questions.map((q) => {
          const current = choices[q.id] || { verdict: "", reason: "" };
          return (
            <div key={q.id} className="flex flex-col gap-2.5 rounded-lg border border-line/70 bg-panel/60 p-3.5">
              <div className="flex items-start gap-2">
                <span className="grid h-5 w-5 flex-none place-items-center rounded bg-accent-soft font-mono text-[11px] font-bold text-accent-text">
                  {q.id}
                </span>
                <p className="text-[13.5px] font-medium leading-snug text-text">{q.prompt}</p>
              </div>

              {q.kind === "multiple_choice" ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {q.options.map((opt) => {
                    const selected = current.verdict === opt.letter;
                    return (
                      <button
                        key={opt.letter}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleUpdate(q.id, opt.letter, current.reason)}
                        className={cn(
                          "flex items-start gap-2 rounded-lg border p-2.5 text-left text-[13px] transition-all",
                          selected
                            ? "border-accent bg-accent-soft/70 font-medium text-text shadow-sm"
                            : "border-line bg-surface hover:border-line-strong hover:bg-hover text-dim hover:text-text",
                          disabled && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-5 w-5 flex-none place-items-center rounded font-mono text-[11px] font-bold",
                            selected ? "bg-accent text-white" : "border border-line bg-card text-dim",
                          )}
                        >
                          {opt.letter}
                        </span>
                        <span className="min-w-0 flex-1 leading-snug">{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex gap-2">
                  {["Verdadero", "Falso"].map((v) => {
                    const selected = current.verdict === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleUpdate(q.id, v, current.reason)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all",
                          selected
                            ? v === "Verdadero"
                              ? "border-mint bg-mint/15 text-mint"
                              : "border-warn bg-warn/15 text-warn"
                            : "border-line bg-surface text-dim hover:bg-hover hover:text-text",
                          disabled && "cursor-not-allowed opacity-60",
                        )}
                      >
                        {selected ? <CheckCircle2 size={13} /> : <ToggleLeft size={13} />}
                        {v}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Justification input */}
              <div className="mt-1 flex flex-col gap-1">
                <label className="text-[11.5px] text-faint flex items-center gap-1">
                  <PenLine size={11} /> Justificación breve (el mecanismo o regla que lo decide):
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={current.reason}
                  onChange={(e) => handleUpdate(q.id, current.verdict, e.target.value)}
                  placeholder="Explica brevemente por qué elegiste esta opción..."
                  className="rounded-md border border-line bg-card px-2.5 py-1 text-[12.5px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
