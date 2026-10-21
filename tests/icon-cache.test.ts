import { describe, expect, it } from "vitest";
import { renderProfileIcon, type IconCache } from "@/lib/icon-image";

class MemoryCache implements IconCache {
  private readonly stored = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    const hit = this.stored.get(request.url);
    return hit ? hit.clone() : undefined;
  }

  async put(request: Request, response: Response): Promise<void> {
    this.stored.set(request.url, response.clone());
  }
}

describe("renderProfileIcon", () => {
  it("fetches an avatar once and serves the second request from cache", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: { "content-type": "image/png" },
      });
    };
    const cache = new MemoryCache();
    const avatar = "https://cdn.example.com/a.png";
    const first = await renderProfileIcon({ name: "Ada", avatar, fetchImpl, cache });
    const second = await renderProfileIcon({ name: "Ada", avatar, fetchImpl, cache });
    expect(calls).toBe(1);
    expect(first.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await second.text()).toContain("<image ");
  });

  it("caches the letter fallback briefly when the origin fetch fails", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("down");
    };
    const cache = new MemoryCache();
    const avatar = "https://cdn.example.com/missing.png";
    const first = await renderProfileIcon({ name: "Ada", avatar, fetchImpl, cache });
    await renderProfileIcon({ name: "Ada", avatar, fetchImpl, cache });
    expect(calls).toBe(1);
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await first.clone().text()).toContain(">A<");
  });
});
