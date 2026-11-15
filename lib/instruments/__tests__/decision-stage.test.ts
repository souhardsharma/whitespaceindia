/**
 * A decision the register no longer shows. After a grant the register can
 * move a proposal to a later position ("forwarded to the pollution control
 * board"), and the row then names its decision in `dsk`. These pin that the
 * reader takes it, that a shard built before the column existed still reads,
 * and that a time to decision is compared only against its own instrument.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unpackOne, type RawShard } from "../projects.ts";
import { appraisalFor } from "../bundle.ts";

const FIELDS = ["id", "sector", "status", "sk", "dtd", "fon", "don"];
const ROW = ["7", 0, 0, "forwarded_to_spcb", 60, "2026-06-01", "2026-07-31"];
const STAGES = {
  statuses: {
    forwarded_to_spcb: { decision: null },
    tor_granted: { decision: "tor" },
    ec_granted: { decision: "ec" },
  },
} as unknown as Parameters<typeof appraisalFor>[2];
const DIST = { n: 40, p25: 90, median: 135, p75: 220 };
const APPRAISAL = {
  minGroup: 30,
  national: { environmentalClearance: DIST },
  environmentalClearance: { bySector: {}, byState: {} },
} as unknown as Parameters<typeof appraisalFor>[3];

function shard(fields: string[], row: unknown[]): RawShard {
  return {
    state: "Odisha", slug: "odisha", fields, certPrefix: "", authorities: [],
    sectors: ["Mining"], statuses: ["Forwarded to MS SPCB/PCC by MS"], rows: [row],
  };
}

test("the decision behind a later position is read from dsk", () => {
  const p = unpackOne(shard([...FIELDS, "dsk"], [...ROW, "tor_granted"]), "7");
  assert.equal(p?.appraisal.statusKey, "forwarded_to_spcb");
  assert.equal(p?.appraisal.decisionStage, "tor_granted");
  assert.equal(p?.appraisal.decidedOn, "2026-07-31");
});

test("a shard built before the column existed reads as it did", () => {
  const p = unpackOne(shard(FIELDS, ROW), "7");
  assert.equal(p?.appraisal.decisionStage, null);
  assert.equal(p?.appraisal.statusKey, "forwarded_to_spcb");
  assert.equal(p?.appraisal.daysToDecision, 60);
});

test("a Terms of Reference grant is never set against clearance times", () => {
  const p = unpackOne(shard([...FIELDS, "dsk"], [...ROW, "tor_granted"]), "7")!;
  assert.equal(appraisalFor(p, "Odisha", STAGES, APPRAISAL), null);
});

test("a clearance behind a later position still is", () => {
  const p = unpackOne(shard([...FIELDS, "dsk"], [...ROW, "ec_granted"]), "7")!;
  const got = appraisalFor(p, "Odisha", STAGES, APPRAISAL);
  assert.equal(got?.days, 60);
  assert.equal(got?.national?.median, 135);
});
