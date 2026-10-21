import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ProfileCard } from "@/components/public/profile-card";
import { LinkList } from "@/components/public/link-list";
import { SiteFooter } from "@/components/public/site-footer";
import { ThemeToolbar } from "@/components/public/theme-toolbar";
import { isAdminSession } from "@/lib/auth";
import { getEnv, getStore, waitUntil } from "@/lib/env";
import { createT, htmlLang } from "@/lib/i18n";
import { resolveColorMode, resolveLocale } from "@/lib/prefs";
import { getTheme, resolveThemeId } from "@/lib/themes";
import { buildThemeColorOverrideCss, resolveColorSeed } from "@/lib/theme-colors";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function truncateName(name: string, max = 40): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const store = await getStore();
    const env = await getEnv();
    const profile = await store.getProfile();
    const settings = await store.getSettings();
    const siteName = env.SITE_NAME || "LinkBio";
    const name = truncateName(profile.name || "");
    // absolute avoids root layout default/template overriding page title
    const displayTitle = name ? `${name}-LinkBio` : siteName;

    const jar = await cookies();
    const hdrs = await headers();
    const cookieHeader = jar
      .getAll()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join("; ");
    const { locale } = resolveLocale(
      cookieHeader,
      hdrs.get("accept-language") || undefined,
      settings.locale,
    );
    const description = createT(locale)("public.metaDescription", { siteName });
    return {
      title: { absolute: displayTitle },
      description,
      icons: {
        icon: [{ url: "/icon", type: "image/svg+xml" }],
      },
    };
  } catch {
    return {
      title: { absolute: "LinkBio" },
      icons: {
        icon: [{ url: "/icon", type: "image/svg+xml" }],
      },
    };
  }
}

export default async function PublicPage() {
  const store = await getStore();
  const env = await getEnv();
  const siteName = env.SITE_NAME || "LinkBio";
  const [profile, links, settings] = await Promise.all([
    store.getProfile(),
    store.getLinks(),
    store.getSettings(),
  ]);

  await waitUntil(store.incrementPageViews());

  const jar = await cookies();
  const hdrs = await headers();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  const colorMode = resolveColorMode(cookieHeader, settings.colorMode);
  const { pref: localePref, locale } = resolveLocale(
    cookieHeader,
    hdrs.get("accept-language") || undefined,
    settings.locale,
  );
  const themeId = resolveThemeId(settings.theme, env.DEFAULT_THEME);
  const theme = getTheme(themeId);
  const t = createT(locale);
  const isAdmin = await isAdminSession();

  const seed = resolveColorSeed(settings.themeColorMode, settings.customColor);
  const dynamicColorCss = seed ? buildThemeColorOverrideCss(seed, themeId) : null;

  const hasBg = Boolean(settings.background && /^https?:\/\//i.test(settings.background));
  const useGradient = Boolean(theme.features?.gradientBg) && !hasBg;

  return (
    <>
      {dynamicColorCss ? (
        <style
          id="theme-color-override"
          dangerouslySetInnerHTML={{ __html: dynamicColorCss }}
        />
      ) : null}
      {/*
        Use a real box (not display:contents) so [data-theme-id] descendant
        selectors in theme tokens.css apply reliably.
      */}
      <div
        lang={htmlLang(locale)}
        data-theme={colorMode}
        data-theme-id={themeId}
        className="relative min-h-screen min-h-dvh bg-background text-foreground"
      >
        <ThemeToolbar
          colorMode={colorMode}
          localePref={localePref}
          labels={{
            color: t("public.toolbar.color"),
            system: t("public.toolbar.color.system"),
            light: t("public.toolbar.color.light"),
            dark: t("public.toolbar.color.dark"),
            locale: t("public.toolbar.locale"),
            auto: t("public.toolbar.locale.auto"),
            zh: t("public.toolbar.locale.zh"),
            en: t("public.toolbar.locale.en"),
          }}
        />
        <main
          className={cn("theme-page", useGradient && "theme-page--gradient")}
          style={
            hasBg
              ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.75)),url(${settings.background})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div className="theme-stack">
            <div className="theme-card flex w-full min-w-0 flex-col items-center gap-[inherit]">
              <ProfileCard profile={profile} />
              <LinkList links={links} emptyLabel={t("public.emptyLinks")} />
            </div>
            <SiteFooter
              settings={settings}
              siteName={siteName}
              isAdmin={isAdmin}
              defaultText={t("public.footer.site", { siteName })}
            />
          </div>
        </main>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.setAttribute('data-theme',${JSON.stringify(colorMode)});document.documentElement.setAttribute('data-theme-id',${JSON.stringify(themeId)});document.documentElement.lang=${JSON.stringify(htmlLang(locale))};`,
        }}
      />
    </>
  );
}
