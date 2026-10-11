const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET environment variable must be set (min 32 characters)");
  }
  return secret;
}

async function getCryptoKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sign(payload: string): Promise<string> {
  const key = await getCryptoKey();
  const encoder = new TextEncoder();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64urlEncode(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(encoded: string): string {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Who a session belongs to: always a person — `id` is a users.id. "user" is a player.
 *
 * Everyone signs in with Google. The old team logins (`type: "team"`, `id` a teams.id) are gone,
 * and verifySession refuses any token still carrying that type.
 */
export type SessionType = "superadmin" | "admin" | "user";

const SESSION_TYPES: ReadonlySet<string> = new Set<SessionType>(["superadmin", "admin", "user"]);

export interface SessionPayload {
  id: string;
  type: SessionType;
  exp: number;
  /**
   * users.session_version when the token was minted (person sessions only). Bumping the column
   * revokes every older token on its next membership or privilege check. Absent means 0, which
   * keeps tokens minted before this field existed valid.
   */
  sv?: number;
}

/** True for sessions that identify a person (a users row). Every verified session does. */
export function isPersonSession(session: Pick<SessionPayload, "type">): boolean {
  return SESSION_TYPES.has(session.type);
}

/** Create a signed session token encoding id, type, expiration and (for people) session version. */
export async function createSession(id: string, type: SessionType, opts: { sv?: number } = {}): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = JSON.stringify(opts.sv ? { id, type, exp, sv: opts.sv } : { id, type, exp });
  const encoded = b64urlEncode(payload);
  const sig = await sign(encoded);
  return `${encoded}.${sig}`;
}

/** Verify and decode a signed session token. Returns null if invalid or expired. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = await sign(encoded);

  // Constant-time comparison
  if (sig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const payload: SessionPayload = JSON.parse(b64urlDecode(encoded));
    if (!payload.id || !payload.type || !payload.exp) return null;
    if (!isPersonSession(payload)) return null; // e.g. an old team-login token
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// isSuperAdmin lives in lib/privilege.ts: it checks the database, and this module must stay
// database-free because middleware imports it.

export const SESSION_COOKIE_NAME = "session";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
