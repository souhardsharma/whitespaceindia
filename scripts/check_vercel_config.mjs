/**
 * Fail unless Vercel's own builder turned vercel.json's bot-deny rule into a
 * route of the deployment.
 *
 * vercel.json is read only by Vercel, so `next build` proves nothing about it:
 * a key Vercel refuses, or a rule it silently drops, shows up at deploy time,
 * where a failed deployment also stops the nightly data publish. Run after
 * `vercel build`, which writes the compiled routes to .vercel/output.
 */
import { readFileSync } from "node:fs";

const CONFIG = ".vercel/output/config.json";

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const routes = config.routes ?? [];
const rule = routes.find((r) => r.mitigate?.action === "deny");

console.log(`${CONFIG}: ${routes.length} route(s)`);
if (!rule) {
  console.error("no route carries mitigate.action = deny: Vercel dropped the bot rule");
  process.exit(1);
}
const agent = (rule.has ?? []).find((h) => h.type === "header" && h.key.toLowerCase() === "user-agent");
if (!agent) {
  console.error(`the deny route does not test the user-agent header: ${JSON.stringify(rule)}`);
  process.exit(1);
}
console.log(`deny rule kept, at position ${routes.indexOf(rule)}: ${JSON.stringify(rule)}`);
const pathRule = routes.find((r) => r.mitigate?.action === "deny" && !r.has && /instruments\/consent/.test(r.src));
if (!pathRule) {
  console.error("no deny route tests the proposal path alone: Vercel dropped the junk-path rule");
  process.exit(1);
}
console.log(`path rule kept, at position ${routes.indexOf(pathRule)}: ${JSON.stringify(pathRule)}`);
// The rule must sit beside the framework's own routes, not replace them.
const filesystem = routes.some((r) => r.handle === "filesystem");
console.log(`framework routes kept (handle: filesystem): ${filesystem}`);
if (!filesystem) {
  console.error("the compiled routes have no filesystem handler: the app's pages would not be served");
  process.exit(1);
}
