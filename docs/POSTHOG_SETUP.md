# Get your PostHog key (2 minutes)

This is the only part you actually need to do. Everything else in this file is
reference — skip to [What gets tracked](#what-gets-tracked) later if you're
curious, but you don't need it to get running.

1. Go to **[posthog.com](https://posthog.com)** and click **Get started** /
   **Sign up**. Use Google or email — either is fine.
2. It'll ask you to create an organization name and a project name. Anything
   works — e.g. "MogadishuRents".
3. Right after that, PostHog shows an **"Install PostHog"** screen asking how
   you want to integrate. Pick **Web** (sometimes labeled **JavaScript**) —
   *not* Next.js/React/a framework-specific option, since this app is a plain
   Vite SPA.
4. It shows you a code snippet that looks like this:

   ```js
   posthog.init('phc_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', {
     api_host: 'https://us.i.posthog.com'
   })
   ```

   You need exactly two things out of that snippet — **you don't need to run
   or paste the snippet itself anywhere**, the app already has its own copy of
   this code (`src/lib/analytics.ts`):

   - the `phc_...` string → that's your **key**
   - the `https://....posthog.com` string → that's your **host**

5. Open (or create) the file **`.env`** in the project root and add:

   ```
   VITE_POSTHOG_KEY=phc_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   VITE_POSTHOG_HOST=https://us.i.posthog.com
   ```

   (Use *your* actual values from step 4, not these placeholders.)

6. Stop the dev server if it's running and start it again (`npm run dev`) —
   Vite only reads `.env` when it starts up, so a running server won't pick
   this up on its own.

That's it. Analytics is now live.

### Lost the snippet / already clicked past it?

You can find the same key any time:

**PostHog dashboard → the gear icon (⚙️ Project settings) in the bottom-left
sidebar → it's right there at the top, labeled "Project API Key".**

The host is whichever one appears in your browser's address bar once you're
inside the project — `https://us.posthog.com` → use host
`https://us.i.posthog.com`; `https://eu.posthog.com` → use
`https://eu.i.posthog.com`.

### How do I know it's working?

Open the site, click around a bit, then in the PostHog dashboard go to
**Activity** (left sidebar) — you should see events like `$pageview` showing
up within a few seconds.

---

## The rest (optional, do whenever)

**Analytics is optional in this app.** With no `VITE_POSTHOG_KEY` set, the app
runs exactly as normal — nothing above is required to develop or deploy.

### Turn on session replay

By default PostHog doesn't record screens even though the app is ready for it.
**Project settings → Session replay → Record user sessions** → turn it on.

The app already masks every input's value in recordings (names, phone
numbers, emails, passwords) — that's set in `src/lib/analytics.ts` and
promised to users on the `/privacy` page. Don't turn that masking off without
a good reason.

### Turn on error tracking

**Project settings → Error tracking** → turn it on. Once it's on, both
uncaught JS errors and React crashes (via the app's `ErrorBoundary`) show up
there automatically.

### Add it to Vercel too

**Vercel → your project → Settings → Environment Variables** → add the same
`VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST`.

Tip: you may want to leave these unset for Preview deployments, so branch
previews don't mix into your real numbers.

---

## What gets tracked

Defined in one place — `ANALYTICS_EVENTS` in `src/lib/analytics.ts`:

| Event | Fires when |
| --- | --- |
| `property_viewed` | a property detail page finishes loading |
| `property_contact_clicked` | the WhatsApp contact button is clicked |
| `property_search_submitted` | the homepage hero search is submitted |
| `service_inquiry_submitted` | a service inquiry is sent |
| `property_listed` | a new listing is created |
| `signup_completed` | the complete-profile step succeeds |
| `favorite_toggled` | a property is saved or un-saved |

Plus `$pageview` / `$pageleave`, autocaptured clicks, session replays, and
exceptions.

**Never sent:** phone numbers, email addresses, or message bodies. Those live
in `profile_contacts`, readable only by the owner and platform admins — not
PostHog. `identify()` sends only the user's id and role.
