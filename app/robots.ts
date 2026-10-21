import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/data";
import { publishableSiteOrigin } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  let sitemap: string | undefined;
  try {
    const env = await getEnv();
    const origin = publishableSiteOrigin(env.SITE_URL);
    if (origin) sitemap = `${origin}/sitemap.xml`;
  } catch {
    /* bindings unavailable: omit sitemap */
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/admin"],
    },
    ...(sitemap ? { sitemap } : {}),
  };
}
