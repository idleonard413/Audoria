# Stremio Audiobook Web UI

A web UI that looks & feels like Stremio, adapted for audiobooks. It is designed to run inside the **stremio-shell** using the `--webui-url` flag and to integrate with **stremio/stremio-core** via the `@stremio/stremio-core-web` WASM bridge.

> Status: scaffold with mock data out of the box; swap to real Core once you build `stremio-core-web`.

## Quick Start (Mock Mode)

```bash
# inside this folder
npm install
npm run dev
```

Then launch Stremio Shell and point it at the dev server:

```bash
# macOS / Linux
/path/to/stremio-shell --webui-url=http://localhost:5173

# Windows (PowerShell)
stremio.exe --webui-url=http://localhost:5173
```

You should see **Discover / Library / Add-ons** tabs, a grid of audiobooks (mocked), and a bottom audio player.

## Switch to Real Stremio Core (WASM)

1. Build `stremio-core-web` from the repo you provided:

```bash
cd /mnt/data/audiobook_app_workdir/core
cd stremio-core-development/stremio-core-web
npm install
npm run build # requires Rust + wasm-pack
```

2. Link it into this UI (one-time):

```bash
# from stremio-core-web
npm link

# from this UI project
cd /mnt/data/stremio-audiobook-webui
npm link @stremio/stremio-core-web
```

3. Wire the adapter in `src/core/index.ts` to call real Core:
   - Create/upgrade a `Core` instance
   - Add add-ons (manifests) that serve **audiobooks** using `type: "other"` and an `id` prefix like `audiobook:`
   - Map `discover -> catalogs`, `search -> local_search`, `getStreams -> streams`

For convenience, the adapter currently returns a `MockCore` so the app is usable before Core is wired.

## Audiobook Add-on Notes

Until Stremio adds first-class audiobook types, use the standard add-on protocol with:

```jsonc
{
  "id": "your-addon-id",
  "version": "1.0.0",
  "name": "Audiobooks",
  "types": ["other"],
  "idPrefixes": ["audiobook:"],
  "catalogs": [
    { "type": "other", "id": "audiobook.popular", "name": "Popular Audiobooks" }
  ],
  "resources": ["catalog", "meta", "stream"]
}
```

- **Meta**: include `title`, `description`, `poster` and custom `audiobook` object: `{ duration, chapters[] }`
- **Streams**: return `{ url, title, mime: "audio/mpeg" }` for MP3/M4B streams

On the UI side we treat `type: "other"` with `id` beginning `audiobook:` as an Audiobook.

## Using Stremio Shell

This repository only provides the **Web UI**. The **Shell** you uploaded is a Qt wrapper which loads a Web UI URL. Keep the shell binaries as-is and point them to this UI with `--webui-url=...` as shown above. You can also set the shell to use this URL by default in its config if you prefer a branded build.

## Roadmap

- [ ] Replace `MockCore` with real Core wiring
- [ ] Add Library sync + progress saving (chapters & bookmarks)
- [ ] Chapter list & sleep timer
- [ ] Add-on manager (install, enable, order)
- [ ] Theming & accessibility polish

---

Generated on 2025-08-31T22:46:40.397917Z