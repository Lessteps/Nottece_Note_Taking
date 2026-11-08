/**
 * Discipline specs: skills, anchors (real failure modes) and exercise framing.
 * Ported from notevault_app/core/practice/discipline_catalog.py.
 */

import { englishSkillSpec } from "../../lib/englishSkillData";

import { mode_for } from "./modes";

export interface Skill {
  readonly code: string;
  readonly title: string;
  readonly anchors: readonly string[];
}

export interface Discipline {
  readonly id: string;
  readonly subject: string;
  readonly title: string;
  readonly modes: readonly string[];
  readonly framing: string;
  readonly skills: readonly Skill[];
}

function _skills(...rows: [string, ...string[]][]): Skill[] {
  return rows.map((row, idx) => ({
    code: String(idx + 1).padStart(2, "0"),
    title: row[0],
    anchors: row.slice(1),
  }));
}

const _DELIBERATE_DEBUGGING: [string, ...string[]] = [
  "Debugging deliberado",
  "fixes the symptom instead of the root cause",
  "changes code without stating a hypothesis first",
  "guesses or prints everywhere instead of gathering targeted evidence at the failure point",
  "never states explicitly 'the symptom was X, the root cause is Y'",
];

const _NO_TOY_NAMES =
  "Every exercise is real and applied; never toy drills with placeholder names like data1 or valueA.";

