// Every functionality the user has visited stays mounted.
//
// Switching a top-bar tab changes the active functionality, but the view is
// hidden instead of destroyed — that is what keeps its internal sub-tab, its
// scroll and whatever the user had half-typed. The first mount happens while the
// view is visible (a module is mounted the first time it is activated), so
// nothing measures its layout while it has no size.

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "./ui";
import { ErrorBoundary } from "./common/ErrorBoundary";
import type { ModuleId } from "../store/app";

/**
 * Whether the functionality that owns the tree is the one on screen. A module
 * that paints outside the DOM (the browser's native view) needs to know: hiding
 * its container with CSS does not hide what the main process draws.
 */
export const ModuleVisible = createContext(true);

export function useModuleVisible(): boolean {
  return useContext(ModuleVisible);
}

const MAX_RETAINED_MODULES = 2;

export function ModuleHost({
  module,
  render,
}: {
  module: ModuleId;
  /** How to render one functionality; the app passes the real module map. */
  render: (id: ModuleId) => ReactNode;
}) {
  const [mounted, setMounted] = useState<ModuleId[]>([module]);

  useEffect(() => {
    setMounted((current) => {
      const withoutActive = current.filter((id) => id !== module);
      const next = [...withoutActive, module];
      // El módulo "web" aloja un <webview> nativo de Chromium: nunca se retiene en segundo plano
      const filtered = next.filter((id) => id === module || id !== "web");
      return filtered.slice(-MAX_RETAINED_MODULES);
    });
  }, [module]);

  return (
    <>
      {mounted.map((id) => {
        const isActive = id === module;
        return (
          <div
            key={id}
            // `hidden` + `inert` instead of unmounting: state survives, and the
            // hidden functionality cannot be reached by tab or by screen reader.
            className={cn("flex min-h-0 min-w-0 flex-1", !isActive && "hidden")}
            aria-hidden={!isActive}
            inert={!isActive}
          >
            <ModuleVisible.Provider value={isActive}><ErrorBoundary what={id === "mentor" ? "El Mentor" : "Esta sección"}>{render(id)}</ErrorBoundary></ModuleVisible.Provider>
          </div>
        );
      })}
    </>
  );
}

/** The lazy-loaded module components, keyed by module id. */
export type ModuleMap = Partial<Record<ModuleId, ComponentType>>;

export function moduleRenderer(MODULES: ModuleMap, fallback: (id: ModuleId) => ReactNode) {
  return (id: ModuleId): ReactNode => {
    const View = MODULES[id];
    return View ? <View /> : fallback(id);
  };
}
