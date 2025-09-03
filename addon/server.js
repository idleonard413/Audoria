// server.js — Audiobook add-on with LibriVox catalog, OL enrichment, and AudioAZ streams
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // v2 for CommonJS
const { URL: NodeURL } = require("url");

const app = express();
app.use(cors());

// ------------------------- Config -------------------------
const HOST = process.env.HOST || "0.0.0.0"; // set HOST=0.0.0.0 to expose on LAN
const PORT = process.env.PORT || 7000;

const LV_BASE = "https://librivox.org/api/feed/audiobooks"; // LibriVox discovery/info

// ------------------------- Utils --------------------------
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// In-memory index so /meta and /stream can resolve by id created from list results
// id => { title, author, lvId }
const catalogIndex = new Map();

// ----------------- Open Library (covers/desc) --------------
async function olSearch(title, author) {
  const url = new URL("https://openlibrary.org/search.json");
  if (title) url.searchParams.set("title", title);
  if (author) url.searchParams.set("author", author);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  const doc = (data.docs || [])[0];
  if (!doc) return null;

  // best-effort cover
  let cover = null;
  if (doc.cover_i) {
    cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  } else if (doc.isbn && doc.isbn.length) {
    cover = `https://covers.openlibrary.org/b/ISBN/${doc.isbn[0]}-L.jpg`;
  } else if (doc.key) {
    const olid = doc.key.replace("/works/", "");
    cover = `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
  }

  // try to get description from Work JSON
  let description = doc.first_sentence?.join?.(" ") || "";
  if ((!description || description.length < 10) && doc.key && doc.key.startsWith("/works/")) {
    try {
      const workRes = await fetch(`https://openlibrary.org${doc.key}.json`);
      if (workRes.ok) {
        const work = await workRes.json();
        if (typeof work.description === "string") description = work.description;
        else if (typeof work.description?.value === "string") description = work.description.value;
      }
    } catch (_) {}
  }

  return {
    title: doc.title,
    author: (doc.author_name && doc.author_name[0]) || author || "",
    cover,
    description: description || "",
    year: doc.first_publish_year || null,
  };
}

// ------------------- LibriVox (fetch by ID) ----------------
async function lvFetchById(lvId) {
  if (!lvId) return null;
  const url = new URL(LV_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("extended", "1");
  url.searchParams.set("id", String(lvId));
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  const rec = (data?.books || [])[0];
  if (!rec) return null;

  // Collect streams; prefer per-track MP3s, but keep ZIP/RSS (UI will filter)
  const streams = [];
  if (Array.isArray(rec.sections)) {
    rec.sections.forEach((s, i) => {
      const url = s?.file_url;
      if (url && (url.endsWith(".mp3") || url.includes(".mp3?"))) {
        const dur =
          typeof s.playtime_seconds === "number"
            ? s.playtime_seconds
            : typeof s.playtime === "string"
              ? s.playtime.split(":").reduce((acc, v) => acc * 60 + Number(v), 0)
              : undefined;
        streams.push({
          title: `Track ${i + 1}: ${s.section_title || ""}`.trim(),
          url,
          mime: "audio/mpeg",
          duration: dur,
        });
      }
    });
  }
  if (rec.url_zip_file) {
    streams.push({ title: "LibriVox ZIP (all tracks)", url: rec.url_zip_file, mime: "application/zip" });
  }
  if (rec.url_rss) {
    streams.push({ title: "LibriVox RSS", url: rec.url_rss });
  }

  const cover = rec?.url_librivox ? rec.url_librivox.replace(/\/$/, "") + "/cover.jpg" : undefined;
  const author = rec.authors?.[0]
    ? `${rec.authors[0].first_name || ""} ${rec.authors[0].last_name || ""}`.trim()
    : undefined;

  return {
    title: rec.title,
    author,
    description: rec.description || "",
    cover,
    streams, // includes per-track MP3s with durations
    duration: rec.totaltime_seconds ? Number(rec.totaltime_seconds) : undefined,
    chapters: Array.isArray(rec.sections)
      ? rec.sections.map((s, i) => ({
          title: s.section_title || `Track ${i + 1}`,
          start: 0, // keep 0 for now; we treat per-track as separate sources
        }))
      : undefined,
  };
}

// -------------- Enrichment: combine LV (by id) + OL --------
async function resolveAudiobook({ id, title, author, lvId }) {
  // 1) Best-quality fetch: LV by numeric id for streams and base meta
  const lv = await lvFetchById(lvId);

  // 2) In parallel, ask OL for nicer cover/description
  const ol = await olSearch(lv?.title || title, lv?.author || author);

  const meta = {
    id,
    type: "other",
    name: (ol?.title || lv?.title || title || "").trim(),
    description: (ol?.description || lv?.description || "").trim(),
    poster: ol?.cover || lv?.cover || null,
    audiobook: {
      author: (ol?.author || lv?.author || author || "").trim(),
      duration: lv?.duration,
      chapters: lv?.chapters || [],
    },
  };

  const streams = (lv?.streams || []).map((s) => ({
    name: "LibriVox",
    title: s.title,
    url: s.url,
    mime: s.mime,
    duration: s.duration,
  }));

  return { meta, streams };
}

// -------------- LibriVox discovery list (catalog) -----------
async function lvList(limit = 50, offset = 0) {
  const u = new URL(LV_BASE);
  u.searchParams.set("format", "json");
  u.searchParams.set("extended", "1");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));

  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`LibriVox list failed: ${res.status}`);
  const data = await res.json();
  const books = Array.isArray(data?.books) ? data.books : [];

  const metas = books.map((b) => {
    const title = b.title || "Untitled";
    const author = (b.authors && b.authors[0])
      ? `${b.authors[0].first_name || ""} ${b.authors[0].last_name || ""}`.trim()
      : undefined;
    const id = `audiobook:${slugify(`${title}-${author || ""}`)}`;

    const poster = b.url_librivox ? `${b.url_librivox.replace(/\/$/, "")}/cover.jpg` : undefined;

    // index for later resolution in /meta and /stream — include LV numeric id
    catalogIndex.set(id, { title, author, lvId: b.id });

    return {
      id,
      type: "other",
      name: title,
      poster,
      description: b.description || "",
      // (optional) preview fields so shelves can show badges without /meta:
      // audiobook: { author, duration: b.totaltime_seconds ? Number(b.totaltime_seconds) : undefined }
    };
  });

  return metas;
}

