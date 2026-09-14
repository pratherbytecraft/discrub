/**
 * Supporter key verification — the client half of the supporter
 * platform (design: tooling/monetization/SUPPORTER_KEY_DESIGN.md).
 *
 * Keys are `(DSCRB|PBYTE)-<base64url(payload json)>.<base64url(signature)>`,
 * Ed25519-signed by the server over the ASCII bytes of the base64url
 * payload segment (NOT the decoded JSON). Verification is entirely
 * local against the public keys baked in below; the server is only
 * contacted to claim or refresh a key.
 *
 * Fail-closed on crypto errors: a browser without WebCrypto Ed25519
 * support treats every key as invalid. The unlock is cosmetic themes,
 * so a false-negative on an ancient browser is acceptable while a
 * false-positive path is not worth carrying.
 */

/** Features a key can carry (payload v2). */
export type SupporterFeature = 'themes' | 'hosted';
export const SUPPORTER_FEATURES: readonly SupporterFeature[] = ['themes', 'hosted'];

/** feature -> unix expiry seconds (null = never). Absent = not included. */
export type SupporterEntitlementMap = Partial<Record<SupporterFeature, number | null>>;

export interface SupporterKeyPayload {
  v: number;
  /** Signing-key id — must match a registered public key below. */
  kid: string;
  /** Unique key id; the revocation list is a set of these. */
  jti: string;
  /** Display name chosen at claim time ("issued to ..."). */
  name: string;
  /** Truncated donor hash, server bookkeeping only — never rendered. */
  eh: string;
  /**
   * One key per person: every feature the supporter holds, each with
   * its own expiry. Buying more grows this map on the next refresh.
   */
  ent: SupporterEntitlementMap;
  /** Ids of made-to-order Scrublings this key unlocks (2.2.0). Absent on stock keys. */
  custom?: string[];
  iat: number;
  /** Latest feature expiry; null when any feature never expires. */
  exp: number | null;
}

export type SupporterKeyStatus = 'valid' | 'expired' | 'revoked' | 'invalid';

export interface SupporterKeyVerification {
  status: SupporterKeyStatus;
  /** Present for every status except 'invalid'. */
  payload?: SupporterKeyPayload;
}

/**
 * Registered signing public keys by kid (SPKI PEM). The bundle may
 * carry several during rotation. kid 2026-1 is BURNED and must never
 * be added back.
 */
export const SUPPORTER_PUBLIC_KEYS: Record<string, string> = {
  '2026-2': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApErJ0/LS5Ns+eiI0pwih7tGW5OXs082NjOQNkD5lKEM=
-----END PUBLIC KEY-----`,
};

/** Tolerated clock skew when checking `exp` (the design allows ~48h). */
const CLOCK_SKEW_MS = 48 * 60 * 60 * 1000;

const KEY_PATTERN = /^(?:DSCRB|PBYTE)-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isEntitlementMap(value: unknown): value is SupporterEntitlementMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([feature, exp]) =>
      (SUPPORTER_FEATURES as readonly string[]).includes(feature) &&
      (typeof exp === 'number' || exp === null),
  );
}

function isPayloadShape(value: unknown): value is SupporterKeyPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 2 &&
    typeof p.kid === 'string' &&
    typeof p.jti === 'string' &&
    typeof p.name === 'string' &&
    isEntitlementMap(p.ent) &&
    typeof p.iat === 'number' &&
    (typeof p.exp === 'number' || p.exp === null)
  );
}

/**
 * Whether one feature inside a (verified) key is still live. Per-feature
 * because a key can hold a lapsed monthly themes entitlement next to a
 * running yearly hosted one; the overall `exp` is only the latest.
 */
export function isSupporterFeatureLive(
  payload: SupporterKeyPayload | null | undefined,
  feature: SupporterFeature,
  nowMs: number = Date.now(),
): boolean {
  if (!payload || !(feature in payload.ent)) return false;
  const exp = payload.ent[feature];
  return exp === null || nowMs <= (exp as number) * 1000 + CLOCK_SKEW_MS;
}

/** The live features of a key, in display order. */
export function liveSupporterFeatures(
  payload: SupporterKeyPayload | null | undefined,
  nowMs: number = Date.now(),
): SupporterFeature[] {
  return SUPPORTER_FEATURES.filter((f) => isSupporterFeatureLive(payload, f, nowMs));
}

/**
 * Decode a key's payload without verifying the signature. Only for
 * display/routing decisions that a forged payload can't abuse (e.g.
 * picking error copy); everything that unlocks goes through
 * verifySupporterKey.
 */
export function decodeSupporterKeyPayload(key: string): SupporterKeyPayload | null {
  const match = KEY_PATTERN.exec(key.trim());
  if (!match) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(match[1]));
    const parsed: unknown = JSON.parse(json);
    return isPayloadShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface VerifySupporterKeyOptions {
  /** Override the baked-in key registry (tests). */
  publicKeys?: Record<string, string>;
  /** Revoked jti list, already fetched (fail-open: default none). */
  revokedJtis?: readonly string[];
  /** Clock override (tests). */
  nowMs?: number;
}

/**
 * Fully verify a supporter key: format, known kid, Ed25519 signature
 * over the base64url payload segment, revocation, and expiry (with
 * clock-skew tolerance; grace is already baked into exp). 'valid'
 * means at least one feature is live; consumers still gate per feature
 * with isSupporterFeatureLive.
 */
export async function verifySupporterKey(
  key: string,
  options: VerifySupporterKeyOptions = {},
): Promise<SupporterKeyVerification> {
  // Dev-only test seam (same spirit as window.__store__): Cypress
  // generates a fixture keypair and overrides the registry so the
  // real WebCrypto verification path runs end-to-end. Stripped from
  // production builds along with every other import.meta.env.DEV block.
  const devOverride =
    import.meta.env.DEV && typeof window !== 'undefined'
      ? (window as { __supporterPublicKeysOverride__?: Record<string, string> })
          .__supporterPublicKeysOverride__
      : undefined;
  const publicKeys = options.publicKeys ?? devOverride ?? SUPPORTER_PUBLIC_KEYS;
  const nowMs = options.nowMs ?? Date.now();

  const match = KEY_PATTERN.exec(key.trim());
  if (!match) return { status: 'invalid' };
  const [, body, signature] = match;

  const payload = decodeSupporterKeyPayload(key.trim());
  if (!payload) return { status: 'invalid' };

  const publicKeyPem = publicKeys[payload.kid];
  if (!publicKeyPem) return { status: 'invalid' };

  let signatureValid = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      pemToDer(publicKeyPem) as unknown as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    signatureValid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      base64UrlToBytes(signature) as unknown as ArrayBuffer,
      new TextEncoder().encode(body) as unknown as ArrayBuffer,
    );
  } catch {
    // WebCrypto unavailable or Ed25519 unsupported — fail closed.
    return { status: 'invalid' };
  }
  if (!signatureValid) return { status: 'invalid' };

  if (options.revokedJtis?.includes(payload.jti)) {
    return { status: 'revoked', payload };
  }

  if (payload.exp !== null && nowMs > payload.exp * 1000 + CLOCK_SKEW_MS) {
    return { status: 'expired', payload };
  }

  return { status: 'valid', payload };
}
