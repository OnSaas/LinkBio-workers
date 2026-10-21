import { getEnv, getRequestPrefs, getSettings, getStore } from "@/lib/data";
import { createT, type TranslateFn } from "@/lib/i18n";
import type { LocalePref } from "@/lib/prefs";
import type { ColorMode, Locale, Settings } from "@/lib/types";
import type { BioStore } from "@/lib/kv";
import type { CloudflareEnv } from "@/lib/env";

/**
 * Shared admin SSR context: locale/color respect visitor cookies (same as public toolbar).
 */
export async function getAdminUi(): Promise<{
  store: BioStore;
  env: CloudflareEnv;
  settings: Settings;
  locale: Locale;
  localePref: LocalePref;
  colorMode: ColorMode;
  t: TranslateFn;
  cookieHeader: string;
  siteName: string;
}> {
  const store = await getStore();
  const env = await getEnv();
  const settings = await getSettings();
  const { cookieHeader, colorMode, localePref, locale } = await getRequestPrefs(settings);
  const t = createT(locale);
  return {
    store,
    env,
    settings,
    locale,
    localePref,
    colorMode,
    t,
    cookieHeader,
    siteName: env.SITE_NAME || "LinkBio",
  };
}

/** Labels for prefs toolbar (color + locale). */
export function prefsToolbarLabels(t: TranslateFn) {
  return {
    color: t("public.toolbar.color"),
    system: t("public.toolbar.color.system"),
    light: t("public.toolbar.color.light"),
    dark: t("public.toolbar.color.dark"),
    locale: t("public.toolbar.locale"),
    auto: t("public.toolbar.locale.auto"),
    zh: t("public.toolbar.locale.zh"),
    en: t("public.toolbar.locale.en"),
  };
}
