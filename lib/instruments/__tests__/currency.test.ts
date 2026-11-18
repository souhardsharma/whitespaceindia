/**
 * The footer's "read incompletely" is a statement about the REGISTER. It used
 * to follow the night's overall flag and so appeared under a full ten-sector
 * sweep whenever the per-proposal backfill ran out of time (2026-11-17).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerReadInPart } from "../currency.ts";

const at = "2026-11-17T02:08:31+00:00";

test("a full register read with backfill owed is not called partial", () => {
  assert.equal(registerReadInPart({ checked_at: at, complete: false, register_complete: true, sectors_unreachable: 0 }), false);
});

test("a register read that missed sectors is called partial", () => {
  assert.equal(registerReadInPart({ checked_at: at, complete: false, register_complete: false, sectors_unreachable: 2 }), true);
});

test("a file from before register_complete falls back to complete", () => {
  assert.equal(registerReadInPart({ checked_at: at, complete: false }), true);
  assert.equal(registerReadInPart({ checked_at: at, complete: true }), false);
});

test("no read time, no claim", () => {
  assert.equal(registerReadInPart({ complete: false, register_complete: false }), false);
});

test("the footer decides through this function, not the night's flag", () => {
  const src = readFileSync(new URL("../../../components/instruments/RegisterCurrency.tsx", import.meta.url), "utf8");
  assert.match(src, /registerReadInPart\(f\)/);
  assert.doesNotMatch(src, /f\.complete === false/);
});
