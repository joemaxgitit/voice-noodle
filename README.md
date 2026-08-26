# Voice Noodle

Private tone and delivery training. A trainee sees a short passage, hears a
master recording, watches the words illuminate in time with the voice, and
repeats it until their delivery matches.

Built first for the Lionside Options Script. The data model is tenant-agnostic,
so the same app serves a CSR script or a screenplay with no code changes.

---

## One-time setup

### 1. Supabase — database
SQL Editor, run in this order:
1. `supabase/schema.sql`
2. `supabase/seed.sql`

### 2. Supabase — storage
Storage > New bucket > name it `master-audio`. Leave it **private**.

### 3. Supabase — your admin account
Authentication > Users > Add user. Then in SQL Editor:

```sql
update public.profiles
set org_id = (select id from public.orgs where slug = 'lionside'),
    role   = 'admin'
where id = (select id from auth.users where email = 'YOUR@EMAIL.COM');
```

Every rep you add later needs the same `org_id` (role stays `rep`).

### 4. Environment variables
Local: copy `.env.example` to `.env.local` and fill in.
Vercel: **Project** settings (not team settings) > Environment Variables.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`NEXT_PUBLIC_` vars are baked in at build time. Changing them requires a fresh
build, not a redeploy of the old one.

---

## Recording a segment

1. `/admin` > pick a segment
2. Choose the MP3
3. Fix the phrase lines (one thought group per line)
4. Press **Start tapping**, hit `Space` as each phrase begins
5. Nudge anything that landed off by ±0.05s
6. **Preview karaoke**, then **Upload and publish**

Uploading always creates a new version and snapshots the old one into
`segment_versions`, so a bad take is recoverable.

---

## Confirming it works after deploy

- `/login` should redirect you there from any URL when signed out
- After sign-in, `/` lists modules with `0 / 3` style counts
- `/admin` should 302 to `/` for anyone whose role is `rep`
- In a segment, DevTools > Network > the MP3 request URL contains `token=` —
  if it does not, the bucket is public and needs fixing

---

## If the site 504s

Check whether the Supabase project has auto-paused before looking anywhere else.
Middleware calls the database on every request, so a paused project takes the
whole site down.
