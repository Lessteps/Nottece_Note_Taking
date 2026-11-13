import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

// The built files are loaded from disk by pywebview or electron, so every
// asset path must be relative.
// La hora de la compilación, visible en la barra de estado: así se ve de un vistazo si la ventana abierta es la versión recién compilada.
const BUILD_STAMP = new Date().toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export default defineConfig({
  base: "./",
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: { entry: "electron/main.ts" },
      preload: { input: "electron/preload.ts" },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@codemirror") || id.includes("@lezer")) {
              return "vendor-codemirror";
            }
            if (id.includes("katex") || id.includes("@vscode/markdown-it-katex")) {
              return "vendor-katex";
            }
            if (id.includes("highlight.js")) {
              return "vendor-highlight";
            }
            if (id.includes("markdown-it") || id.includes("dompurify")) {
              return "vendor-markdown";
            }
            if (id.includes("@milkdown") || id.includes("prosemirror")) {
              return "vendor-milkdown";
            }
            if (id.includes("lucide-react")) {
              return "vendor-lucide";
            }
          }
        },
      },
    },
  },
  test: {
    // The suite is logic-only; the fast Node environment is the default. The
    // few files that touch the DOM opt in with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      // Only the layers that carry logic are measured. `components/` is mostly
      // markup, and a global percentage over it would reward adding untested
      // .tsx files rather than testing the state and domain code. Raise the
      // numbers as those layers get their own tests.
      include: ["src/api/**/*.ts", "src/core/**/*.ts", "src/lib/**/*.ts", "src/store/**/*.ts"],
      exclude: ["src/**/*.test.*", "src/**/__golden__/**"],
      reporter: ["text", "html"],
      // Vitest 5 counts untested files by default, so an untested file drags
      // the number down instead of vanishing from the report.
      // The floor as of 2026-09-29. `npm test:coverage` fails below these.
      // store/ alone is ~30%, which is where the real risk is; see the QA issue
      // on the state stores before trying to lift the global number by covering
      // more markup.
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 72,
      },
    },
  },
});
