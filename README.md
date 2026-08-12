# Sparkline ⚡

One 7-character code. No email, no phone, no password — just pick a name and start chatting, calling or video calling in seconds.

## Structure

| Path | What it is |
| --- | --- |
| `client/` | React + Vite app (landing + chat, calls, media) |
| `server/` | Node.js backend: REST API + Socket.IO realtime + WebRTC signaling (SQLite) |
| `site/` | Static marketing page (used for GitHub Pages) |
| `Dockerfile` / `render.yaml` | Cloud deployment configs |

## Run locally

```bash
# server (serves the built client from client/dist)
cd server
npm ci
npm run start:prod
# → http://localhost:3000
```

Client dev server:

```bash
cd client
npm ci
npm run dev
```

## Deploy to the cloud (free)

**Render** — push this repo to GitHub, then create a Blueprint from `render.yaml`.
**Railway / others** — use the `Dockerfile`; set `PORT` (default 3000) and persist `/app/data`.

All config is env-based: `PORT`, `PUBLIC_URL`, `DB_PATH`, `ADMIN_KEY`, `STUN_URLS`, `TURN_URL` (see `server/.env.example`).

## GitHub Pages

1. Push the repo to GitHub.
2. Repo → Settings → Pages → deploy from branch `main`, folder `/site`.
3. Open `site/index.html` and replace `http://localhost:3000` with your live server URL,
   or pass it as a query param: `?app=<url>`.

## Notes

- Data lives in `server/data/` (SQLite + uploads) — back it up.
- Set `ADMIN_KEY` in production for a stable admin endpoint.
- `TURN_URL` is only needed for calls between strict NATs.