// Mentor — la flecha de una fila (tema, kata…): abre un menú con sus acciones. Compartido por el tablero «Cómo voy» y la práctica de cada área.

import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../ui";

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  testid?: string;
  children?: MenuAction[];
}

/**
 * `trigger`: en vez de la flecha, el propio contenido (el título del tema) abre el menú al pulsarlo; `className` es el de ese botón.
 */
export function RowMenu({ title, items, disabled, trigger, className }: { title: string; items: MenuAction[]; disabled?: boolean; trigger?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useEffect(() => {
    if (!open) {
      setActiveSub(null);
      return;
    }
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) {
        setOpen(false);
        setActiveSub(null);
      }
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        setActiveSub(null);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    const reposition = (e: Event): void => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[14px] hover:bg-hover transition-colors";
  return (
    <span ref={box} className={cn("relative", trigger ? "min-w-0 flex-1" : "flex-none")}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={trigger ? `Abrir ${title}` : `Opciones de ${title}`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const width = Math.min(256, window.innerWidth - 16);
          setPosition({ left: Math.max(8, Math.min(trigger ? rect.left : rect.right - width, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 280)) });
          setOpen((v) => !v);
        }}
        className={trigger ? cn("block max-w-full text-left", className) : "grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"}
        data-testid={trigger ? "board-topic-trigger" : "board-arrow"}
        title={trigger ? undefined : "Opciones"}
      >
        {trigger ?? <MoreHorizontal size={16} aria-hidden />}
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={`Abrir ${title}`} style={{ position: "fixed", left: position.left, top: position.top, width: "min(256px, calc(100vw - 16px))", maxHeight: "calc(100vh - 16px)", overflowY: "auto" }} className="z-[100] rounded-xl border border-line bg-card p-1.5 shadow-xl" data-testid="board-menu">
          {items.map((it) => {
            if (it.children && it.children.length > 0) {
              return (
                <div
                  key={it.id}
                  className="relative"
                  onMouseEnter={() => setActiveSub(it.id)}
                  onMouseOver={() => setActiveSub(it.id)}
                  onMouseLeave={() => setActiveSub((curr) => (curr === it.id ? null : curr))}
                >
                  <button
                    role="menuitem"
                    type="button"
                    className={cn(item, "justify-between", activeSub === it.id && "bg-hover text-text font-medium")}
                    data-testid={it.testid}
                    aria-haspopup="menu"
                    aria-expanded={activeSub === it.id}
                    onMouseEnter={() => setActiveSub(it.id)}
                    onMouseOver={() => setActiveSub(it.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveSub((curr) => (curr === it.id ? null : it.id));
                    }}
                  >
                    <span className="flex items-center gap-2">
                      {it.icon} {it.label}
                    </span>
                    <ChevronRight size={14} aria-hidden className={cn("text-faint transition-transform", activeSub === it.id ? (trigger ? "translate-x-0.5 text-text" : "-translate-x-0.5 rotate-180 text-text") : (trigger ? "" : "rotate-180"))} />
                  </button>
                  {activeSub === it.id && (
                    <div
                      role="menu"
                      aria-label={it.label}
                      className="ml-3 rounded-lg border border-line bg-card p-1"
                      data-testid="board-menu-sub"
                    >
                      {it.children.map((sub) => (
                        <button
                          key={sub.id}
                          role="menuitem"
                          type="button"
                          className={item}
                          data-testid={sub.testid}
                          onClick={() => {
                            setOpen(false);
                            setActiveSub(null);
                            sub.onClick?.();
                          }}
                        >
                          {sub.icon} {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={it.id}
                role="menuitem"
                type="button"
                className={item}
                data-testid={it.testid}
                onMouseEnter={() => setActiveSub(null)}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon} {it.label}
              </button>
            );
          })}
        </div>
      , document.body)}
    </span>
  );
}
