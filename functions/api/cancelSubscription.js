// functions/api/cancelSubscription.js
// Route: POST /api/cancelSubscription
// Ported from functions/index.js `cancelSubscription` (Firebase Functions -> Pages Functions).

import { verifyFirebaseIdToken } from "./_utils/firebaseAuth.js";
import { firestoreGet, firestoreSetMerge } from "./_utils/firestore.js";
import { razorpayRequest, corsHeaders } from "./_utils/razorpay.js";

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("origin")) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders(request.headers.get("origin"));

  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) throw new Error("Missing Firebase ID token.");
    const decoded = await verifyFirebaseIdToken(match[1], env.FIREBASE_PROJECT_ID);

    const body = await request.json().catch(() => ({}));
    const subscriptionId = body.subscriptionId;
    if (!subscriptionId) {
      return new Response(JSON.stringify({ error: "Missing subscriptionId." }), { status: 400, headers });
    }

    const record = await firestoreGet(env, `subscriptions/${subscriptionId}`);
    if (!record || record.uid !== decoded.uid) {
      return new Response(
        JSON.stringify({ error: "Subscription does not belong to this user." }),
        { status: 403, headers }
      );
    }

    const cancelled = await razorpayRequest(env, `/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      body: { cancel_at_cycle_end: 1 }
    });

    await firestoreSetMerge(env, `subscriptions/${subscriptionId}`, {
      status: cancelled.status || "cancel_requested"
    });

    return new Response(JSON.stringify({ status: cancelled.status || "cancel_requested" }), {
      status: 200,
      headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Server error." }), { status: 500, headers });
  }
}

