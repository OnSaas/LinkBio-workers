import { describe, expect, it } from "vitest";
import { publicPageMetadata, publishableSiteOrigin } from "@/lib/seo";

describe("publishableSiteOrigin", () => {
  it("rejects empty, placeholder, and localhost urls", () => {
    expect(publishableSiteOrigin("")).toBeNull();
    expect(publishableSiteOrigin("https://YOUR_SUBDOMAIN.workers.dev")).toBeNull();
    expect(publishableSiteOrigin("http://localhost:8787")).toBeNull();
    expect(publishableSiteOrigin("https://card.example.com/bio")).toBe("https://card.example.com");
  });
});

describe("publicPageMetadata", () => {
  it("omits canonical urls when SITE_URL is a placeholder", () => {
    const metadata = publicPageMetadata({
      title: "Ada-LinkBio",
      description: "hello",
      siteName: "LinkBio",
      siteUrl: "https://YOUR_SUBDOMAIN.workers.dev",
      avatar: "https://cdn.example.com/a.png",
    });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain("YOUR_SUBDOMAIN");
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.title).toBe("Ada-LinkBio");
    expect(metadata.openGraph?.description).toBe("hello");
  });

  it("sets canonical and og:url for a real origin", () => {
    const metadata = publicPageMetadata({
      title: "Ada-LinkBio",
      description: "hello",
      siteName: "LinkBio",
      siteUrl: "https://card.example.com",
      avatar: "http://cdn.example.com/a.png",
    });
    expect(metadata.metadataBase?.origin).toBe("https://card.example.com");
    expect(metadata.alternates).toEqual({ canonical: "/" });
    expect(metadata.openGraph?.url).toBe("https://card.example.com/");
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.twitter).toEqual({ card: "summary" });
  });
});
