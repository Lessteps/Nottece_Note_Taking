// Una sola lectura de la vault compartida por las llamadas de estudio.
//
// Vive en un módulo propio (y no en modules/study.ts) para que `appState`/`context`
// puedan importar `topicLookup` sin arrastrar el módulo de estudio entero, que a su
// vez importa AppState: eso era el ciclo context <-> study.

import { scanVault, type VaultScan } from "../core/practice/exerciseIndex.js";
import type { AppState } from "./appState.js";

export const SCAN_CACHE_TTL_MS = 300_000;

const _scanCache = new Map<string, { data: VaultScan; timestamp: number }>();

const _invalidationListeners = new Set<() => void>();

export function registerScanInvalidation(listener: () => void): () => void {
  _invalidationListeners.add(listener);
  return () => {
    _invalidationListeners.delete(listener);
  };
}

export function vaultScan(app: AppState): VaultScan {
  const hit = _scanCache.get(app.root);
  if (hit && Date.now() - hit.timestamp < SCAN_CACHE_TTL_MS) return hit.data;
  const data = scanVault(app.root, app.vault.notePaths());
  _scanCache.set(app.root, { data, timestamp: Date.now() });
  return data;
}

export function setVaultScanCache(root: string, data: VaultScan): void {
  _scanCache.set(root, { data, timestamp: Date.now() });
}

export function hasVaultScan(root: string): boolean {
  return _scanCache.has(root);
}

export function clearVaultScanCache(): void {
  _scanCache.clear();
  for (const listener of _invalidationListeners) {
    try {
      listener();
    } catch {}
  }
}
