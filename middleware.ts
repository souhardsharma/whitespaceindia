import { NextResponse, type NextRequest } from "next/server";

/**
 * Hostname-based routing.
 *
 * The CSR app shipped first at `whitespaceindia-csr.vercel.app`. Anyone with
 * that URL bookmarked (or any backlink already in the wild) expects to land
 * on the CSR experience, not the new parent-brand landing. We honor that:
 * requests to `/` on the legacy host get rewritten to `/csr` so the homepage
 * still serves the CSR app. All other paths (`/methodology`, `/about`, etc.)
 * already work as-is — they were always top-level routes — so we leave them
 * alone.
 *
 * If you add a `csr.whitespaceindia.com` subdomain later, append its host
 * to LEGACY_CSR_HOSTS — same behavior.
 */
const LEGACY_CSR_HOSTS = new Set([
  "whitespaceindia-csr.vercel.app",
  "csr.whitespaceindia.com",
]);

export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase().split(":")[0] ?? "";
  const { pathname } = req.nextUrl;

  if (LEGACY_CSR_HOSTS.has(host) && pathname === "/") {
    const rewritten = req.nextUrl.clone();
    rewritten.pathname = "/csr";
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
