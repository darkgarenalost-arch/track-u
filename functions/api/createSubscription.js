import { verifyFirebaseIdToken } from "../_lib/firebaseAuth.js";
import { razorpayRequest } from "../_lib/razorpay.js";
import { patchDocument } from "../_lib/firestore.js";
import { json, handleOptions } from "../_lib/cors.js";

function playerIdFor(uid) {
  return `TU-${uid.slice(0, 4).toUpperCase()}-${uid.slice(-4).toUpperCase()}`;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request);
}

// Cloudflare Pages Functions: this file automatically serves POST /api/createSubscription
export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  try {
    const { uid, email } = await verifyFirebaseIdToken(request, env.FIREBASE_PROJECT_ID);
    const body = await request.json().catch(() => ({}));
    const playerId = body.playerId || playerIdFor(uid);

    const subscription = await razorpayRequest(env, "/subscriptions", {
      method: "POST",
      body: {
        plan_id: env.RAZORPAY_PLAN_ID,
        total_count: 120,
        customer_notify: 1,
        notes: {
          uid,
          playerId,
          email: body.email || email || "",
        },
      },
    });

    await patchDocument(env, `subscriptions/${subscription.id}`, {
      uid,
      id: subscription.id,
      planId: env.RAZORPAY_PLAN_ID,
      status: subscription.status || "created",
      createdAt: new Date().toISOString(),
      currentStart: subscription.current_start
        ? new Date(subscription.current_start * 1000).toISOString()
        : null,
      currentEnd: subscription.current_end
        ? new Date(subscription.current_end * 1000).toISOString()
        : null,
    });

    return json(
      {
        subscriptionId: subscription.id,
        razorpayKey: env.RAZORPAY_KEY_ID,
        planId: env.RAZORPAY_PLAN_ID,
      },
      200,
      origin
    );
  } catch (err) {
    return json({ error: err.message || "Server error." }, err.status || 500, origin);
  }
}
