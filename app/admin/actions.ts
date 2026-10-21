"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  backupConfigFromForm,
  restoreFromGist,
  restoreFromWebDav,
  runBackup,
  scheduleBackup,
} from "@/lib/backup";
import { getAdminUi } from "@/lib/admin-ui";
import { translateBackupError } from "@/lib/backup-i18n";
import { isAdminSession } from "@/lib/auth";
import { getEnv, getStore } from "@/lib/env";
import { flashErr, flashOk, setFlashCookie } from "@/lib/flash";
import { createT } from "@/lib/i18n";
import {
  clientIpFromHeaders,
  sanitizeLink,
  sanitizeProfile,
  sanitizeSettings,
  stripForbiddenSecrets,
} from "@/lib/kv";
import { resolveLocale } from "@/lib/prefs";
import {
  constantTimeEqual,
  createSessionToken,
  getSessionCookieName,
} from "@/lib/session";
import {
  CSRF_COOKIE,
  CSRF_FIELD,
  generateCsrfToken,
  isSecureRequestFromHeaders,
  validateCsrf,
} from "@/lib/security";
import type { LinkItem } from "@/lib/types";
import { resolveThemeId } from "@/lib/themes";

async function tSite() {
  try {
    const ui = await getAdminUi();
    return ui.t;
  } catch {
    const store = await getStore();
    const settings = await store.getSettings();
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
    return createT(locale);
  }
}

async function requireCsrf(formData: FormData) {
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value || null;
  const formToken = String(formData.get(CSRF_FIELD) || "");
  if (!validateCsrf(cookieToken, formToken)) {
    return false;
  }
  return true;
}

/** Session + CSRF for mutating admin actions. Login/logout skip this. */
async function requireWrite(formData: FormData, failPath: string): Promise<void> {
  if (!(await isAdminSession())) redirect("/admin/login");
  const t = await tSite();
  if (!(await requireCsrf(formData))) {
    await flashRedirect(failPath, flashErr(t("admin.error.csrf")));
  }
}

async function isSecure() {
  const h = await headers();
  return isSecureRequestFromHeaders(h);
}

/** Set one-shot flash then redirect (no ?msg= in the URL). */
async function flashRedirect(path: string, message: string): Promise<never> {
  await setFlashCookie(message);
  redirect(path);
}

function revalidatePublic() {
  revalidatePath("/");
}

export async function loginAction(formData: FormData) {
  const store = await getStore();
  const env = await getEnv();
  const t = await tSite();
  const h = await headers();
  const ip = clientIpFromHeaders(h);

  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    await flashRedirect("/admin/login", flashErr(t("admin.login.error.noPassword")));
  }

  const lock = await store.checkLoginRateLimit(ip);
  if (lock !== null) {
    await flashRedirect(
      "/admin/login",
      flashErr(t("admin.login.error.rateLimit", { minutes: lock })),
    );
  }

  if (!(await requireCsrf(formData))) {
    await flashRedirect("/admin/login", flashErr(t("admin.login.error.csrf")));
  }

  const password = String(formData.get("password") || "");
  const ok = await constantTimeEqual(password, env.ADMIN_PASSWORD);
  if (!ok) {
    await store.recordLoginFailure(ip);
    await flashRedirect("/admin/login", flashErr(t("admin.login.error.password")));
  }

  await store.clearLoginRateLimit(ip);
  const token = await createSessionToken(env.SESSION_SECRET);
  const jar = await cookies();
  const sec = await isSecure();
  jar.set(getSessionCookieName(), token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    secure: sec,
  });
  jar.set(CSRF_COOKIE, generateCsrfToken(), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 86400,
    secure: sec,
  });
  redirect("/admin");
}

export async function logoutAction(formData: FormData) {
  if (!(await requireCsrf(formData))) {
    redirect("/admin");
  }
  const jar = await cookies();
  jar.set(getSessionCookieName(), "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    secure: await isSecure(),
  });
  redirect("/admin/login");
}