const _CATALOGUE: readonly Discipline[] = [
  {
    id: "math_general",
    subject: "mathematics",
    title: "Matemáticas generales",
    modes: ["prove", "solve", "counterexample", "true_false", "find_error", "explain"],
    framing:
      "Exercises are precise mathematical tasks with every object defined. Statements are " +
      "self-contained, use standard notation (LaTeX between $...$) and ask for exactly one " +
      "product: a proof, a value with its justification, a verified counterexample, a " +
      "justified true/false verdict, the location of an error, or an explanation.",
    skills: _skills(
      [
        "Escritura de demostraciones",
        "assumes the conclusion in the inductive step (circular reasoning)",
        "checks only examples instead of proving the general statement",
        "uses a hypothesis that was not given, or never uses one that was",
        "proves the converse instead of the stated implication",
        "skips the base case or checks the wrong starting value",
      ],
      [
        "Cálculo y procedimiento",
        "sign error when distributing a minus",
        "applies (a+b)^2 = a^2 + b^2 or a similar false linearity",
        "cancels terms across a sum instead of common factors",
        "arithmetic slip early on that propagates through the rest of the work",
      ],
      [
        "Recuerdo de conceptos",
        "states a definition with a missing or misplaced quantifier",
        "confuses a theorem with its converse",
        "forgets the hypotheses under which a result holds",
        "mixes up similar notations or terms",
      ],
      [
        "Pensamiento abstracto",
        "generalizes from a single example",
        "proposes a counterexample that does not satisfy every hypothesis",
        "negates 'for all' / 'there exists' incorrectly",
        "treats a necessary condition as sufficient",
      ],
    ),
  },
  {
    id: "math_drill",
    subject: "mathematics",
    title: "Cálculo rápido",
    modes: ["drill"],
    framing: "Short timed calculations generated and checked by the app, with exact answers.",
    skills: _skills(
      [
        "Aritmética",
        "sign error with negative operands",
        "ignores operator precedence (adds before multiplying)",
        "carry or borrow slip in multi-digit operations",
      ],
      [
        "Fracciones",
        "adds numerators and denominators directly",
        "leaves the result unreduced",
        "inverts the wrong fraction when dividing",
        "loses the sign of a negative fraction",
      ],
      [
        "Potencias y raíces",
        "multiplies base by exponent instead of repeated multiplication",
        "adds exponents when the bases differ",
        "takes the root of a sum as the sum of the roots",
      ],
      [
        "Porcentajes",
        "divides by 10 instead of 100",
        "adds successive percentages instead of compounding them",
        "misplaces the decimal point",
      ],
      [
        "Derivadas",
        "forgets to lower the exponent by one (power rule)",
        "gives a non-zero derivative for a constant term",
        "drops the coefficient when differentiating",
        "sign error on negative terms",
      ],
    ),
  },
  {
    id: "programming_logic",
    subject: "programming",
    title: "Lógica de programación",
    modes: ["implement", "find_error", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "cloze", "trace", "decompose", "test", "analyze", "review", "debug"],
    framing:
      "Language-agnostic logic exercises (pseudocode or simple Python) set in small real " +
      "situations: processing a list of orders, validating form input, counting events in " +
      "a log. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Control de flujo",
        "off-by-one error in loop bounds",
        "conditions in the wrong order make a branch unreachable",
        "loop never terminates because the variable in its condition never changes",
        "else attached to the wrong condition",
      ],
      [
        "Estructuras de datos",
        "uses a list where a dict or set gives the needed lookup",
        "modifies a collection while iterating over it",
        "indexes into a collection that can be empty",
      ],
      [
        "Descomposición de problemas",
        "one block does everything instead of named steps",
        "steps in the wrong order (a value is used before it is computed)",
        "repeats code instead of extracting a reusable function",
      ],
      [
        "Traza de ejecución",
        "loses track of a variable's value between iterations",
        "assumes the loop runs one time more or less than it does",
        "assumes a function modifies its argument in place when it returns a new value",
      ],
    ),
  },
  {
    id: "python",
    subject: "programming",
    title: "Python",
    modes: ["implement", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "trace", "review", "test", "analyze", "port"],
    framing:
      "Every exercise must be framed as an automation task, not a generic backend or " +
      "algorithm drill: a script reacting to a webhook, a batch job processing a CSV/JSON " +
      "export, a pipeline step feeding data from one system into another, a scheduled job, " +
      "a retry policy against a flaky external API. The stack is Python scripts and FastAPI " +
      "endpoints that trigger or are triggered by n8n, read/write PostgreSQL and call " +
      "external APIs. " +
      _NO_TOY_NAMES +
      " Bugs must be found by reasoning about behaviour and output, never by spotting a syntax error.",
    skills: _skills(
      [
        "Control de flujo (if/else, for, while)",
        "return or break inside the loop stops processing the remaining records",
        "off-by-one in range() or in the while condition processes one item too many or too few",
        "while loop whose stop condition never becomes false on an unexpected upstream value",
      ],
      [
        "Estructuras de datos (listas, dicts, sets, tuplas, JSON anidado)",
        "assumes a dict/JSON key always exists",
        "mutates a shared list/dict by reference unintentionally",
        "shallow vs deep copy bug",
        "KeyError on nested access into a real API payload",
      ],
      [
        "Manejo de strings/texto (parsing, formatting, encoding real)",
        "encoding assumptions when reading or writing text",
        "does not strip whitespace/newlines from a real CSV/API export",
        "off-by-one in slicing",
        "locale-dependent case or date handling",
      ],
      [
        "Lógica de I/O (archivos, streams, CSV/JSON)",
        "file handle not closed",
        "assumes a file or path exists",
        "reads before the write has finished",
        "silently overwrites existing data",
        "loads a large export fully into memory instead of streaming it",
      ],
      [
        "Descomposición de problemas",
        "one function mixes I/O, validation and business logic, and the execution order " +
          "silently breaks validation (the external call happens before validating)",
        "function name promises 2 responsibilities but performs 3-4 (typical of AI-generated code)",
        "hidden coupling through a shared variable/dict between sub-steps that should be independent",
        "function that works but no part can be touched without risking another",
      ],
      [
        "Manejo de errores + lectura de tracebacks",
        "except Exception swallows real bugs",
        "catches the wrong exception type",
        "does not re-raise when the caller must know about the failure",
        "validates the type but not the value range",
      ],
      [
        "Composición funcional (comprehensions, map/filter/reduce)",
        "comprehension with a hidden side effect",
        "map/filter iterator exhausted after the first pass",
        "wrong initial value in reduce",
      ],
      _DELIBERATE_DEBUGGING,
      [
        "Integración con APIs externas (requests/httpx, auth, timeouts, reintentos, rate limits)",
        "no timeout on the external call",
        "retries a non-idempotent operation and duplicates its effect",
        "assumes success without checking the status code",
        "hardcoded credentials",
        "ignores Retry-After on a rate limit",
      ],
      [
        "Procesamiento por lotes / pipelines de datos (leer → transformar → escribir, idempotencia, fallo parcial)",
        "batch is not idempotent (a second run duplicates the effect)",
        "no handling of a partial failure in the middle of the batch",
        "assumes the source format without validating it",
        "hardcoded file paths",
      ],
      [
        "Configuración y manejo de credenciales (.env, variables de entorno, separación dev/prod)",
        "secrets in source code instead of .env",
        "no separation between dev and production configuration",
        "assumes an environment variable always exists, with no default or validation",
      ],
      [
        "Programación Orientada a Objetos (clases, encapsulamiento, herencia, polimorfismo, dataclasses, enums)",
        "mutable class attribute shared between instances",
        "class that does too much",
        "inheritance where composition would avoid fragile coupling",
        "compares objects with == without defining __eq__",
        "internal state exposed directly instead of through @property",
      ],
      [
        "Decoradores y context managers",
        "decorator without functools.wraps",
        "side effect at decoration time instead of call time",
        "stacked decorators in the wrong order",
        "decorator swallows exceptions without re-raising",
        "synchronous decorator applied to an async function",
      ],
      [
        "Asyncio (async/await, event loop, gather, tasks)",
        "blocking call inside an async function",
        "coroutine created but never awaited",
        "gather() over tasks that share mutable state",
        "exception inside a gather() task silently swallowed",
        "inconsistent mixing of sync and async code",
      ],
      [
        "Testing (pytest, fixtures, mocking, parametrización)",
        "test without a real assert",
        "mocks the function under test instead of its external dependency",
        "fixture with shared mutable state",
        "only the happy path, no pytest.raises",
        "flaky test because of a real network call",
      ],
    ),
  },
  {
    id: "javascript",
    subject: "programming",
    title: "JavaScript",
    modes: ["implement", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "trace", "review", "test", "port"],
    framing:
      "Every exercise must be framed as a real frontend/automation task: a component " +
      "consuming a REST API, a form validation pipeline, a data transformation feeding a " +
      "React list, a scheduled fetch job, a retry handler; never an isolated algorithm " +
      "puzzle. The stack is React + TypeScript calling FastAPI backends and third-party " +
      "APIs. " +
      _NO_TOY_NAMES +
      " Bugs must be found by reasoning about behaviour and output, never by spotting a syntax error.",
    skills: _skills(
      [
        "Control de flujo (if/else, switch, for, while, for...of, for...in)",
        "== instead of === causes silent bugs with null, 0 or \"\"",
        "infinite loop from a stop condition built on a Promise",
        "switch without break falls through silently",
      ],
      [
        "Estructuras de datos (Array, Object, Map, Set, destructuring, spread)",
        "mutates an array/object directly instead of copying it (classic React state bug)",
        ".find() returns undefined and it is not checked",
        "iterates Object.keys() assuming a reliable insertion order",
        "one-level spread (shallow copy) of a nested object",
      ],
      [
        "Manejo de strings/texto (template literals, parsing, .split()/.join(), .replace(), .trim())",
        "does not .trim() user input",
        "parseInt() without the radix argument",
        "split() leaves a trailing empty string",
        "template literal prints the word \"undefined\"",
      ],
      [
        "Funciones y scope (let/const/var, closures, this, arrow vs regular, hoisting)",
        "this lost in a callback (should be an arrow function)",
        "closure captures a var loop variable by reference",
        "hoisted var creates unexpected behaviour",
        "function implicitly returns undefined",
      ],
      [
        "Descomposición de problemas (SRP en funciones, separar lógica de rendering, contratos claros)",
        "one function mixes fetch, validation, transformation and render",
        "hidden coupling through an object shared between functions that should be independent",
        "function name promises 2 responsibilities but performs 4",
      ],
      [
        "Manejo de errores (try/catch/finally, errores custom, errores de API, Promise.reject)",
        "empty catch swallows the error without logging it",
        "async call without await inside the catch body",
        "fetch resolves with a 4xx/5xx status and it is not handled",
        "throws a string instead of an Error object",
      ],
      [
        "Composición funcional (.map()/.filter()/.reduce(), encadenamiento, funciones de orden superior)",
        ".map() with a hidden side effect that mutates the original array",
        ".reduce() with a wrong or missing initialValue",
        "chain consumes an iterator only once (exhaustion)",
        ".filter() always returns true because of a weak comparison",
      ],
      _DELIBERATE_DEBUGGING,
      [
        "Async/await y Promises (async/await, Promise.all, fetch, manejo de errores async)",
        "forgotten await: the variable holds an unresolved Promise",
        "Promise.all: one rejected promise discards all the other results",
        "async callback inside .forEach is not awaited",
        "nested async callback without error handling",
      ],
      [
        "Consumo de APIs externas (fetch con auth, timeouts, retry, rate limits, validación de respuesta)",
        "calls .json() without checking response.ok",
        "no AbortController timeout",
        "retries a non-idempotent POST and duplicates its effect",
        "assumes the response shape without optional chaining",
        "credentials in source code",
      ],
      [
        "Variables de entorno y configuración (.env, import.meta.env, separación dev/prod)",
        "uses process.env in Vite instead of import.meta.env",
        "does not handle a missing variable",
        "exposes a private value through the VITE_ prefix",
      ],
      [
        "POO en JS (clases, #privado, get/set, herencia, instanceof)",
        "mutable attribute on the prototype shared between instances",
        "compares objects with === without valueOf/equals",
        "this lost when a method is extracted from the instance",
        "extends without calling super() in the constructor",
      ],
      [
        "Tipado dinámico y validación en runtime (typeof, duck typing, zod/yup, optional chaining ?., ??)",
        "typeof null === \"object\" produces a false positive",
        "chained ?. silences a real missing-data bug",
        "?? vs || confusion when 0 or \"\" are legitimate values",
        "assumes the API shape without validating it (zod/yup)",
      ],
      [
        "Testing (Jest/Vitest, expect, vi.fn(), beforeEach, mocking de fetch)",
        "test without expect (always passes)",
        "mocks the function under test instead of its external dependency",
        "beforeEach with mutable state shared between tests",
        "test calls the real fetch (flaky)",
        "forgets async/await in an async test",
      ],
    ),
  },
  {
    id: "sql",
    subject: "programming",
    title: "SQL (PostgreSQL)",
    modes: ["design", "implement", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "query", "analyze", "review"],
    framing:
      "Every exercise must be framed as a real database/automation task: a schema for a " +
      "webhook-driven pipeline, a query feeding an n8n workflow, a transaction wrapping a " +
      "multi-table upsert, a trigger maintaining audit state; never an isolated textbook " +
      "puzzle with placeholder table names like tabla1 or data. PostgreSQL is the " +
      "persistence layer for FastAPI, a queue/trigger source for n8n and the destination " +
      "of data pipelines. Bugs must be found by reasoning about behaviour, result or side " +
      "effect, never by spotting a syntax error.",
    skills: _skills(
      [
        "Tipos de datos y DDL (CREATE TABLE, constraints, tipos, ALTER)",
        "TIMESTAMP without time zone instead of TIMESTAMPTZ",
        "VARCHAR(n) where TEXT was correct",
        "missing NOT NULL on a critical column",
        "SERIAL where UUID would avoid collisions between environments",
        "foreign key without an explicit ON DELETE",
      ],
      [
        "Normalización y diseño de esquemas (1FN/2FN/3FN, relaciones, naming, soft delete)",
        "repeated data that violates 2NF/3NF",
        "multi-valued column (violates 1NF)",
        "unnecessarily coupled N:M pivot table",
        "inconsistent snake_case naming",
        "SELECT * in production",
      ],
      [
        "DML — CRUD básico (SELECT, INSERT, UPDATE, DELETE, RETURNING, filtros)",
        "UPDATE without WHERE updates every row",
        "DELETE without checking foreign keys",
        "omits RETURNING when the id was needed",
        "duplicate INSERT without ON CONFLICT",
        "LIKE '%term%' that cannot use an index on a large table",
      ],
      [
        "JOINs y agregaciones (INNER/LEFT/FULL, GROUP BY, HAVING, subqueries, CTEs)",
        "LEFT JOIN produces unexpected NULLs that are not filtered",
        "GROUP BY with a non-aggregated column",
        "HAVING confused with WHERE",
        "CTE materialized when it was unnecessary",
      ],
      [
        "Índices y performance (CREATE INDEX, EXPLAIN ANALYZE, B-tree vs GIN, índice parcial)",
        "index on a low-cardinality column (useless)",
        "no GIN index on a frequently queried JSONB column",
        "EXPLAIN without ANALYZE (estimated plan, not the real one)",
        "index on a foreign key that is never queried",
      ],
      [
        "Transacciones y concurrencia (BEGIN/COMMIT/ROLLBACK, niveles de aislamiento, locking, SKIP LOCKED)",
        "BEGIN without an explicit COMMIT in a migration script",
        "wrong isolation level (allows phantom reads)",
        "deadlock from inconsistent lock order between transactions",
        "queue UPDATE without FOR UPDATE under concurrency",
      ],
      [
        "Idempotencia en automatización (ON CONFLICT, tablas de eventos procesados, diseño de colas de trabajo)",
        "pipeline run twice duplicates rows (no ON CONFLICT)",
        "does not record the event in a processed-events table before executing the effect",
        "upsert overwrites valid data because DO UPDATE SET has no condition",
      ],
      _DELIBERATE_DEBUGGING,
      [
        "Funciones, procedimientos y triggers (PL/pgSQL, CREATE TRIGGER, NEW/OLD, LISTEN/NOTIFY)",
        "BEFORE trigger modifies NEW without RETURN NEW",
        "function without a declared RETURN",
        "NOTIFY inside a trigger without knowing it is only delivered after COMMIT",
        "trigger calls an external function (anti-pattern inside a transaction)",
      ],
      [
        "Migraciones y versionado de esquema (Alembic, up/down, autogenerate)",
        "manual ALTER TABLE in production without a matching Alembic migration",
        "Alembic autogenerate accepted without review (may include wrong drops)",
        "downgrade not implemented, assuming it never fails",
      ],
      [
        "Seguridad y control de acceso (GRANT/REVOKE, mínimo privilegio, prepared statements, SSL)",
        "application user with SUPERUSER or DBA privileges",
        "credentials inside the SQL script",
        "no prepared statements, leaving the door open to SQL injection",
        "GRANT ALL instead of only the needed privileges",
      ],
      [
        "JSONB en profundidad (->, ->>, #>, @>, jsonb_set, índice GIN, cuándo usarlo vs columnas)",
        "uses -> (returns json) instead of ->> (returns text) in a comparison",
        "no GIN index on a JSONB field used in WHERE",
        "JSONB where normalized columns would give stronger integrity",
        "jsonb_set with a wrong path fails silently",
      ],
      [
        "Postgres como pieza de automatización n8n (polling, LISTEN/NOTIFY, SKIP LOCKED, vistas como capa estable)",
        "polling without a processed_at/status column processes the same row twice",
        "no SKIP LOCKED on a concurrent queue: two workers take the same job",
        "view exposed to n8n is coupled to internal details, so a schema change breaks the workflow",
        "assumes NOTIFY is persistent (it is lost if n8n is not listening)",
      ],
    ),
  },
  {
    id: "git",
    subject: "programming",
    title: "Git",
    modes: ["commands", "find_error", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare"],
    framing:
      "Every exercise is real and situated in the daily work of a solo full-stack developer: " +
      "a repo with concrete files, realistic commit messages, domain branch names " +
      "(feature/login, hotfix/precio-null) and a real starting state shown as git status / " +
      "git log output; never placeholders like archivo1 or ramaA. The learner writes the " +
      "commands; the judge replays them mentally against the stated state. The mastery " +
      "signal is the expected final state (git log, git status, git diff), never the " +
      "commands.",
    skills: _skills(
      [
        "Configuración e inicialización (init, config, .gitignore)",
        "adds .gitignore after the files were already tracked, so they stay tracked",
        "commits secrets or build artifacts (.env, node_modules) for lack of a .gitignore",
        "wrong user.name/user.email identity (global vs per-repo config confused)",
      ],
      [
        "Staging y commits (add, commit, status, diff)",
        "commits files that should not be committed",
        "empty or useless commit message",
        "stages everything with git add . without reviewing",
      ],
      [
        "Historial y navegación (log, show, checkout, detached HEAD)",
        "ends up in detached HEAD without noticing",
        "unreadable git log for lack of flags",
        "confuses checking out a commit with checking out a branch",
      ],
      [
        "Branching (branch, switch, merge, fast-forward vs 3-way)",
        "merges into the wrong branch",
        "fast-forward when a merge commit was needed",
        "branch never deleted after the merge",
      ],
      [
        "Resolución de conflictos",
        "commits conflict markers (<<<<<<<)",
        "resolves the conflict by deleting both sides",
        "never verifies the result after resolving",
      ],
      [
        "Trabajo remoto (clone, push, pull, fetch, remote)",
        "pushes directly to main",
        "pulls without fetching first on a diverged history",
        "misconfigured remote",
      ],
      [
        "Corrección de errores (reset, revert, amend, stash)",
        "reset --hard where revert was appropriate",
        "amends a commit that was already pushed",
        "stash lost without being applied",
      ],
      [
        "Colaboración (fork, PR workflow, code review en GitHub)",
        "PR without a description",
        "fix commits mixed with feature commits in the same PR",
        "merge without review",
      ],
      [
        "Historial avanzado (rebase interactivo, bisect, blame)",
        "rebases a shared branch",
        "bisect abandoned halfway",
        "reads blame without the date context",
      ],
    ),
  },
  {
    id: "english_grammar",
    subject: "english",
    title: "Gramática inglesa",
    // The first-generation English modes stay valid so existing exercises keep working; they are no longer offered.
    modes: ["gr_explain_rule", "gr_recognize", "gr_syntax", "gr_cloze", "gr_transform", "gr_correct", "gr_expressions", "gr_produce", "rewrite", "find_error", "cloze", "translate", "true_false"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). Sentences come " +
      "from realistic contexts the learner meets: work emails and meetings in a tech/" +
      "automation job, travel and daily life. Target the errors a Spanish speaker " +
      "actually makes (transfer from Spanish) and calibrate vocabulary and structures to " +
      "the CEFR level of the exercise.",
    skills: _skills(
      [
        "Tiempos verbales",
        "uses present simple for actions in progress",
        "uses present simple with since/for where present perfect is needed",
        "uses present perfect with a finished time expression (yesterday, in 2020)",
        "omits the third-person -s",
        "uses the wrong past participle (has went, have saw)",
      ],
      [
        "Artículos y determinantes",
        "uses 'the' with general plural or uncountable nouns (the life is hard)",
        "omits a/an before a singular countable noun (she is teacher)",
        "confuses much/many or few/little",
        "uses 'the' before possessives or proper names by transfer",
      ],
      [
        "Preposiciones",
        "in/on/at chosen by transfer from Spanish 'en'",
        "depend of instead of depend on",
        "arrive to instead of arrive in/at",
        "married with instead of married to",
      ],
      [
        "Orden de palabras",
        "adjective after noun",
        "omits the subject pronoun (pro-drop transfer)",
        "missing dummy subject: 'is important' instead of 'it is important'",
        "adverb between verb and object (I like very much football)",
        "question without auxiliary inversion",
      ],
      [
        "Condicionales",
        "will in the if-clause",
        "mixes second and third conditional forms",
        "would in both clauses",
      ],
      [
        "Voz pasiva",
        "omits the auxiliary be (the report written yesterday)",
        "uses the simple past instead of the participle (was wrote)",
        "translates the Spanish impersonal 'se' literally",
      ],
      [
        "Oraciones de relativo",
        "what instead of which/that (the car what I bought)",
        "who for things or which for people",
        "commas misused between defining and non-defining clauses",
        "keeps a resumptive pronoun (the man that I saw him)",
      ],
      [
        "Estilo indirecto",
        "does not backshift tenses",
        "keeps question word order in reported questions",
        "say vs tell confusion (he said me)",
      ],
    ),
  },
  {
    id: "english_vocabulary",
    subject: "english",
    title: "Vocabulario inglés",
    modes: ["vc_recall", "vc_recognition", "vc_usage", "vc_families", "vc_collocations", "vc_synonyms", "cloze", "translate", "explain"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). Vocabulary comes " +
      "from realistic work (tech/automation) and daily-life contexts, always inside a " +
      "full sentence; target Spanish-speaker confusions and the CEFR level of the " +
      "exercise.",
    skills: _skills(
      [
        "Colocaciones",
        "make/do confusion",
        "say a lie instead of tell a lie (decir -> say/tell)",
        "win/earn money confusion (ganar)",
        "strong/heavy mismatch (strong rain instead of heavy rain)",
      ],
      [
        "Phrasal verbs",
        "wrong particle (look for vs look after)",
        "pronoun after the particle of a separable verb (pick up it)",
        "avoids the phrasal verb and uses a stiff Latinate verb in informal register",
      ],
      [
        "Falsos amigos (ES→EN)",
        "false friend: actually/actualmente",
        "false friend: embarrassed/embarazada",
        "false friend: assist/asistir",
        "false friend: library/librería",
        "false friend: sensible/sensitive",
      ],
      [
        "Formación de palabras",
        "wrong suffix for the part of speech (the economic of the country)",
        "-ed/-ing adjective confusion (I am boring)",
        "wrong negative prefix (unpossible)",
      ],
    ),
  },
  {
    id: "english_writing",
    subject: "english",
    title: "Redacción en inglés",
    modes: ["wr_sentences", "wr_paragraph", "wr_free", "wr_paraphrase", "wr_register", "wr_review", "writing", "rewrite"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). Tasks are real " +
      "writing needs: a paragraph about work or study, an email to a colleague or client, " +
      "an opinion essay. State the word range and the CEFR level; judge with CEFR writing " +
      "criteria.",
    skills: _skills(
      [
        "Párrafo",
        "no clear topic sentence",
        "run-on sentences joined with commas (comma splice)",
        "ideas not connected by linkers",
      ],
      [
        "Correo electrónico",
        "register mismatch (too informal for a formal email)",
        "purpose not stated in the opening lines",
        "calqued Spanish formulas (I write you for...)",
      ],
      [
        "Ensayo de opinión",
        "opinion not stated clearly in the introduction",
        "arguments without support or examples",
        "no conclusion restating the position",
        "overuses the same linker",
      ],
    ),
  },
  {
    id: "english_reading",
    subject: "english",
    title: "Lectura en inglés",
    modes: ["rd_literal", "rd_inference", "rd_vocab_context", "rd_summary", "rd_skim_scan", "rd_structure", "rd_paraphrase", "rd_translate"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). Every task comes with " +
      "its own short text written at the target CEFR level about realistic work or daily-life " +
      "content; questions are answerable from the text alone. State the CEFR level and the time limit.",
    skills: _skills(
      [
        "Comprensión del texto",
        "answers from prior knowledge instead of from the text",
        "copies a phrase without understanding it",
        "misses negation or a qualifier (not, hardly, only)",
      ],
      [
        "Inferencia",
        "takes the literal statement as the inferred one",
        "over-infers something the text does not support",
        "does not justify with evidence from the text",
      ],
      [
        "Vocabulario en contexto",
        "guesses from a Spanish look-alike (false friend) instead of the context",
        "ignores the part of speech of the unknown word",
        "gives the dictionary meaning that does not fit this context",
      ],
      [
        "Síntesis y estructura",
        "summarises with details instead of main ideas",
        "copies sentences instead of paraphrasing",
        "does not see the function of each paragraph or the linkers that mark it",
      ],
    ),
  },
  {
    id: "english_listening",
    subject: "english",
    title: "Escucha en inglés",
    modes: ["ls_dictation", "ls_gist", "ls_detail", "ls_gap", "ls_variation", "ls_podcast", "ls_shadowing"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). The audio text is played " +
      "aloud by the app and stays hidden; write it at the target CEFR level from realistic work " +
      "and daily-life situations, with natural rhythm. Keep the answer verifiable word by word.",
    skills: _skills(
      [
        "Discriminación de sonidos",
        "confuses similar sounds (ship/sheep, think/sink)",
        "hears a homophone as the wrong word (their/there, to/too)",
        "misses weak forms and contractions (he's / he was)",
      ],
      [
        "Terminaciones y ortografía",
        "drops the final -s, -ed or -ing that is pronounced weakly",
        "misspells a word that was heard correctly",
        "writes numbers or dates in the wrong form",
      ],
      [
        "Comprensión global y de detalle",
        "gets stuck on one unknown word and loses the rest",
        "gives the main idea from one sentence only",
        "mishears figures, names or times",
      ],
    ),
  },
  {
    id: "english_speaking",
    subject: "english",
    title: "Habla en inglés",
    modes: ["sp_read_aloud", "sp_shadowing", "sp_guided", "sp_monologue", "sp_roleplay", "sp_record_compare", "sp_phonemes", "sp_ipa", "sp_word_stress", "sp_sentence_stress", "sp_intonation", "sp_connected"],
    framing:
      "The learner is a native Spanish speaker (beginner to intermediate: A1 to B1 today). There is no speech " +
      "recognition: the learner speaks aloud and then types what they said (or a report of how it " +
      "went), and that text is what is judged. Tasks are real situations (a meeting, a call, travel). " +
      "State the CEFR level and how long to speak.",
    skills: _skills(
      [
        "Pronunciación",
        "pronounces final consonant clusters by adding a vowel (school as eschool)",
        "does not reduce unstressed syllables",
        "stress on the wrong syllable by transfer from Spanish",
      ],
      [
        "Fluidez y organización",
        "long pauses or abandoned sentences",
        "no linkers between ideas",
        "translates word by word from Spanish while speaking",
      ],
      [
        "Interacción",
        "answers with a single word instead of a full turn",
        "does not use conversational formulas (Could you…? I see what you mean)",
        "register too blunt or too formal for the situation",
      ],
    ),
  },
  // ── Programming, by area of the Programación space ────────────────────────
  {
    id: "typescript",
    subject: "programming",
    title: "TypeScript",
    modes: ["implement", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "cloze", "trace", "review", "test", "port"],
    framing:
      "Every exercise is real TypeScript work: typing an API response, narrowing a union, a generic helper, a module " +
      "shared by an Electron main process and its renderer, a Node script. Strict mode is on; `any` is never the answer. " +
      _NO_TOY_NAMES +
      " Bugs must be found by reasoning about types and behaviour, never by spotting a syntax error.",
    skills: _skills(
      [
        "Sistema de tipos",
        "uses `any` or a type assertion to silence the compiler instead of modelling the data",
        "confuses a type (compile time) with a value (runtime)",
        "widens a literal type by accident (string instead of a union of literals)",
      ],
      [
        "Narrowing y uniones",
        "accesses a property without narrowing the union first",
        "forgets the exhaustive case in a switch over a discriminated union",
        "trusts a type guard that does not actually check the value",
      ],
      [
        "Genéricos",
        "over-constrained or unconstrained generic parameters",
        "a generic that loses the type of its argument",
      ],
      [
        "Módulos y proyecto",
        "circular imports; wrong module resolution in tsconfig",
        "mixes CommonJS and ES modules",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "backend",
    subject: "programming",
    title: "Backend",
    modes: ["implement", "design", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "review", "test", "trace", "decompose", "analyze", "port"],
    framing:
      "Every exercise is a real backend task in Python (FastAPI) or TypeScript (Node): an endpoint with its contract and " +
      "status codes, a service layer rule, a webhook receiver that must be idempotent, an authentication check, a " +
      "repository query, a background job. Requests, payloads and failures are concrete. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Diseño de APIs",
        "wrong HTTP status code or verb for the operation (200 with an error body, POST for a read)",
        "endpoint that is not idempotent when a client retries it",
        "leaks the internal model instead of a response contract",
      ],
      [
        "Capas y responsabilidades",
        "business rules inside the route handler",
        "the service knows HTTP details (request objects, status codes)",
        "the repository returns half-built objects that the caller must fix",
      ],
      [
        "Autenticación y seguridad",
        "authorises only by checking that a token exists, not what it allows",
        "stores or logs secrets and passwords in plain text",
        "trusts client-supplied ids (broken object-level authorisation)",
      ],
      [
        "Errores y validación",
        "validates format but not the business rule; catches everything and hides the failure",
        "returns different error shapes from different endpoints",
      ],
      [
        "Persistencia desde el backend",
        "N+1 queries in a loop; a transaction that is too wide or missing",
        "connection not released back to the pool on error",
      ],
      [
        "Tareas en segundo plano e integración",
        "a retry without backoff or limit; a job that is not safe to run twice",
        "a webhook handler that does the slow work before answering",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "frontend",
    subject: "programming",
    title: "Frontend",
    modes: ["implement", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "cloze", "review", "test", "trace", "decompose", "analyze"],
    framing:
      "Every exercise is a real UI task with React and TypeScript: a form with validation, a list fed by an API with its " +
      "loading and error states, a component whose state is in the wrong place, an effect with a stale closure. State is " +
      "always separated into UI state, server state and form state. " +
      _NO_TOY_NAMES +
      " Bugs must be found by reasoning about rendering and state, never by spotting a syntax error.",
    skills: _skills(
      [
        "Componentes y estado",
        "derived data stored in state and kept in sync by an effect",
        "state lifted too high or duplicated in two components",
        "mutates state directly instead of producing a new value",
      ],
      [
        "Efectos y ciclo de vida",
        "an effect with a missing dependency (stale closure)",
        "a fetch without cancellation that sets state after unmount or out of order",
        "an effect that runs on every render",
      ],
      [
        "Datos del servidor",
        "no loading or error state; the UI shows stale data as if it were fresh",
        "server state copied into local state",
      ],
      [
        "Formularios y validación",
        "validates only on the client; error messages that do not say which field",
        "the submit can be fired twice (no pending state), so the server receives duplicates",
      ],
      [
        "Accesibilidad y rendimiento",
        "a clickable div with no keyboard access or role",
        "re-renders a huge list on every keystroke",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "desktop",
    subject: "programming",
    title: "Apps de escritorio (Electron)",
    modes: ["implement", "design", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "review", "test", "trace", "decompose", "analyze"],
    framing:
      "Every exercise is real Electron + TypeScript work on a Windows desktop app: what runs in the main process and " +
      "what in the renderer, a typed IPC call through a preload script, a native dialog, a file the app writes, a " +
      "window lifecycle bug, packaging with electron-builder. Security defaults (context isolation, no Node in the " +
      "renderer) are always on. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Arquitectura main / preload / renderer",
        "puts privileged work (files, processes) in the renderer",
        "exposes the whole ipcRenderer to the page instead of narrow functions",
        "blocks the main process with synchronous work so every window freezes",
      ],
      [
        "IPC tipado",
        "an IPC handler that trusts the arguments it receives from the renderer",
        "channel names and payload types that drift apart between processes",
      ],
      [
        "Seguridad",
        "nodeIntegration on or contextIsolation off; loads remote content with privileges",
        "path traversal: a renderer-supplied path is opened without confining it",
      ],
      [
        "Ciclo de vida y ventanas",
        "listeners registered on every window creation and never removed",
        "app quits or keeps running when the last window closes on the wrong platform",
      ],
      [
        "Empaquetado y distribución",
        "a dependency or resource missing from the packaged app but present in dev",
        "paths that work in dev and break inside the asar archive",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "automation",
    subject: "programming",
    title: "Automatización",
    modes: ["implement", "design", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "review", "test", "trace", "decompose", "port"],
    framing:
      "Every exercise is an automation task: a script reacting to a webhook, a batch job over a CSV/JSON export, a " +
      "pipeline step moving data between two systems, a scheduled job, an n8n workflow or Power Automate flow, a retry " +
      "policy against a flaky API. Never an isolated puzzle without operational context. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Idempotencia",
        "running the job twice duplicates or corrupts the result",
        "no key that identifies an event that was already processed",
      ],
      [
        "Fallos parciales y reintentos",
        "one bad record aborts the whole batch, or is silently skipped",
        "retries with no backoff, no limit, or on errors that can never succeed",
      ],
      [
        "Integración con APIs",
        "ignores pagination, rate limits or expired tokens",
        "hardcoded URLs, paths or credentials",
      ],
      [
        "Programación y disparadores",
        "a scheduled job that overlaps with its previous run",
        "time zone and daylight-saving assumptions in schedules",
      ],
      [
        "Observabilidad de procesos",
        "no log line that says what was processed and what failed",
        "logs whole payloads with personal data or secrets",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "mobile",
    subject: "programming",
    title: "Móvil",
    modes: ["implement", "design", "debug", "refactor", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "review", "test", "trace", "decompose", "analyze", "port"],
    framing:
      "Every exercise is real mobile work (TypeScript with React Native, and Kotlin for native modules): a list with " +
      "thousands of rows, local storage and sync with the desktop vault, a permission flow, background limits, a bridge " +
      "call that is too chatty. Performance, battery and the app lifecycle are always part of the answer. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Rendimiento móvil",
        "renders a huge list without virtualisation; heavy work on the UI thread",
        "too many small bridge calls between JavaScript and native code",
      ],
      [
        "Ciclo de vida y permisos",
        "assumes the app keeps running in the background or that a permission stays granted",
        "state lost when the OS kills the process",
      ],
      [
        "Almacenamiento y sincronización",
        "two devices edit the same file with no conflict strategy",
        "reads the whole vault into memory instead of indexing it",
      ],
      _DELIBERATE_DEBUGGING,
    ),
  },
  {
    id: "devtools",
    subject: "programming",
    title: "Herramientas y calidad",
    modes: ["commands", "implement", "debug", "find_error", "explain", "pg_true_false", "pg_quiz", "project_structure", "pg_classify", "pg_compare", "review", "test", "design"],
    framing:
      "Every exercise is real day-to-day tooling for a solo developer: a Dockerfile or compose file that must build and " +
      "run, a CI pipeline step, a package manager and lockfile problem, a test setup, a shell or PowerShell script, a " +
      "linter configuration. Commands and files are concrete. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Contenedores",
        "secrets baked into an image; runs as root; a bad layer order that defeats caching",
        "data stored in the container filesystem and lost when it is replaced",
      ],
      [
        "Integración continua",
        "a pipeline that passes without running the tests it claims to run",
        "secrets echoed in logs",
      ],
      [
        "Dependencias y entornos",
        "unpinned versions that make the build differ between machines",
        "a global install that hides a missing dependency",
      ],
      [
        "Scripts y terminal",
        "a destructive command with an unquoted variable or path",
        "assumes a POSIX shell on Windows or the other way round",
      ],
    ),
  },
  {
    id: "programming_practice",
    subject: "programming",
    title: "Práctica de programación",
    modes: ["pp_kata", "trace", "analyze", "debug", "explain"],
    framing:
      "Daily logic katas: one self-contained problem built on a recognised pattern, solvable in 20 to 30 minutes in Python or " +
      "TypeScript. Statements are set in small real situations (deduplicating records, merging time ranges, matching brackets in a " +
      "config, ranking search results) with exact inputs and outputs. " +
      _NO_TOY_NAMES,
    skills: _skills(
      [
        "Elección del patrón",
        "uses brute force where a hash map or two pointers is the point of the problem",
        "picks a pattern by the problem's name instead of by its constraints",
      ],
      [
        "Casos límite",
        "fails on empty input, a single element or all-equal values",
        "off-by-one at the boundaries of a window or a range",
        "assumes the input is sorted or has no duplicates",
      ],
      [
        "Complejidad",
        "states the complexity of the idea instead of the code as written",
        "hides a linear operation inside a loop (slicing, in on a list, string concatenation)",
      ],
      [
        "Corrección bajo presión",
        "stops at the example that passes instead of testing another input",
        "rewrites a working solution instead of fixing the failing case",
      ],
    ),
  },
];

