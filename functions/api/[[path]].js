// /api/* except /api/news, which is a static file (see _routes.json).
import { proxy } from "../../scripts/cloudflare/proxy.mjs";
export const onRequest = proxy;
