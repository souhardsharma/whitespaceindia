/**
 * The part of the site that answers on request (the search, the status
 * lookup, /latest) sleeps when nobody has used it for a while, and a request
 * made through the site cannot wake it: the proxy answers 503 and names the
 * backend's address in `x-backend-wake` (scripts/cloudflare/proxy.mjs, which
 * records why).
 *
 * A reader's own browser can wake it. A visit to that address starts the
 * service, and the backend answers every visit by sending it back to the same
 * path here. A script cannot make that visit, because the site's
 * Content-Security-Policy keeps connect-src to 'self', so the reader is given
 * a link.
 */
export class BackendAsleep extends Error {
  origin: string;

  constructor(origin: string) {
    super("the backend is asleep");
    this.name = "BackendAsleep";
    this.origin = origin;
  }
}

/** The address to send a reader to, when `res` says the backend is asleep. */
export function wakeOrigin(res: Response): string | null {
  if (res.status !== 503) return null;
  const origin = res.headers.get("x-backend-wake") ?? "";
  return /^https:\/\/[a-z0-9.-]+$/i.test(origin) ? origin : null;
}

/** The same page on the backend: where the link goes, and where it returns from. */
export function wakeLink(origin: string, here: { pathname: string; search: string }): string {
  return origin + here.pathname + here.search;
}
