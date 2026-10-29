// Keeps the Render backend awake in the hours people use the site. The free
// plan sleeps the service after 15 idle minutes and a cold start takes up to
// a minute, which the CSR brief, the subscribe form and /latest all wait on.
// GitHub never delivered the backend-warm workflow's schedule, so a Cloudflare
// cron asks instead (wrangler.toml beside this file): every 10 minutes from
// 06:30 to 23:30 IST, about 530 of Render's 750 free instance hours a month.
// /healthz is open, so no key is needed.
//
// Deployed from the dashboard as Worker `whitespaceindia-keepwarm`; this copy
// is the source of record. Pasting a change there, or `npx wrangler deploy` in
// this folder, publishes it.
const HEALTHZ = "https://whitespaceindia-backend.onrender.com/healthz";

export default {
  async scheduled() {
    const started = Date.now();
    try {
      const r = await fetch(HEALTHZ, { headers: { "user-agent": "whitespaceindia-keepwarm" } });
      console.log(`healthz ${r.status} in ${Date.now() - started} ms`);
    } catch (e) {
      console.log(`healthz failed after ${Date.now() - started} ms: ${e}`);
    }
  },
  async fetch() {
    return new Response("Not found\n", { status: 404 });
  },
};
