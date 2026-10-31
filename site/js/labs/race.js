// Lab 01: concurrent withdrawals against one account row.
// A deterministic, seeded scheduler interleaves the steps of each transaction,
// the way a database interleaves statements from concurrent connections.

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MODES = {
  naive: {
    label: "read, then write",
    sql: "SELECT balance …; UPDATE … SET balance = :read - :amount",
    steps: ["read", "check", "write", "dispense"],
    safe: false,
  },
  locked: {
    label: "SELECT … FOR UPDATE",
    sql: "BEGIN; SELECT balance … FOR UPDATE; UPDATE …; COMMIT",
    steps: ["lock", "read", "check", "write", "dispense", "unlock"],
    safe: true,
  },
  conditional: {
    label: "conditional UPDATE",
    sql: "UPDATE … SET balance = balance - :amount WHERE balance >= :amount",
    steps: ["cas", "dispense"],
    safe: true,
  },
};

/**
 * Simulate `amounts.length` concurrent withdrawals.
 * Returns the event log and whether "money in = money out" still holds:
 * initial balance - cash dispensed must equal the final balance, and the balance never goes negative.
 */
export function simulate({ balance = 100, amounts = [60, 60], mode = "naive", seed = 1 } = {}) {
  const plan = MODES[mode];
  if (!plan) throw new Error(`unknown mode: ${mode}`);
  const rng = mulberry32(seed);
  const initial = balance;
  const db = { balance, lockHolder: null };
  const txs = amounts.map((amount, i) => ({
    id: i, name: `T${i + 1}`, amount, pc: 0, read: null, done: false, outcome: null, waiting: false,
  }));
  const events = [];
  let paidOut = 0;
  let tick = 0;
  const log = (tx, op, text, extra = {}) => events.push({ tick, tx: tx.id, op, text, balance: db.balance, ...extra });

  const blocked = (tx) => plan.steps[tx.pc] === "lock" && db.lockHolder !== null && db.lockHolder !== tx.id;

  for (let guard = 0; guard < 10_000; guard++) {
    const live = txs.filter((t) => !t.done);
    if (live.length === 0) break;
    for (const t of live) {
      if (blocked(t) && !t.waiting) {
        t.waiting = true;
        log(t, "wait", `waits for row lock held by T${db.lockHolder + 1}`);
      }
    }
    const runnable = live.filter((t) => !blocked(t));
    if (runnable.length === 0) throw new Error("deadlock");
    const tx = runnable[Math.floor(rng() * runnable.length)];
    tick++;
    const step = plan.steps[tx.pc];
    tx.pc++;
    switch (step) {
      case "lock":
        db.lockHolder = tx.id;
        tx.waiting = false;
        log(tx, "lock", "SELECT … FOR UPDATE (lock acquired)");
        break;
      case "read":
        tx.read = db.balance;
        log(tx, "read", `SELECT balance → ${tx.read}`);
        break;
      case "check":
        if (tx.read < tx.amount) {
          tx.outcome = "rejected";
          log(tx, "reject", `${tx.read} < ${tx.amount}: insufficient funds`);
          tx.pc = plan.steps.includes("unlock") ? plan.steps.indexOf("unlock") : plan.steps.length;
        } else {
          log(tx, "check", `${tx.read} ≥ ${tx.amount}: ok`);
        }
        break;
      case "write":
        db.balance = tx.read - tx.amount;
        log(tx, "write", `UPDATE balance = ${tx.read} - ${tx.amount} = ${db.balance}`);
        break;
      case "cas":
        if (db.balance >= tx.amount) {
          db.balance -= tx.amount;
          log(tx, "write", `UPDATE … WHERE balance ≥ ${tx.amount} → 1 row, balance ${db.balance}`);
        } else {
          tx.outcome = "rejected";
          log(tx, "reject", `UPDATE … WHERE balance ≥ ${tx.amount} → 0 rows`);
          tx.pc = plan.steps.length;
        }
        break;
      case "dispense":
        paidOut += tx.amount;
        tx.outcome = "approved";
        log(tx, "dispense", `dispense ${tx.amount} in cash`);
        break;
      case "unlock":
        db.lockHolder = null;
        log(tx, "unlock", "COMMIT (lock released)");
        break;
      default:
        throw new Error(`unknown step ${step}`);
    }
    if (tx.pc >= plan.steps.length) tx.done = true;
  }

  const conserved = initial - paidOut === db.balance;
  const broken = !conserved || db.balance < 0 || paidOut > initial;
  return {
    mode, seed, initial, final: db.balance, paidOut, events,
    transactions: txs.map(({ id, name, amount, outcome }) => ({ id, name, amount, outcome })),
    conserved, broken,
    missing: paidOut - (initial - db.balance),
  };
}

/** Run the same scenario `runs` times with different seeds; return how often the invariant broke. */
export function breakRate({ runs = 1000, firstSeed = 1, ...scenario } = {}) {
  let broken = 0;
  for (let i = 0; i < runs; i++) if (simulate({ ...scenario, seed: firstSeed + i }).broken) broken++;
  return { runs, broken, rate: broken / runs };
}
