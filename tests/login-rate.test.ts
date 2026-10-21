import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "@/lib/kv";
import { LOGIN_RATE_LIMIT } from "@/lib/types";
import { FakeKv } from "./helpers/fake-kv";

describe("login rate limit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks after maxFailures and clears after the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = createStore(new FakeKv().asNamespace());
    const ip = "203.0.113.5";

    expect(await store.checkLoginRateLimit(ip)).toBeNull();
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailures; i++) {
      await store.recordLoginFailure(ip);
    }
    expect(await store.checkLoginRateLimit(ip)).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + (LOGIN_RATE_LIMIT.windowSeconds + 1) * 1000));
    expect(await store.checkLoginRateLimit(ip)).toBeNull();
  });
});
