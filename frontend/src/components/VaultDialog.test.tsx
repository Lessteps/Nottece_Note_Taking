// @vitest-environment jsdom

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useVaultDialog, VaultDialog } from "./VaultDialog";
import { useVaultEmojis } from "../lib/vaultEmoji";
import { api } from "../lib/bridge";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

describe("VaultDialog and Vault Emojis", () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.spyOn(api, "vaultList").mockResolvedValue([
      {
        path: "/path/to/vault-a",
        name: "vault-a",
        markdown: 10,
        folders: 2,
        code_markers: 0,
        truncated: false,
        obsidian: true,
      },
      {
        path: "/path/to/vault-b",
        name: "vault-b",
        markdown: 5,
        folders: 1,
        code_markers: 0,
        truncated: false,
        obsidian: false,
      },
    ]);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.restoreAllMocks();
  });

  it("permite elegir un emoji para una vault y lo persiste", async () => {
    act(() => {
      useVaultDialog.setState({ open: true });
    });

    await act(async () => {
      root.render(<VaultDialog />);
    });

    // Both vaults should be listed with a default emoji
    const emojiButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[title="Cambiar emoji de la vault"]'
    );
    expect(emojiButtons.length).toBe(2);
    expect(emojiButtons[0]?.textContent).toContain("⚡");

    // Click to change emoji for vault-a
    act(() => {
      emojiButtons[0]?.click();
    });

    // Emoji picker should be visible
    expect(container.textContent).toContain("Emoji para vault-a");

    // Click on a curated clean emoji (e.g. 📚)
    const bookBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "📚"
    );
    expect(bookBtn).toBeDefined();

    act(() => {
      bookBtn?.click();
    });

    // The emoji for vault-a should now be updated to 📚
    expect(useVaultEmojis.getState().getEmoji("/path/to/vault-a")).toBe("📚");
    expect(emojiButtons[0]?.textContent).toContain("📚");
  });

  it("al hacer clic en la vault actual se cierra el diálogo limpiamente", async () => {
    vi.spyOn(api, "vaultList").mockResolvedValue([
      {
        path: "/path/to/vault-a",
        name: "vault-a",
        current: true,
        markdown: 10,
        folders: 2,
        code_markers: 0,
        truncated: false,
        obsidian: true,
      },
    ]);

    act(() => {
      useVaultDialog.setState({ open: true });
    });

    await act(async () => {
      root.render(<VaultDialog />);
    });

    const vaultBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Vault actualmente abierta (clic para cerrar)"]'
    );
    expect(vaultBtn).not.toBeNull();
    expect(vaultBtn?.disabled).toBe(false);

    act(() => {
      vaultBtn?.click();
    });

    expect(useVaultDialog.getState().open).toBe(false);
  });
});

