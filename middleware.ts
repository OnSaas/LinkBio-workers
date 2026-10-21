import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  generateCsrfToken,
  securityHeaders,
} from "@/lib/security";

function isSecureRequest(req: NextRequest): boolean {
  if (req.nextUrl.protocol === "https:") return true;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto === "https") return true;
  const host = req.headers.get("host") || "";
  if (host.includes("localhost") || host.startsWith("127.0.0.1")) return false;
  return proto !== "http";
}

/**
 * For /admin/*: ensure double-submit CSRF cookie exists.
 * Must not use cookies().set inside RSC (Next 15 throws → HTTP 500).
 */
export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);

  let csrfToken: string | undefined;
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const existing = req.cookies.get(CSRF_COOKIE)?.value;
    if (existing && existing.length >= 16) {
      csrfToken = existing;
    } else {
      csrfToken = generateCsrfToken();
    }
    requestHeaders.set(CSRF_HEADER, csrfToken);
  }

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  for (const [k, v] of Object.entries(securityHeaders(isSecureRequest(req)))) {
    res.headers.set(k, v);
  }

  if (csrfToken && req.nextUrl.pathname.startsWith("/admin")) {
    const existing = req.cookies.get(CSRF_COOKIE)?.value;
    if (!existing || existing.length < 16) {
      res.cookies.set(CSRF_COOKIE, csrfToken, {
        path: "/",
        sameSite: "lax",
        maxAge: 86400,
        httpOnly: true,
        secure: isSecureRequest(req),
      });
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
