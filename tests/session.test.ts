import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/session";

describe("session token", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a valid token", async () => {
    const token = await createSessionToken("test-secret");
    expect(await verifySessionToken(token, "test-secret")).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken("test-secret");
    const [body, sig] = token.split(".");
    const flipped = sig!.slice(0, -1) + (sig!.endsWith("a") ? "b" : "a");
    expect(await verifySessionToken(`${body}.${flipped}`, "test-secret")).toBe(false);
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await createSessionToken("test-secret");
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z"));
    expect(await verifySessionToken(token, "test-secret")).toBe(false);
  });

  it("rejects an empty secret", async () => {
    const token = await createSessionToken("test-secret");
    expect(await verifySessionToken(token, "")).toBe(false);
  });
});
