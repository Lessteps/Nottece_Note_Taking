import { describe, expect, it } from "vitest";
import { parseStatementQuestions } from "./ConceptQuizPanel";
import {
  buildAsciiTree,
  parseLabRequirements,
  getFileTemplate,
  buildExplorerTree,
  buildExecutionScript,
  buildSingleCommandScript,
} from "./ProjectStructureLab";

describe("parseStatementQuestions", () => {
  it("parses multiple choice questions with A-D options", () => {
    const statement = `
1. What is the role of a virtual environment in Python?
A) It speeds up Python execution by compiling bytecode.
B) It isolates dependencies per project preventing version conflicts.
C) It manages Git branches automatically.
D) It replaces the operating system kernel.

2. Which file marks a folder as a package in older Python versions?
A) setup.cfg
B) __init__.py
C) pyproject.toml
D) index.py
    `.trim();

    const questions = parseStatementQuestions(statement, false);
    expect(questions.length).toBe(2);
    expect(questions[0]!.id).toBe(1);
    expect(questions[0]!.prompt).toContain("What is the role of a virtual environment");
    expect(questions[0]!.options.length).toBe(4);
    expect(questions[0]!.options[1]!.letter).toBe("B");
    expect(questions[0]!.options[1]!.text).toContain("isolates dependencies");

    expect(questions[1]!.id).toBe(2);
    expect(questions[1]!.options[1]!.letter).toBe("B");
    expect(questions[1]!.options[1]!.text).toBe("__init__.py");
  });

  it("parses true/false statements correctly", () => {
    const statement = `
1. Virtual environments must always be committed to the Git repository.
2. The sys.path list determines where Python looks for imported modules.
    `.trim();

    const questions = parseStatementQuestions(statement, true);
    expect(questions.length).toBe(2);
    expect(questions[0]!.kind).toBe("true_false");
    expect(questions[0]!.prompt).toContain("Virtual environments must always be committed");
    expect(questions[1]!.prompt).toContain("sys.path list");
  });
});

describe("buildAsciiTree", () => {
  it("builds a formatted ascii hierarchy from path list", () => {
    const tree = buildAsciiTree(["pyproject.toml", "src/main.py", "tests/test_main.py"]);
    expect(tree).toContain("proyecto/");
    expect(tree).toContain("pyproject.toml");
    expect(tree).toContain("src/main.py");
    expect(tree).toContain("tests/test_main.py");
  });

  it("handles empty path array gracefully", () => {
    expect(buildAsciiTree([])).toBe("(vacío)");
  });
});

describe("parseLabRequirements", () => {
  it("extracts project name, paths and commands from exercise statement", () => {
    const statement = `
You are initializing a small Python project named \`my_project\` that requires testing.
1. Include:
   - The virtual environment folder \`.venv/\`
   - The main entry file \`main.py\`
   - A helper module \`utils/helpers.py\`
   - A test module \`tests/test_helpers.py\`
2. Write terminal commands:
   - Create with \`python -m venv .venv\`
   - Run the entry file from the project directory.
    `.trim();

    const reqs = parseLabRequirements(statement, "python");
    expect(reqs.projectName).toBe("my_project");
    expect(reqs.requiredPaths).toContain(".venv/");
    expect(reqs.requiredPaths).toContain("main.py");
    expect(reqs.requiredPaths).toContain("utils/helpers.py");
    expect(reqs.requiredPaths).toContain("tests/test_helpers.py");
    expect(reqs.requiredCommands).toContain("python -m venv .venv");
    expect(reqs.requiredCommands).toContain("python main.py");
    expect(reqs.suggestedPaths.length).toBeGreaterThanOrEqual(4);
  });
});

describe("getFileTemplate", () => {
  it("provides syntax code and architectural explanation for main.py", () => {
    const tmpl = getFileTemplate("main.py", "auth_service");
    expect(tmpl.language).toBe("python");
    expect(tmpl.badge).toContain("Punto de entrada");
    expect(tmpl.code).toContain("from utils.helpers import format_message");
    expect(tmpl.explanation).toContain("sys.path[0]");
  });

  it("provides code and explanation for helper modules", () => {
    const tmpl = getFileTemplate("utils/helpers.py");
    expect(tmpl.language).toBe("python");
    expect(tmpl.code).toContain("def format_message");
    expect(tmpl.explanation).toContain("Módulo de soporte");
  });

  it("provides configuration content for pyvenv.cfg", () => {
    const tmpl = getFileTemplate(".venv/pyvenv.cfg");
    expect(tmpl.language).toBe("ini");
    expect(tmpl.code).toContain("include-system-site-packages = false");
    expect(tmpl.explanation).toContain("Aislamiento de entorno");
  });
});

describe("buildExplorerTree", () => {
  it("structures raw paths into hierarchical folder and file nodes", () => {
    const paths = [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"];
    const tree = buildExplorerTree(paths);

    const dirNames = tree.filter((n) => n.isDir).map((n) => n.name);
    const fileNames = tree.filter((n) => !n.isDir).map((n) => n.name);

    expect(dirNames).toContain(".venv");
    expect(dirNames).toContain("utils");
    expect(dirNames).toContain("tests");
    expect(fileNames).toContain("main.py");

    const utilsNode = tree.find((n) => n.name === "utils");
    expect(utilsNode).toBeDefined();
    expect(utilsNode?.children?.length).toBe(1);
    expect(utilsNode?.children?.[0]?.name).toBe("helpers.py");
  });
});

describe("buildExecutionScript and buildSingleCommandScript", () => {
  it("generates a runnable Python script for command sequence verification", () => {
    const script = buildExecutionScript(
      [".venv/", "main.py", "utils/helpers.py"],
      ["python -m venv .venv", "source .venv/bin/activate", "python main.py"],
      "my_test_app",
    );
    expect(script).toContain("my_test_app");
    expect(script).toContain("import sys, os, tempfile");
    expect(script).toContain("python -m venv");
    expect(script).toContain("activate");
    expect(script).toContain("subprocess.run");
  });

  it("generates a single command execution script for terminal prompts", () => {
    const script = buildSingleCommandScript("python -V", ["main.py"], "my_test_app");
    expect(script).toContain("my_test_app");
    expect(script).toContain("cmd_str =");
    expect(script).toContain("python -V");
  });
});


