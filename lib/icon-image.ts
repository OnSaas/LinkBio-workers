const FETCH_TIMEOUT_MS = 2500;
const MAX_AVATAR_BYTES = 512 * 1024;

export interface IconCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export function defaultIconCache(): IconCache | null {
  const storage = (
    globalThis as {
      caches?: {
        default?: {
          match(request: Request): Promise<Response | undefined>;
          put(request: Request, response: Response): Promise<void>;
        };
      };
    }
  ).caches;
  const cache = storage?.default;
  if (!cache) return null;
  return cache;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function firstLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "L";
  return Array.from(trimmed)[0]!.toUpperCase();
}

function svgCircleLetter(letter: string): string {
  const safe = escapeXml(letter.slice(0, 2));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="32" fill="#6366f1"/>
  <text x="32" y="33" dominant-baseline="middle" text-anchor="middle" fill="#ffffff"
    font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="28" font-weight="600">${safe}</text>
</svg>`;
}

function svgCircleAvatarDataUrl(dataUrl: string): string {
  const href = escapeXml(dataUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath>
  </defs>
  <circle cx="32" cy="32" r="32" fill="#6366f1"/>
  <image href="${href}" xlink:href="${href}" width="64" height="64" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function normalizeMime(contentType: string | null, url: string): string | null {
  const raw = (contentType || "").split(";")[0]?.trim().toLowerCase() || "";
  if (
    raw === "image/jpeg" ||
    raw === "image/jpg" ||
    raw === "image/png" ||
    raw === "image/webp" ||
    raw === "image/gif"
  ) {
    return raw === "image/jpg" ? "image/jpeg" : raw;
  }
  const path = url.split("?")[0]?.toLowerCase() || "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (raw.startsWith("image/")) return raw;
  return null;
}

async function fetchAvatarDataUrl(avatarUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(avatarUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "LinkBio-workers-favicon/1.0",
      },
    });
    if (!res.ok) return null;

    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_AVATAR_BYTES) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_AVATAR_BYTES) return null;

    const mime = normalizeMime(res.headers.get("content-type"), parsed.toString());
    if (!mime || mime === "image/svg+xml" || mime.includes("svg")) return null;

    return `data:${mime};base64,${bytesToBase64(buf)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function svgResponse(svg: string, maxAge: number): Response {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

export async function renderProfileIcon(options: {
  name: string;
  avatar: string;
  fetchImpl?: typeof fetch;
  cache?: IconCache | null;
}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache === undefined ? defaultIconCache() : options.cache;
  const letter = firstLetter(options.name || "");
  const avatar = (options.avatar || "").trim();

  if (!/^https?:\/\//i.test(avatar)) {
    return svgResponse(svgCircleLetter(letter), 300);
  }

  const key = new Request(avatar);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  const dataUrl = await fetchAvatarDataUrl(avatar, fetchImpl);
  const svg = dataUrl ? svgCircleAvatarDataUrl(dataUrl) : svgCircleLetter(letter);
  const response = svgResponse(svg, dataUrl ? 3600 : 60);
  if (cache) await cache.put(key, response.clone());
  return response;
}
