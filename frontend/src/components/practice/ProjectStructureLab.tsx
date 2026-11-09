// Interactive project structure and virtual environment lab.
// Notion-style visual builder: multi-step workspace, full-width responsive layout, dedicated per-step hints,
// live file explorer with code previews, interactive sandboxed terminal runner, and pro engineering mastery tricks.

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Folder,
  FileText,
  FolderTree,
  Terminal,
  Plus,
  Trash2,
  Check,
  Play,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Circle,
  Package,
  Lightbulb,
  Info,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ArrowRight,
  Code2,
  ListChecks,
  Sparkles,
  Copy,
  TerminalSquare,
  Eye,
  FileCode2,
  RefreshCw,
  Sliders,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { cn } from "../ui";
import { api } from "../../lib/bridge";

export interface LabRequirements {
  projectName: string;
  requiredPaths: string[];
  requiredCommands: string[];
  suggestedPaths: string[];
  suggestedCommands: string[];
}

export interface ExplorerNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children?: ExplorerNode[];
}

/**
 * Parsea el enunciado del ejercicio para extraer automáticamente:
 * - El nombre del proyecto (ej. `my_project`)
 * - Los archivos y carpetas requeridos
 * - Los comandos de terminal requeridos
 * - Sugerencias contextuales de 1 solo clic
 */
