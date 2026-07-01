import { SignJWT, importPKCS8 } from "jose";

// Module-level cache. Cloudflare reuses the same isolate across requests,
// so this avoids re-minting an OAuth token on every call.
let cachedToken = null;
let cachedExpiry = 0;

function normalizePrivateKey(key) {
  // Works whether the env var was pasted with literal newlines (dashboard)
  // or with escaped \n (wrangler secret / .dev.vars single-line paste).
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

/**
 * Exchanges the Firebase service account credentials for a short-lived
 * Google OAuth2 access token scoped to Firestore, using the JWT-bearer flow.
 * This is what firebase-admin does internally — reimplemented with Web Crypto
 * (via jose) since firebase-admin itself doesn't run on the Workers runtime.
 */
export async function getFirestoreAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedExpiry - 60 > now) return cachedToken;

  const privateKey = await importPKCS8(
    normalizePrivateKey(env.FIREBASE_PRIVATE_KEY),
    "RS256"
  );

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/datastore",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error_description || "Failed to obtain Google access token.");
  }

  cachedToken = body.access_token;
  cachedExpiry = now + (body.expires_in || 3600);
  return cachedToken;
}
