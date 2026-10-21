/**
 * Escape text for HTML text nodes / attributes.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Simple CSRF: double-submit cookie + form field.
 */
export const CSRF_COOKIE = "lb_csrf";
export const CSRF_FIELD = "_csrf";
/** Middleware → RSC: freshly issued CSRF token for the same request (no cookie yet on request). */
export const CSRF_HEADER = "x-csrf-token";

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
  return s;
}

export function validateCsrf(cookieToken: string | null, formToken: string | null | undefined): boolean {
  if (!cookieToken || !formToken) return false;
  if (cookieToken.length < 16 || formToken.length < 16) return false;
  if (cookieToken.length !== formToken.length) return false;
  let out = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    out |= cookieToken.charCodeAt(i) ^ formToken.charCodeAt(i);
  }
  return out === 0;
}

export function clickBodyTooLarge(req: Request): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const len = Number(raw);
  return Number.isFinite(len) && len > 1024;
}

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless/i;

/** Skip page-view and click counting for crawlers, link previews, and prefetch. */
export function isLikelyBot(headers: Headers): boolean {
  const ua = headers.get("user-agent") || "";
  if (BOT_UA.test(ua)) return true;
  const purpose = `${headers.get("purpose") || ""} ${headers.get("sec-purpose") || ""}`.toLowerCase();
  return purpose.includes("prefetch");
}

export function isSecureRequestFromHeaders(h: Headers): boolean {
  const proto = h.get("x-forwarded-proto");
  if (proto === "https") return true;
  const host = h.get("host") || "";
  return host.includes("localhost") || host.startsWith("127.0.0.1") ? false : proto !== "http";
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

export function securityHeaders(secure: boolean): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (secure) headers["Strict-Transport-Security"] = "max-age=31536000";
  return headers;
}
