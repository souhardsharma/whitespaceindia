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
  // Joined as text, never resolved against the origin: `new URL("//evil.com",
  // SITE_URL)` is https://evil.com, an open redirect waiting for the platform
  // to stop collapsing `//`. Collapsing leading slashes here and checking the
  // result's origin keeps every redirect on SITE_URL whatever the path holds.
  const path = pathname === "/" ? "/csr" : "/" + pathname.replace(/^[/\\]+/, "");
  const target = new URL(SITE_URL + path);
  if (target.origin !== new URL(SITE_URL).origin) return NextResponse.next();
  target.search = search;
  return NextResponse.redirect(target, 308);
}

// Page requests on a legacy host only. On Next 15 an invocation added ~190 ms
// to every page on the primary origin, where it only ever said "carry on", so
// the platform now skips it there. The host list must stay literal (Next reads
// the matcher at build time) and equal LEGACY_CSR_HOSTS; site.test.ts checks.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next|landing|images|data|.*\\..*).*)",
      has: [{ type: "host", value: "whitespaceindia-csr\\.vercel\\.app|csr\\.whitespaceindia\\.com" }],
    },
  ],
};