export const DISCIPLINES: Record<string, Discipline> = Object.fromEntries(
  _CATALOGUE.map((d) => [d.id, d]),
);

/** The discipline (framing and error taxonomy) of each English area. */
export const ENGLISH_DISCIPLINE_OF_AREA: Record<string, string> = {
  grammar: "english_grammar",
  writing: "english_writing",
  reading: "english_reading",
  listening: "english_listening",
  speaking: "english_speaking",
  vocabulary: "english_vocabulary",
};

/**
 * The discipline of a programming exercise from where it lives in the Programación space: the area folder decides
 * the framing (`2.1 Python` → python, `4 Backend` → backend…). Unknown places keep the language-agnostic one.
 */
export function programmingDisciplineOfPath(rel: string): string {
  const parts = String(rel || "").split(/[\\/]/);
  const area = parts.find((p) => /^\d+(?:\.\d+)?\s+\S/.test(p)) ?? "";
  const n = /^(\d+(?:\.\d+)?)/.exec(area)?.[1] ?? "";
  const byNumber: Record<string, string> = {
    "1": "programming_logic",
    "2.1": "python",
    "2.2": "javascript",
    "2.3": "typescript",
    "3": "desktop",
    "4": "backend",
    "5": "frontend",
    "6": "sql",
    "7": "automation",
    "8": "mobile",
    "9": "devtools",
  };
  // The practice area has no number: its folder name decides.
  if (parts.some((p) => p.toLowerCase() === "programming_practice")) return "programming_practice";
  return byNumber[n] ?? "programming_logic";
}

