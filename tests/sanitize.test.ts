import { describe, expect, it } from "vitest";
import {
  sanitizeLink,
  sanitizeSettings,
  sanitizeUrl,
  stripForbiddenSecrets,
} from "@/lib/kv";

describe("sanitizeUrl", () => {
  it("rejects non-http(s) schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("data:text/html,hi")).toBe("");
    expect(sanitizeUrl("ftp://example.com/file")).toBe("");
  });

  it("accepts http and https", () => {
    expect(sanitizeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(sanitizeUrl("http://example.com/a")).toBe("http://example.com/a");
  });
});

describe("sanitizeLink", () => {
  it("keeps a safe link and drops a javascript url", () => {
    const link = sanitizeLink({
      id: "gh",
      title: "GitHub",
      url: "javascript:alert(1)",
      icon: "github",
      order: 2,
      enabled: false,
    });
    expect(link.id).toBe("gh");
    expect(link.url).toBe("");
    expect(link.enabled).toBe(false);
    expect(link.order).toBe(2);
  });
});

describe("sanitizeSettings", () => {
  it("migrates legacy darkMode when colorMode is absent", () => {
    const settings = sanitizeSettings({ darkMode: true });
    expect(settings.colorMode).toBe("dark");
    expect(settings.darkMode).toBe(true);
  });

  it("prefers colorMode over legacy darkMode", () => {
    const settings = sanitizeSettings({ colorMode: "light", darkMode: true });
    expect(settings.colorMode).toBe("light");
    expect(settings.darkMode).toBe(false);
  });

  it("keeps the unknown legacy theme id old for resolveThemeId to fall through", () => {
    expect(sanitizeSettings({ theme: "old" }).theme).toBe("old");
  });
});

describe("stripForbiddenSecrets", () => {
  it("drops env secrets and secret bags", () => {
    const clean = stripForbiddenSecrets({
      profile: { name: "A" },
      ADMIN_PASSWORD: "nope",
      sessionSecret: "nope",
      env: { SESSION_SECRET: "nope" },
      secrets: { token: "nope" },
    });
    expect(clean).toEqual({ profile: { name: "A" } });
  });
});
