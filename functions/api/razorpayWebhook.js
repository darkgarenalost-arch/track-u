// functions/api/razorpayWebhook.js
// Route: POST /api/razorpayWebhook
// Ported from functions/index.js `razorpayWebhook` (Firebase Functions -> Pages Functions).
//
// Razorpay calls this directly (server-to-server) whenever a subscription event fires.
// This is what makes renewals/cancellations automatic — Firestore is updated here,
// and the frontend's existing users/{uid} listener picks up state.subscription changes
// with no polling required.

import { firestoreSetMerge } from "./_utils/firestore.js";
import { verifyWebhookSignature, corsHeaders } from "./_utils/razorpay.js";

const STATUS_BY_EVENT = {
  "subscription.activated": "active",
  "subscription.charged": "active", // renewal payment succeeded -> currentEnd advances
  "subscription.cancelled": "cancelled",
  "subscription.halted": "halted",
  "payment.failed": "past_due",
  "subscription.pending": "pending"
};

function toIso(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders(request.headers.get("origin"));

  try {
    // Must read the raw body (not JSON-parsed) to verify the HMAC signature correctly.
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";
    const valid = await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid webhook signature." }), { status: 401, headers });
    }

    const event = JSON.parse(rawBody);
    const subscription = event.payload?.subscription?.entity;
    if (!subscription) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    const uid = subscription.notes?.uid;
    if (!uid) {
      // No uid metadata -> nothing we can attribute this to; ack so Razorpay stops retrying.
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    const status = STATUS_BY_EVENT[event.event] || subscription.status || "unknown";
    const subscriptionData = {
      uid,
      id: subscription.id,
      subscriptionId: subscription.id,
      planId: subscription.plan_id || env.RAZORPAY_PLAN_ID,
      status,
      currentStart: toIso(subscription.current_start),
      currentEnd: toIso(subscription.current_end), // advances automatically on subscription.charged
      chargeAt: toIso(subscription.charge_at),
      lastEvent: event.event,
      updatedAt: new Date().toISOString()
    };

    // Audit/lookup collection (used by cancelSubscription to check ownership).
    await firestoreSetMerge(env, `subscriptions/${subscription.id}`, subscriptionData);
    // Source of truth for premium gating on the client: users/{uid}/subscription.
    await firestoreSetMerge(env, `users/${uid}`, { subscription: subscriptionData });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Server error." }), { status: 500, headers });
  }
}
