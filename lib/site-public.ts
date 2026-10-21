import type { BioStore } from "./kv";
import type { LinkItem, Profile, Settings } from "./types";

/** Profile, links, and settings only. Analytics are not part of this response. */
export async function loadPublicSite(store: BioStore): Promise<{
  profile: Profile;
  links: LinkItem[];
  settings: Settings;
}> {
  const [profile, links, settings] = await Promise.all([
    store.getProfile(),
    store.getLinks(),
    store.getSettings(),
  ]);
  return { profile, links, settings };
}

export function toPublicSiteJson(
  data: { profile: Profile; links: LinkItem[]; settings: Settings },
  env: { SITE_NAME?: string; SITE_URL?: string },
): {
  siteName: string;
  siteUrl: string;
  profile: Profile;
  links: LinkItem[];
  settings: Settings;
} {
  return {
    siteName: env.SITE_NAME || "LinkBio",
    siteUrl: env.SITE_URL || "",
    profile: data.profile,
    links: data.links.filter((link) => link.enabled),
    settings: data.settings,
  };
}
