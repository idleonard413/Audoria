# Stremio Audiobook (Monorepo)

- `webui/` — Vite + React frontend (audiobook UI, stream picker, chapters)
- `addon/` — Node/Express add-on (LibriVox catalog, OL enrichment, AudioAZ, RSS expansion)

## Dev

### Web UI
```bash
cd webui
npm i
npm run dev
Add-on
bash
Copy code
cd addon
npm i
HOST=0.0.0.0 PORT=7000 node server.js
Point the Stremio shell at your UI preview URL (e.g. http://<host>:5173 or http://<host>:4173).

Build
bash
Copy code
cd webui && npm run build
