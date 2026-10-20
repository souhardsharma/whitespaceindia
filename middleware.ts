import { NextResponse, type NextRequest } from "next/server";
import { LEGACY_CSR_HOSTS, SITE_URL } from "@/lib/site";

/**
 * Hostname-based routing.
 *
 * The CSR app shipped first on its own host. Every page there now answers
 * with a permanent redirect to the same path on the primary origin
 * (lib/site.ts), and "/" goes to /csr, so a bookmark or backlink to the old
 * host still lands on the CSR app. It used to rewrite "/" to "/csr" in place,
 * which served one page at two URLs and left a second host carrying copies
 * of every page; Search Console reported the duplicate and the parent
 * landing, canonicalised to the old host's "/", could never be indexed.
 *
 * 308 keeps the method, and a permanent redirect is what transfers the old
 * URLs' standing to the new ones. API routes, Next internals and files are
 * outside the matcher and keep answering on either host.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase().split(":")[0] ?? "";
  if (!LEGACY_CSR_HOSTS.has(host)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  const target = new URL(pathname === "/" ? "/csr" : pathname, SITE_URL);
  target.search = search;
  return NextResponse.redirect(target, 308);
}

// Page requests only. Without this filter every image and font request would
// run the middleware for nothing.
export const config = {
  matcher: ["/((?!api|_next|landing|images|data|.*\\..*).*)"],
};