export async function saveProfileAction(formData: FormData) {
  await requireWrite(formData, "/admin/profile");
  const t = await tSite();
  const store = await getStore();
  await store.setProfile(
    sanitizeProfile({
      name: String(formData.get("name") || ""),
      username: String(formData.get("username") || ""),
      bio: String(formData.get("bio") || ""),
      avatar: String(formData.get("avatar") || ""),
      location: String(formData.get("location") || ""),
      email: String(formData.get("email") || ""),
    }),
  );
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/profile", flashOk(t("admin.profile.saved")));
}

export async function saveSettingsAction(formData: FormData) {
  await requireWrite(formData, "/admin/theme");
  const t = await tSite();
  const store = await getStore();
  const env = await getEnv();
  const next = sanitizeSettings({
    theme: resolveThemeId(String(formData.get("theme") || ""), env.DEFAULT_THEME),
    accentColor: String(formData.get("accentColor") || ""),
    background: String(formData.get("background") || ""),
    colorMode: String(formData.get("colorMode") || "") as never,
    themeColorMode: String(formData.get("themeColorMode") || "") as never,
    customColor: String(formData.get("customColor") || ""),
    locale: String(formData.get("locale") || "") as never,
    showFooter: formData.get("showFooter") === "1",
    footerMode: String(formData.get("footerMode") || "") as never,
    footerText: String(formData.get("footerText") || ""),
  });
  await store.setSettings(next);
  revalidatePublic();
  await scheduleBackup(store);
  // Admin UI language follows visitor cookie (toolbar), not site default locale.
  await flashRedirect("/admin/theme", flashOk(t("admin.theme.saved")));
}

export async function addLinkAction(formData: FormData) {
  await requireWrite(formData, "/admin/links");
  const t = await tSite();
  const store = await getStore();
  const links = await store.getLinks();
  const maxOrder = links.reduce((m, l) => Math.max(m, l.order), -1);
  const item = sanitizeLink(
    {
      id: crypto.randomUUID(),
      title: String(formData.get("title") || ""),
      url: String(formData.get("url") || ""),
      icon: String(formData.get("icon") || "link"),
      order: maxOrder + 1,
      enabled: formData.get("enabled") === "1",
    },
    maxOrder + 1,
  );
  if (!item.url) {
    await flashRedirect("/admin/links/new", flashErr(t("admin.links.invalidUrl")));
  }
  links.push(item);
  await store.setLinks(links);
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/links", flashOk(t("admin.links.added")));
}

/** Update title/url/icon/enabled by id; keep order and id unchanged. */
export async function updateLinkAction(formData: FormData) {
  await requireWrite(formData, "/admin/links");
  const t = await tSite();
  const id = String(formData.get("id") || "").trim();
  if (!id) {
    await flashRedirect("/admin/links", flashErr(t("admin.links.notFound")));
  }
  const store = await getStore();
  const links = await store.getLinks();
  const idx = links.findIndex((l) => l.id === id);
  if (idx < 0) {
    await flashRedirect("/admin/links", flashErr(t("admin.links.notFound")));
  }
  const prev = links[idx]!;
  const next = sanitizeLink(
    {
      id: prev.id,
      title: String(formData.get("title") || ""),
      url: String(formData.get("url") || ""),
      icon: String(formData.get("icon") || prev.icon || "link"),
      order: prev.order,
      enabled: formData.get("enabled") === "1",
    },
    prev.order,
  );
  // sanitizeLink may regenerate id — force preserve
  next.id = prev.id;
  next.order = prev.order;
  if (!next.url) {
    await flashRedirect(
      `/admin/links/${encodeURIComponent(id)}`,
      flashErr(t("admin.links.invalidUrl")),
    );
  }
  links[idx] = next;
  await store.setLinks(links);
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/links", flashOk(t("admin.links.savedEdit")));
}

export async function deleteLinkAction(formData: FormData) {
  await requireWrite(formData, "/admin/links");
  const t = await tSite();
  const id = String(formData.get("id") || "");
  const store = await getStore();
  const links = (await store.getLinks()).filter((l) => l.id !== id);
  await store.setLinks(links.map((l, i) => ({ ...l, order: i })));
  await store.deleteLinkClicks(id).catch(() => {
    /* deleting the link still succeeds if the counter key cannot be removed */
  });
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/links", flashOk(t("admin.links.deleted")));
}