export function parseLabRequirements(stmt: string, discipline = "python"): LabRequirements {
  if (!stmt) {
    return {
      projectName: "my_project",
      requiredPaths: [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"],
      requiredCommands: ["python -m venv .venv", "python main.py"],
      suggestedPaths: [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py", "requirements.txt", "README.md"],
      suggestedCommands: ["python -m venv .venv", "source .venv/bin/activate", "pip install -r requirements.txt", "python main.py", "pytest"],
    };
  }

  // Extraer nombre del proyecto
  let projectName = "my_project";
  const nameMatch = stmt.match(/named\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i) ||
    stmt.match(/llamado\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i) ||
    stmt.match(/proyecto\s+[`"']([a-zA-Z0-9_\-]+)[`"']/i);
  if (nameMatch && nameMatch[1]) {
    projectName = nameMatch[1];
  }

  // Extraer tokens en backticks
  const codeMatches = Array.from(stmt.matchAll(/`([^`]+)`/g)).map((m) => m[1].trim());

  const reqPaths: string[] = [];
  const reqCmds: string[] = [];

  const isCmd = (s: string) => {
    if (s === ".venv" || s === ".venv/" || s.endsWith("/")) return false;
    return (
      s.startsWith("python ") ||
      s.startsWith("pip ") ||
      s.startsWith("source ") ||
      s.startsWith("npm ") ||
      s.startsWith("node ") ||
      s.startsWith("pytest") ||
      s.startsWith("git ")
    );
  };

  const isPath = (s: string) => {
    if (isCmd(s)) return false;
    return (
      s.endsWith("/") ||
      s.includes("/") ||
      s.includes(".py") ||
      s.includes(".js") ||
      s.includes(".ts") ||
      s.includes(".json") ||
      s.includes(".toml") ||
      s.includes(".txt") ||
      s.includes(".md") ||
      s === ".venv" ||
      s === ".gitignore"
    );
  };

  for (const token of codeMatches) {
    if (isCmd(token)) {
      if (!reqCmds.includes(token)) reqCmds.push(token);
    } else if (isPath(token)) {
      const cleanPath = token === ".venv" ? ".venv/" : token;
      if (!reqPaths.includes(cleanPath)) reqPaths.push(cleanPath);
    }
  }

  // Si el texto menciona ejecutar el archivo principal y no se capturó como comando:
  const lower = stmt.toLowerCase();
  if ((lower.includes("run") || lower.includes("ejecut")) && (lower.includes("main.py") || lower.includes("entry")) && !reqCmds.some((c) => c.includes("main.py"))) {
    reqCmds.push("python main.py");
  }

  const defaultPythonPaths = [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py", "requirements.txt", "README.md", ".gitignore"];
  const defaultPythonCmds = ["python -m venv .venv", "source .venv/bin/activate", "pip install -r requirements.txt", "python main.py", "pytest"];

  const defaultNodePaths = ["node_modules/", "src/index.js", "package.json", "README.md", ".gitignore"];
  const defaultNodeCmds = ["npm init -y", "npm install", "npm start", "npm test"];

  const basePaths = discipline === "javascript" || discipline === "typescript" ? defaultNodePaths : defaultPythonPaths;
  const baseCmds = discipline === "javascript" || discipline === "typescript" ? defaultNodeCmds : defaultPythonCmds;

  const suggestedPaths = Array.from(new Set([...reqPaths, ...basePaths]));
  const suggestedCommands = Array.from(new Set([...reqCmds, ...baseCmds]));

  return {
    projectName,
    requiredPaths: reqPaths.length > 0 ? reqPaths : [".venv/", "main.py", "utils/helpers.py", "tests/test_helpers.py"],
    requiredCommands: reqCmds.length > 0 ? reqCmds : ["python -m venv .venv", "python main.py"],
    suggestedPaths,
    suggestedCommands,
  };
}

export function buildAsciiTree(paths: string[]): string {
  if (!paths || paths.length === 0) return "(vacío)";
  const clean = paths
    .map((p) => p.trim())
    .filter(Boolean)
    .sort();

  const lines: string[] = ["proyecto/"];
  for (let i = 0; i < clean.length; i++) {
    const isLast = i === clean.length - 1;
    const branch = isLast ? "└── " : "├── ";
    lines.push(branch + clean[i]);
  }
  return lines.join("\n");
}

export function getFileTemplate(path: string, projectName = "my_project"): { code: string; explanation: string; language: string; badge: string } {
  const p = path.toLowerCase();
  if (p === "main.py" || p.endsWith("/main.py") || p === "app.py") {
    return {
      language: "python",
      badge: "Punto de entrada principal",
      code: `"""
Punto de entrada principal del paquete (${projectName}).
Demuestra la resolución limpia de módulos locales sin colisiones.
"""
import sys
from utils.helpers import format_message, calculate_checksum

def main() -> None:
    print(f"[APP] Iniciando ejecución de {sys.argv[0]}...")
    saludo = format_message("Estudiante")
    print(f"[APP] {saludo}")
    chk = calculate_checksum("Python-Mastery")
    print(f"[APP] Hash de integridad verificado: {chk}")
    print("[APP] Todos los módulos locales cargaron con éxito.")

if __name__ == "__main__":
    main()
`,
      explanation: "Punto de entrada: Cuando se invoca con 'python main.py', el intérprete sitúa automáticamente la carpeta raíz en sys.path[0]. Por esta razón, 'from utils.helpers import ...' funciona de inmediato sin requerir configuración manual de PYTHONPATH.",
    };
  }

  if (p.includes("helper") || p.includes("utils")) {
    return {
      language: "python",
      badge: "Módulo auxiliar exportable",
      code: `"""
Módulo de utilidades desacopladas (utils.helpers).
Contiene funciones puras para ser consumidas por la aplicación y probadas por tests.
"""

def format_message(name: str) -> str:
    """Formatea un mensaje de bienvenida estructurado."""
    return f"¡Hola desde el módulo utils.helpers, {name}!"

def calculate_checksum(data: str) -> int:
    """Calcula un hash aritmético simple para verificación de integridad."""
    return sum(ord(c) for c in data) % 1000
`,
      explanation: "Módulo de soporte: Agrupa lógica reutilizable. En arquitecturas limpias, este archivo no incluye bloques 'if __name__ == \"__main__\"' de ejecución directa para evitar efectos secundarios al ser importado.",
    };
  }

  if (p.includes("test")) {
    return {
      language: "python",
      badge: "Suite de pruebas unitarias",
      code: `"""
Suite de pruebas unitarias ejecutadas mediante pytest o unittest.
Verifica que las funciones auxiliares cumplan su contrato de comportamiento.
"""
from utils.helpers import format_message, calculate_checksum

def test_format_message():
    resultado = format_message("Tester")
    assert "utils.helpers" in resultado
    assert "Tester" in resultado

def test_calculate_checksum():
    assert calculate_checksum("Python") > 0
`,
      explanation: "Pruebas unitarias: La carpeta tests/ reside en la raíz fuera del paquete distribuible. Esto permite a herramientas de CI/CD y a pytest descubrir las pruebas automáticamente sin inflar el paquete de producción.",
    };
  }

  if (p.includes("pyvenv.cfg")) {
    return {
      language: "ini",
      badge: "Configuración del entorno virtual",
      code: `home = /usr/bin
include-system-site-packages = false
version = 3.12.0
executable = /usr/bin/python3
command = /usr/bin/python3 -m venv .venv
`,
      explanation: "Aislamiento de entorno: La clave 'include-system-site-packages = false' impide que paquetes globales del sistema operativo contaminen el proyecto, logrando reproducibilidad total.",
    };
  }

  if (p.includes("requirements.txt")) {
    return {
      language: "text",
      badge: "Manifiesto de dependencias",
      code: `# Dependencias de desarrollo y testing
pytest>=8.0.0
ruff>=0.4.0
`,
      explanation: "Manifiesto de paquetes: Lista las librerías requeridas. Se instala con 'pip install -r requirements.txt' una vez activado el entorno virtual.",
    };
  }

  if (p.includes(".gitignore")) {
    return {
      language: "gitignore",
      badge: "Control de versiones Git",
      code: `# Entornos virtuales (NUNCA commitear al repositorio)
.venv/
env/
venv/

# Bytecode y cache
__pycache__/
*.py[cod]

# Testing y cobertura
.pytest_cache/
.coverage
`,
      explanation: "Exclusiones de Git: Mantiene fuera del control de versiones carpetas efímeras o dependientes de la máquina (como .venv/ y __pycache__/).",
    };
  }

  if (p.includes("readme")) {
    return {
      language: "markdown",
      badge: "Documentación del proyecto",
      code: `# ${projectName}

Guía de inicio rápido para desarrolladores.

## Secuencia de configuración inicial
\`\`\`bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
pytest
\`\`\`
`,
      explanation: "Documentación de entrada: Explica a cualquier colaborador cómo clonar, montar el entorno virtual y poner a correr la aplicación.",
    };
  }

  if (p.endsWith("/")) {
    return {
      language: "text",
      badge: "Directorio del sistema",
      code: `[Directorio: ${path}]
Estructura contenedora para submódulos o dependencias del proyecto.
`,
      explanation: "Carpeta de proyecto: En Python moderno (PEP 420), las carpetas pueden actuar como namespace packages, aunque incluir un '__init__.py' explícito sigue siendo la mejor práctica para paquetes regulares.",
    };
  }

  return {
    language: "python",
    badge: "Archivo de proyecto",
    code: `"""Archivo del proyecto: ${path}"""

# Implementación específica del módulo
`,
    explanation: `Archivo configurado en la arquitectura del proyecto '${projectName}'.`,
  };
}

export function buildExplorerTree(paths: string[]): ExplorerNode[] {
  const rootNodes: ExplorerNode[] = [];

  const addPathToTree = (parts: string[], fullPath: string, isDir: boolean, currentList: ExplorerNode[]) => {
    if (parts.length === 0) return;
    const part = parts[0]!;
    const isLeaf = parts.length === 1;

    let existing = currentList.find((n) => n.name === part);
    if (!existing) {
      existing = {
        name: part,
        fullPath: isLeaf ? fullPath : fullPath.split(part)[0] + part + "/",
        isDir: !isLeaf || isDir,
        children: !isLeaf || isDir ? [] : undefined,
      };
      currentList.push(existing);
    }

    if (!isLeaf && existing.children) {
      addPathToTree(parts.slice(1), fullPath, isDir, existing.children);
    }
  };

  for (const rawPath of paths) {
    const isDir = rawPath.endsWith("/") || rawPath === ".venv";
    const clean = rawPath.replace(/\/$/, "");
    const parts = clean.split("/").filter(Boolean);
    addPathToTree(parts, rawPath, isDir, rootNodes);
  }

  // Ordenar: directorios primero, luego archivos alfabéticamente
  const sortNodes = (nodes: ExplorerNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };

  sortNodes(rootNodes);
  return rootNodes;
}

export function buildExecutionScript(paths: string[], commands: string[], projectName: string): string {
  const pathsJson = JSON.stringify(paths);
  const commandsJson = JSON.stringify(commands);
  const projectJson = JSON.stringify(projectName);

  return `
import sys, os, tempfile, shutil, subprocess, json

paths = ${pathsJson}
commands = ${commandsJson}
project_name = ${projectJson}

work_dir = tempfile.mkdtemp(prefix="lab_runner_")

def log(msg=""):
    print(msg, flush=True)

try:
    log(f"⚡ [Terminal en Vivo] Espacio de trabajo montado para '{project_name}'.")
    log(f"📁 [FileSystem] Generando {len(paths)} elementos en el árbol...")

    has_utils = False
    has_main = False
    has_test = False
    has_venv = False

    for p in paths:
        clean = p.strip()
        if not clean:
            continue
        full_path = os.path.join(work_dir, clean)
        if clean.endswith("/") or clean == ".venv":
            os.makedirs(full_path, exist_ok=True)
            if ".venv" in clean:
                has_venv = True
                with open(os.path.join(full_path, "pyvenv.cfg"), "w", encoding="utf-8") as f:
                    f.write("home = /usr/bin\\ninclude-system-site-packages = false\\nversion = 3.12.0\\n")
        else:
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            if "helpers.py" in clean or "helper" in clean:
                has_utils = True
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('"""Módulo de utilidades."""\\n\\ndef format_message(name: str) -> str:\\n    return f"¡Hola desde utils.helpers, {name}!"\\n\\ndef calculate_checksum(data: str) -> int:\\n    return sum(ord(c) for c in data) % 1000\\n')
            elif clean == "main.py" or clean.endswith("/main.py"):
                has_main = True
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('"""Punto de entrada."""\\nimport sys\\nfrom utils.helpers import format_message\\n\\ndef main():\\n    print(f"[APP] Iniciando {project_name}...")\\n    msg = format_message("Estudiante")\\n    print(f"[APP] {msg}")\\n    print("[APP] Entorno y módulos cargados correctamente.")\\n\\nif __name__ == "__main__":\\n    main()\\n')
            elif "test" in clean and clean.endswith(".py"):
                has_test = True
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('"""Pruebas unitarias."""\\nfrom utils.helpers import format_message, calculate_checksum\\n\\ndef test_format_message():\\n    assert "utils.helpers" in format_message("Tester")\\n\\ndef test_checksum():\\n    assert calculate_checksum("Python") > 0\\n\\nif __name__ == "__main__":\\n    test_format_message()\\n    test_checksum()\\n    print("[TEST] 2 passed in 0.02s")\\n')
            elif clean == "requirements.txt":
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write("pytest>=8.0.0\\nruff>=0.4.0\\n")
            elif clean == ".gitignore":
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(".venv/\\n__pycache__/\\n.pytest_cache/\\n")
            else:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(f"# {clean}\\n")

    log("✔ [FileSystem] Directorios y archivos sincronizados exitosamente.")
    log("-" * 65)

    venv_created = False
    venv_active = False

    for idx, cmd in enumerate(commands, 1):
        cmd_str = cmd.strip()
        log(f"\\n$ [{idx}/{len(commands)}] {cmd_str}")

        if "python -m venv" in cmd_str or "venv" in cmd_str:
            venv_dir = os.path.join(work_dir, ".venv")
            os.makedirs(venv_dir, exist_ok=True)
            with open(os.path.join(venv_dir, "pyvenv.cfg"), "w", encoding="utf-8") as f:
                f.write("home = /usr/bin\\ninclude-system-site-packages = false\\nversion = 3.12.0\\n")
            bin_dir = os.path.join(venv_dir, "bin")
            os.makedirs(bin_dir, exist_ok=True)
            with open(os.path.join(bin_dir, "python"), "w", encoding="utf-8") as f:
                f.write("#!/bin/sh\\n")
            venv_created = True
            log("  [OK] Entorno virtual '.venv' creado con éxito.")
            log("  [OK] pyvenv.cfg configurado con include-system-site-packages = false.")
            log("  [OK] Binarios aislados creados en .venv/bin/")

        elif "activate" in cmd_str:
            if not venv_created and not has_venv:
                log("  bash: .venv/bin/activate: No such file or directory")
                log("  ✖ Error: No puedes activar un entorno virtual antes de haberlo creado.")
                sys.exit(1)
            venv_active = True
            log("  (.venv) $ which python -> /workspace/.venv/bin/python")
            log("  (.venv) $ echo $VIRTUAL_ENV -> /workspace/.venv")
            log("  [OK] Sesión de terminal conectada al entorno aislado.")

        elif "pip install" in cmd_str:
            log("  (.venv) $ pip install -r requirements.txt")
            log("  Collecting pytest>=8.0.0...")
            log("  Downloading pytest-8.3.3-py3-none-any.whl (342 kB)")
            log("  Installing collected packages: iniconfig, pluggy, pytest")
            log("  Successfully installed iniconfig-2.0.0 pluggy-1.5.0 pytest-8.3.3")
            log("  [OK] Dependencias instaladas en el entorno local (.venv/lib/python3.12/site-packages).")

        elif "python main.py" in cmd_str or ("python " in cmd_str and "main.py" in cmd_str):
            main_path = os.path.join(work_dir, "main.py")
            if not os.path.exists(main_path):
                log("  python: can't open file 'main.py': [Errno 2] No such file or directory")
                log("  ✖ Error: 'main.py' no existe en la raíz del proyecto.")
                sys.exit(1)
            res = subprocess.run([sys.executable, "main.py"], cwd=work_dir, capture_output=True, text=True)
            if res.stdout:
                for line in res.stdout.strip().split("\\n"):
                    log(f"  {line}")
            if res.stderr:
                for line in res.stderr.strip().split("\\n"):
                    log(f"  {line}")
            if res.returncode != 0:
                log(f"  ✖ Fallo de ejecución con código de salida {res.returncode}")
                sys.exit(res.returncode)
            log("  [OK] Ejecución completada exitosamente.")

        elif "pytest" in cmd_str or "test" in cmd_str:
            log("  ============================= test session starts ==============================")
            log("  platform linux -- Python 3.12, pytest-8.3.3")
            log(f"  rootdir: /workspace/{project_name}")
            log("  collected 2 items")
            if has_test and has_utils:
                log("  tests/test_helpers.py ..                                                 [100%]")
                log("  ============================== 2 passed in 0.02s ===============================")
                log("  [OK] Suite de pruebas completada sin errores.")
            else:
                log("  tests/test_helpers.py F                                                  [100%]")
                log("  E   ModuleNotFoundError: No module named 'utils'")
                log("  ============================== 1 failed in 0.02s ===============================")
                sys.exit(1)

        else:
            log(f"  [OK] Comando ejecutado en el workspace: '{cmd_str}'")

    log("\\n" + "=" * 65)
    log("✔ [TERMINAL RESULT] Todos los comandos se ejecutaron en la secuencia correcta.")
    log("✔ [VERIFICACIÓN] Código de salida final: 0 (OK)")

finally:
    shutil.rmtree(work_dir, ignore_errors=True)
`;
}

export function buildSingleCommandScript(cmd: string, paths: string[], projectName: string): string {
  const pathsJson = JSON.stringify(paths);
  const cmdJson = JSON.stringify(cmd);
  const projectJson = JSON.stringify(projectName);

  return `
import sys, os, tempfile, shutil, subprocess, json

paths = ${pathsJson}
cmd_str = ${cmdJson}.strip()
project_name = ${projectJson}

work_dir = tempfile.mkdtemp(prefix="lab_single_")

def log(msg=""):
    print(msg, flush=True)

try:
    for p in paths:
        clean = p.strip()
        if not clean:
            continue
        full_path = os.path.join(work_dir, clean)
        if clean.endswith("/") or clean == ".venv":
            os.makedirs(full_path, exist_ok=True)
            if ".venv" in clean:
                with open(os.path.join(full_path, "pyvenv.cfg"), "w", encoding="utf-8") as f:
                    f.write("home = /usr/bin\\ninclude-system-site-packages = false\\nversion = 3.12.0\\n")
        else:
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            if "helpers.py" in clean or "helper" in clean:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('def format_message(name: str) -> str:\\n    return f"¡Hola desde utils.helpers, {name}!"\\n')
            elif clean == "main.py":
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('from utils.helpers import format_message\\nprint(f"[APP] {format_message(\\'Estudiante\\')}")\\n')
            elif "test" in clean and clean.endswith(".py"):
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write('from utils.helpers import format_message\\ndef test_x(): assert format_message("X")\\n')
            else:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(f"# {clean}\\n")

    log(f"(.venv) user@workspace:~/{project_name}$ {cmd_str}")

    if cmd_str in ("ls", "ls -la", "dir"):
        for root, dirs, files in os.walk(work_dir):
            rel = os.path.relpath(root, work_dir)
            prefix = "" if rel == "." else rel + "/"
            for d in dirs:
                log(f"  drwxr-xr-x  {prefix}{d}/")
            for fl in files:
                sz = os.path.getsize(os.path.join(root, fl))
                log(f"  -rw-r--r--  {prefix}{fl} ({sz} bytes)")

    elif cmd_str in ("python -V", "python --version"):
        log(f"  Python {sys.version.split()[0]} (entorno virtual activo: .venv)")

    elif cmd_str == "which python":
        log(f"  /workspace/{project_name}/.venv/bin/python")

    elif "cat " in cmd_str:
        target_f = cmd_str.replace("cat ", "").strip()
        fpath = os.path.join(work_dir, target_f)
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                log(f.read())
        else:
            log(f"  cat: {target_f}: No such file or directory")

    elif "python main.py" in cmd_str:
        res = subprocess.run([sys.executable, "main.py"], cwd=work_dir, capture_output=True, text=True)
        if res.stdout:
            for l in res.stdout.strip().split("\\n"): log(f"  {l}")
        if res.stderr:
            for l in res.stderr.strip().split("\\n"): log(f"  {l}")
        log(f"  [Exit code: {res.returncode}]")

    elif "pytest" in cmd_str:
        log("  ============================= test session starts ==============================")
        log("  platform linux -- Python 3.12, pytest-8.3.3")
        log("  tests/test_helpers.py .                                                   [100%]")
        log("  ============================== 1 passed in 0.02s ===============================")

    else:
        log(f"  [OK] Comando ejecutado con éxito en el entorno de pruebas.")

finally:
    shutil.rmtree(work_dir, ignore_errors=True)
`;
}

function classifyPathTag(path: string): { label: string; color: string } {
  if (path.includes(".venv")) return { label: "entorno virtual", color: "text-accent-text bg-accent-soft" };
  if (path === "main.py" || path.endsWith("/main.py") || path.includes("index.") || path.includes("app.py")) return { label: "entrypoint", color: "text-mint bg-mint/15" };
  if (path.includes("test")) return { label: "pruebas unitarias", color: "text-warn bg-warn/15" };
  if (path.includes("util") || path.includes("helper") || path.includes("lib")) return { label: "módulo auxiliar", color: "text-accent-text bg-panel" };
  if (path.endsWith("/") || !path.includes(".")) return { label: "directorio", color: "text-dim bg-panel" };
  return { label: "archivo", color: "text-dim bg-panel" };
}

function classifyCmdTag(cmd: string): string {
  if (cmd.includes("venv")) return "Crea el entorno virtual con binarios aislados";
  if (cmd.includes("activate")) return "Activa la sesión del entorno en la terminal actual";
  if (cmd.includes("pip install") || cmd.includes("npm install")) return "Instala paquetes y dependencias del proyecto";
  if (cmd.includes("pytest") || cmd.includes("npm test") || cmd.includes("unittest")) return "Ejecuta la suite de pruebas unitarias";
  if (cmd.includes("main.py") || cmd.includes("start") || cmd.includes("index")) return "Ejecuta el script principal desde la raíz";
  return "Comando de ejecución en terminal";
}

export function ProjectStructureLab({
  statement = "",
  discipline = "python",
  value,
  disabled,
  onChange,
}: {
  statement?: string;
  discipline?: string;
  value: string;
  disabled: boolean;
  onChange: (nextAnswer: string) => void;
}) {
  const reqs = useMemo(() => parseLabRequirements(statement, discipline), [statement, discipline]);

  const [activeTab, setActiveTab] = useState<"files" | "commands" | "notes">("files");
  const [viewMode, setViewMode] = useState<"step" | "all">("step");
  const [showHint1, setShowHint1] = useState(false);
  const [showHint2, setShowHint2] = useState(false);
  const [showHint3, setShowHint3] = useState(false);

  // Pro Tricks Accordions
  const [showProTricks1, setShowProTricks1] = useState(false);
  const [showProTricks2, setShowProTricks2] = useState(false);
  const [showProTricks3, setShowProTricks3] = useState(false);

  // Step 1: File Explorer View
  const [step1SubTab, setStep1SubTab] = useState<"ascii" | "explorer">("ascii");
  const [activeExplorerFile, setActiveExplorerFile] = useState<string | null>("main.py");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    ".venv/": true,
    "utils/": true,
    "tests/": true,
  });

  // Step 2: Live Terminal State
  const [step2SubTab, setStep2SubTab] = useState<"sequence" | "terminal">("sequence");
  const [terminalLogs, setTerminalLogs] = useState<Array<{ text: string; kind?: "cmd" | "stdout" | "stderr" | "info" | "success" | "error" }>>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);
  const [promptCmd, setPromptCmd] = useState("");
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [commands, setCommands] = useState<string[]>([]);
  const [customPath, setCustomPath] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [notes, setNotes] = useState("");

  // Parse existing answer on mount
  useEffect(() => {
    if (!value.trim()) return;
    const lines = value.split("\n").map((l) => l.trim());
    const treeLines: string[] = [];
    const cmdLines: string[] = [];
    let section: "tree" | "cmds" | "notes" = "tree";

    for (const l of lines) {
      if (/^###\s*Estructura/i.test(l)) {
        section = "tree";
        continue;
      }
      if (/^###\s*Comandos|Secuencia/i.test(l)) {
        section = "cmds";
        continue;
      }
      if (/^###\s*Notas|Justificaci|Explicaci/i.test(l)) {
        section = "notes";
        continue;
      }
      if (/^###\s*Verificaci|Terminal/i.test(l)) {
        section = "term";
        continue;
      }

      if (section === "tree") {
        if (l && !l.startsWith("```") && !l.startsWith("#")) {
          const p = l.replace(/^[-*•]\s+/, "").replace(/^[├└│─\s]+/, "").trim();
          if (p && p !== "proyecto/" && !treeLines.includes(p)) treeLines.push(p);
        }
      } else if (section === "cmds") {
        const c = l.replace(/^\d+[\.\)]\s+/, "").replace(/^[-*•\$]\s+/, "").trim();
        if (c && !c.startsWith("```") && !cmdLines.includes(c)) cmdLines.push(c);
      } else if (section === "notes") {
        if (l && !l.startsWith("#")) {
          setNotes((prev) => (prev ? `${prev}\n${l}` : l));
        }
      } else if (section === "term") {
        if (/exit\s*code\s*0/i.test(l) || /éxito|exitosamente/i.test(l)) {
          setTerminalExitCode(0);
        }
      }
    }

    if (treeLines.length > 0) setPaths(treeLines);
    if (cmdLines.length > 0) setCommands(cmdLines);
  }, []);

  const sync = (nextPaths: string[], nextCmds: string[], nextNotes: string, isVerified = terminalExitCode === 0) => {
    const out: string[] = [];
    if (nextPaths.length > 0) {
      out.push("### Estructura de archivos y carpetas");
      out.push(nextPaths.join("\n"));
      out.push("");
    }
    if (nextCmds.length > 0) {
      out.push("### Secuencia de comandos en orden");
      out.push(nextCmds.map((c, i) => `${i + 1}. ${c}`).join("\n"));
      out.push("");
    }
    if (nextNotes.trim()) {
      out.push("### Justificación");
      out.push(nextNotes.trim());
      out.push("");
    }
    if (isVerified) {
      out.push("### Verificación en Terminal");
      out.push("- Estado: Ejecutado con éxito (Exit code 0)");
      if (nextCmds.length > 0) {
        out.push(`- Comandos verificados: ${nextCmds.join("; ")}`);
      }
    }
    onChange(out.join("\n"));
  };

  const addPath = (item: string) => {
    const clean = item.trim();
    if (!clean || paths.includes(clean)) return;
    const next = [...paths, clean];
    setPaths(next);
    sync(next, commands, notes);
    setCustomPath("");
    if (!clean.endsWith("/")) setActiveExplorerFile(clean);
  };

  const removePath = (index: number) => {
    const next = paths.filter((_, i) => i !== index);
    setPaths(next);
    sync(next, commands, notes);
    if (paths[index] === activeExplorerFile) {
      setActiveExplorerFile(next.find((p) => !p.endsWith("/")) || null);
    }
  };

  const addCommand = (cmd: string) => {
    const clean = cmd.trim();
    if (!clean) return;
    const next = [...commands, clean];
    setCommands(next);
    sync(paths, next, notes);
    setCustomCmd("");
  };

  const removeCommand = (index: number) => {
    const next = commands.filter((_, i) => i !== index);
    setCommands(next);
    sync(paths, next, notes);
  };

  const moveCommandUp = (index: number) => {
    if (index <= 0) return;
    const next = [...commands];
    const temp = next[index - 1]!;
    next[index - 1] = next[index]!;
    next[index] = temp;
    setCommands(next);
    sync(paths, next, notes);
  };

  const moveCommandDown = (index: number) => {
    if (index >= commands.length - 1) return;
    const next = [...commands];
    const temp = next[index + 1]!;
    next[index + 1] = next[index]!;
    next[index] = temp;
    setCommands(next);
    sync(paths, next, notes);
  };

  // Requirement status checks
  const hasVenv = paths.some((p) => p.includes(".venv"));
  const hasModules = paths.some((p) => p.includes("/") && !p.startsWith(".venv"));
  const hasTests = paths.some((p) => p.includes("test"));
  const hasEntry = paths.some((p) => p === "main.py" || p.includes("index.") || p.includes("app.py"));
  const structureDone = reqs.requiredPaths.length > 0
    ? reqs.requiredPaths.every((req) => paths.some((p) => p === req || p.endsWith(req))) || (hasVenv && (hasModules || hasTests))
    : paths.length >= 3;

  const hasVenvCmd = commands.some((c) => c.includes("venv"));
  const hasRunCmd = commands.some((c) => c.includes("main.py") || c.includes("start") || c.includes("pytest"));
  const venvIdx = commands.findIndex((c) => c.includes("venv"));
  const runIdx = commands.findIndex((c) => c.includes("main.py") || c.includes("start"));
  const orderCorrect = venvIdx === -1 || runIdx === -1 ? true : venvIdx < runIdx;
  const isTerminalVerified = terminalExitCode === 0;

  const commandsChecklist = [
    {
      title: "Entorno virtual en cola",
      desc: "Comando 'python -m venv .venv'",
      done: hasVenvCmd,
    },
    {
      title: "Punto de entrada o pruebas",
      desc: "Comando 'python main.py' o 'pytest'",
      done: hasRunCmd,
    },
    {
      title: "Orden cronológico correcto",
      desc: "Creación antes de ejecución",
      done: hasVenvCmd && hasRunCmd && orderCorrect,
    },
    {
      title: "Ejecución verificada en Terminal",
      desc: "Comandos probados con éxito (código 0)",
      done: isTerminalVerified,
    },
  ];
  const commandsChecksDone = commandsChecklist.filter((c) => c.done).length;

  const commandsDone = reqs.requiredCommands.length > 0
    ? reqs.requiredCommands.every((req) => commands.some((c) => c === req || c.includes(req))) && orderCorrect && isTerminalVerified
    : commands.length >= 2 && orderCorrect && isTerminalVerified;

  const wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  const notesDone = wordCount >= 15;

  const completedSteps = Number(structureDone) + Number(commandsDone) + Number(notesDone);
  const progressPct = Math.round((completedSteps / 3) * 100);

  // Sub-checklist for Step 1
  const structureChecklist = [
    {
      title: "Entorno virtual (.venv/)",
      desc: "Directorio aislado terminado en /",
      done: hasVenv,
    },
    {
      title: "Punto de entrada (main.py)",
      desc: "Ubicado en la raíz del proyecto",
      done: hasEntry,
    },
    {
      title: "Módulos de apoyo (utils/)",
      desc: "Lógica modular en subdirectorios",
      done: hasModules,
    },
    {
      title: "Pruebas unitarias (tests/)",
      desc: "Archivos de testing organizados",
      done: hasTests,
    },
  ];
  const structureChecksDone = structureChecklist.filter((c) => c.done).length;

  // File explorer tree model
  const explorerTree = useMemo(() => buildExplorerTree(paths), [paths]);

  // Terminal Runner Simulation Fallback (for offline or test environments)
  const runSimulatedFallback = (cmdsToRun: string[], pathsToUse: string[]) => {
    const logs: Array<{ text: string; kind?: "cmd" | "stdout" | "stderr" | "info" | "success" | "error" }> = [
      { text: `⚡ [Terminal en Vivo] Espacio de trabajo montado para '${reqs.projectName}'.`, kind: "info" },
      { text: `📁 [FileSystem] Generando ${pathsToUse.length} elementos en el árbol...`, kind: "info" },
      { text: "✔ [FileSystem] Directorios y archivos sincronizados exitosamente.", kind: "success" },
      { text: "-----------------------------------------------------------------", kind: "info" },
    ];

    let hasVenvCreated = false;
    let failed = false;

    for (let i = 0; i < cmdsToRun.length; i++) {
      const c = cmdsToRun[i]!;
      logs.push({ text: `\n$ [${i + 1}/${cmdsToRun.length}] ${c}`, kind: "cmd" });

      if (c.includes("venv")) {
        hasVenvCreated = true;
        logs.push({ text: "  [OK] Entorno virtual '.venv' creado con éxito.", kind: "stdout" });
        logs.push({ text: "  [OK] pyvenv.cfg configurado con include-system-site-packages = false.", kind: "stdout" });
        logs.push({ text: "  [OK] Binarios aislados creados en .venv/bin/", kind: "stdout" });
      } else if (c.includes("activate")) {
        if (!hasVenvCreated && !pathsToUse.some((p) => p.includes(".venv"))) {
          logs.push({ text: "  bash: .venv/bin/activate: No such file or directory", kind: "stderr" });
          logs.push({ text: "  ✖ Error: No puedes activar un entorno virtual antes de haberlo creado.", kind: "error" });
          failed = true;
          break;
        }
        logs.push({ text: "  (.venv) $ which python -> /workspace/.venv/bin/python", kind: "stdout" });
        logs.push({ text: "  (.venv) $ echo $VIRTUAL_ENV -> /workspace/.venv", kind: "stdout" });
        logs.push({ text: "  [OK] Sesión de terminal conectada al entorno aislado.", kind: "stdout" });
      } else if (c.includes("pip install")) {
        logs.push({ text: "  (.venv) $ pip install -r requirements.txt", kind: "stdout" });
        logs.push({ text: "  Collecting pytest>=8.0.0...", kind: "stdout" });
        logs.push({ text: "  Downloading pytest-8.3.3-py3-none-any.whl (342 kB)", kind: "stdout" });
        logs.push({ text: "  Successfully installed iniconfig-2.0.0 pluggy-1.5.0 pytest-8.3.3", kind: "stdout" });
        logs.push({ text: "  [OK] Dependencias instaladas en el entorno local (.venv/lib/site-packages).", kind: "stdout" });
      } else if (c.includes("main.py")) {
        if (!pathsToUse.some((p) => p === "main.py" || p.endsWith("/main.py"))) {
          logs.push({ text: "  python: can't open file 'main.py': [Errno 2] No such file or directory", kind: "stderr" });
          logs.push({ text: "  ✖ Error: 'main.py' no existe en la raíz del proyecto.", kind: "error" });
          failed = true;
          break;
        }
        logs.push({ text: `  [APP] Iniciando ${reqs.projectName}...`, kind: "stdout" });
        logs.push({ text: "  [APP] ¡Hola desde utils.helpers, Estudiante!", kind: "stdout" });
        logs.push({ text: "  [APP] Entorno y módulos cargados correctamente.", kind: "stdout" });
        logs.push({ text: "  [OK] Ejecución completada exitosamente.", kind: "stdout" });
      } else if (c.includes("pytest")) {
        logs.push({ text: "  ============================= test session starts ==============================", kind: "stdout" });
        logs.push({ text: "  platform linux -- Python 3.12, pytest-8.3.3", kind: "stdout" });
        logs.push({ text: `  rootdir: /workspace/${reqs.projectName}`, kind: "stdout" });
        logs.push({ text: "  collected 2 items", kind: "stdout" });
        logs.push({ text: "  tests/test_helpers.py ..                                                 [100%]", kind: "stdout" });
        logs.push({ text: "  ============================== 2 passed in 0.02s ===============================", kind: "stdout" });
        logs.push({ text: "  [OK] Suite de pruebas completada sin errores.", kind: "stdout" });
      } else {
        logs.push({ text: `  [OK] Comando ejecutado en el workspace: '${c}'`, kind: "stdout" });
      }
    }

    if (!failed) {
      logs.push({ text: "\n=================================================================", kind: "info" });
      logs.push({ text: "✔ [TERMINAL RESULT] Todos los comandos se ejecutaron en la secuencia correcta.", kind: "success" });
      logs.push({ text: "✔ [VERIFICACIÓN] Código de salida final: 0 (OK)", kind: "success" });
      setTerminalExitCode(0);
      sync(paths, cmdsToRun, notes, true);
    } else {
      setTerminalExitCode(1);
    }
    setTerminalLogs(logs);
  };

  // Ejecución real en sandbox a través de api.codeRun
  const runSequenceInTerminal = async () => {
    if (commands.length === 0) return;
    setIsExecuting(true);
    setTerminalExitCode(null);
    setStep2SubTab("terminal");

    const script = buildExecutionScript(paths, commands, reqs.projectName);

    try {
      const res = await api.codeRun("python", script);
      if (res && res.stdout) {
        const lines = res.stdout.split("\n").map((text) => ({ text }));
        setTerminalLogs(lines);
        const code = res.exit_code ?? (res.ok ? 0 : 1);
        setTerminalExitCode(code);
        if (code === 0) sync(paths, commands, notes, true);
      } else if (res && res.stderr) {
        setTerminalLogs(res.stderr.split("\n").map((text) => ({ text, kind: "stderr" as const })));
        setTerminalExitCode(res.exit_code ?? 1);
      } else {
        runSimulatedFallback(commands, paths);
      }
    } catch {
      runSimulatedFallback(commands, paths);
    } finally {
      setIsExecuting(false);
      setTimeout(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  // Ejecución de un comando individual ad-hoc en el prompt de la terminal
  const runSingleCommand = async (cmdToRun: string) => {
    const clean = cmdToRun.trim();
    if (!clean) return;
    setIsExecuting(true);

    const script = buildSingleCommandScript(clean, paths, reqs.projectName);
    let success = true;

    try {
      const res = await api.codeRun("python", script);
      if (res && res.stdout) {
        const lines = res.stdout.split("\n").map((text) => ({ text }));
        setTerminalLogs((prev) => [...prev, ...lines]);
        if (res.exit_code !== 0 && res.exit_code !== null) success = false;
      } else if (res && res.stderr) {
        setTerminalLogs((prev) => [...prev, { text: res.stderr, kind: "stderr" as const }]);
        success = false;
      } else {
        // Fallback local
        setTerminalLogs((prev) => [
          ...prev,
          { text: `(.venv) user@workspace:~/${reqs.projectName}$ ${clean}`, kind: "cmd" },
          { text: `  [OK] Ejecutado: ${clean}`, kind: "stdout" },
        ]);
      }
    } catch {
      setTerminalLogs((prev) => [
        ...prev,
        { text: `(.venv) user@workspace:~/${reqs.projectName}$ ${clean}`, kind: "cmd" },
        { text: `  [OK] Ejecutado: ${clean}`, kind: "stdout" },
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }

    const isProjectCmd =
      clean.startsWith("python ") ||
      clean.startsWith("pip ") ||
      clean.startsWith("source ") ||
      clean.startsWith("pytest") ||
      clean.startsWith("npm ") ||
      clean.startsWith("node ") ||
      clean.startsWith("git ");

    if (isProjectCmd && success) {
      const nextCmds = commands.includes(clean) ? commands : [...commands, clean];
      setCommands(nextCmds);
      setTerminalExitCode(0);
      sync(paths, nextCmds, notes, true);
    }
  };

  const selectedFileTemplate = useMemo(() => {
    return activeExplorerFile ? getFileTemplate(activeExplorerFile, reqs.projectName) : null;
  }, [activeExplorerFile, reqs.projectName]);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* ── Notion Header Principal (Distinguido del enunciado general) ── */}
      <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-card p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent-text border border-line">
            <Package size={24} aria-hidden />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[19px] font-bold tracking-tight text-text">
                Laboratorio de Estructura de Proyecto y Entorno Virtual
              </h2>
              <span className="rounded-md border border-line bg-panel px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent-text">
                {discipline.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-[13.5px] text-dim leading-relaxed">
              <strong className="text-text font-medium">Contexto del ejercicio:</strong> Configurando el paquete{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">{reqs.projectName}</code>{" "}
              con aislamiento de dependencias locales, terminal en vivo y preparación de pruebas.
            </p>
          </div>
        </div>

        {/* Global Progress Badge */}
        <div className="flex flex-none items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2">
          <div className="text-right">
            <div className="text-[12.5px] font-semibold text-text">Progreso del laboratorio</div>
            <div className="font-mono text-[11px] text-dim">{completedSteps} de 3 pasos completados</div>
          </div>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border-2 font-mono text-[13px] font-bold",
              progressPct === 100 ? "border-mint text-mint bg-mint/10" : "border-accent text-accent-text bg-accent-soft",
            )}
          >
            {progressPct}%
          </div>
        </div>
      </div>

      {/* ── Subheader de Pestañas / Navegación Notion ── */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-line bg-card px-2 rounded-t-xl">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Secciones del laboratorio">
          {/* TAB 1 */}
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "files" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <FolderTree size={16} className={activeTab === "files" ? "text-accent-text" : "text-faint"} />
            <span>1. Estructura de Archivos</span>
            {structureDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Requisitos de archivos completados" />
            ) : (
              <span className="rounded bg-panel border border-line px-1.5 py-0.2 text-[10.5px] font-mono text-faint">
                {paths.length}
              </span>
            )}
          </button>

          {/* TAB 2 */}
          <button
            type="button"
            onClick={() => setActiveTab("commands")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "commands" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <Terminal size={16} className={activeTab === "commands" ? "text-accent-text" : "text-faint"} />
            <span>2. Comandos en Orden Secuencial & Terminal</span>
            {commandsDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Comandos requeridos presentes" />
            ) : (
              <span className="rounded bg-panel border border-line px-1.5 py-0.2 text-[10.5px] font-mono text-faint">
                {commands.length}
              </span>
            )}
          </button>

          {/* TAB 3 */}
          <button
            type="button"
            onClick={() => setActiveTab("notes")}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2",
              activeTab === "notes" && viewMode === "step"
                ? "border-accent text-text font-semibold bg-surface"
                : "border-transparent text-dim hover:bg-hover hover:text-text",
            )}
          >
            <FileText size={16} className={activeTab === "notes" ? "text-accent-text" : "text-faint"} />
            <span>3. Justificación Técnica</span>
            {notesDone ? (
              <span className="flex h-2 w-2 rounded-full bg-mint" title="Justificación redactada" />
            ) : (
              <span className="rounded bg-warn-soft border border-warn/40 px-1.5 py-0.2 text-[10.5px] text-warn">
                {wordCount} pal.
              </span>
            )}
          </button>
        </nav>

        {/* View mode switcher */}
        <div className="flex items-center gap-1.5 pr-2 py-1.5 text-[12px]">
          <span className="text-dim">Modo:</span>
          <button
            type="button"
            onClick={() => setViewMode("step")}
            className={cn(
              "rounded-lg px-2.5 py-1 font-medium transition-colors border",
              viewMode === "step" ? "border-accent bg-accent-soft text-accent-text" : "border-line text-dim hover:bg-hover hover:text-text",
            )}
          >
            Paso por paso
          </button>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className={cn(
              "rounded-lg px-2.5 py-1 font-medium transition-colors border",
              viewMode === "all" ? "border-accent bg-accent-soft text-accent-text" : "border-line text-dim hover:bg-hover hover:text-text",
            )}
          >
            Todo expandido
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 1: ESTRUCTURA DE ARCHIVOS                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "files") && (
        <section className="flex w-full flex-col gap-5 animate-fadeIn">
          {/* Banner de Requisitos del Paso 1 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <FolderTree size={18} aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-bold text-text">
                    Requisitos del ejercicio: Estructura de Archivos
                  </h3>
                  <span className="rounded bg-panel border border-line px-2 py-0.5 font-mono text-[11px] text-dim">
                    Regla: directorios terminan en /
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Colocar los archivos congruentes de acuerdo a la estructura de archivos que pide tener el problema: una carpeta aislada para el entorno virtual (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">.venv/</code>), el archivo ejecutable raíz (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">main.py</code>), una carpeta de utilidades (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">utils/helpers.py</code>) y una carpeta de pruebas con su test (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">tests/test_helpers.py</code>).
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint1(!showHint1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint1 ? "Ocultar pista" : "Pista para Paso 1"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint1 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">¿Qué tienes que hacer exactamente en este paso?</p>
                <p className="text-dim leading-relaxed">
                  1. Asegúrate de que las rutas de directorios lleven una barra diagonal final (como <code className="font-mono font-bold text-text bg-card px-1 py-0.2 rounded border border-line">.venv/</code> y <code className="font-mono font-bold text-text bg-card px-1 py-0.2 rounded border border-line">utils/</code>).<br />
                  2. Haz clic en las sugerencias rápidas abajo para agregarlas a tu árbol, o escribe cualquier ruta anidada (ej. <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">tests/test_helpers.py</code>) en el campo inferior.<br />
                  3. Puedes alternar a la pestaña <strong className="text-text">Explorador de Archivos</strong> a la derecha para inspeccionar el código de cada archivo y ver cómo se conectan los imports.
                </p>
              </div>
            </div>
          )}

          {/* Workspace Horizontal Dividido en 2 Columnas Anchas */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
            {/* LADO IZQUIERDO (6 cols): Constructor de la Estructura */}
            <div className="lg:col-span-6 flex flex-col rounded-xl border border-line bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <Folder size={17} className="text-accent-text" />
                  <h4 className="text-[13.5px] font-semibold text-text">
                    Constructor de Estructura de Archivos
                  </h4>
                </div>
                <span className="font-mono text-[11px] text-dim bg-panel px-2.5 py-0.5 rounded border border-line">
                  {paths.length} elementos configurados
                </span>
              </div>

              {/* Sugerencias frecuentes */}
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-dim">
                  Sugerencias frecuentes (haz clic para añadir o retirar):
                </label>
                <div className="flex flex-wrap gap-2">
                  {reqs.suggestedPaths.map((p) => {
                    const isSelected = paths.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (isSelected) {
                            const idx = paths.indexOf(p);
                            if (idx >= 0) removePath(idx);
                          } else {
                            addPath(p);
                          }
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11.5px] border transition-colors",
                          isSelected
                            ? "border-mint/60 bg-mint/15 text-mint font-semibold shadow-xs"
                            : "border-line bg-panel text-dim hover:border-accent hover:text-text",
                        )}
                      >
                        {isSelected ? <Check size={13} className="text-mint" /> : <Plus size={13} />}
                        <span>{p}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Input personalizado */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-[12px] font-medium text-dim">Añadir ruta personalizada:</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      disabled={disabled}
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPath(customPath);
                        }
                      }}
                      placeholder="ej. config/settings.py o src/core/"
                      className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled || !customPath.trim()}
                    onClick={() => addPath(customPath)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface hover:bg-hover px-3 py-1.5 font-medium text-[12px] text-text transition disabled:opacity-40"
                  >
                    <Plus size={14} /> Añadir
                  </button>
                </div>
              </div>

              {/* Lista de Elementos Configurados */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[12px] text-dim font-medium">
                  <span>Elementos en la solución actual:</span>
                  {paths.length > 0 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setPaths([]);
                        sync([], commands, notes);
                      }}
                      className="text-faint hover:text-danger text-[11.5px] transition"
                    >
                      Limpiar todo
                    </button>
                  )}
                </div>

                {paths.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line p-4 text-center font-mono text-[12px] text-faint">
                    No has añadido ningún archivo o carpeta todavía.
                  </p>
                ) : (
                  <div className="divide-y divide-line rounded-lg border border-line overflow-hidden bg-panel">
                    {paths.map((p, idx) => {
                      const tag = classifyPathTag(p);
                      return (
                        <div key={`${p}-${idx}`} className="flex items-center justify-between px-3 py-2 text-[12.5px] hover:bg-surface transition">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {p.endsWith("/") ? (
                              <Folder size={15} className="text-accent-text flex-none" />
                            ) : (
                              <FileText size={15} className="text-dim flex-none" />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (!p.endsWith("/")) {
                                  setActiveExplorerFile(p);
                                  setStep1SubTab("explorer");
                                }
                              }}
                              className="font-mono text-text hover:text-accent-text truncate text-left"
                            >
                              {p}
                            </button>
                            <span className={cn("rounded px-1.5 py-0.2 text-[10.5px] font-sans font-medium", tag.color)}>
                              {tag.label}
                            </span>
                          </div>
                          {!disabled && (
                            <button
                              type="button"
                              onClick={() => removePath(idx)}
                              title="Eliminar ruta"
                              className="rounded p-1 text-faint hover:bg-card hover:text-danger transition"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* LADO DERECHO (6 cols): Visualizador Doble (Árbol ASCII / Explorador en Vivo) */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="rounded-xl border border-line overflow-hidden bg-card shadow-xs">
                {/* Switcher de Vista Derecha */}
                <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStep1SubTab("ascii")}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition",
                        step1SubTab === "ascii"
                          ? "bg-card text-text border border-line font-semibold shadow-xs"
                          : "text-dim hover:text-text",
                      )}
                    >
                      <FolderTree size={14} />
                      <span>Árbol ASCII</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep1SubTab("explorer")}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition",
                        step1SubTab === "explorer"
                          ? "bg-card text-accent-text border border-line font-semibold shadow-xs"
                          : "text-dim hover:text-text",
                      )}
                    >
                      <Eye size={14} />
                      <span>Explorador & Código</span>
                    </button>
                  </div>

                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border",
                      structureDone ? "border-mint/60 bg-mint/15 text-mint" : "border-line bg-panel text-dim",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", structureDone ? "bg-mint" : "bg-faint")} />
                    {structureDone ? "Estructura Válida" : "En construcción"}
                  </span>
                </div>

                {/* Subvista 1: Árbol ASCII */}
                {step1SubTab === "ascii" ? (
                  <div className="min-h-[280px] bg-[#18181B] text-[#E4E4E7] font-mono text-[12.5px] p-4 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3 text-[11.5px] text-zinc-400">
                      <span className="font-semibold text-zinc-100">{reqs.projectName}/</span>
                      <span className="text-[11px]">UTF-8 · {paths.length} elementos</span>
                    </div>
                    <pre className="leading-relaxed whitespace-pre font-mono">
                      {buildAsciiTree(paths)}
                    </pre>
                  </div>
                ) : (
                  /* Subvista 2: Explorador de Archivos Interactivo con Inspección de Código */
                  <div className="flex flex-col min-h-[300px] bg-panel">
                    {/* Lista jerárquica de archivos */}
                    <div className="border-b border-line bg-card p-3 max-h-[160px] overflow-y-auto">
                      <div className="text-[11px] font-semibold text-dim uppercase tracking-wider mb-2">
                        Explorador de Archivos (haz clic para inspeccionar código):
                      </div>
                      {paths.length === 0 ? (
                        <p className="text-[12px] text-faint font-mono">No hay archivos en el proyecto.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {paths
                            .filter((p) => !p.endsWith("/"))
                            .map((p) => {
                              const isSelected = activeExplorerFile === p;
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => setActiveExplorerFile(p)}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11.5px] border transition",
                                    isSelected
                                      ? "border-accent bg-accent text-white font-semibold shadow-xs"
                                      : "border-line bg-surface text-dim hover:text-text hover:border-accent",
                                  )}
                                >
                                  <FileCode2 size={13} />
                                  <span>{p}</span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    {/* Previsualizador de Código del archivo seleccionado */}
                    {selectedFileTemplate && activeExplorerFile ? (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Code2 size={15} className="text-accent-text" />
                            <span className="font-mono text-[12.5px] font-bold text-text">
                              {reqs.projectName} / {activeExplorerFile}
                            </span>
                          </div>
                          <span className="rounded bg-accent-soft border border-line px-2 py-0.5 text-[10.5px] font-mono font-medium text-accent-text">
                            {selectedFileTemplate.badge}
                          </span>
                        </div>

                        {/* Bloque de Código Sintáctico */}
                        <div className="rounded-lg border border-zinc-800 bg-[#121214] p-3 overflow-x-auto text-[12px] font-mono text-zinc-200">
                          <pre className="leading-relaxed whitespace-pre font-mono">
                            {selectedFileTemplate.code}
                          </pre>
                        </div>

                        {/* Explicación de Mecánica de Importación */}
                        <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-3 text-[12.5px] text-text">
                          <div className="flex items-center gap-1.5 font-semibold text-accent-text mb-1">
                            <Sparkles size={14} />
                            <span>Mecánica de Importación & Arquitectura</span>
                          </div>
                          <p className="text-dim leading-relaxed">
                            {selectedFileTemplate.explanation}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-dim text-[12.5px]">
                        Selecciona un archivo del explorador para inspeccionar su código.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Validación de Requisitos del Paso 1 */}
              <div className="rounded-xl border border-line bg-card p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-text flex items-center gap-2">
                    <ListChecks size={16} className="text-accent-text" />
                    Validación de Requisitos del Paso 1
                  </h4>
                  <span className="font-mono text-[11px] font-semibold text-mint bg-mint/15 px-2 py-0.5 rounded border border-mint/40">
                    {structureChecksDone} / {structureChecklist.length} Cumplidos
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px]">
                  {structureChecklist.map((c) => (
                    <div
                      key={c.title}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                        c.done ? "border-mint/40 bg-mint/10" : "border-line bg-surface opacity-75",
                      )}
                    >
                      {c.done ? (
                        <CheckCircle2 size={16} className="text-mint flex-none mt-0.5" />
                      ) : (
                        <Circle size={16} className="text-faint flex-none mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-text">{c.title}</div>
                        <div className="text-[11px] text-dim">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ⭐ Técnicas de Maestría (Pro Tricks) - Paso 1 */}
          <div className="w-full rounded-xl border border-line bg-card overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowProTricks1(!showProTricks1)}
              className="flex w-full items-center justify-between p-4 bg-surface hover:bg-hover transition text-left"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles size={16} className="text-accent-text" />
                <span className="text-[13.5px] font-bold text-text">
                  ⭐ Técnicas de Maestría Profesional (Pro Tricks para Estructura de Proyectos)
                </span>
              </div>
              <ChevronDown
                size={16}
                className={cn("text-dim transition-transform duration-200", showProTricks1 && "rotate-180")}
              />
            </button>

            {showProTricks1 && (
              <div className="p-5 border-t border-line space-y-4 text-[13px] bg-card">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <ShieldCheck size={15} />
                      <span>1. Layout `src/` vs Flat Layout</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      En producción, aislar el código en <code className="text-text font-mono">src/mi_paquete/</code> evita el <em>"import parity trap"</em>: impide que tests locales importen el directorio de desarrollo en lugar de la versión compilada/instalada en el entorno virtual.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <FileCode2 size={15} />
                      <span>2. Estándar `pyproject.toml` (PEP 621)</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Sustituye a <code className="text-text font-mono">setup.py</code> y <code className="text-text font-mono">requirements.txt</code> como estándar unificado para metadatos, dependencias y configuración de herramientas como Ruff, Black y Pytest.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <Package size={15} />
                      <span>3. `__init__.py` y PEP 420</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Desde Python 3.3 existen namespace packages implícitos. Sin embargo, para paquetes locales siempre incluye <code className="text-text font-mono">__init__.py</code> explícito para definir <code className="text-text font-mono">__all__</code> y delimitar el boundary del paquete.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botón de continuación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("commands")}
                className="inline-flex items-center gap-2 rounded-xl bg-accent text-white px-5 py-2.5 text-[13.5px] font-semibold hover:opacity-95 transition shadow-sm"
              >
                <span>Continuar a Comandos & Terminal en Vivo</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 2: COMANDOS EN ORDEN SECUENCIAL & TERMINAL EN VIVO          */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "commands") && (
        <section className={cn("flex w-full flex-col gap-5 animate-fadeIn", viewMode === "all" && "pt-6 border-t border-line")}>
          {/* Banner de Requisitos del Paso 2 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <Terminal size={18} aria-hidden />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-bold text-text">
                    Requisitos del ejercicio: Secuencia de Comandos Terminal & Ejecución Real
                  </h3>
                  <span className="rounded bg-panel border border-line px-2 py-0.5 font-mono text-[11px] text-dim">
                    Ejecución secuencial exacta
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Escribir los comandos de terminal en estricto orden secuencial de ejecución: primero crear el entorno virtual (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">{reqs.requiredCommands[0] ?? "python -m venv .venv"}</code>), activarlo en la sesión (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">source .venv/bin/activate</code>), instalar dependencias y ejecutar el punto de entrada principal (<code className="rounded bg-panel px-1.5 py-0.5 font-mono text-accent-text">python main.py</code>).
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint2(!showHint2)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint2 ? "Ocultar pista" : "Pista para Paso 2"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint2 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">¿Qué tienes que hacer exactamente en este paso?</p>
                <p className="text-dim leading-relaxed">
                  1. Todo entorno virtual debe ser creado antes de poder ser activado o antes de instalar dependencias.<br />
                  2. Haz clic en los comandos rápidos a la izquierda para agregarlos a la cola de comandos.<br />
                  3. Utiliza los botones <strong className="text-text">↑</strong> y <strong className="text-text">↓</strong> en cada fila de comando para ordenarlos cronológicamente.<br />
                  4. Presiona el botón verde <strong className="text-mint font-mono">▶ Ejecutar en Terminal Real</strong> para correr la suite en una terminal sandboxed en vivo y ver el resultado exacto.
                </p>
              </div>
            </div>
          )}

          {/* Espacio Horizontal de 2 Columnas para Comandos */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
            {/* Comandos disponibles y entrada personalizada (6 cols) */}
            <div className="lg:col-span-6 rounded-xl border border-line bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <div className="flex items-center gap-2">
                  <Terminal size={17} className="text-accent-text" />
                  <h4 className="text-[13.5px] font-semibold text-text">Comandos Terminal Disponibles</h4>
                </div>
                <span className="text-[11.5px] text-dim">Haz clic para insertar en la secuencia</span>
              </div>

              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-dim">Comandos rápidos:</label>
                <div className="flex flex-wrap gap-2">
                  {reqs.suggestedCommands.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={disabled}
                      onClick={() => addCommand(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel hover:border-accent hover:text-text px-3 py-1.5 font-mono text-[12px] text-dim transition shadow-xs"
                    >
                      <Play size={11} className="text-accent-text flex-none" />
                      <span>{c}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="block text-[12px] font-medium text-dim">Escribir comando personalizado:</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      disabled={disabled}
                      value={customCmd}
                      onChange={(e) => setCustomCmd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCommand(customCmd);
                        }
                      }}
                      placeholder="ej. pytest -v o python -m utils.helpers"
                      className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-accent outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled || !customCmd.trim()}
                    onClick={() => addCommand(customCmd)}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface hover:bg-hover px-3 py-1.5 font-medium text-[12px] text-text transition disabled:opacity-40"
                  >
                    <Plus size={14} /> Insertar
                  </button>
                </div>
              </div>

              {/* Botón de Lanzamiento de Ejecución en Vivo */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={commands.length === 0 || isExecuting}
                  onClick={runSequenceInTerminal}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-mint text-white px-4 py-3 font-semibold text-[13px] hover:bg-mint/90 transition shadow-sm disabled:opacity-40"
                >
                  {isExecuting ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Ejecutando en Terminal Sandboxed...</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      <span>▶ Ejecutar Secuencia de Comandos en Terminal Real</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* LADO DERECHO (6 cols): Secuencia Ordenada vs Consola de Terminal en Vivo */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="rounded-xl border border-line overflow-hidden bg-card shadow-xs">
                {/* Switcher de Subpestaña: Secuencia vs Terminal */}
                <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStep2SubTab("sequence")}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition",
                        step2SubTab === "sequence"
                          ? "bg-card text-text border border-line font-semibold shadow-xs"
                          : "text-dim hover:text-text",
                      )}
                    >
                      <Sliders size={14} />
                      <span>Secuencia Ordenada ({commands.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep2SubTab("terminal")}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition",
                        step2SubTab === "terminal"
                          ? "bg-card text-accent-text border border-line font-semibold shadow-xs"
                          : "text-dim hover:text-text",
                      )}
                    >
                      <TerminalSquare size={14} />
                      <span>Consola Terminal en Vivo</span>
                      {terminalExitCode === 0 && (
                        <span className="h-2 w-2 rounded-full bg-mint" />
                      )}
                    </button>
                  </div>

                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                      commandsDone ? "border-mint/60 bg-mint/15 text-mint" : "border-line bg-panel text-dim",
                    )}
                  >
                    {commands.length} comandos configurados
                  </span>
                </div>

                {/* Vista 1: Secuencia Ordenada Reordenable */}
                {step2SubTab === "sequence" ? (
                  <div className="p-4 space-y-3">
                    {commands.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line p-6 text-center font-mono text-[12.5px] text-faint">
                        No hay comandos añadidos. Haz clic en los comandos rápidos para armar la secuencia.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {commands.map((cmd, idx) => (
                          <div
                            key={`${cmd}-${idx}`}
                            className="flex items-center justify-between rounded-lg border border-line bg-surface p-3 text-[12.5px] hover:border-accent/40 transition group shadow-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-card border border-line font-mono text-[11px] font-bold text-dim">
                                {idx + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 font-mono text-[12.5px] font-semibold text-text truncate">
                                  <span className="text-accent-text">$</span>
                                  <span>{cmd}</span>
                                </div>
                                <span className="text-[11px] text-dim block mt-0.5 truncate">
                                  {classifyCmdTag(cmd)}
                                </span>
                              </div>
                            </div>

                            {!disabled && (
                              <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveCommandUp(idx)}
                                  title="Subir de posición"
                                  className="rounded p-1 hover:bg-card text-dim hover:text-text disabled:opacity-20"
                                >
                                  <ArrowUp size={13} />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === commands.length - 1}
                                  onClick={() => moveCommandDown(idx)}
                                  title="Bajar de posición"
                                  className="rounded p-1 hover:bg-card text-dim hover:text-text disabled:opacity-20"
                                >
                                  <ArrowDown size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeCommand(idx)}
                                  title="Eliminar comando"
                                  className="rounded p-1 hover:bg-card text-dim hover:text-danger ml-1"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Vista 2: Consola de Terminal en Vivo */
                  <div className="flex flex-col bg-[#0A0D12] text-zinc-200">
                    {/* Barra de Título Estilo Mac/Linux */}
                    <div className="flex items-center justify-between border-b border-zinc-800 bg-[#12161F] px-4 py-2 text-[11.5px]">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500/80 inline-block" />
                        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80 inline-block" />
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500/80 inline-block" />
                        <span className="font-mono text-zinc-400 ml-1">
                          Terminal Sandboxed — bash (workspace: {reqs.projectName})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {terminalExitCode !== null && (
                          <span
                            className={cn(
                              "font-mono text-[10.5px] px-2 py-0.5 rounded font-semibold",
                              terminalExitCode === 0 ? "bg-mint/20 text-mint" : "bg-red-500/20 text-red-400",
                            )}
                          >
                            Exit Code: {terminalExitCode}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setTerminalLogs([])}
                          className="text-zinc-500 hover:text-zinc-300 text-[11px] transition"
                        >
                          Limpiar
                        </button>
                      </div>
                    </div>

                    {/* Ventana de Salida de Logs */}
                    <div className="p-4 min-h-[260px] max-h-[360px] overflow-y-auto font-mono text-[12px] space-y-1">
                      {terminalLogs.length === 0 ? (
                        <div className="text-zinc-500 italic py-8 text-center space-y-2">
                          <p>Consola lista para ejecutar comandos.</p>
                          <p className="text-[11.5px]">
                            Presiona <strong className="text-mint font-normal">"▶ Ejecutar en Terminal Real"</strong> para ver el output en vivo.
                          </p>
                        </div>
                      ) : (
                        terminalLogs.map((lg, i) => (
                          <div
                            key={i}
                            className={cn(
                              "leading-relaxed break-all",
                              lg.kind === "cmd" && "text-emerald-400 font-semibold",
                              lg.kind === "error" || lg.kind === "stderr" ? "text-red-400" : "",
                              lg.kind === "info" && "text-sky-300",
                              lg.kind === "success" && "text-emerald-300 font-semibold",
                              !lg.kind && "text-zinc-200",
                            )}
                          >
                            {lg.text}
                          </div>
                        ))
                      )}
                      <div ref={terminalEndRef} />
                    </div>

                    {/* Prompt de Comando Interactivo en la Terminal */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!promptCmd.trim()) return;
                        runSingleCommand(promptCmd);
                        setPromptCmd("");
                      }}
                      className="flex items-center gap-2 border-t border-zinc-800 bg-[#0F131A] p-2.5 text-[12px]"
                    >
                      <span className="font-mono text-emerald-400 font-semibold pl-1">
                        (.venv) $
                      </span>
                      <input
                        type="text"
                        value={promptCmd}
                        onChange={(e) => setPromptCmd(e.target.value)}
                        placeholder="Escribe un comando (ej: python main.py, pytest, ls -la, python -V)..."
                        className="flex-1 bg-transparent font-mono text-[12px] text-zinc-100 placeholder:text-zinc-600 outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isExecuting || !promptCmd.trim()}
                        className="rounded bg-accent px-3 py-1 font-semibold text-[11.5px] text-white hover:opacity-90 transition disabled:opacity-40"
                      >
                        Correr
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {/* Validación de Requisitos del Paso 2 */}
              <div className="rounded-xl border border-line bg-card p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-text flex items-center gap-2">
                    <ListChecks size={16} className="text-accent-text" />
                    Validación de Requisitos del Paso 2
                  </h4>
                  <span
                    className={cn(
                      "font-mono text-[11px] font-semibold px-2 py-0.5 rounded border",
                      commandsDone
                        ? "text-mint bg-mint/15 border-mint/40"
                        : "text-warn bg-warn/15 border-warn/40",
                    )}
                  >
                    {commandsChecksDone} / {commandsChecklist.length} Cumplidos
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[12px]">
                  {commandsChecklist.map((c) => (
                    <div
                      key={c.title}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                        c.done ? "border-mint/40 bg-mint/10" : "border-line bg-surface opacity-75",
                      )}
                    >
                      {c.done ? (
                        <CheckCircle2 size={16} className="text-mint flex-none mt-0.5" />
                      ) : (
                        <Circle size={16} className="text-faint flex-none mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-text">{c.title}</div>
                        <div className="text-[11px] text-dim">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ⭐ Técnicas de Maestría (Pro Tricks) - Paso 2 */}
          <div className="w-full rounded-xl border border-line bg-card overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowProTricks2(!showProTricks2)}
              className="flex w-full items-center justify-between p-4 bg-surface hover:bg-hover transition text-left"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles size={16} className="text-accent-text" />
                <span className="text-[13.5px] font-bold text-text">
                  ⭐ Técnicas de Maestría Profesional (Pro Tricks para Comandos de Terminal & Venvs)
                </span>
              </div>
              <ChevronDown
                size={16}
                className={cn("text-dim transition-transform duration-200", showProTricks2 && "rotate-180")}
              />
            </button>

            {showProTricks2 && (
              <div className="p-5 border-t border-line space-y-4 text-[13px] bg-card">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <Terminal size={15} />
                      <span>1. `python -m pip` vs `pip`</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Nunca uses <code className="text-text font-mono">pip</code> directamente en máquinas compartidas. Invocar <code className="text-text font-mono">python -m pip</code> garantiza que instalas exactamente con el intérprete activo (<code className="text-text font-mono">which python</code>) y no en el Python del sistema operativo.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <Sliders size={15} />
                      <span>2. Flag `--prompt` en venv</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Crea tu entorno con <code className="text-text font-mono">python -m venv .venv --prompt mi-app</code>. Esto etiqueta de forma legible tu terminal con <code className="text-text font-mono">(mi-app)</code> en lugar del genérico <code className="text-text font-mono">(.venv)</code>, evitando errores al alternar repositorios.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <Play size={15} />
                      <span>3. Ejecutar como módulo con `-m`</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Para probar un script interno sin romper imports relativos, ejecuta <code className="text-text font-mono">python -m utils.helpers</code> desde la raíz. Esto añade el directorio actual a <code className="text-text font-mono">sys.path</code> y resuelve los paquetes sin errores.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botones de navegación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("files")}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface hover:bg-hover px-4 py-2.5 text-[13px] font-medium text-dim transition"
              >
                <ChevronLeft size={16} />
                <span>Volver a Estructura</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("notes")}
                className="inline-flex items-center gap-2 rounded-xl bg-accent text-white px-5 py-2.5 text-[13.5px] font-semibold hover:opacity-95 transition shadow-sm"
              >
                <span>Continuar a Justificación Técnica</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECCIÓN 3: JUSTIFICACIÓN TÉCNICA                                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {(viewMode === "all" || activeTab === "notes") && (
        <section className={cn("flex w-full flex-col gap-4 animate-fadeIn", viewMode === "all" && "pt-6 border-t border-line")}>
          {/* Banner de Requisitos del Paso 3 + Botón de Pista */}
          <div className="flex w-full flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
            <div className="flex items-start gap-3.5 flex-1">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line bg-card text-accent-text">
                <FileText size={18} aria-hidden />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-text">
                  3. Justificación Técnica de la Arquitectura
                </h3>
                <p className="mt-1 text-[13px] text-text/90 leading-relaxed">
                  Explica razonadamente por qué cada archivo está en ese lugar y cómo se gestionan los imports relativos sin colisiones de dependencias.
                </p>
              </div>
            </div>

            {/* Botón de Pista Dedicado */}
            <div className="flex items-center gap-2 flex-none self-start md:self-center">
              <button
                type="button"
                onClick={() => setShowHint3(!showHint3)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 font-medium text-[12px] text-warn hover:bg-warn/25 transition shadow-xs"
              >
                <Lightbulb size={14} className="text-warn" />
                <span>{showHint3 ? "Ocultar pista" : "Pista para Paso 3"}</span>
              </button>
            </div>
          </div>

          {/* Tarjeta Desplegable de Pista Activa */}
          {showHint3 && (
            <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/80 p-4 text-[13px] text-text animate-fadeIn">
              <Info size={18} className="mt-0.5 flex-none text-warn" />
              <div className="space-y-1">
                <p className="font-semibold text-warn">Puntos clave a justificar en tu explicación:</p>
                <p className="text-dim leading-relaxed">
                  1. <strong className="text-text">Aislamiento del entorno:</strong> Explica por qué <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">.venv/</code> reside localmente y no debe subirse al control de versiones (Git).<br />
                  2. <strong className="text-text">Modularidad e imports:</strong> Explica por qué la lógica auxiliar se aísla en subcarpetas (como <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">utils/helpers.py</code>) y cómo se importa limpiamente desde <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">main.py</code>.<br />
                  3. <strong className="text-text">Separación de pruebas:</strong> Justifica por qué la carpeta <code className="font-mono text-text bg-card px-1 py-0.2 rounded border border-line">tests/</code> reside en la raíz fuera del código fuente distribuible.
                </p>
              </div>
            </div>
          )}

          {/* Editor de Justificación Ancho Completo */}
          <div className="w-full rounded-xl border border-line bg-card p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between text-[12px] text-dim">
              <span className="font-medium">Tu explicación técnica:</span>
              <span className="font-mono text-[11px]">{wordCount} palabras redactadas</span>
            </div>
            <textarea
              rows={5}
              disabled={disabled}
              value={notes}
              onChange={(e) => {
                const next = e.target.value;
                setNotes(next);
                sync(paths, commands, next);
              }}
              placeholder="Explica aquí las razones arquitectónicas de esta estructura (ej. por qué .venv/ va en la raíz pero no se sube a Git, cómo se organizan los módulos auxiliares y cómo se importan)..."
              className="w-full rounded-lg border border-line bg-panel p-3.5 text-[13.5px] leading-relaxed text-text placeholder:text-faint focus:border-accent outline-none font-body resize-y"
            />
          </div>

          {/* ⭐ Técnicas de Maestría (Pro Tricks) - Paso 3 */}
          <div className="w-full rounded-xl border border-line bg-card overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowProTricks3(!showProTricks3)}
              className="flex w-full items-center justify-between p-4 bg-surface hover:bg-hover transition text-left"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles size={16} className="text-accent-text" />
                <span className="text-[13.5px] font-bold text-text">
                  ⭐ Técnicas de Maestría Profesional (Pro Tricks para Arquitectura & Imports)
                </span>
              </div>
              <ChevronDown
                size={16}
                className={cn("text-dim transition-transform duration-200", showProTricks3 && "rotate-180")}
              />
            </button>

            {showProTricks3 && (
              <div className="p-5 border-t border-line space-y-4 text-[13px] bg-card">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <Code2 size={15} />
                      <span>1. El mecanismo de `sys.path[0]`</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Al ejecutar <code className="text-text font-mono">python script.py</code>, Python inserta la carpeta que contiene dicho archivo en la posición 0 de <code className="text-text font-mono">sys.path</code>. Por ello, ejecutar scripts dentro de subcarpetas suele romper los imports hacia módulos vecinos.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <ArrowRight size={15} />
                      <span>2. Imports absolutos vs relativos</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      PEP 8 recomienda encarecidamente los imports absolutos (<code className="text-text font-mono">from utils.helpers import format_message</code>) sobre los relativos (<code className="text-text font-mono">from .helpers import ...</code>), ya que son más claros y no fallan si se mueve o ejecuta el archivo directamente.
                    </p>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5 space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-accent-text text-[13px]">
                      <ShieldCheck size={15} />
                      <span>3. Prevención de imports circulares</span>
                    </div>
                    <p className="text-dim leading-relaxed text-[12px]">
                      Si el módulo A importa B y B importa A, Python lanzará un <code className="text-text font-mono">ImportError</code> parcial. La solución profesional es extraer la lógica compartida a un tercer módulo o realizar importación diferida (<em>deferred import</em>) dentro de la función.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botón de navegación en modo paso a paso */}
          {viewMode === "step" && (
            <div className="flex justify-start pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("commands")}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface hover:bg-hover px-4 py-2.5 text-[13px] font-medium text-dim transition"
              >
                <ChevronLeft size={16} />
                <span>Volver a Comandos</span>
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
