# Track U — Cloudflare Pages Functions Backend

Replaces `functions/index.js` (Firebase Functions, needs Blaze plan) with
Cloudflare Pages Functions, which run on the **same domain and deploy** as
your existing Cloudflare Pages site. Firebase stays on the Spark (free) plan —
it's now used only for Auth + Firestore, not Functions.

## 1. Folder structure

Merge this into your existing Pages project repo (the one containing `index.html`):

```
your-site/
├── index.html                     ← unchanged, already deployed to Cloudflare Pages
├── package.json                   ← NEW (declares the `jose` dependency)
├── wrangler.toml                  ← NEW (optional, only needed for CLI secret management)
└── functions/
    ├── api/
    │   ├── createSubscription.js  ← POST /api/createSubscription
    │   ├── cancelSubscription.js  ← POST /api/cancelSubscription
    │   └── razorpayWebhook.js     ← POST /api/razorpayWebhook
    └── _lib/
        ├── cors.js
        ├── firebaseAuth.js        ← verifies Firebase ID tokens (no firebase-admin)
        ├── google.js              ← mints Firestore OAuth token from service account
        ├── firestore.js           ← Firestore REST client (get/patch documents)
        ├── razorpay.js            ← Razorpay REST client
        └── webhookVerify.js       ← HMAC signature check via Web Crypto
```

Cloudflare Pages auto-routes any file under `functions/` to a matching URL path
(`functions/api/createSubscription.js` → `/api/createSubscription`). Files/folders
prefixed with `_` (like `_lib`) are ignored for routing — they're just shared modules.

Because `firebase-admin` needs Node.js APIs that don't exist in the Workers
runtime, Firestore and Firebase Auth are re-implemented here using their
plain REST APIs + Web Crypto (via the `jose` library) — same result, edge-compatible.

## 2. Delete/retire the old backend

