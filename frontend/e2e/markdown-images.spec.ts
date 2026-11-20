import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { sandboxEnv } from "./helpers";

const HERE = dirname(fileURLToPath(import.meta.url));
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
test("una imagen seleccionada se guarda, se inserta y se ve en lectura", async () => {
  const env = sandboxEnv();
  const app = await electron.launch({ args: [".", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"], cwd: join(HERE, ".."), env });
  try {
    const win = await app.firstWindow();
    await win.getByRole("button", { name: /Notas/ }).first().click({ timeout: 30_000 });
    const title = `Imagen E2E ${Date.now()}`;
    await win.keyboard.press("Control+P");
    await win.getByPlaceholder(/Busca una nota por nombre/).fill(title);
    await win.keyboard.press("Enter");
    const editor = win.locator(".cm-content");
    await expect(editor).toBeVisible();
    await editor.click();
    await win.locator('input[aria-label="Seleccionar imágenes"]').setInputFiles({ name: "prueba.png", mimeType: "image/png", buffer: png });
    await expect(editor).toContainText("![[attachments/prueba.png]]");
    await editor.evaluate((element, bytes) => {
      const file = new File([new Uint8Array(bytes)], "pegada.png", { type: "image/png" });
      const transfer = new DataTransfer(); transfer.items.add(file);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, [...png]);
    await expect(editor).toContainText("![[attachments/pegada.png]]");
    await win.keyboard.press("Control+S");
    await expect.poll(() => existsSync(join(env.NV_E2E_HOME, "NoteVault", "attachments", "prueba.png"))).toBe(true);
    await expect.poll(() => existsSync(join(env.NV_E2E_HOME, "NoteVault", "attachments", "pegada.png"))).toBe(true);
    await expect.poll(() => readFileSync(join(env.NV_E2E_HOME, "NoteVault", `${title}.md`), "utf8")).toContain("![[attachments/prueba.png]]");
    await win.getByRole("tab", { name: "Lectura", exact: true }).click();
    const image = win.locator(".nv-prose img").first();
    await expect(win.locator(".nv-prose img")).toHaveCount(2);
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  } finally { await app.close(); }
});

test("una nota larga permite escribir y guardar sin bloquear el editor", async () => {
  const env = sandboxEnv();
  const vault = join(env.NV_E2E_HOME, "NoteVault"); mkdirSync(vault, { recursive: true });
  const filename = join(vault, "Nota larga E2E.md");
  writeFileSync(filename, "# Prueba\n\n" + "Línea normal de una nota larga.\n".repeat(20000));
  const app = await electron.launch({ args: [".", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"], cwd: join(HERE, ".."), env });
  try {
    const win = await app.firstWindow();
    await win.getByRole("button", { name: /Notas/ }).first().click({ timeout: 30_000 });
    await win.keyboard.press("Control+P");
    await win.getByPlaceholder(/Busca una nota por nombre/).fill("Nota larga E2E");
    await win.keyboard.press("Enter");
    await win.getByRole("tab", { name: "Editar", exact: true }).click();
    const editor = win.locator(".cm-content"); await expect(editor).toBeVisible();
    await editor.click(); await win.keyboard.press("Control+Home");
    const start = Date.now();
    await win.keyboard.type("Texto escrito con fluidez en una nota larga.");
    const elapsed = Date.now() - start;
    console.log(`Escritura de 44 caracteres en 20.000 líneas: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(10000);
    await win.keyboard.press("Control+S");
    await expect.poll(() => readFileSync(filename, "utf8")).toContain("Texto escrito con fluidez");
  } finally { await app.close(); }
});
