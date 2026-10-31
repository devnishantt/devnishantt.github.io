import { test } from "node:test";
import assert from "node:assert/strict";

import { simulate as race, breakRate, MODES } from "../site/js/labs/race.js";
import { simulate as retry, createServer, canonical } from "../site/js/labs/idempotency.js";
import { parseMinor, formatMinor, allocate, compareSplit, compareSum } from "../site/js/labs/money.js";
import { build, verify, forge, checkpointOf, SAMPLE, GENESIS } from "../site/js/labs/chain.js";
import { createIncident, apply, auditResolution, currentApprovers } from "../site/js/labs/approvals.js";

// ---------------------------------------------------------------- race

test("race: the naive read-then-write path loses money under some interleavings", () => {
  const r = breakRate({ runs: 500, mode: "naive", balance: 100, amounts: [60, 60] });
  assert.ok(r.broken > 0, "expected at least one broken interleaving");
  assert.ok(r.broken < r.runs, "expected at least one safe interleaving too");
});

test("race: a broken run dispenses more than the account ever held", () => {
  let found = null;
  for (let seed = 1; seed < 500 && !found; seed++) {
    const r = race({ mode: "naive", seed });
    if (r.broken) found = r;
  }
  assert.ok(found);
  assert.equal(found.paidOut, 120);
  assert.ok(found.missing > 0);
  assert.equal(found.conserved, false);
});

for (const mode of ["locked", "conditional"]) {
  test(`race: ${mode} never breaks conservation across 2000 seeds and 3 racers`, () => {
    const r = breakRate({ runs: 2000, mode, balance: 100, amounts: [60, 60, 30] });
    assert.equal(r.broken, 0);
  });
}

test("race: safe modes still approve what fits and reject what does not", () => {
  for (const mode of ["locked", "conditional"]) {
    const r = race({ mode, seed: 3, balance: 100, amounts: [60, 60] });
    const outcomes = r.transactions.map((t) => t.outcome).sort();
    assert.deepEqual(outcomes, ["approved", "rejected"]);
    assert.equal(r.final, 40);
  }
});

test("race: runs are deterministic for a seed", () => {
  assert.deepEqual(race({ mode: "naive", seed: 42 }), race({ mode: "naive", seed: 42 }));
});

test("race: lock waits are recorded and unknown modes are rejected", () => {
  let waited = false;
  for (let seed = 1; seed < 100 && !waited; seed++) waited = race({ mode: "locked", seed }).events.some((e) => e.op === "wait");
  assert.ok(waited);
  assert.throws(() => race({ mode: "nope" }), /unknown mode/);
  assert.equal(Object.values(MODES).filter((m) => m.safe).length, 2);
});

// ---------------------------------------------------------------- idempotency

test("idempotency: without a key, two lost responses mean three charges", () => {
  const r = retry({ idempotency: false, lost: [true, true] });
  assert.equal(r.charges.length, 3);
  assert.equal(r.totalCharged, 1500);
  assert.equal(r.broken, true);
  assert.equal(r.gotResponse, true);
});

test("idempotency: with a key, retries replay the original response", () => {
  const r = retry({ idempotency: true, lost: [true, true] });
  assert.equal(r.charges.length, 1);
  assert.equal(r.totalCharged, 500);
  assert.equal(r.broken, false);
  assert.equal(r.events.filter((e) => e.replayed).length, 2);
});

test("idempotency: reusing a key with a different body is a 422, not a charge", () => {
  const r = retry({ idempotency: true, lost: [true], changeAmountOnRetry: true });
  assert.equal(r.charges.length, 1);
  assert.ok(r.events.some((e) => e.status === 422));
});

