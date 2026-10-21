import { getEnv, getStore } from "@/lib/env";
import { loadPublicSite, toPublicSiteJson } from "@/lib/site-public";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await getStore();
  const env = await getEnv();
  const data = await loadPublicSite(store);
  return Response.json(toPublicSiteJson(data, env), {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
