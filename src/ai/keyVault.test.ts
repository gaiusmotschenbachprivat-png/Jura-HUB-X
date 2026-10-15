// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isVault, openKey, sealKey } from "./keyVault";

describe("Schlüssel mit PIN verschlüsseln", () => {
  it("verschlüsselt und entschlüsselt; falsche PIN scheitert", async () => {
    const v = await sealKey("sk-ant-geheim", "123456", 1000);
    expect(isVault(v)).toBe(true);
    expect(JSON.stringify(v)).not.toContain("geheim");
    expect(await openKey(v, "123456")).toBe("sk-ant-geheim");
    await expect(openKey(v, "654321")).rejects.toThrow("Falsche PIN");
  });
  it("verlangt eine ausreichend lange PIN", async () => {
    await expect(sealKey("sk-ant-x", "123")).rejects.toThrow(/mindestens 6/);
  });
  it("jedes Mal anderes Salz und Chiffrat", async () => {
    const a = await sealKey("sk-ant-x", "123456", 1000);
    const b = await sealKey("sk-ant-x", "123456", 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.data).not.toBe(b.data);
  });
});
