/**
 * The redeploy marker pushed after Render reports a failed deploy
 * (scripts/cloudflare/render-retry.sh). It must ask again when nothing newer
 * is deploying, stay quiet when something is, and never loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/cloudflare/render-retry.sh", import.meta.url));
const hasBash = spawnSync("bash", ["-c", "git --version"]).status === 0;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "rr-"));
  const sh = (cmd: string, env: Record<string, string> = {}) =>
    spawnSync("bash", ["-c", cmd], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...env },
    });
  sh("git init -q && git config user.email t@t && git config user.name t");
  mkdirSync(join(dir, "scripts/cloudflare"), { recursive: true });
  mkdirSync(join(dir, "scripts/instruments"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts/cloudflare/render-retry.sh"));
  writeFileSync(join(dir, "app.txt"), "a\n");
  sh("git add -A && git commit -qm data");
  const head = () => sh("git rev-parse HEAD").stdout.trim();
  const retry = (failed: string, extra: Record<string, string> = {}) =>
    sh("bash scripts/cloudflare/render-retry.sh", { FAILED_SHA: failed, ...extra });
  return { dir, sh, head, retry };
}

test("a failed deploy with nothing newer is asked again, at most twice a day", { skip: !hasBash }, () => {
  const r = repo();
  const first = r.head();
  r.retry(first);
  assert.notEqual(r.head(), first, "a marker commit is made");
  assert.match(r.sh("git log -1 --format=%s").stdout, /^ops\(render\): redeploy/);
  r.retry(r.head());
  const second = r.head();
  const out = r.retry(second);
  assert.equal(r.head(), second, "the third failure in a day is left alone");
  assert.match(out.stdout, /failed again after 2 retries/);
});

test("no retry when a newer deployable commit is already deploying", { skip: !hasBash }, () => {
  const r = repo();
  const failed = r.head();
  writeFileSync(join(r.dir, "app.txt"), "b\n");
  r.sh("git commit -qam newer");
  const newer = r.head();
  r.retry(failed);
  assert.equal(r.head(), newer);
});

test("a commit Render ignores does not count as a new deploy", { skip: !hasBash }, () => {
  const r = repo();
  const failed = r.head();
  writeFileSync(join(r.dir, "scripts/instruments/crosscheck_report.json"), "{}\n");
  r.sh("git add -A && git commit -qm report");
  const report = r.head();
  r.retry(failed);
  assert.notEqual(r.head(), report, "the cross-check commit deploys nothing, so Render is asked again");
});

test("the ignored paths match render.yaml's buildFilter", () => {
  const yaml = readFileSync(new URL("../../render.yaml", import.meta.url), "utf8");
  const script = readFileSync(SCRIPT, "utf8");
  for (const p of ["scripts/instruments/crosscheck_report.json", "*.md", ".github/"]) {
    assert.ok(yaml.includes(p.replace("/", "/").replace(".github/", ".github/**")) || yaml.includes(p), `render.yaml names ${p}`);
    assert.ok(script.includes(p), `render-retry.sh treats ${p} as ignored`);
  }
  assert.doesNotMatch(yaml, /render-redeploy\.txt/, "the marker must be a path Render deploys on");
});
