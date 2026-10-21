import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { getEnv, getRequestPrefs, getSettings } from "@/lib/data";
import { htmlLang } from "@/lib/i18n";
import { COLOR_COOKIE, parseColorMode } from "@/lib/prefs";
import { resolveThemeId } from "@/lib/themes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "LinkBio",
    template: "%s",
  },
  description: "Personal bio / digital card on Cloudflare Workers",
  icons: {
    icon: [{ url: "/icon", type: "image/svg+xml" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let dataTheme: "system" | "light" | "dark" = "system";
  let lang = "zh-CN";
  let themeId = "minimal";

  try {
    const jar = await cookies();
    dataTheme = parseColorMode(jar.get(COLOR_COOKIE)?.value) || "system";
  } catch {
    /* cookies unavailable */
  }

  try {
    const env = await getEnv();
    const settings = await getSettings();
    const prefs = await getRequestPrefs(settings);
    dataTheme = prefs.colorMode;
    lang = htmlLang(prefs.locale);
    themeId = resolveThemeId(settings.theme, env.DEFAULT_THEME);
  } catch {
    /* keep defaults when KV unavailable (e.g. edge edge-cases) */
  }

  const colorScheme =
    dataTheme === "system" ? "light dark" : dataTheme === "light" ? "light" : "dark";

  return (
    <html
      lang={lang}
      data-theme={dataTheme}
      data-theme-id={themeId}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content={colorScheme} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('lb_color');if(m==='light'||m==='dark'||m==='system'){document.documentElement.setAttribute('data-theme',m);var meta=document.querySelector('meta[name="color-scheme"]');if(meta)meta.setAttribute('content',m==='system'?'light dark':m);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
