// functions/api/createSubscription.js
// Route: POST /api/createSubscription
// Ported from functions/index.js `createSubscription` (Firebase Functions -> Pages Functions).

<<<<<<< HEAD
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

=======
import { verifyFirebaseIdToken } from "./_utils/firebaseAuth.js";
import { firestoreSetMerge } from "./_utils/firestore.js";
import { razorpayRequest, playerIdFor, corsHeaders } from "./_utils/razorpay.js";

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
    const uid = decoded.uid;
    const email = body.email || decoded.email || "";
    const playerId = body.playerId || playerIdFor(uid);

    if (body.planId && body.planId !== env.RAZORPAY_PLAN_ID) {
      return new Response(JSON.stringify({ error: "Invalid plan." }), { status: 400, headers });
    }

    const subscription = await razorpayRequest(env, "/subscriptions", {
      method: "POST",
      body: {
        plan_id: env.RAZORPAY_PLAN_ID,
        total_count: 120,
        customer_notify: 1,
        notes: { uid, playerId, email }
      }
    });

    await firestoreSetMerge(env, `subscriptions/${subscription.id}`, {
      uid,
      id: subscription.id,
      planId: env.RAZORPAY_PLAN_ID,
      status: subscription.status || "created",
      currentStart: subscription.current_start || null,
      currentEnd: subscription.current_end || null,
      createdAt: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({
        subscriptionId: subscription.id,
        razorpayKey: env.RAZORPAY_KEY_ID,
        planId: env.RAZORPAY_PLAN_ID
      }),
      { status: 200, headers }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Server error." }), { status: 500, headers });
  }
}

>>>>>>> 68cd51b49dce1b6fca0078c6acead9dcabffca9f