import { NextResponse, type NextRequest } from "next/server";

/**
 * Hostname-based routing.
 *
 * The CSR app shipped first at `whitespaceindia-csr.vercel.app`. Anyone with
 * that URL bookmarked (or any backlink already in the wild) expects to land
 * on the CSR experience, not the new parent-brand landing. We honor that:
 * requests on the legacy host get rewritten to /csr/* so the CSR app shows
 * up exactly where it always did. New hosts (whitespaceindia.vercel.app,
 * future custom domains) see the landing at /.
 *
 * If you add a `csr.whitespaceindia.com` subdomain later, append its host
 * to LEGACY_CSR_HOSTS — same rewrite.
 */
const LEGACY_CSR_HOSTS = new Set([
  "whitespaceindia-csr.vercel.app",
  "csr.whitespaceindia.com",
]);

export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase().split(":")[0] ?? "";
  const { pathname, search } = req.nextUrl;

  if (LEGACY_CSR_HOSTS.has(host) && !pathname.startsWith("/csr")) {
    const rewritten = req.nextUrl.clone();
    rewritten.pathname = `/csr${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewritten);
  }

  return NextResponse.next();
}

// Skip Next.js internals, API routes, and static assets — only run on page
// requests. Without this filter, every image and font request would hit the
// middleware unnecessarily.
export const config = {
  matcher: ["/((?!api|_next|landing|images|data|.*\\..*).*)"],
};
