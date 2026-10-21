/**
 * Optional remote backup (WebDAV + GitHub Gist).
 * Credentials live in KV as plain user config — never env ADMIN_PASSWORD / SESSION_SECRET.
 *
 * Auth notes (401 root causes we handle):
 * - WebDAV: fetch() drops Authorization on cross-origin redirects (http→https, trailing slash).
 *   We follow redirects manually and re-attach Basic auth each hop.
 * - WebDAV: user:pass@url credentials must not be mixed with a second Authorization header.
 * - Gist: strip accidental "Bearer "/"token " prefixes; allow long fine-grained PATs.
 */
import type { BioStore } from "./kv";
import { sanitizeBackupConfig, stripForbiddenSecrets } from "./kv";
import type {
  BackupConfig,
  BackupPayload,
  BackupState,
  GistBackupConfig,
  SiteData,
  WebDavBackupConfig,
} from "./types";
import { DEFAULT_BACKUP_STATE } from "./types";

const UA = "LinkBio-workers-backup";

export type BackupTargetResult = {
  target: "webdav" | "gist";
  ok: boolean;
  error?: string;
  /** New gist id when created */
  gistId?: string;
};

export type BackupRunResult = {
  ok: boolean;
  results: BackupTargetResult[];
  error: string;
  exportedAt: string;
};

