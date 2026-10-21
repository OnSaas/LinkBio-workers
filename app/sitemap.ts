import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/data";
import { publishableSiteOrigin } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const env = await getEnv();
    const origin = publishableSiteOrigin(env.SITE_URL);
    if (!origin) return [];
    return [{ url: `${origin}/` }];
  } catch {
    return [];
  }
}
