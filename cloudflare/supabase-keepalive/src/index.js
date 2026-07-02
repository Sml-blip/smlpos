/**
 * Cloudflare Worker — daily Supabase ping to prevent free-tier project pause
 * when no SMLPOS PC runs for 7+ days (vacation, etc.).
 *
 * Deploy: see README.md in this folder.
 */

async function pingSupabase(env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '')
  const key = env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY secrets')

  const res = await fetch(`${url}/rest/v1/app_settings?select=key&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ping failed: ${res.status} ${body.slice(0, 200)}`)
  }

  return { ok: true, at: new Date().toISOString() }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      pingSupabase(env).then(r => console.log('[smlpos] Scheduled keep-alive OK', r.at)),
    )
  },

  async fetch(request, env) {
    const path = new URL(request.url).pathname
    if (path === '/health') {
      return Response.json({ ok: true, service: 'smlpos-supabase-keepalive' })
    }
    if (path === '/ping' || path === '/') {
      try {
        const result = await pingSupabase(env)
        return Response.json(result)
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 })
      }
    }
    return new Response('Not found', { status: 404 })
  },
}
