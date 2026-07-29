// Web Crypto only (no Node `crypto` module) so this works from both the
// Node.js runtime (Server Actions) and Proxy, which cannot select a runtime
// and does not have Node's `crypto` module available.
const encoder = new TextEncoder();

export const SESSION_COOKIE = "session";
const SESSION_PAYLOAD = "authenticated";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required env var: SESSION_SECRET");
  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function createSessionToken(): Promise<string> {
  const key = await hmacKey(sessionSecret());
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(SESSION_PAYLOAD));
  return bufferToHex(signature);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const expected = await createSessionToken();
    return timingSafeEqual(token, expected);
  } catch {
    return false;
  }
}

export function checkSitePassword(candidate: string): boolean {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("Missing required env var: SITE_PASSWORD");
  return timingSafeEqual(candidate, expected);
}

// Only a same-origin relative path is a safe redirect target — anything else
// (absolute URL, protocol-relative "//host", a bare scheme) risks sending a
// freshly-authenticated user off-site via a crafted `from` link. Lives here
// (not in login/actions.ts) because that file has "use server" at the top,
// which requires every export to be an async Server Action.
export function sanitizeRedirectTarget(path: string): string {
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return "/";
}