// -------------------------- AudioAZ resolver --------------------------
async function fetchText(u) {
  const res = await fetch(u, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Audiobook Addon; +https://github.com/your/repo)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`fetch ${u} -> ${res.status}`);
  return await res.text();
}

function tryParseNextData(html) {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractMp3Links(html) {
  const links = new Set();
  const re = /https?:\/\/[^\s"'<>]+?\.mp3(?:\?[^\s"'<>]*)?/ig;
  let m; while ((m = re.exec(html))) links.add(m[0]);
  return Array.from(links);
}

function extractSectionTitles(html) {
  const lines = html
    .split(/\n/)
    .map(s => s.trim())
    .filter(s => /^\d+\.\s+(Section|Chapter|Track)\b/i.test(s));
  return lines.map(s => s.replace(/^\d+\.\s+/, "").trim());
}

function fmtSecs(sec) {
  if (!sec || !isFinite(sec)) return undefined;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}

async function resolveAudioAz(url) {
  // validate & normalize
  let u;
  try { u = new NodeURL(url); } catch { throw new Error("Invalid AudioAZ URL"); }
  if (!/audioaz\.com\/(en|vi|es|de|ru|zh)\/audiobook\//i.test(u.href))
    throw new Error("Not an AudioAZ audiobook URL");

  const html = await fetchText(u.href);

  // 1) Try Next.js data
  const nextData = tryParseNextData(html);
  /** @type {{title?:string, author?:string, tracks?: Array<{title?:string, url?:string, duration?:number}>}} */
  let structured = null;

  if (nextData) {
    const stack = [nextData];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.sections) || Array.isArray(node.tracks)) {
        const list = node.sections || node.tracks;
        const items = list
          .map((s, i) => {
            const url = s?.file_url || s?.url;
            if (!url || !/\.mp3(\?|$)/i.test(url)) return null;
            const dur = typeof s?.playtime_seconds === "number"
              ? s.playtime_seconds
              : (typeof s?.playtime === "string"
                  ? s.playtime.split(":").reduce((acc, v) => acc * 60 + Number(v), 0)
                  : undefined);
            return { url, title: s?.section_title || s?.title || `Track ${i + 1}`, duration: dur };
          })
          .filter(Boolean);
        if (items.length) {
          const metaTitle = node?.title || node?.book?.title || node?.meta?.title;
          const metaAuthor =
            node?.author?.name ||
            node?.book?.author ||
            node?.meta?.author ||
            undefined;
          structured = { title: metaTitle, author: metaAuthor, tracks: items };
          break;
        }
      }
      // scan children
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  // 2) Fallback: scrape any .mp3 links
  if (!structured) {
    const mp3s = extractMp3Links(html);
    if (!mp3s.length) return { title: undefined, author: undefined, streams: [] };
    const labels = extractSectionTitles(html);
    const streams = mp3s.map((url, i) => ({
      name: "AudioAZ",
      title: labels[i] ? `${labels[i]}` : `Track ${i + 1}`,
      url,
      mime: "audio/mpeg",
    }));
    return { title: undefined, author: undefined, streams };
  }

  // 3) Normalize into Stremio streams
  const streams = structured.tracks.map(t => ({
    name: "AudioAZ",
    title: t.duration ? `${t.title} • ${fmtSecs(t.duration)}` : t.title,
    url: t.url,
    mime: "audio/mpeg",
    duration: t.duration,
  }));

  return {
    title: structured.title,
    author: structured.author,
    streams,
  };
}

// --------------------- Routes -------------------------------

// Manifest
app.get("/manifest.json", (_req, res) => {
  res.json({
    id: "com.example.audiobooks",
    version: "3.0.0",
    name: "Example Audiobooks (LibriVox + AudioAZ)",
    description: "Live LibriVox catalog with Open Library enrichment and AudioAZ streams",
    types: ["other"],
    idPrefixes: ["audiobook:"],
    catalogs: [{ type: "other", id: "audiobook.popular", name: "Popular Audiobooks" }],
    resources: ["catalog", "meta", "stream", "search"],
  });
});

// Catalog — LibriVox list (supports ?limit & ?offset)
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other" || id !== "audiobook.popular") return res.json({ metas: [] });

  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const metas = await lvList(limit, offset);
    res.json({ metas });
  } catch (e) {
    console.error("catalog error", e);
    res.json({ metas: [] });
  }
});

