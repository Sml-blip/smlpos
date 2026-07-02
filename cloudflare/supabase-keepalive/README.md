# Supabase keep-alive Worker

Supabase **free projects pause after 7 days without API activity**. SMLPOS pings Supabase every 12h while the app runs; this Worker covers vacations when **no PC is on for a week**.

## Deploy (one time)

```bash
cd cloudflare/supabase-keepalive
npm install -g wrangler
wrangler login

wrangler secret put SUPABASE_URL
# paste: https://YOUR_PROJECT.supabase.co

wrangler secret put SUPABASE_ANON_KEY
# paste your anon key from Supabase Dashboard → Settings → API

wrangler deploy
```

## Test

```bash
curl https://smlpos-supabase-keepalive.YOUR_SUBDOMAIN.workers.dev/ping
```

Expected: `{"ok":true,"at":"..."}`

## Cron

Runs daily at **09:00 UTC** (`0 9 * * *`). Edit `wrangler.toml` `[triggers].crons` if needed.
