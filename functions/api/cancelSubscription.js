import { verifyFirebaseIdToken } from "./_lib/firebaseAuth.js";
import { razorpayRequest } from "./_lib/razorpay.js";
import { getDocument } from "./_lib/firestore.js";
import { json, handleOptions } from "./_lib/cors.js";

export async function onRequestOptions(context) {
  return handleOptions(context.request);
}

// Serves POST /api/cancelSubscription
export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  try {
    const { uid } = await verifyFirebaseIdToken(request, env.FIREBASE_PROJECT_ID);
    const body = await request.json().catch(() => ({}));
    const subscriptionId = body.subscriptionId;

    if (!subscriptionId) {
      return json({ error: "Missing subscriptionId." }, 400, origin);
    }

    const existing = await getDocument(env, `subscriptions/${subscriptionId}`);
    if (!existing || existing.uid !== uid) {
      return json({ error: "Subscription does not belong to this user." }, 403, origin);
    }

    const cancelled = await razorpayRequest(env, `/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      body: { cancel_at_cycle_end: 1 },
    });

    // Firestore is updated authoritatively by the webhook (subscription.cancelled)
    // once Razorpay confirms the cancellation — not here.
    return json({ status: cancelled.status || "cancel_requested" }, 200, origin);
  } catch (err) {
    return json({ error: err.message || "Server error." }, err.status || 500, origin);
  }
}
