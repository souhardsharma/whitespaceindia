// The backend build's own scripts and styles, which its pages (/latest) name
// under /_be (next.config.mjs): /_be/_next/static/x is the backend's
// /_next/static/x. Pages has its own build's files, not these.
import { proxyAsset } from "../../scripts/cloudflare/proxy.mjs";
export const onRequest = proxyAsset;