export const DEFAULT_DISCIPLINE: Record<string, string> = {
  mathematics: "math_general",
  programming: "programming_logic",
  english: "english_grammar",
};

export function disciplineFor(frontmatter: Record<string, any>): Discipline {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const explicit = String(fm.discipline || "").trim().toLowerCase();
  if (explicit in DISCIPLINES) {
    return DISCIPLINES[explicit]!;
  }
  const subject = String(fm.subject || "").trim().toLowerCase();
  // English: the discipline follows the skill (`gr_` grammar, `wr_` writing, `rd_` reading, …), never math.
  if (subject === "english" || subject === "ingles" || subject === "inglés") {
    const bySkill = ENGLISH_DISCIPLINE_OF_AREA[englishSkillSpec(String(fm.mode || ""))?.area ?? ""];
    return DISCIPLINES[bySkill || DEFAULT_DISCIPLINE.english!]!;
  }
  if (mode_for(fm).id === "drill") {
    return DISCIPLINES["math_drill"]!;
  }
  return DISCIPLINES[DEFAULT_DISCIPLINE[subject] || "math_general"]!;
}
export const discipline_for = disciplineFor;

export function normalizeSkillCode(code: unknown): string {
  const text = String(code !== null && code !== undefined ? code : "").trim();
  return /^\d+$/.test(text) ? String(parseInt(text, 10)).padStart(2, "0") : text;
}
export const normalize_skill_code = normalizeSkillCode;

export function skillOf(discipline: Discipline, code: unknown): Skill | null {
  const wanted = normalizeSkillCode(code);
  return discipline.skills.find((s) => s.code === wanted) ?? null;
}
export const skill_of = skillOf;
