import { describe, expect, it } from "vitest";
import { parseStatementQuestions } from "./ConceptQuizPanel";
import { buildAsciiTree, parseLabRequirements } from "./ProjectStructureLab";

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

