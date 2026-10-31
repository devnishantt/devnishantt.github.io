// Lab 04: a hash-linked audit log. Edit a row, delete the tail, or forge the whole chain.

import { canonical } from "./idempotency.js";

export { canonical };
export const GENESIS = "0".repeat(64);

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashRecord(seq, prev, data) {
  return sha256Hex(canonical({ seq, prev, data }));
}

export async function append(chain, data) {
  const seq = chain.length;
  const prev = seq ? chain[seq - 1].hash : GENESIS;
  return [...chain, { seq, prev, data, hash: await hashRecord(seq, prev, data) }];
}

export async function build(entries) {
  let chain = [];
  for (const data of entries) chain = await append(chain, data);
  return chain;
}

/** What an attacker with database access does to cover their tracks: recompute every hash. */
export async function forge(chain) {
  return build(chain.map((r) => r.data));
}

export function checkpointOf(chain) {
  return { count: chain.length, head: chain.length ? chain[chain.length - 1].hash : GENESIS };
}

/**
 * Verify every link. With a checkpoint (published somewhere the attacker cannot write),
 * truncation and full re-hashing are detected too.
 */
export async function verify(chain, checkpoint = null) {
  const issues = [];
  let expectedPrev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (r.seq !== i) issues.push({ seq: i, kind: "sequence-gap", message: `expected seq ${i}, found ${r.seq}` });
    if (r.prev !== expectedPrev) issues.push({ seq: r.seq, kind: "broken-link", message: "prev does not match the previous record's hash" });
    const actual = await hashRecord(r.seq, r.prev, r.data);
    if (actual !== r.hash) issues.push({ seq: r.seq, kind: "hash-mismatch", message: "contents changed after the hash was written" });
    expectedPrev = r.hash;
  }
  if (checkpoint) {
    if (chain.length < checkpoint.count) {
      issues.push({ seq: chain.length, kind: "missing-tail", message: `checkpoint says ${checkpoint.count} records, found ${chain.length}` });
    } else if (checkpoint.count > 0 && chain[checkpoint.count - 1].hash !== checkpoint.head) {
      issues.push({ seq: checkpoint.count - 1, kind: "head-mismatch", message: "history before the checkpoint was rewritten" });
    }
  }
  return { ok: issues.length === 0, issues };
}

export const SAMPLE = [
  { at: "09:00", memo: "opening balance", amount: 10000 },
  { at: "09:12", memo: "salary credit", amount: 85000 },
  { at: "10:40", memo: "rent", amount: -32000 },
  { at: "13:05", memo: "card: groceries", amount: -2340 },
  { at: "16:22", memo: "transfer to savings", amount: -20000 },
  { at: "18:47", memo: "refund", amount: 1290 },
];
