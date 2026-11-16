// Elige tu vault: recent vaults, open another folder, or create a new one.

import { FolderOpen, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "../lib/bridge";
import type { VaultInfo } from "../lib/types";
import { flushAll, useApp } from "../store/app";
import { DEFAULT_VAULT_EMOJIS, useVaultEmojis } from "../lib/vaultEmoji";
import { GhostButton, input, Modal, PrimaryButton } from "./common/forms";
import { askText, cn, confirmAction } from "./ui";

export const useVaultDialog = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

function describe(v: Partial<VaultInfo>): string {
  if (v.exists === false) return "la carpeta ya no existe";
  const bits = [];
  if (v.obsidian) bits.push("vault de Obsidian");
  bits.push(`${v.markdown ?? 0}${v.truncated ? "+" : ""} notas`, `${v.folders ?? 0} carpetas`);
  return bits.join(" · ");
}

export function VaultDialog() {
  const open = useVaultDialog((s) => s.open);
  const setOpen = useVaultDialog((s) => s.set);
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<VaultInfo[]>([]);
  const [path, setPath] = useState("");
  const [manual, setManual] = useState(false);

  const getEmoji = useVaultEmojis((s) => s.getEmoji);
  const setEmoji = useVaultEmojis((s) => s.setEmoji);
  const [editingEmojiVault, setEditingEmojiVault] = useState<VaultInfo | null>(null);
  const [customEmoji, setCustomEmoji] = useState("");

  useEffect(() => {
    if (open) api.vaultList().then(setList).catch((e) => toast("error", (e as Error).message));
  }, [open, toast]);
  if (!open) return null;

  const choose = async (v: Partial<VaultInfo> & { path: string }) => {
    if (v.current) {
      setEditingEmojiVault(null);
      setOpen(false);
      return;
    }
    if (v.exists === false) {
      toast("error", "La carpeta de esta vault ya no existe en el disco.");
      return;
    }
    if (!v.obsidian && (v.code_markers ?? 0) > 0 && (v.markdown ?? 0) <= 2) {
      const ok = await confirmAction(
        "¿Seguro que es una vault?",
        `«${v.name ?? v.path}» parece una carpeta de código, no de notas: el explorador se llenará de carpetas que no son notas. ¿Abrirla de todas formas?`,
        "Abrir igualmente"
      );
      if (!ok) return;
    }
    try {
      await flushAll();
      await api.vaultOpen(v.path);
      // Every module reloads from the new vault.
      window.location.reload();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <Modal
      title="Elige tu vault"
      onClose={() => {
        setEditingEmojiVault(null);
        setOpen(false);
      }}
      width={560}
      footer={
        <>
          <GhostButton
            onClick={async () => {
              const r = await api.vaultPick().catch((e) => {
                toast("error", (e as Error).message);
                return null;
              });
              if (r?.fallback) setManual(true);
              else if (r?.ok && r.path) void choose(r as VaultInfo);
            }}
          >
            <FolderOpen size={14} /> Abrir otra carpeta…
          </GhostButton>
          <GhostButton
            onClick={async () => {
              const name = await askText("Nombre de la nueva vault", "Mis notas", "Elegir dónde…");
              if (!name) return;
              const r = await api.vaultCreate(name).catch((e) => {
                toast("error", (e as Error).message);
                return null;
              });
              if (r?.fallback) setManual(true);
              else if (r?.ok && r.path) {
                void choose({
                  path: r.path,
                  name,
                  markdown: 1,
                  folders: 0,
                  code_markers: 0,
                  truncated: false,
                  obsidian: false,
                });
              }
            }}
          >
            <FolderPlus size={14} /> Crear vault…
          </GhostButton>
          <span className="flex-1" />
          <GhostButton
            onClick={() => {
              setEditingEmojiVault(null);
              setOpen(false);
            }}
          >
            Cerrar
          </GhostButton>
        </>
      }
    >
      <p className="text-[12.5px] text-dim">
        Una vault es una carpeta con tus notas en Markdown. Puedes asignarle un emoji para identificarla fácilmente.
      </p>

      {/* Editor de emoji para la vault seleccionada */}
      {editingEmojiVault && (
        <div className="rounded-xl border border-line-strong bg-card p-3 shadow-md space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text">
              Emoji para <span className="text-accent">{editingEmojiVault.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setEditingEmojiVault(null)}
              className="text-faint hover:text-text p-1 rounded transition"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-10 gap-1.5 p-1 bg-surface rounded-lg border border-line max-h-36 overflow-y-auto">
            {DEFAULT_VAULT_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => {
                  setEmoji(editingEmojiVault.path, em);
                  setEditingEmojiVault(null);
                }}
                className={cn(
                  "h-7 w-7 rounded flex items-center justify-center text-base hover:bg-hover hover:scale-110 transition cursor-pointer",
                  getEmoji(editingEmojiVault.path) === em && "bg-accent-soft border border-accent/40"
                )}
              >
                {em}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="O escribe/pega cualquier emoji (ej: 🚀, 💻)..."
              value={customEmoji}
              onChange={(e) => setCustomEmoji(e.target.value)}
              className="flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-text placeholder-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (customEmoji.trim()) {
                  setEmoji(editingEmojiVault.path, customEmoji.trim());
                }
                setEditingEmojiVault(null);
              }}
              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-strong transition cursor-pointer"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-1.5">
        {list.map((v) => {
          const emoji = getEmoji(v.path);
          return (
            <li key={v.path} className="flex items-center gap-2">
              <button
                type="button"
                title="Cambiar emoji de la vault"
                aria-label={`Cambiar emoji para ${v.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingEmojiVault(v);
                  setCustomEmoji(emoji);
                }}
                className="group relative flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-line bg-surface text-lg hover:border-accent hover:scale-105 transition active:scale-95 cursor-pointer shadow-xs"
              >
                <span>{emoji}</span>
                <span className="pointer-events-none absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[9px] text-white opacity-0 group-hover:opacity-100 transition">
                  ✎
                </span>
              </button>
              <button
                type="button"
                onClick={() => void choose(v)}
                title={v.current ? "Vault actualmente abierta (clic para cerrar)" : `Abrir vault ${v.name}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left transition cursor-pointer",
                  v.current
                    ? "border-accent bg-accent-soft shadow-xs"
                    : "border-line hover:border-line-strong hover:bg-hover",
                  v.exists === false && "opacity-60"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                    <span>{v.name}</span>
                    {v.current && <span className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-accent">actual</span>}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{v.path}</span>
                  <span className="block text-[11.5px] text-dim">{describe(v)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {manual && (
        <div className="flex gap-2">
          <input
            className={input}
            value={path}
            placeholder="Ruta de la carpeta"
            onChange={(e) => setPath(e.target.value)}
          />
          <PrimaryButton
            onClick={() =>
              path.trim() &&
              void choose({
                path: path.trim(),
                name: path.trim(),
                markdown: 1,
                folders: 0,
                code_markers: 0,
                truncated: false,
                obsidian: false,
              })
            }
          >
            Abrir
          </PrimaryButton>
        </div>
      )}
    </Modal>
  );
}
