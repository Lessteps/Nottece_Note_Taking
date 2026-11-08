// Programming competencies beyond the first eight (implement, debug, refactor, design, commands, explain, cloze,
// find_error). Pure data (no imports) so the core (modes, skills) and the UI share it.
//
// The set comes from what a working developer actually does with code: predict what it will do, take a plausible
// piece (often written by an AI) and catch what is quietly wrong, prove it works with tests, judge its cost,
// plan before writing, move it between languages, and ask a database the right question.

export interface ProgrammingSkillSpec {
  id: string;
  label: string;
  /** what the student does (Spanish, shown in lists) */
  description: string;
  /** the instruction the exercise generator follows (English) */
  act: string;
  /** what the grader looks for (English) */
  judge: string;
  answerKind: "code" | "text";
  timer: string;
  /** no beginner level: it needs some code-reading base */
  noBeginner?: boolean;
}

export const PROGRAMMING_EXTRA_SKILLS: readonly ProgrammingSkillSpec[] = [
  {
    id: "trace",
    label: "Seguir la ejecución",
    description: "Predecir la salida y el estado del programa paso a paso, sin ejecutarlo.",
    act: "Give a short piece of code and concrete inputs; the learner writes the exact output and the value of the key variables after each step (a trace table), without running it.",
    judge: "The final output is exact and every intermediate state is right: loop iterations counted correctly, evaluation order respected, references vs copies and scope handled as the language really behaves.",
    answerKind: "text",
    timer: "10m",
  },
  {
    id: "review",
    label: "Revisar código (incluido el de IA)",
    description: "Auditar código que parece correcto y encontrar sus fallos silenciosos y riesgos.",
    act: "Give a plausible, working-looking piece of code (typical of what an AI assistant would write) with real, non-cosmetic problems planted in it; the learner reviews it like a pull request: lists each problem with evidence, severity and a fix.",
    judge: "The real behavioural problems are all found (wrong on some input, unsafe, not idempotent, leaks, hidden assumptions), ranked by severity with evidence; style nitpicks do not count and no correct code is called wrong.",
    answerKind: "text",
    timer: "pomodoro",
    noBeginner: true,
  },
  {
    id: "test",
    label: "Escribir pruebas",
    description: "Escribir pruebas que fijan el comportamiento: casos normales, límites y errores.",
    act: "Give a function or a specification (and optionally a buggy variant); the learner writes automated tests for it with the framework of the language.",
    judge: "The tests cover the normal case, the boundaries and the error paths; each asserts one clear thing, is deterministic and independent, and would fail on the buggy variant; names say what is being checked.",
    answerKind: "code",
    timer: "pomodoro",
  },
  {
    id: "analyze",
    label: "Analizar complejidad y rendimiento",
    description: "Estimar el coste en tiempo y memoria, encontrar el cuello de botella y mejorarlo.",
    act: "Give code that works but does not scale; the learner states its time and space complexity, names the bottleneck with evidence and proposes a better structure or algorithm.",
    judge: "The complexity is right for the code as written, the bottleneck is the real one, and the improvement is correct, justified with the new complexity and keeps the behaviour.",
    answerKind: "text",
    timer: "15m",
    noBeginner: true,
  },
  {
    id: "decompose",
    label: "Descomponer y planificar",
    description: "Antes de programar: entradas, salidas, casos límite y los pasos en orden.",
    act: "Give a real requirement; the learner writes the plan before any code: inputs and outputs, edge cases, the steps in order (pseudocode) or the breakdown into functions/modules with what each receives and returns.",
    judge: "The specification is complete and unambiguous, the edge cases are real, the steps are in a valid order with no missing dependency, and each part has one responsibility. No implementation is expected.",
    answerKind: "text",
    timer: "15m",
  },
  {
    id: "port",
    label: "Portar entre lenguajes",
    description: "Traducir código de un lenguaje a otro conservando el comportamiento y sonando idiomático.",
    act: "Give working code in one language (for example Python) and ask for the equivalent in another (for example TypeScript), keeping the behaviour and using the target language's idioms.",
    judge: "The behaviour is identical including the language differences that bite (truthiness, integer division, mutability, equality, null handling, async), and the result is idiomatic for the target rather than a line-by-line calque.",
    answerKind: "code",
    timer: "pomodoro",
    noBeginner: true,
  },
  // ── Concept skills: for theory topics, where nothing is worth coding. The ids carry a `pg_` prefix because
  // `true_false` already exists for mathematics and its generator talks about postulates.
  {
    id: "pg_true_false",
    label: "Verdadero o falso (concepto)",
    description: "Decidir si una afirmación sobre un concepto de programación es verdadera o falsa y justificarlo.",
    act: "Give 4 to 6 short statements about the topic, each one either exactly true or false in a subtle way (a plausible misconception, a wrong cause, an absolute word such as 'always' or 'never', two concepts swapped). The learner marks each one true or false and justifies the verdict in one or two sentences. About half must be false. No code has to be written; a statement may quote one or two lines of code.",
    judge: "Every verdict is right AND every justification names the actual reason (the mechanism or the rule), not a restatement of the statement. A correct verdict with a wrong or empty reason counts as wrong. False statements are corrected, not just rejected.",
    answerKind: "text",
    timer: "5m",
  },
  {
    id: "pg_classify",
    label: "Clasificar (concepto)",
    description: "Ubicar casos, ejemplos o fragmentos en la categoría correcta de un concepto.",
    act: "Give a short list of 5 to 8 concrete cases (a snippet, a log line, a requirement, a sentence about a system) and the categories of the topic (for example kinds of error, kinds of memory, HTTP method semantics, layers, types of test). The learner puts each case in its category and says in one sentence what decides it. Include borderline cases that look like one category but belong to another.",
    judge: "Every case is in the right category and the deciding feature named for each one is the real criterion. Borderline cases are resolved by the definition of the category, not by surface appearance.",
    answerKind: "text",
    timer: "5m",
  },
  {
    id: "pg_compare",
    label: "Comparar conceptos",
    description: "Distinguir dos conceptos parecidos y elegir cuál usar en una situación dada.",
    act: "Name two or three concepts that are easy to confuse in this topic (for example process vs thread, authentication vs authorization, stack vs heap, unit vs integration test) and give two small real situations. The learner states what is the same, what differs, and which concept applies in each situation and why.",
    judge: "The difference stated is the one that matters in practice (not a vague one), each situation is assigned to the right concept, and the reasoning shows the criterion for choosing. Definitions copied without applying them do not pass.",
    answerKind: "text",
    timer: "10m",
  },
  {
    id: "pg_quiz",
    label: "Opción múltiple (concepto)",
    description: "Elegir la opción correcta (A–D) en preguntas y escenarios sobre el concepto y justificar la elección.",
    act: "Give 4 to 6 numbered multiple-choice questions about the topic. Use EXACTLY this layout so the app can render clickable options: a line `1. <question or short scenario>` followed by option lines `A) …`, `B) …`, `C) …`, `D) …` (one per line, exactly one correct). Distractors must be real misconceptions about THIS topic, not absurd options. Mix definition questions with small real situations (\"you clone a repo and…\"). No code has to be written; a question may quote one or two lines. The learner picks one letter per question and justifies it in one sentence.",
    judge: "Every chosen option is the correct one AND its justification names the actual reason (the rule or mechanism). A right letter with an empty or wrong reason counts half. For each wrong choice, name the misconception behind it.",
    answerKind: "text",
    timer: "5m",
  },
  {
    id: "project_structure",
    label: "Estructura de proyecto y entorno",
    description: "Recrear o reparar la estructura real de un proyecto (carpetas, configuración, entorno) y los comandos para montarlo.",
    act: "Describe a small realistic project (a CLI script, a tiny API, a package with tests) and ask the learner to BUILD its layout: the folder/file tree (one path per line, folders end with `/`, e.g. `pyproject.toml`, `.venv/`, `src/app/__init__.py`, `src/app/main.py`, `tests/test_main.py`), the setup commands in order (create and activate the environment, install, run) and, when relevant, the import line that works from a given file. Variants: repair a broken tree, say which files must NOT be committed, or decide where a new module goes. Never ask to trace, debug or refactor a program.",
    judge: "The tree has every required piece in the right place (package folders with `__init__.py` when needed, config at the root, tests apart, the environment folder excluded from version control), the commands are correct and in a working order for the stated OS, and the imports resolve from where the code runs. Extra noise files or a wrong root lose points.",
    answerKind: "text",
    timer: "10m",
  },
  // The daily logic exercise of the `programming_practice` area (a track apart from the weekly projects).
  {
    id: "pp_kata",
    label: "Reto de lógica diario",
    description: "Un problema corto de lógica por día: resolverlo, razonar el patrón y repetir los que fallaste.",
    act: "Give ONE short logic problem (20 to 30 minutes) with a precise statement, exact inputs and expected outputs including edge cases (empty input, one element, duplicates, negatives). The learner writes the solution in Python or TypeScript and names the pattern used and its time complexity.",
    judge: "The solution is correct on the normal cases AND on every edge case, the complexity stated matches the code, and the pattern named is the one that actually solves it (not a brute force presented as a pattern). A solution that works only on the shown example does not pass.",
    answerKind: "code",
    timer: "30m",
  },
  {
    id: "query",
    label: "Consulta SQL",
    description: "Traducir una pregunta sobre los datos a una consulta correcta y eficiente.",
    act: "Give a schema with sample rows and a question about the data; the learner writes the SQL query that answers it.",
    judge: "The query returns exactly the right rows and columns on the sample and on edge cases (NULLs, duplicates, empty groups, ties); joins and filters are correct and the query does not do needless work.",
    answerKind: "code",
    timer: "15m",
  },
];

export const PROGRAMMING_EXTRA_IDS: readonly string[] = PROGRAMMING_EXTRA_SKILLS.map((s) => s.id);
