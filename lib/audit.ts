/**
 * Hash-chained audit trail. Each entry stores the SHA-256 of the previous
 * entry, so editing or deleting any past entry breaks every hash after it.
 * verifyChain() recomputes the chain and reports the first broken link.
 */

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  detail: string;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

async function sha256(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const payload = (e: Omit<AuditEntry, "hash">) => JSON.stringify([e.seq, e.at, e.actor, e.action, e.detail, e.prevHash]);

export async function appendAudit(chain: AuditEntry[], actor: string, action: string, detail: string): Promise<AuditEntry[]> {
  const prev = chain[chain.length - 1];
  const base = { seq: chain.length + 1, at: new Date().toISOString(), actor, action, detail, prevHash: prev ? prev.hash : GENESIS };
  return [...chain, { ...base, hash: await sha256(payload(base)) }];
}

export async function verifyChain(chain: AuditEntry[]): Promise<{ ok: boolean; brokenAt: number | null }> {
  let prev = GENESIS;
  for (const e of chain) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    const h = await sha256(payload(e));
    if (h !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null };
}
