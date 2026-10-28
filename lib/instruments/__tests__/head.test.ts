/**
 * A proposal's head holds against React putting the shared page's back.
 *
 * On 2026-10-28 a mistyped proposal address was set to "noindex" and React,
 * finishing the page's metadata 8 ms later, restored the generic title and
 * appended "index, follow": the page said both. This plays React's part on a
 * stand-in document and fails if the proposal's values do not survive it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHead, type Head } from "../head.ts";

type El = { tagName: string; name?: string; rel?: string; href?: string; content?: string; remove(): void };

function fakeDocument() {
  const children: El[] = [];
  const observers: { cb: () => void; on: boolean }[] = [];
  const notify = () => observers.filter((o) => o.on).forEach((o) => o.cb());
  const el = (tagName: string, props: Partial<El> = {}): El => {
    const e: El = { tagName, ...props, remove: () => children.splice(children.indexOf(e), 1) };
    return e;
  };
  let title = "Proposal | People & Consent";
  const doc = {
    get title() { return title; },
    set title(t: string) { title = t; notify(); },
    head: { appendChild: (e: El) => { children.push(e); notify(); } },
    createElement: (tag: string) => el(tag.toUpperCase()),
    querySelector: (sel: string) => doc.querySelectorAll(sel)[0] ?? null,
    querySelectorAll: (sel: string) => {
      const names = [...sel.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
      return children.filter((c) => c.tagName === "META" && names.includes(c.name ?? ""));
    },
    defaultView: {
      MutationObserver: class {
        o: { cb: () => void; on: boolean };
        constructor(cb: () => void) { this.o = { cb, on: false }; observers.push(this.o); }
        observe() { this.o.on = true; }
        disconnect() { this.o.on = false; }
      },
    },
  };
  // What the shared static page's HTML carries.
  children.push(
    el("META", { name: "description", content: "One environmental clearance proposal" }),
    el("META", { name: "robots", content: "index, follow" }),
    el("META", { name: "googlebot", content: "index, follow" }),
  );
  // React re-rendering the page's metadata: the generic title, fresh copies.
  const reactPutsItsHeadBack = () => {
    title = "Proposal | People & Consent";
    notify();
    children.push(el("META", { name: "description", content: "One environmental clearance proposal" }));
    notify();
    children.push(el("META", { name: "robots", content: "index, follow" }));
    notify();
  };
  const contents = (name: string) => children.filter((c) => c.name === name).map((c) => c.content);
  return { doc: doc as unknown as Document, children, contents, reactPutsItsHeadBack };
}

const MISSING: Head = {
  path: "/instruments/consent/not-a-proposal",
  title: "Proposal not found | People & Consent",
  description: "This proposal number is not in the register.",
  index: false,
};

test("a noindexed proposal stays noindexed when React puts the page's head back", () => {
  const f = fakeDocument();
  applyHead(MISSING, "https://example.org", f.doc);
  f.reactPutsItsHeadBack();
  assert.equal(f.doc.title, MISSING.title);
  assert.deepEqual(f.contents("robots"), ["noindex, follow", "noindex, follow"]);
  assert.deepEqual(f.contents("googlebot"), ["noindex, follow"]);
  assert.deepEqual(f.contents("description"), [MISSING.description, MISSING.description]);
  const canonicals = f.children.filter((c) => c.rel === "canonical");
  assert.deepEqual(canonicals.map((c) => c.href), ["https://example.org/instruments/consent/not-a-proposal"]);
});

test("an indexed proposal keeps its title and description, and its robots tag untouched", () => {
  const f = fakeDocument();
  applyHead({ ...MISSING, title: "A mine | People & Consent", index: true }, "https://example.org", f.doc);
  f.reactPutsItsHeadBack();
  assert.equal(f.doc.title, "A mine | People & Consent");
  assert.deepEqual(f.contents("robots"), ["index, follow", "index, follow"]);
  assert.deepEqual(f.contents("description"), [MISSING.description, MISSING.description]);
});

test("leaving the proposal stops holding and restores what was there", () => {
  const f = fakeDocument();
  const undo = applyHead(MISSING, "https://example.org", f.doc);
  undo();
  assert.equal(f.doc.title, "Proposal | People & Consent");
  assert.deepEqual(f.contents("robots"), ["index, follow"]);
  assert.equal(f.children.some((c) => c.rel === "canonical"), false);
  f.reactPutsItsHeadBack();
  assert.deepEqual(f.contents("robots"), ["index, follow", "index, follow"]);
});
