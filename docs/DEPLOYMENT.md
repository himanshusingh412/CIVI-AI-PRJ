# Deployment (Vercel)

## What gets deployed

- `vercel.json` rewrites `/api/*` to the serverless function and everything
  else to `index.html` for client-side routing.
- `api/index.ts` re-exports the Express app in `server/index.ts`.
- `npm run build` produces the static bundle.

## Steps

### 1. Provision the database

Create a project at [neon.tech](https://neon.tech) and copy the **pooled**
connection string. The unpooled one exhausts connections under serverless
almost immediately.

The schema is applied on first boot. To seed demonstration data:

```bash
DATABASE_URL='postgresql://…' npm run db:seed
```

That creates roles, departments, ~500 citizens, ~100 officers and ~1000
complaints. `npm run db:seed:dry` shows what it would do.

### 2. Generate a session secret

```bash
openssl rand -base64 48
```

### 3. Set environment variables

Vercel → your project → Settings → Environment Variables. At minimum:

```
SESSION_SECRET      <the value from step 2>
DATABASE_URL        <pooled Neon string>
NODE_ENV            production
PUBLIC_BASE_URL     https://<your-deployment>.vercel.app
AUTH_DEV_OTP        false
```

Then whichever of the optional providers you have — see
[ENVIRONMENT.md](ENVIRONMENT.md).

**`AUTH_DEV_OTP` must be `false` in production.** The server ignores it when
`NODE_ENV=production` anyway, but do not rely on a second line of defence
for something this important.

### 4. Google sign-in

Google Cloud Console → APIs & Services → Credentials → OAuth client ID
(type: Web application). Add your deployment origin under **Authorized
JavaScript origins** — the origin only, no path, no trailing slash.

### 5. WhatsApp (optional)

1. developers.facebook.com → your app → WhatsApp → API Setup.
2. Webhook callback URL: `https://<your-deployment>/api/whatsapp/webhook`
3. Verify token: the same string as `WHATSAPP_VERIFY_TOKEN`.
4. Subscribe to the `messages` field.
5. Copy the App Secret into `WHATSAPP_APP_SECRET`.

Meta calls `GET /api/whatsapp/webhook` once to verify. If it fails, check
that the verify token matches exactly and that the response is **plain text**
— returning JSON here is the classic reason a correct-looking webhook never
activates.

### 6. Deploy

```bash
npx vercel --prod
```

## Verifying a deployment

```bash
curl https://<your-deployment>/api/health
```

Check:

- `config.sessionSecret` is `true`
- `integrations` reports the modes you expect — anything showing
  `config_required` is a variable you meant to set and did not
- `staffDirectory.demoAccountsActive` is **`false`**

Then in a browser:

1. The landing page loads and is readable without signing in.
2. Sign-in works and lands you on the right portal.
3. **View source and search the bundle for your keys.** Nothing but
   `GOOGLE_CLIENT_ID` should appear.
4. The Network tab shows no request to `localhost`.

## Known serverless constraints

Several stores are in-process and do not survive a cold start or span
instances:

| Store | Symptom when it resets |
|---|---|
| OTP codes | A code issued by one instance may not verify on another |
| Session revocation | Logout may not propagate; bounded by the 1-hour token life |
| Document verification sessions | Uploaded documents vanish mid-flow |
| DigiLocker authorisations | "This authorisation request has expired" |
| Notification preferences | Reset to defaults |
| WhatsApp conversation state | The next message starts a new complaint |

None of these lose a **complaint** — that is in Postgres. The fix for all of
them is the same: back them with Redis (Upstash works well on Vercel). Until
then, prefer a single long-lived instance over aggressive scale-out.

## Rollback

Vercel keeps every deployment. Promote a previous one from the dashboard, or:

```bash
npx vercel rollback <deployment-url>
```

Rotating `SESSION_SECRET` signs everybody out — correct if it leaked,
disruptive otherwise.
