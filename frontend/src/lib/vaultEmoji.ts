// Gestor de emojis por vault: persistencia en localStorage para que cada bóveda
// tenga su propio emoji identificador reconocible (sin estilos IA).

import { create } from "zustand";

const STORAGE_KEY = "nv.vaultEmojis";

export const DEFAULT_VAULT_EMOJIS = [
  // Productividad y Código
  "⚡", "💻", "🚀", "🎯", "🛠️", "💡", "📊", "💼", "🔬", "🌐",
  // Conocimiento y Notas
  "📚", "📖", "📝", "🧠", "🎓", "🏛️", "🖋️", "📜", "📂", "📋",
  // Vida y Personal
  "🏠", "☕", "🌿", "🧘", "🎨", "🎵", "🌱", "🏔️", "🛡️", "✨",
  // Salud y Rendimiento
  "🏋️", "🏃", "🍎", "🥗", "🥑", "🚲", "⏱️", "❤️", "🔥", "🏆",
  // Finanzas y Metas
  "💰", "💳", "📈", "💎", "🏦", "🪙", "📅", "🧭", "🔒", "⭐",
];

function loadMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

interface VaultEmojiState {
  emojis: Record<string, string>;
  getEmoji: (pathOrName: string | null | undefined) => string;
  setEmoji: (pathOrName: string, emoji: string) => void;
}

export const useVaultEmojis = create<VaultEmojiState>((set, get) => ({
  emojis: loadMap(),
  getEmoji: (pathOrName) => {
    if (!pathOrName) return "⚡";
    const map = get().emojis;
    if (map[pathOrName]) return map[pathOrName];
    // Fallback por nombre si path fue usado o viceversa
    const key = pathOrName.split("/").pop() || pathOrName;
    if (map[key]) return map[key];
    return "⚡";
  },
  setEmoji: (pathOrName, emoji) => {
    if (!pathOrName) return;
    const clean = emoji.trim() || "⚡";
    set((state) => {
      const next = { ...state.emojis, [pathOrName]: clean };
      const key = pathOrName.split("/").pop();
      if (key) next[key] = clean;
      saveMap(next);
      return { emojis: next };
    });
  },
}));

