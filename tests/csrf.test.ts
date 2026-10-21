import { describe, expect, it } from "vitest";
import { validateCsrf } from "@/lib/security";

const TOKEN = "a".repeat(32);

describe("validateCsrf", () => {
  it("rejects unequal lengths", () => {
    expect(validateCsrf(TOKEN, `${TOKEN}b`)).toBe(false);
  });

  it("rejects tokens shorter than 16 characters", () => {
    expect(validateCsrf("short-token", "short-token")).toBe(false);
  });

  it("accepts equal tokens", () => {
    expect(validateCsrf(TOKEN, TOKEN)).toBe(true);
  });
});