export async function toggleLinkAction(formData: FormData) {
  await requireWrite(formData, "/admin/links");
  const t = await tSite();
  const id = String(formData.get("id") || "");
  const store = await getStore();
  const links = await store.getLinks();
  await store.setLinks(links.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)));
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/links", flashOk(t("admin.links.updated")));
}

export async function reorderLinkAction(formData: FormData) {
  await requireWrite(formData, "/admin/links");
  const t = await tSite();
  const id = String(formData.get("id") || "");
  const dir = Number(formData.get("dir") || 0) as -1 | 1;
  const store = await getStore();
  const links = (await store.getLinks()).sort((a, b) => a.order - b.order);
  const idx = links.findIndex((l) => l.id === id);
  if (idx < 0) redirect("/admin/links");
  const swap = idx + dir;
  if (swap < 0 || swap >= links.length) redirect("/admin/links");
  const tmp = links[idx]!;
  links[idx] = links[swap]!;
  links[swap] = tmp;
  const normalized: LinkItem[] = links.map((l, i) => ({ ...l, order: i }));
  await store.setLinks(normalized);
  revalidatePublic();
  await scheduleBackup(store);
  await flashRedirect("/admin/links", flashOk(t("admin.links.reordered")));
}

export async function importDataAction(formData: FormData) {
  await requireWrite(formData, "/admin/data");
  const t = await tSite();
  const raw = String(formData.get("json") || "");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const data = stripForbiddenSecrets(parsed);
    const store = await getStore();
    await store.importAll({
      profile: data.profile as never,
      links: data.links as never,
      settings: data.settings as never,
      analytics: data.analytics as never,
      backup: data.backup as never,
    });
    revalidatePublic();
    await scheduleBackup(store);
    await flashRedirect("/admin/data", flashOk(t("admin.data.imported")));
  } catch {
    await flashRedirect("/admin/data", flashErr(t("admin.data.invalidJson")));
  }
}

export async function saveBackupConfigAction(formData: FormData) {
  await requireWrite(formData, "/admin/data");
  const t = await tSite();
  const store = await getStore();
  const next = backupConfigFromForm(formData);
  // Preserve password/token if form left blank (browser may not re-send secrets)
  const prev = await store.getBackupConfig();
  if (!String(formData.get("webdavPassword") || "") && prev.webdav.password) {
    next.webdav.password = prev.webdav.password;
  }
  if (!String(formData.get("gistToken") || "") && prev.gist.token) {
    next.gist.token = prev.gist.token;
  }
  await store.setBackupConfig(next);
  await flashRedirect("/admin/data", flashOk(t("admin.backup.configSaved")));
}

export async function runBackupNowAction(formData: FormData) {
  await requireWrite(formData, "/admin/data");
  const t = await tSite();
  const store = await getStore();
  const result = await runBackup(store, { source: "manual", force: true });
  if (result.ok) {
    if (result.error) {
      await flashRedirect(
        "/admin/data",
        flashOk(
          t("admin.backup.runOkPartial", {
            details: translateBackupError(t, result.error),
          }),
        ),
      );
    }
    await flashRedirect("/admin/data", flashOk(t("admin.backup.runOk")));
  }
  await flashRedirect(
    "/admin/data",
    flashErr(translateBackupError(t, result.error) || t("admin.backup.runFail")),
  );
}

export async function restoreWebDavAction(formData: FormData) {
  await requireWrite(formData, "/admin/data");
  const t = await tSite();
  const store = await getStore();
  const result = await restoreFromWebDav(store);
  if (result.ok) {
    revalidatePublic();
    await flashRedirect("/admin/data", flashOk(t("admin.backup.restoreOk")));
  }
  await flashRedirect(
    "/admin/data",
    flashErr(translateBackupError(t, result.error) || t("admin.backup.restoreFail")),
  );
}

export async function restoreGistAction(formData: FormData) {
  await requireWrite(formData, "/admin/data");
  const t = await tSite();
  const store = await getStore();
  const result = await restoreFromGist(store);
  if (result.ok) {
    revalidatePublic();
    await flashRedirect("/admin/data", flashOk(t("admin.backup.restoreOk")));
  }
  await flashRedirect(
    "/admin/data",
    flashErr(translateBackupError(t, result.error) || t("admin.backup.restoreFail")),
  );
}

export { flashOk, flashErr };