function basicAuth(user: string, pass: string): string {
  // UTF-8 safe Basic (Workers btoa only accepts Latin-1 binary string)
  const raw = `${user}:${pass}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `Basic ${btoa(bin)}`;
}

/** Stable error codes for i18n (UI translates via lib/backup-i18n). */
function errCode(code: string, ...args: Array<string | number>): string {
  return args.length ? `err.${code}|${args.join("|")}` : `err.${code}`;
}

/**
 * Resolve WebDAV URL + Basic auth.
 * Prefer form fields; fall back to userinfo embedded in the URL; never send both
 * (userinfo in URL + Authorization) — that confuses some servers → 401.
 */
function resolveWebDavAuth(cfg: WebDavBackupConfig): {
  url: string;
  authorization: string | null;
} {
  let url = (cfg.url || "").trim();
  let user = (cfg.username || "").trim();
  let pass = cfg.password || ""; // do not trim password (may be intentional spaces)

  try {
    const u = new URL(url);
    if (u.username || u.password) {
      if (!user && !pass) {
        try {
          user = decodeURIComponent(u.username);
        } catch {
          user = u.username;
        }
        try {
          pass = decodeURIComponent(u.password);
        } catch {
          pass = u.password;
        }
      }
      // Strip credentials from URL before request
      u.username = "";
      u.password = "";
      url = u.toString();
    }
  } catch {
    /* keep raw url; fetch will fail with network error if invalid */
  }

  const authorization = user || pass ? basicAuth(user, pass) : null;
  return { url, authorization };
}

/**
 * fetch that re-applies Authorization on every redirect hop.
 * Default fetch drops Authorization when the redirect changes origin
 * (common: http→https or host rewrite on NAS / Nextcloud) → spurious 401.
 */
async function fetchWebDav(
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    authorization: string | null;
  },
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      ...(init.headers || {}),
    };
    if (init.authorization) {
      headers.Authorization = init.authorization;
    }
    const res = await fetch(current, {
      method: init.method,
      headers,
      body: init.body,
      redirect: "manual",
    });

    // 3xx → follow with auth re-attached
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      // Drain body to free connection
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore */
      }
      if (!loc) return res;
      current = new URL(loc, current).toString();
      // Only GET/HEAD should replay body-less; for PUT re-send body on redirect
      continue;
    }

    return res;
  }
  // Too many redirects
  return new Response(null, { status: 310, statusText: "Too many redirects" });
}

function normalizeGistToken(raw: string): string {
  let t = (raw || "").trim();
  // Users sometimes paste full header values
  t = t.replace(/^(Bearer|token)\s+/i, "").trim();
  // Remove accidental surrounding quotes
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function gistHeaders(token: string, withJson = true): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    // Bearer works for classic (ghp_) and fine-grained (github_pat_) PATs
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function pushWebDav(
  cfg: WebDavBackupConfig,
  body: string,
): Promise<BackupTargetResult> {
  if (!cfg.url) return { target: "webdav", ok: false, error: errCode("webdav_url_empty") };
  try {
    const { url, authorization } = resolveWebDavAuth(cfg);
    if (!url) return { target: "webdav", ok: false, error: errCode("webdav_url_empty") };

    const res = await fetchWebDav(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
      authorization,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 401 with no credentials configured — clearer code
      if (res.status === 401 && !authorization) {
        return {
          target: "webdav",
          ok: false,
          error: errCode("webdav_auth_required"),
        };
      }
      return {
        target: "webdav",
        ok: false,
        error: errCode("webdav_http", res.status, text.slice(0, 120)),
      };
    }
    return { target: "webdav", ok: true };
  } catch (e) {
    return {
      target: "webdav",
      ok: false,
      error: e instanceof Error ? errCode("network", e.message) : errCode("webdav_failed"),
    };
  }
}

async function pullWebDav(
  cfg: WebDavBackupConfig,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!cfg.url) return { ok: false, error: errCode("webdav_url_empty") };
  try {
    const { url, authorization } = resolveWebDavAuth(cfg);
    if (!url) return { ok: false, error: errCode("webdav_url_empty") };

    const res = await fetchWebDav(url, {
      method: "GET",
      headers: { Accept: "application/json, text/plain, */*" },
      authorization,
    });
    if (!res.ok) {
      if (res.status === 401 && !authorization) {
        return { ok: false, error: errCode("webdav_auth_required") };
      }
      return { ok: false, error: errCode("webdav_http", res.status) };
    }
    return { ok: true, text: await res.text() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? errCode("network", e.message) : errCode("webdav_fetch_failed"),
    };
  }
}

async function pushGist(
  cfg: GistBackupConfig,
  body: string,
): Promise<BackupTargetResult> {
  const token = normalizeGistToken(cfg.token);
  if (!token) return { target: "gist", ok: false, error: errCode("gist_token_empty") };
  const filename = cfg.filename || "linkbio-backup.json";
  const headers = gistHeaders(token);

  try {
    if (cfg.gistId) {
      const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          files: { [filename]: { content: body } },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          target: "gist",
          ok: false,
          error: errCode("gist_http", res.status, text.slice(0, 120)),
        };
      }
      return { target: "gist", ok: true, gistId: cfg.gistId };
    }

    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers,
      body: JSON.stringify({
        description: "LinkBio-workers backup",
        public: false,
        files: { [filename]: { content: body } },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        target: "gist",
        ok: false,
        error: errCode("gist_create_http", res.status, text.slice(0, 120)),
      };
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) return { target: "gist", ok: false, error: errCode("gist_create_no_id") };
    return { target: "gist", ok: true, gistId: json.id };
  } catch (e) {
    return {
      target: "gist",
      ok: false,
      error: e instanceof Error ? errCode("network", e.message) : errCode("gist_failed"),
    };
  }
}

async function pullGist(
  cfg: GistBackupConfig,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const token = normalizeGistToken(cfg.token);
  if (!token) return { ok: false, error: errCode("gist_token_empty") };
  if (!cfg.gistId) return { ok: false, error: errCode("gist_id_empty") };
  const filename = cfg.filename || "linkbio-backup.json";
  try {
    const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
      headers: gistHeaders(token, false),
    });
    if (!res.ok) return { ok: false, error: errCode("gist_http", res.status) };
    const json = (await res.json()) as {
      files?: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
    };
    const file = json.files?.[filename] || Object.values(json.files || {})[0];
    if (!file) return { ok: false, error: errCode("gist_no_files") };
    if (file.content && !file.truncated) return { ok: true, text: file.content };
    if (file.raw_url) {
      const raw = await fetch(file.raw_url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": UA,
          Accept: "application/vnd.github.raw",
        },
      });
      if (!raw.ok) return { ok: false, error: errCode("gist_raw_http", raw.status) };
      return { ok: true, text: await raw.text() };
    }
    return { ok: false, error: errCode("gist_content_unavailable") };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? errCode("network", e.message) : errCode("gist_fetch_failed"),
    };
  }
}

export async function buildBackupPayload(
  store: BioStore,
  config: BackupConfig,
): Promise<BackupPayload> {
  return store.exportBackup({
    includeAnalytics: config.includeAnalytics,
    includeBackupConfig: true,
    includeBackupSecrets: false,
  });
}

/**
 * Push to all enabled targets in parallel.
 * Failures are recorded; does not throw for partial failure.
 */
export async function runBackup(
  store: BioStore,
  options?: { source?: "auto" | "manual"; force?: boolean },
): Promise<BackupRunResult> {
  const source = options?.source || "manual";
  const force = options?.force === true;
  const config = await store.getBackupConfig();
  const enabled: Array<"webdav" | "gist"> = [];
  if (config.webdav.enabled) enabled.push("webdav");
  if (config.gist.enabled) enabled.push("gist");

  const now = new Date().toISOString();

  if (!force) {
    const state = await store.getBackupState();
    const minSec = Math.max(60, config.minIntervalSec || 300);
    if (state.lastAttemptAt) {
      const elapsed = (Date.now() - Date.parse(state.lastAttemptAt)) / 1000;
      if (Number.isFinite(elapsed) && elapsed < minSec) {
        return { ok: false, results: [], error: state.lastError, exportedAt: now };
      }
    }
  }

  if (!enabled.length) {
    const state: BackupState = {
      ...DEFAULT_BACKUP_STATE,
      lastAttemptAt: now,
      lastOk: false,
      lastError: errCode("no_target"),
      lastSource: source,
      lastTargets: [],
    };
    await store.setBackupState(state).catch(() => {});
    return { ok: false, results: [], error: state.lastError, exportedAt: now };
  }

  const payload = await buildBackupPayload(store, config);
  const body = JSON.stringify(payload, null, 2);

  const tasks: Promise<BackupTargetResult>[] = [];
  if (config.webdav.enabled) tasks.push(pushWebDav(config.webdav, body));
  if (config.gist.enabled) tasks.push(pushGist(config.gist, body));

  const results = await Promise.all(tasks);

  // Persist new gist id if created
  const gistHit = results.find((r) => r.target === "gist" && r.ok && r.gistId);
  if (gistHit?.gistId && gistHit.gistId !== config.gist.gistId) {
    const next = sanitizeBackupConfig({
      ...config,
      gist: { ...config.gist, gistId: gistHit.gistId },
    });
    await store.setBackupConfig(next).catch(() => {});
  }

  const okTargets = results.filter((r) => r.ok).map((r) => r.target);
  const errors = results.filter((r) => !r.ok).map((r) => r.error || r.target);
  const ok = okTargets.length > 0;
  const state: BackupState = {
    lastAttemptAt: now,
    lastSuccessAt: ok ? now : (await store.getBackupState()).lastSuccessAt,
    lastOk: ok,
    lastError: ok
      ? errors.length
        ? `partial:${errors.join("; ")}`
        : ""
      : errors.join("; ") || errCode("backup_failed"),
    lastTargets: okTargets,
    lastSource: source,
  };
  await store.setBackupState(state).catch(() => {});

  return {
    ok,
    results,
    error: state.lastError,
    exportedAt: payload.exportedAt,
  };
}

/**
 * After content writes: if autoBackup on, schedule remote push via waitUntil.
 * Never blocks the request on network I/O when waitUntil is available.
 * Analytics increments must not call this.
 */
export async function scheduleBackup(store: BioStore): Promise<void> {
  try {
    const config = await store.getBackupConfig();
    if (!config.autoBackup) return;
    if (!config.webdav.enabled && !config.gist.enabled) return;

    const state = await store.getBackupState();
    const minSec = Math.max(60, config.minIntervalSec || 300);
    if (state.lastAttemptAt) {
      const elapsed = (Date.now() - Date.parse(state.lastAttemptAt)) / 1000;
      if (Number.isFinite(elapsed) && elapsed < minSec) return;
    }

    const task = runBackup(store, { source: "auto" }).catch(() => {
      /* status already written inside runBackup when possible */
    });

    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const cf = await getCloudflareContext({ async: true });
      const waitUntil = cf?.ctx?.waitUntil?.bind(cf.ctx);
      if (typeof waitUntil === "function") {
        waitUntil(task);
        return;
      }
    } catch {
      /* local/dev without CF ctx */
    }
    // Fallback: do not await long I/O on the critical path
    void task;
  } catch {
    /* never fail the primary write */
  }
}

export async function restoreFromWebDav(store: BioStore): Promise<{ ok: boolean; error: string }> {
  const config = await store.getBackupConfig();
  const pulled = await pullWebDav(config.webdav);
  if (!pulled.ok) return { ok: false, error: pulled.error };
  return applyBackupJson(store, pulled.text);
}

export async function restoreFromGist(store: BioStore): Promise<{ ok: boolean; error: string }> {
  const config = await store.getBackupConfig();
  const pulled = await pullGist(config.gist);
  if (!pulled.ok) return { ok: false, error: pulled.error };
  return applyBackupJson(store, pulled.text);
}

export async function applyBackupJson(
  store: BioStore,
  raw: string,
): Promise<{ ok: boolean; error: string }> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: errCode("invalid_json") };
    }
    const clean = stripForbiddenSecrets(parsed);
    // Remote restore must not rewrite how we connect to the backup source.
    await store.importAll({
      profile: clean.profile as never,
      links: clean.links as never,
      settings: clean.settings as never,
      analytics: clean.analytics as never,
    });
    return { ok: true, error: "" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? errCode("network", e.message) : errCode("apply_failed"),
    };
  }
}

/** FormData → BackupConfig (admin data page). */
export function backupConfigFromForm(formData: FormData): BackupConfig {
  return sanitizeBackupConfig({
    autoBackup: formData.get("autoBackup") === "1",
    minIntervalSec: Number(formData.get("minIntervalSec") || 300),
    includeAnalytics: formData.get("includeAnalytics") === "1",
    webdav: {
      enabled: formData.get("webdavEnabled") === "1",
      url: String(formData.get("webdavUrl") || ""),
      username: String(formData.get("webdavUsername") || ""),
      password: String(formData.get("webdavPassword") || ""),
    },
    gist: {
      enabled: formData.get("gistEnabled") === "1",
      token: String(formData.get("gistToken") || ""),
      gistId: String(formData.get("gistId") || ""),
      filename: String(formData.get("gistFilename") || "linkbio-backup.json"),
    },
  });
}

export type { SiteData };
