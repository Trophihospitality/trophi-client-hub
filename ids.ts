// ============================================================
// ID GENERATION
// Business ID:  TRP-XXXXXX        (6-char alphanumeric, no ambiguous chars)
// Location ID:  TRP-XXXXXX-L01    (sequential per business, maps to parent)
// These IDs are the universal keys used to map a client and its
// locations through Onboarding, Account Management, Support, and
// the Client Portal.
// ============================================================

const SAFE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

function randomBlock(length: number): string {
  let out = '';
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
  for (let i = 0; i < length; i++) {
    const idx = cryptoObj
      ? cryptoObj.getRandomValues(new Uint32Array(1))[0] % SAFE_CHARS.length
      : Math.floor(Math.random() * SAFE_CHARS.length);
    out += SAFE_CHARS[idx];
  }
  return out;
}

/** Generates a unique business ID, checking against existing IDs to prevent collisions. */
export function generateBusinessId(existingIds: string[]): string {
  let id: string;
  do {
    id = `TRP-${randomBlock(6)}`;
  } while (existingIds.includes(id));
  return id;
}

/** Generates the next sequential location ID for a business. */
export function generateLocationId(businessId: string, existingCount: number): string {
  const seq = String(existingCount + 1).padStart(2, '0');
  return `${businessId}-L${seq}`;
}

/** Simple unique id for notes / activity events. */
export function uid(): string {
  return `${Date.now().toString(36)}-${randomBlock(4)}`;
}
