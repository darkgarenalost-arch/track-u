import { jwtVerify, createRemoteJWKSet } from "jose";

// Google's public JWKS for Firebase Auth ID tokens.
// jose caches this internally across invocations within the same isolate.
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

/**
 * Verifies the Firebase Auth ID token sent as `Authorization: Bearer <token>`.
 * Replaces admin.auth().verifyIdToken() from the old Firebase Functions backend.
 */
export async function verifyFirebaseIdToken(request, projectId) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Missing Firebase ID token.");
    err.status = 401;
    throw err;
  }

  try {
    const { payload } = await jwtVerify(match[1], JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (!payload.sub) throw new Error("Invalid token subject.");
    return { uid: payload.sub, email: payload.email || null };
  } catch (e) {
    const err = new Error("Invalid or expired Firebase ID token.");
    err.status = 401;
    throw err;
  }
}
