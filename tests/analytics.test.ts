import { describe, expect, it } from "vitest";
import { createStore } from "@/lib/kv";
import { isLikelyBot } from "@/lib/security";
import { KV_KEYS } from "@/lib/types";
import { FakeKv } from "./helpers/fake-kv";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("analytics counters", () => {
  it("counts with one getWithMetadata and one put", async () => {
    const kv = new FakeKv();
    const store = createStore(kv.asNamespace());
    await store.incrementPageViews();
    expect(kv.getWithMetadataCalls).toBe(1);
    expect(kv.puts).toBe(1);
    expect(kv.gets).toBe(0);
    expect(kv.entries.has(KV_KEYS.ANALYTICS_UPDATED)).toBe(false);
  });

  it("reads a legacy string counter and upgrades it on the next increment", async () => {
    const kv = new FakeKv();
    kv.seed(KV_KEYS.ANALYTICS_PV, "3");
    kv.seed(KV_KEYS.ANALYTICS_UPDATED, "2026-01-01T00:00:00.000Z");
    kv.seed(`${KV_KEYS.ANALYTICS_CLICK_PREFIX}gh`, "2");
    const store = createStore(kv.asNamespace());

    const before = await store.getAnalytics();
    expect(before).toEqual({
      pageViews: 3,
      linkClicks: { gh: 2 },
      lastUpdated: "2026-01-01T00:00:00.000Z",
    });

    kv.getWithMetadataCalls = 0;
    kv.puts = 0;
    kv.gets = 0;
    await store.incrementPageViews();
    const entry = kv.entries.get(KV_KEYS.ANALYTICS_PV);
    expect(entry?.value).toBe("4");
    expect(entry?.metadata).toMatchObject({ n: 4 });
    expect(await store.getAnalytics()).toMatchObject({
      pageViews: 4,
      linkClicks: { gh: 2 },
    });
  });

  it("prefers metadata.n over a stale body", async () => {
    const kv = new FakeKv();
    kv.seed(KV_KEYS.ANALYTICS_PV, "1", { n: 9, t: "2026-02-02T00:00:00.000Z" });
    kv.seed(`${KV_KEYS.ANALYTICS_CLICK_PREFIX}gh`, "1", { n: 4, t: "2026-02-01T00:00:00.000Z" });
    const store = createStore(kv.asNamespace());
    const analytics = await store.getAnalytics();
    expect(analytics.pageViews).toBe(9);
    expect(analytics.linkClicks).toEqual({ gh: 4 });
    expect(analytics.lastUpdated).toBe("2026-02-02T00:00:00.000Z");
  });

  it("drops click counters for a deleted link", async () => {
    const kv = new FakeKv();
    kv.seed(KV_KEYS.ANALYTICS_PV, "1", { n: 1, t: "2026-01-01T00:00:00.000Z" });
    kv.seed(`${KV_KEYS.ANALYTICS_CLICK_PREFIX}gone`, "5", { n: 5, t: "2026-01-01T00:00:00.000Z" });
    kv.seed(`${KV_KEYS.ANALYTICS_CLICK_PREFIX}keep`, "2", { n: 2, t: "2026-01-01T00:00:00.000Z" });
    const store = createStore(kv.asNamespace());
    await store.deleteLinkClicks("gone");
    expect(kv.entries.has(`${KV_KEYS.ANALYTICS_CLICK_PREFIX}gone`)).toBe(false);
    expect((await store.getAnalytics()).linkClicks).toEqual({ keep: 2 });
  });
});

describe("isLikelyBot", () => {
  it("matches crawlers and prefetch", () => {
    expect(isLikelyBot(headers({ "user-agent": "Mozilla/5.0 Googlebot/2.1" }))).toBe(true);
    expect(isLikelyBot(headers({ "user-agent": "curl/8.0", purpose: "prefetch" }))).toBe(true);
    expect(isLikelyBot(headers({ "sec-purpose": "prefetch" }))).toBe(true);
    expect(isLikelyBot(headers({ "user-agent": "Mozilla/5.0" }))).toBe(false);
  });
});
