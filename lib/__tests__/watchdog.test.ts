/**
 * The watchdog's budget arithmetic. It decides whether the owner hears about a
 * free plan running out, so it must project from the busier pace and must
 * assume Render's worst case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthWindow, project, renderHoursWorstCase, BUDGET, judgeVercel, SITE } from "../../scripts/watchdog.mjs";

const at = (iso: string) => new Date(iso);

test("month windows are UTC calendar months", () => {
  assert.equal(monthWindow(at("2026-12-10T00:00:00Z")).days, 31);
  assert.equal(monthWindow(at("2026-11-10T00:00:00Z")).days, 30);
  assert.equal(monthWindow(at("2027-02-10T00:00:00Z")).days, 28);
});

test("a busy last week is projected at its own pace, not averaged away", () => {
  const now = at("2026-11-20T00:00:00Z");
  const quiet = Array.from({ length: 12 }, (_, i) => at(`2026-11-${String(i + 1).padStart(2, "0")}T12:00:00Z`));
  const busy = Array.from({ length: 35 }, (_, i) => at(`2026-11-${13 + Math.floor(i / 5)}T0${i % 5}:00:00Z`));
  const p = project([...quiet, ...busy], now);
  assert.equal(p.sofar, 47);
  assert.equal(p.projected, 47 + 5 * 11, "five a day for the eleven days left (20-30 Nov)");
});

test("events outside the month are not counted", () => {
  const now = at("2026-11-02T00:00:00Z");
  assert.equal(project([at("2026-10-31T23:00:00Z"), at("2026-11-01T01:00:00Z")], now).sofar, 1);
});

test("Render's worst case is a full month awake plus every deploy counted twice", () => {
  const dec = at("2026-12-15T00:00:00Z");
  assert.equal(renderHoursWorstCase(0, dec), 744);
  assert.equal(renderHoursWorstCase(60, dec), 744 + (60 * BUDGET.overlapMinutesPerDeploy) / 60);
  assert.ok(renderHoursWorstCase(100, dec) > BUDGET.renderHoursWarn, "a hundred deploys in December is worth a warning");
});

// Vercel stays redirect-only and its old full-app deployments stay behind a
// login (Deployment Protection). Measured live on 2026-11-25 after the unpause.
const healthy = {
  parent: { status: 308, location: `${SITE}/instruments` },
  csr: { status: 308, location: `${SITE}/csr` },
  alias: { status: 302, location: "https://vercel.com/sso-api?url=x&nonce=y" },
};

test("Vercel as measured after the unpause passes", () => {
  assert.deepEqual(judgeVercel(healthy), []);
});

test("a paused team, a full app or protection turned off each fail", () => {
  const paused = judgeVercel({ ...healthy, parent: { status: 402, location: null } });
  assert.match(paused.join(), /paused again/);
  const full = judgeVercel({ ...healthy, csr: { status: 200, location: null } });
  assert.match(full.join(), /full app/);
  const open = judgeVercel({ ...healthy, alias: { status: 200, location: null } });
  assert.match(open.join(), /Deployment Protection is off/);
  const openRedirect = judgeVercel({ ...healthy, alias: { status: 308, location: `${SITE}/` } });
  assert.equal(openRedirect.length, 1, "a deployment address that redirects is still unprotected");
});

test("a redirect anywhere but the same path on the live site fails", () => {
  assert.equal(judgeVercel({ ...healthy, parent: { status: 308, location: "https://example.com/instruments" } }).length, 1);
});