// Meta — resolve by id (uses index; falls back to slug guess)
app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  let intent = catalogIndex.get(id);
  if (!intent) {
    const slug = id.replace(/^audiobook:/, "");
    const guessTitle = slug.replace(/-/g, " ");
    intent = { title: guessTitle };
  }

  try {
    const { meta } = await resolveAudiobook({
      id,
      title: intent.title,
      author: intent.author,
      lvId: intent.lvId, // pass LV id when we have it
    });
    res.json({ meta });
  } catch (e) {
    console.error("meta error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Stream — include LibriVox streams; optionally blend AudioAZ via ?audioaz=<AudioAZ title URL>
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  let intent = catalogIndex.get(id);
  if (!intent) {
    const slug = id.replace(/^audiobook:/, "");
    const guessTitle = slug.replace(/-/g, " ");
    intent = { title: guessTitle };
  }

  try {
    const { streams } = await resolveAudiobook({
      id,
      title: intent.title,
      author: intent.author,
      lvId: intent.lvId,
    });

    // Blend in AudioAZ if the UI passes a hint
    const audioAzHint = req.query.audioaz ? String(req.query.audioaz) : null;
    if (audioAzHint) {
      try {
        const az = await resolveAudioAz(audioAzHint);
        if (az.streams?.length) {
          // put AudioAZ tracks first so the picker shows them on top
          streams.unshift(...az.streams);
        }
      } catch (e) {
        console.warn("audioaz hint failed:", e.message);
      }
    }

    res.json({ streams });
  } catch (e) {
    console.error("stream error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Search — OL quick discovery for arbitrary query
app.get("/search.json", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ metas: [] });

  try {
    const [titleGuess, authorGuess] = q.split(" - ").map((s) => s.trim());
    const ol = await olSearch(titleGuess || q, authorGuess || "");
    if (!ol) return res.json({ metas: [] });

    const id = `audiobook:${slugify(`${ol.title}-${ol.author || ""}`)}`;
    catalogIndex.set(id, { title: ol.title, author: ol.author }); // help later resolution

    res.json({
      metas: [
        {
          id,
          type: "other",
          name: ol.title,
          poster: ol.cover || null,
          description: ol.description || "",
          // optionally preview more fields:
          // audiobook: { author: ol.author }
        },
      ],
    });
  } catch (e) {
    console.error("search error", e);
    res.json({ metas: [] });
  }
});

// AudioAZ direct resolver — test or use for ad-hoc streams
// GET /audioaz/resolve.json?url=<audioaz-title-url>
app.get("/audioaz/resolve.json", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).json({ error: "missing url" });
  try {
    const data = await resolveAudioAz(url);
    res.json(data);
  } catch (e) {
    console.error("audioaz resolve error", e);
    res.json({ title: null, author: null, streams: [] });
  }
});

// Health
app.get("/", (_req, res) => res.send("Audiobook add-on (LibriVox + AudioAZ) running. See /manifest.json"));

app.listen(PORT, HOST, () => {
  console.log(`Audiobook add-on listening on http://${HOST}:${PORT}`);
});
