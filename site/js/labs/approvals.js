// Lab 05: closing an incident needs two people who did not open it,
// both approving the evidence as it is *now*.

import { canonical, sha256Hex } from "./chain.js";

export const FLOW = ["open", "investigating", "contained", "resolved"];

const fail = (state, status, message) => ({ ok: false, state, status, message });
const pass = (state, status, message) => ({ ok: true, state, status, message });

export async function manifestOf(state) {
  return sha256Hex(canonical({ id: state.id, title: state.title, evidence: state.evidence }));
}

export async function createIncident({ id = "INC-1042", title = "Payments API 5xx spike", creator = "alice" } = {}) {
  const state = { id, title, creator, status: "open", evidence: [], approvals: [], revision: 0, manifest: "" };
  state.manifest = await manifestOf(state);
  return state;
}

export function currentApprovers(state) {
  return [...new Set(state.approvals.filter((a) => a.manifest === state.manifest && a.actor !== state.creator).map((a) => a.actor))];
}

/** Independent audit: was this incident closed legitimately? */
export function auditResolution(state) {
  if (state.status !== "resolved") return { legitimate: true, reason: "not resolved" };
  const n = currentApprovers(state).length;
  return n >= 2
    ? { legitimate: true, reason: `${n} independent approvals of the final evidence` }
    : { legitimate: false, reason: `resolved with ${n} independent approval${n === 1 ? "" : "s"} of the final evidence` };
}

/**
 * Apply an action. `enforce: false` models the common shortcut where "resolved" is just a status
 * field anyone can set once some approvals exist.
 */
export async function apply(state, action, { enforce = true } = {}) {
  const { type, actor, ref, expectedRevision } = action;
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    return fail(state, 409, `stale write: revision is ${state.revision}, you sent ${expectedRevision}`);
  }
  if (state.status === "resolved" && enforce) return fail(state, 423, "resolved incidents are immutable");
  const next = structuredClone(state);
  next.revision += 1;

  switch (type) {
    case "investigate":
      if (state.status !== "open") return fail(state, 409, `cannot investigate from ${state.status}`);
      next.status = "investigating";
      return pass(next, 200, `${actor} started the investigation`);

    case "evidence": {
      if (!ref) return fail(state, 400, "evidence needs a reference");
      next.evidence.push({ ref, by: actor });
      next.manifest = await manifestOf(next);
      const stale = state.approvals.filter((a) => a.manifest === state.manifest).length;
      return pass(next, 201, `${actor} attached ${ref}${stale ? `; ${stale} earlier approval${stale > 1 ? "s are" : " is"} now stale` : ""}`);
    }

    case "contain":
      if (state.status !== "investigating") return fail(state, 409, `cannot contain from ${state.status}`);
      if (enforce && state.evidence.length === 0) return fail(state, 412, "containment needs at least one piece of evidence");
      next.status = "contained";
      return pass(next, 200, `${actor} marked the incident contained`);

    case "approve":
      if (state.status !== "contained") return fail(state, 409, "only contained incidents can be approved");
      if (enforce && actor === state.creator) return fail(state, 403, `${actor} opened this incident and cannot approve it`);
      if (state.approvals.some((a) => a.actor === actor && a.manifest === state.manifest)) {
        return fail(state, 409, `${actor} already approved this manifest`);
      }
      next.approvals.push({ actor, manifest: state.manifest });
      return pass(next, 201, `${actor} approved manifest ${state.manifest.slice(0, 8)}`);

    case "resolve": {
      if (state.status !== "contained") return fail(state, 409, `cannot resolve from ${state.status}`);
      if (enforce) {
        const n = currentApprovers(state).length;
        if (n < 2) return fail(state, 412, `needs 2 independent approvals of the current manifest, has ${n}`);
      } else if (state.approvals.length === 0) {
        return fail(state, 412, "needs at least one approval");
      }
      next.status = "resolved";
      return pass(next, 200, `${actor} resolved the incident`);
    }

    default:
      return fail(state, 400, `unknown action ${type}`);
  }
}
