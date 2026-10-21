import type { Metadata } from "next";

/** Origin suitable for canonical / Open Graph. Placeholders and localhost are rejected. */
export function publishableSiteOrigin(raw: string | undefined | null): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  if (/YOUR_SUBDOMAIN/i.test(text) || /localhost|127\.0\.0\.1/i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function publicPageMetadata(input: {
  title: string;
  description: string;
  siteName: string;
  siteUrl: string | undefined;
  avatar: string;
}): Metadata {
  const origin = publishableSiteOrigin(input.siteUrl);
  const images = /^https:\/\//i.test(input.avatar) ? [{ url: input.avatar }] : undefined;
  const metadata: Metadata = {
    title: { absolute: input.title },
    description: input.description,
    icons: {
      icon: [{ url: "/icon", type: "image/svg+xml" }],
    },
    openGraph: {
      title: input.title,
      description: input.description,
      type: "website",
      siteName: input.siteName,
      ...(images ? { images } : {}),
      ...(origin ? { url: `${origin}/` } : {}),
    },
    twitter: { card: "summary" },
  };
  if (origin) {
    metadata.metadataBase = new URL(origin);
    metadata.alternates = { canonical: "/" };
  }
  return metadata;
}
