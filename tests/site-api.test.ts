import { describe, expect, it } from "vitest";
import { createStore } from "@/lib/kv";
import { clickBodyTooLarge } from "@/lib/security";
import { loadPublicSite, toPublicSiteJson } from "@/lib/site-public";
import { FakeKv } from "./helpers/fake-kv";

describe("public site payload", () => {
  it("does not read analytics and keeps the response keys", async () => {
    const kv = new FakeKv();
    const store = createStore(kv.asNamespace());
    kv.reads = [];
    kv.lists = 0;
    const data = await loadPublicSite(store);
    expect(kv.lists).toBe(0);
    expect(kv.reads.some((key) => key.startsWith("analytics"))).toBe(false);

    const body = toPublicSiteJson(data, { SITE_NAME: "LinkBio", SITE_URL: "https://example.com" });
    expect(Object.keys(body).sort()).toEqual(
      ["links", "profile", "settings", "siteName", "siteUrl"].sort(),
    );
  });
});

describe("clickBodyTooLarge", () => {
  it("rejects content-length above 1024", () => {
    expect(clickBodyTooLarge(new Request("https://x", { headers: { "content-length": "1025" } }))).toBe(
      true,
    );
    expect(clickBodyTooLarge(new Request("https://x", { headers: { "content-length": "1024" } }))).toBe(
      false,
    );
    expect(clickBodyTooLarge(new Request("https://x"))).toBe(false);
  });
});
