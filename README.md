# MovieTogether

MovieTogether is a dark, cinematic watch-room experience for friends who want to watch together from different places. The current first slice includes the responsive dashboard, room preview, chat interactions, playback controls, media-source picker, participant panel, and local-video validation UI.

## Current status

This repository currently contains the frontend foundation, a Supabase-backed dashboard room list, and the first authentication/database slice. The dashboard loads active rooms visible to the signed-in user. The Supabase browser client boundary is in [`src/lib/supabase-browser.ts`](./src/lib/supabase-browser.ts), and email/password authentication is in [`src/app/login/page.tsx`](./src/app/login/page.tsx).

The room page now uses Supabase Realtime for chat, membership, playback updates, and WebRTC signaling. Persistent chat and host playback actions are wired to the database. Local movie-file playback still requires the host to share authorized content, and mesh WebRTC is intended only for small rooms.

## Run locally

Requirements: Node.js 20+ and npm.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000.

Supabase variables are optional for the current UI demo. Add them to `.env.local` before wiring authentication and room persistence:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

The publishable key is designed for browser use and is protected by RLS. Never put a Supabase service-role or secret key in client-side code or a `NEXT_PUBLIC_` variable. The app refreshes auth cookies through [`middleware.ts`](./middleware.ts).

Video calls use Supabase Realtime Broadcast for signaling and WebRTC for peer media. The default STUN server is suitable for development. Production deployments should provide a TURN server through `NEXT_PUBLIC_TURN_SERVER_URL`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL`; use short-lived credentials because these values are sent to the browser.

Local movie files are currently delivered from the host to members as a captured WebRTC media stream. This preserves authorized local playback without exposing filesystem paths, but it cannot buffer HLS/DASH segments ahead of time. The host upload connection is shared across members, so larger rooms or slower uplinks require an HLS/DASH pipeline backed by authorized private storage and server-side transcoding.

## Supabase setup

1. Create a Supabase project.
2. Copy the project URL and publishable/anonymous key into `.env.local`.
3. Run [`supabase/migrations/20261022000100_initial_room_schema.sql`](./supabase/migrations/20261022000100_initial_room_schema.sql) in the Supabase SQL Editor, or apply it through the Supabase CLI.
4. In Supabase Auth settings, choose whether email confirmation is required.
5. Open `/login` and create a test account.

The migration enables RLS on every application table. It creates profiles on signup, automatically adds room hosts as approved members, and limits chat/playback writes to approved members and hosts.

If you already ran the first migration and see `infinite recursion detected in policy`, run the repair migration [`supabase/migrations/20261022000200_fix_rls_recursion.sql`](./supabase/migrations/20261022000200_fix_rls_recursion.sql) in the SQL Editor. It replaces the circular room-membership policies with private helper checks. Room-code discovery uses a narrowly scoped authenticated RPC; it does not expose all active rooms through the `rooms` table policy.

## Validation

```powershell
npm run lint
npm run build
```

## Media policy

MovieTogether must not bypass DRM, download or decrypt OTT streams, proxy restricted provider content, or circumvent provider rules. The production implementation may support:

- Official provider links or provider-approved embeds
- YouTube videos that permit embedding
- Host-local video files the host owns or is authorized to share, streamed through browser-supported WebRTC
- Authorized uploads in private storage with access control

When a provider does not permit embedding, the app should show an official external link instead of attempting to work around the restriction.

## Deployment target

The repository includes a Docker deployment for an AWS EC2 prototype:

1. Create the Supabase project and apply the migrations before enabling real room data.
2. Copy `deploy/.env.production.example` to `.env.production` on the server and fill in the public Supabase and WebRTC values.
3. Configure DNS for `harshvardhan0.in` and `www.harshvardhan0.in` to point to the server.
4. Set `ACME_EMAIL` in `.env.production`, then run `bash deploy/rebuild.sh`. This explicitly loads `.env.production` for the Next.js build arguments and avoids accidentally baking a stale shell or `.env` value into the browser bundle.
5. Caddy obtains and renews the HTTPS certificate, while Docker restarts the app after an EC2 reboot.

The Docker image uses Next.js standalone output. Caddy is the public reverse proxy; the Next.js container is not exposed directly to the internet. Keep `.env.production` on the server only and never commit it. A TURN server remains optional, but restrictive networks may require one for reliable WebRTC connections.

For reliable production video rooms beyond a small peer-to-peer group, add an SFU integration boundary such as LiveKit rather than assuming mesh WebRTC will scale.
