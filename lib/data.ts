import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getEnv as readEnv } from "./env";
import { BioStore } from "./kv";
import { resolveColorMode, resolveLocale } from "./prefs";
import type { ColorMode, Locale } from "./types";

export const getEnv = cache(readEnv);

export const getStore = cache(async () => {
  const env = await getEnv();
  return new BioStore(env.BIO_KV);
});

export const getProfile = cache(async () => (await getStore()).getProfile());
export const getLinks = cache(async () => (await getStore()).getLinks());
export const getSettings = cache(async () => (await getStore()).getSettings());

export function joinCookieHeader(pairs: { name: string; value: string }[]): string {
  return pairs.map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join("; ");
}

/**
 * Visitor color and locale for this request.
 * Lives here, not in lib/prefs.ts, because that module is imported by client components.
 */
export const getRequestPrefs = cache(async (settings: { colorMode?: ColorMode; locale?: Locale }) => {
  const jar = await cookies();
  const hdrs = await headers();
  const cookieHeader = joinCookieHeader(jar.getAll());
  const colorMode = resolveColorMode(cookieHeader, settings.colorMode);
  const { pref: localePref, locale } = resolveLocale(
    cookieHeader,
    hdrs.get("accept-language") || undefined,
    settings.locale,
  );
  return { cookieHeader, colorMode, localePref, locale, hdrs };
});