test("idempotency: fingerprints ignore key order", () => {
  const s = createServer();
  s.handle({ key: "a", body: { amount: 1, to: "x" } });
  const again = s.handle({ key: "a", body: { to: "x", amount: 1 } });
  assert.equal(again.replayed, true);
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

// ---------------------------------------------------------------- money

test("money: parse and format round-trip, reject extra precision", () => {
  assert.equal(parseMinor("19.99"), 1999n);
  assert.equal(parseMinor("-0.5"), -50n);
  assert.equal(parseMinor("7"), 700n);
  assert.equal(formatMinor(-5n), "-0.05");
  assert.equal(formatMinor(123456789012345678901234n), "1234567890123456789012.34");
  assert.throws(() => parseMinor("1.005"), /more than 2/);
  assert.throws(() => parseMinor("abc"), /not an amount/);
});

test("money: allocation always sums to the total", () => {
  for (let total = 0n; total < 400n; total += 7n) {
    for (const w of [[1, 1, 1], [1, 2], [3, 0, 5], [1, 1, 1, 1, 1, 1, 1]]) {
      const parts = allocate(total, w);
      assert.equal(parts.reduce((a, b) => a + b, 0n), total);
      assert.ok(parts.every((p) => p >= 0n));
    }
  }
  assert.throws(() => allocate(10n, [0, 0]), /all be zero/);
});

test("money: splitting 100.00 three ways loses a cent with floats, not with integers", () => {
  const c = compareSplit("100.00", 3);
  assert.equal(c.float.exact, false);
  assert.equal(c.integer.exact, true);
  assert.deepEqual(c.integer.shares, ["33.34", "33.33", "33.33"]);
});

test("money: 0.10 + 0.20 is not 0.30 in binary floating point", () => {
  const c = compareSum(["0.10", "0.20"]);
  assert.equal(c.floatText, "0.30000000000000004");
  assert.equal(c.exact, "0.30");
  assert.equal(c.matches, false);
});

// ---------------------------------------------------------------- chain

test("chain: an untouched chain verifies", async () => {
  const chain = await build(SAMPLE);
  assert.equal(chain[0].prev, GENESIS);
  assert.deepEqual(await verify(chain, checkpointOf(chain)), { ok: true, issues: [] });
});

test("chain: editing a record is caught at that record", async () => {
  const chain = await build(SAMPLE);
  chain[2] = { ...chain[2], data: { ...chain[2].data, amount: -3200 } };
  const v = await verify(chain);
  assert.equal(v.ok, false);
  assert.equal(v.issues[0].seq, 2);
  assert.equal(v.issues[0].kind, "hash-mismatch");
});

test("chain: deleting a middle record breaks the links", async () => {
  const chain = await build(SAMPLE);
  chain.splice(3, 1);
  const v = await verify(chain);
  assert.ok(v.issues.some((i) => i.kind === "sequence-gap"));
  assert.ok(v.issues.some((i) => i.kind === "broken-link"));
});

test("chain: truncation and forgery pass link checks but fail the checkpoint", async () => {
  const chain = await build(SAMPLE);
  const cp = checkpointOf(chain);
  const truncated = chain.slice(0, 4);
  assert.equal((await verify(truncated)).ok, true, "links alone cannot see a missing tail");
  assert.equal((await verify(truncated, cp)).issues[0].kind, "missing-tail");

  const tampered = chain.map((r) => ({ ...r, data: { ...r.data } }));
  tampered[1].data.amount = 1;
  const forged = await forge(tampered);
  assert.equal((await verify(forged)).ok, true, "a fully re-hashed chain is internally consistent");
  assert.equal((await verify(forged, cp)).issues[0].kind, "head-mismatch");
});

// ---------------------------------------------------------------- approvals

async function contained(enforce = true) {
  let s = await createIncident();
  for (const a of [
    { type: "investigate", actor: "alice" },
    { type: "evidence", actor: "alice", ref: "grafana/5xx.png" },
    { type: "contain", actor: "alice" },
  ]) {
    const r = await apply(s, a, { enforce });
    assert.ok(r.ok, r.message);
    s = r.state;
  }
  return s;
}

test("approvals: the creator cannot approve their own incident", async () => {
  const r = await apply(await contained(), { type: "approve", actor: "alice" });
  assert.equal(r.status, 403);
});

test("approvals: two independent approvals resolve it", async () => {
  let s = await contained();
  for (const actor of ["bob", "carol"]) s = (await apply(s, { type: "approve", actor })).state;
  const r = await apply(s, { type: "resolve", actor: "bob" });
  assert.equal(r.ok, true);
  assert.equal(auditResolution(r.state).legitimate, true);
  assert.equal((await apply(r.state, { type: "evidence", actor: "bob", ref: "late.txt" })).status, 423);
});

test("approvals: new evidence makes earlier approvals stale", async () => {
  let s = await contained();
  s = (await apply(s, { type: "approve", actor: "bob" })).state;
  s = (await apply(s, { type: "approve", actor: "carol" })).state;
  assert.equal(currentApprovers(s).length, 2);
  s = (await apply(s, { type: "evidence", actor: "mallory", ref: "doctored.log" })).state;
  assert.equal(currentApprovers(s).length, 0);
  assert.equal((await apply(s, { type: "resolve", actor: "mallory" })).status, 412);
});

test("approvals: stale revisions are rejected", async () => {
  const s = await contained();
  const r = await apply(s, { type: "approve", actor: "bob", expectedRevision: s.revision - 1 });
  assert.equal(r.status, 409);
});

test("approvals: the unenforced shortcut lets a self-approved incident close, and the audit flags it", async () => {
  let s = await contained(false);
  s = (await apply(s, { type: "approve", actor: "alice" }, { enforce: false })).state;
  const r = await apply(s, { type: "resolve", actor: "alice" }, { enforce: false });
  assert.equal(r.ok, true);
  assert.equal(auditResolution(r.state).legitimate, false);
});
