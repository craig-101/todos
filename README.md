# todos

Minimal single-user todo app. Express + sessions + a JSON file for storage.

## Local

```bash
cp .env.example .env
# edit USERNAME, PASSWORD, SESSION_SECRET
npm install
npm start
```

Open http://localhost:3000.

## Deploy to Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New** → **Web Service** → connect your repo.
3. **Build command:** `npm install`
   **Start command:** `npm start`
4. Add environment variables:
   - `AUTH_USER` — your login
   - `AUTH_PASS` — your password
   - `SESSION_SECRET` — a long random string
   - `NODE_ENV` — `production`
5. (Optional, recommended) Add a **Persistent Disk** so todos survive restarts:
   - Mount path: `/data`
   - Then add env var `DATA_DIR=/data`
   Without this, todos are stored on Render's ephemeral filesystem and will be wiped on every redeploy or restart.

## API

- `GET /api/todos`
- `POST /api/todos` `{ text }`
- `PATCH /api/todos/:id` `{ done?, text? }`
- `DELETE /api/todos/:id`