- Remove the `functions/` folder that contained the Firebase Functions `index.js` (or leave it unused — just don't deploy it).
- You do **not** need `firebase deploy --only functions` anymore. Firebase stays on Spark.
- Firebase Hosting is not used — Cloudflare Pages serves `index.html` and `/api/*` together.

## 3. Install the dependency

```bash
npm install
```

This pulls in `jose`, which Cloudflare's build system bundles automatically
into your Functions (no extra config needed) because `package.json` sits at
the project root next to `functions/`.

## 4. Set environment variables / secrets

You need a **Firebase service account** (for Firestore REST access) — generate
one from Firebase Console → Project Settings → Service Accounts → "Generate
new private key". This gives you `client_email` and `private_key`.

**Dashboard (recommended for the private key):**
Cloudflare Dashboard → your Pages project → Settings → Environment variables →
add for both **Production** and **Preview**:

| Variable | Type | Value |
|---|---|---|
| `RAZORPAY_KEY_ID` | Secret | from Razorpay Dashboard → API Keys |
| `RAZORPAY_KEY_SECRET` | Secret | from Razorpay Dashboard → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Secret | set when you create the webhook (step 6) |
| `RAZORPAY_PLAN_ID` | Secret or Plaintext | your existing Razorpay plan ID |
| `FIREBASE_PROJECT_ID` | Plaintext | your Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Plaintext | `xxx@your-project.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Secret | paste the full PEM block, including `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`, exactly as downloaded (the dashboard's multiline textarea preserves real newlines) |

**CLI equivalent** (`wrangler.toml` in this project makes this available):

```bash
npx wrangler pages secret put RAZORPAY_KEY_ID --project-name track-u
npx wrangler pages secret put RAZORPAY_KEY_SECRET --project-name track-u
npx wrangler pages secret put RAZORPAY_WEBHOOK_SECRET --project-name track-u
npx wrangler pages secret put RAZORPAY_PLAN_ID --project-name track-u
npx wrangler pages secret put FIREBASE_PROJECT_ID --project-name track-u
npx wrangler pages secret put FIREBASE_CLIENT_EMAIL --project-name track-u
npx wrangler pages secret put FIREBASE_PRIVATE_KEY --project-name track-u
# when prompted for FIREBASE_PRIVATE_KEY, paste the key with \n escape sequences
# (functions/_lib/google.js normalizes both real and escaped newlines automatically)
```

Never commit any of these values — `package.json`/`wrangler.toml` here contain none.

## 5. Grant the service account Firestore access

The default Firebase service account already has the `Firebase Admin SDK
Administrator Service Agent` role, which includes Firestore read/write — no
extra IAM setup needed if you generated the key from Firebase Console as above.

## 6. Deploy to Cloudflare Pages

If the project is already connected to your Git repo, just push:

```bash
git add .
git commit -m "Migrate subscription backend to Cloudflare Pages Functions"
git push
```

Cloudflare Pages will detect `functions/` on the next build and deploy it
automatically alongside your static `index.html`.

Or deploy directly via CLI:

```bash
npx wrangler pages deploy . --project-name track-u
```

## 7. Configure the Razorpay webhook

Razorpay Dashboard → Settings → Webhooks → Add New Webhook:

- **URL:** `https://<your-pages-domain>/api/razorpayWebhook`
  (e.g. `https://track-u.pages.dev/api/razorpayWebhook`, or your custom domain)
- **Secret:** generate a strong random string, save it as `RAZORPAY_WEBHOOK_SECRET` (step 4)
- **Active events:**
  - `subscription.activated`
  - `subscription.charged`
  - `subscription.cancelled`
  - `subscription.halted`
  - `payment.failed`

Razorpay calls this URL server-to-server — the frontend never calls
`/api/razorpayWebhook` directly.

## 8. Frontend changes required

**None.** Cloudflare Pages Functions are served from the same domain as your
site, so the frontend's existing relative-path calls already work:

```js
fetch('/api/createSubscription', { ... })
fetch('/api/cancelSubscription', { ... })
```

If your `index.html` was previously pointed at an absolute
`https://YOUR_WORKER.workers.dev/...` URL (from an earlier standalone-Worker
version), point it back at the relative path — see the diff below.

```js
// If present, replace this:
const WORKER_BASE_URL = (cfg.endpoints && cfg.endpoints.workerBaseUrl) || 'https://YOUR_WORKER.workers.dev';
const ENDPOINTS = {
  createSubscription: (cfg.endpoints && cfg.endpoints.createSubscription) || `${WORKER_BASE_URL}/createSubscription`,
  cancelSubscription: (cfg.endpoints && cfg.endpoints.cancelSubscription) || `${WORKER_BASE_URL}/cancelSubscription`
};

// With this (same-origin, no absolute URL needed):
const ENDPOINTS = {
  createSubscription: (cfg.endpoints && cfg.endpoints.createSubscription) || '/api/createSubscription',
  cancelSubscription: (cfg.endpoints && cfg.endpoints.cancelSubscription) || '/api/cancelSubscription'
};
```

`state.subscription`, `currentSubscription()`, `isPremiumActive()`,
`renderBilling()`, `setPremiumVisibility()`, and all premium-feature gating
logic are completely untouched — they still just read `state.subscription`,
which your existing Firestore `onSnapshot` listener on `users/{uid}` populates
from the `subscription` field the webhook writes.

## 9. Test

1. Trigger checkout → confirm `POST /api/createSubscription` returns `{ subscriptionId, razorpayKey, planId }` and Razorpay Checkout opens.
2. Complete a test payment (Razorpay test mode) → confirm the webhook fires and `users/{uid}.subscription.status` becomes `"active"` in Firestore.
3. Cancel from the UI → confirm `POST /api/cancelSubscription` succeeds, then wait for the `subscription.cancelled` webhook to flip status to `"cancelled"`.
4. Use Razorpay Dashboard's "Send Test Webhook" feature to dry-run signature verification without a real payment.
