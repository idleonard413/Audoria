// server.js — Audoria add-on (OpenLibrary metadata + LibriVox streams, Auth, Progress)

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // v2 CJS
const bodyParser = require("body-parser");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ------------------------- Config -------------------------
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 7000;
const LV_BASE = "https://librivox.org/api/feed/audiobooks";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DB_PATH = process.env.DB_PATH || "./audoria.sqlite";

// ------------------------- App ----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ------------------------- DB -----------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    position_sec INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER,
    title TEXT,
    author TEXT,
    poster TEXT,
    src TEXT,
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`).run();

// ------------------------- Auth helpers -------------------
function createToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "missing token" });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.uid, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

// ------------------------- Utils --------------------------
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
function parseHmsToSeconds(hms) {
  if (!hms || typeof hms !== "string") return undefined;
  return hms.split(":").reduce((acc, v) => acc * 60 + Number(v), 0);
}
function toHttps(u) { return typeof u === "string" ? u.replace(/^http:\/\//i, "https://") : u; }

function hostAllowed(u) {
  try {
    const h = new URL(u).host.toLowerCase();
    if (h.endsWith(".us.archive.org")) return /^ia\d{3,}\.us\.archive\.org$/.test(h);
    if (h === "archive.org" || h === "www.archive.org") return true;
    if (h === "covers.openlibrary.org") return true;
    if (h === "librivox.org" || h === "www.librivox.org") return true;
    return false;
  } catch { return false; }
}
function passThroughHeaders(originHeaders, res) {
  const ct = originHeaders.get("content-type");
  const cl = originHeaders.get("content-length");
  const ar = originHeaders.get("accept-ranges");
  const cd = originHeaders.get("content-disposition");
  if (ct) res.setHeader("Content-Type", ct);
  if (cl) res.setHeader("Content-Length", cl);
  if (ar) res.setHeader("Accept-Ranges", ar);
  if (cd) res.setHeader("Content-Disposition", cd);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Timing-Allow-Origin", "*");
}


// Safe JSON fetch (timeout, never throws)
async function safeFetchJson(url, { timeoutMs = 4000, headers = {} } = {}) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { headers, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ------------------- Proxies (audio/image) ----------------
// Range-capable audio proxy
app.options("/proxy", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.status(204).end();
});
app.get("/proxy", async (req, res) => {
  const u = req.query.u ? String(req.query.u) : "";
  if (!u) return res.status(400).json({ error: "missing u" });
  const url = toHttps(u);
  if (!hostAllowed(url)) return res.status(403).json({ error: "host not allowed" });

  try {
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;
    const r = await fetch(url, { headers, redirect: "follow" });
    if (!r.ok && r.status !== 206) return res.status(r.status || 502).end();
    if (r.status === 206) res.status(206);
    passThroughHeaders(r.headers, res);
    if (!r.body) return res.end();
    r.body.pipe(res);
  } catch (e) {
    console.error("proxy error", e);
    res.status(502).json({ error: "proxy failed" });
  }
});

// Image proxy (avoid ORB)
app.get("/img", async (req, res) => {
  const u = req.query.u ? String(req.query.u) : "";
  if (!u) return res.status(400).end();
  const url = toHttps(u);
  if (!hostAllowed(url)) return res.status(403).end();
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(r.status).end();
    const ct = r.headers.get("content-type") || "";
    if (!/^image\//i.test(ct)) return res.status(415).end();
    passThroughHeaders(r.headers, res);
    if (!r.body) return res.end();
    r.body.pipe(res);
  } catch (e) {
    console.error("img proxy error", e);
    res.status(502).end();
  }
});

// ----------------- Open Library (metadata) ----------------
async function olEnrich(title, author) {
  // search
  const url = new URL("https://openlibrary.org/search.json");
  if (title) url.searchParams.set("title", title);
  if (author) url.searchParams.set("author", author);
  url.searchParams.set("limit", "1");

  const data = await safeFetchJson(url.toString(), { timeoutMs: 5000 });
  if (!data || !data.docs || !data.docs.length) return { title, author, cover: null, description: "" };

  const doc = data.docs[0];
  const out = {
    title: doc.title || title || "",
    author: (doc.author_name && doc.author_name[0]) || author || "",
    cover: null,
    description: ""
  };

  // cover
  if (doc.cover_i) out.cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  else if (doc.isbn && doc.isbn.length) out.cover = `https://covers.openlibrary.org/b/ISBN/${doc.isbn[0]}-L.jpg`;
  else if (doc.key) {
    const olid = doc.key.replace("/works/", "");
    out.cover = `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
  }

  // description
  if (doc.key && doc.key.startsWith("/works/")) {
    const work = await safeFetchJson(`https://openlibrary.org${doc.key}.json`, { timeoutMs: 5000 });
    const d = work && (typeof work.description === "string" ? work.description
              : (work?.description?.value || ""));
    if (d) out.description = String(d);
  }
  return out;
}

function parseRssTracks(xml) {
  try {
    const items = xml.split(/<item[\s>]/i).slice(1); // crude split
    const tracks = [];
    let i = 0;
    for (const it of items) {
      // enclosure url
      const mUrl = it.match(/<enclosure[^>]*url="([^"]+)"/i);
      const url = mUrl ? mUrl[1] : null;
      if (!url) continue;

      // optional title
      const mTitle = it.match(/<title>([^<]+)<\/title>/i);
      const title = mTitle ? mTitle[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;

      // optional duration from itunes:duration (hh:mm:ss or mm:ss)
      const mDur = it.match(/<itunes:duration>([^<]+)<\/itunes:duration>/i);
      const dur = mDur ? parseHmsToSeconds(mDur[1].trim()) : undefined;

      i += 1;
      tracks.push({
        title: title ? `Track ${i}: ${title}` : `Track ${i}`,
        url: toHttps(url),
        mime: "audio/mpeg",
        duration: dur
      });
    }

    // RSS is usually newest→oldest; reverse to oldest→newest
    return tracks.reverse();
  } catch {
    return [];
  }
}

// -------------- LibriVox queries (id + list + streams) ---
function bestArchiveCover(url_iarchive, url_librivox) {
  // prefer archive cover if we have identifier, else LV cover.jpg
  try {
    if (url_iarchive) {
      const u = new URL(url_iarchive);
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("details");
      const id = (i >= 0 && parts[i + 1]) ? parts[i + 1] : (parts[parts.length - 1] || null);
      if (id) return `https://archive.org/services/img/${encodeURIComponent(id)}`;
    }
  } catch {}
  return url_librivox ? `${url_librivox.replace(/\/$/, "")}/cover.jpg` : null;
}

async function lvFindByTitleAuthor(title, author) {
  const u = new URL(LV_BASE);
  u.searchParams.set("format", "json");
  u.searchParams.set("extended", "1");
  if (title) u.searchParams.set("title", title);
  if (author) u.searchParams.set("author", author);
  u.searchParams.set("limit", "5");

  const data = await safeFetchJson(u.toString(), { timeoutMs: 7000 });
  if (!data || !Array.isArray(data.books) || !data.books.length) return null;

  // best match
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const nt = norm(title), na = norm(author);
  let best = null, score = -1;
  for (const b of data.books) {
    const bt = norm(b.title);
    const ba = norm((b.authors && b.authors[0]) ? `${b.authors[0].first_name || ""} ${b.authors[0].last_name || ""}` : "");
    let sc = 0;
    if (nt && bt === nt) sc += 3; else if (nt && bt.includes(nt)) sc += 2;
    if (na && ba === na) sc += 2; else if (na && ba.includes(na)) sc += 1;
    if (!best || sc > score) { best = b; score = sc; }
  }
  return best || data.books[0];
}

async function lvFetchById(lvId) {
  if (!lvId) return null;
  const url = new URL(LV_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("extended", "1");
  url.searchParams.set("id", String(lvId));
  const data = await safeFetchJson(url.toString(), { timeoutMs: 8000 });
  if (!data) return null;
  const rec = (data.books || [])[0];
  if (!rec) return null;

  // Build MP3 streams ascending (from sections)
  let mp3 = [];
  if (Array.isArray(rec.sections) && rec.sections.length) {
    const sections = [...rec.sections].sort((a, b) => {
      const an = Number(a?.section_number ?? a?.track_number ?? a?.id ?? 0);
      const bn = Number(b?.section_number ?? b?.track_number ?? b?.id ?? 0);
      return (Number.isFinite(an) && Number.isFinite(bn)) ? (an - bn) : 0;
    });
    sections.forEach((s, i) => {
      const u = s?.file_url ? toHttps(s.file_url) : null;
      if (!u || (!u.endsWith(".mp3") && !u.includes(".mp3"))) return;
      const dur = typeof s.playtime_seconds === "number"
        ? s.playtime_seconds
        : (typeof s.playtime === "string" ? parseHmsToSeconds(s.playtime) : undefined);
      mp3.push({
        title: (s.section_title ? `Track ${i + 1}: ${s.section_title}` : `Track ${i + 1}`),
        url: u,
        mime: "audio/mpeg",
        duration: dur
      });
    });
  }

  // 🔁 Fallback: if no usable sections, parse the RSS
  if ((!mp3 || mp3.length === 0) && rec.url_rss) {
    try {
      const rssRes = await fetch(toHttps(rec.url_rss), { redirect: "follow" });
      if (rssRes.ok) {
        const xml = await rssRes.text();
        const fromRss = parseRssTracks(xml);
        if (fromRss.length) mp3 = fromRss;
      }
    } catch {}
  }

  return {
    lvId: rec.id,
    title: rec.title,
    author: rec.authors?.[0]
      ? `${rec.authors[0].first_name || ""} ${rec.authors[0].last_name || ""}`.trim()
      : "",
    description: rec.description || "",
    coverFallback: bestArchiveCover(rec.url_iarchive, rec.url_librivox),
    rss: rec.url_rss || null,
    streams: mp3
  };
}


async function lvList(limit = 50, offset = 0) {
  const u = new URL(LV_BASE);
  u.searchParams.set("format", "json");
  u.searchParams.set("extended", "1");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  const data = await safeFetchJson(u.toString(), { timeoutMs: 8000 });
  if (!data) return [];
  return Array.isArray(data.books) ? data.books : [];
}

// -------------- Resolver (OL metadata + LV streams) -------
const catalogIndex = new Map(); // id -> { title, author, lvId }

async function resolveByTitleAuthor({ id, title, author }) {
  // Look up OL metadata (title/author/desc/cover)
  const ol = await olEnrich(title, author);

  // Find LV record & streams
  const lvRec = await lvFindByTitleAuthor(ol.title || title, ol.author || author);
  const lv = await lvFetchById(lvRec?.id);

  // poster: prefer OL cover, else LV fallback
  let poster = ol.cover || lv?.coverFallback || null;

  const meta = {
    id,
    type: "other",
    name: ol.title || lv?.title || title || "",
    description: (ol.description || lv?.description || "").trim(),
    poster,
    audiobook: {
      author: ol.author || lv?.author || author || "",
      chapters: [], // (optional: could be mapped from LV sections if desired)
      duration: undefined
    },
  };

  const streams = (lv?.streams || []).map(s => ({ ...s }));

  return { meta, streams, lvId: lv?.lvId || lvRec?.id || null };
}

// ------------------------- Routes -------------------------

// Manifest
app.get("/manifest.json", (_req, res) => {
  res.json({
    id: "com.audoria.audiobooks",
    version: "4.0.0",
    name: "Audoria Audiobooks (OL + LibriVox)",
    description: "Metadata & covers from Open Library, streams from LibriVox",
    types: ["other"],
    idPrefixes: ["audiobook:"],
    catalogs: [{ type: "other", id: "audiobook.popular", name: "Popular Audiobooks" }],
    resources: ["catalog", "meta", "stream", "search"],
  });
});

// Catalog: LibriVox list enriched with OL covers
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other" || id !== "audiobook.popular") return res.json({ metas: [] });

  const limit = Math.max(1, Math.min(60, parseInt(req.query.limit, 10) || 30));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const books = await lvList(limit, offset);
    const base = `${req.protocol}://${req.get("host")}`;

    // Enrich covers concurrently but don't block slow ones
    const metas = await Promise.all(books.map(async (b) => {
      const title = b.title || "Untitled";
      const author = (b.authors && b.authors[0])
        ? `${b.authors[0].first_name || ""} ${b.authors[0].last_name || ""}`.trim()
        : "";
      const id = `audiobook:${slugify(`${title}-${author}`)}-${b.id}`;

      // cache lvId for fast stream lookup
      catalogIndex.set(id, { title, author, lvId: b.id });

      // prefer OL cover, else archive/LV fallback
      let cover = null;
      try {
        const ol = await olEnrich(title, author);
        cover = ol.cover || null;
      } catch {}
      if (!cover) {
        // fallback to archive cover.jpg
        try {
          const fallback = bestArchiveCover(b.url_iarchive, b.url_librivox);
          if (fallback) cover = fallback;
        } catch {}
      }

      const poster = cover ? `${base}/img?u=${encodeURIComponent(toHttps(cover))}` : null;

      return {
        id, type: "other", name: title, poster,
        description: b.description || "", author
      };
    }));

    res.json({ metas });
  } catch (e) {
    console.error("catalog error", e);
    res.json({ metas: [] });
  }
});

// Meta: OL metadata + LV fallback, cache lvId
app.get("/meta/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  let intent = catalogIndex.get(id);
  if (!intent) {
    const slug = id.replace(/^audiobook:/, "");
    const [title, ...rest] = slug.split("-");
    intent = { title: slug.replace(/-/g, " "), author: rest.join(" ") || "" };
  }
  try {
    const { meta, lvId } = await resolveByTitleAuthor({ id, title: intent.title, author: intent.author });
    // cache lvId for streams
    if (lvId) catalogIndex.set(id, { title: meta.name, author: meta.audiobook.author, lvId });
    // proxy poster
    const base = `${req.protocol}://${req.get("host")}`;
    if (meta.poster) meta.poster = `${base}/img?u=${encodeURIComponent(toHttps(meta.poster))}`;
    res.json({ meta });
  } catch (e) {
    console.error("meta error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Stream: ensure we resolve LV by title/author if no lvId cached
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  let intent = catalogIndex.get(id);
  if (!intent) {
    const slug = id.replace(/^audiobook:/, "");
    intent = { title: slug.replace(/-/g, " "), author: "" };
  }

  try {
    // if we already cached lvId from catalog/meta, use it
    let streams = [];
    if (intent.lvId) {
      const lv = await lvFetchById(intent.lvId);
      streams = lv?.streams || [];
    } else {
      // resolve by title/author
      const { streams: s, lvId } = await resolveByTitleAuthor({ id, title: intent.title, author: intent.author });
      streams = s;
      if (lvId) catalogIndex.set(id, { title: intent.title, author: intent.author, lvId });
    }

    // proxy stream URLs
    const base = `${req.protocol}://${req.get("host")}`;
    streams = streams.map(s => ({ ...s, url: `${base}/proxy?u=${encodeURIComponent(toHttps(s.url))}` }));

    res.json({ streams });
  } catch (e) {
    console.error("stream error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Search: Open Library (up to 10), no blocking enrichment here
app.get("/search.json", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const limit = Math.max(1, Math.min(10, parseInt(req.query.limit, 10) || 10));
  if (!q) return res.json({ metas: [] });

  try {
    const url = new URL("https://openlibrary.org/search.json");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    const data = await safeFetchJson(url.toString(), { timeoutMs: 6000 });
    if (!data || !Array.isArray(data.docs)) return res.json({ metas: [] });

    const base = `${req.protocol}://${req.get("host")}`;
    const metas = data.docs.slice(0, limit).map(doc => {
      const title = doc.title || "Untitled";
      const author = (doc.author_name && doc.author_name[0]) || "";
      const workKey = (doc.key || "").replace("/works/", "");
      const baseSlug = slugify(`${title}-${author}`);
      const id = workKey ? `audiobook:${baseSlug}-ol${workKey}` : `audiobook:${baseSlug}`;

      // cache minimal (no lvId yet; meta/stream will resolve later)
      catalogIndex.set(id, { title, author });

      let cover = null;
      if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      else if (doc.isbn && doc.isbn.length) cover = `https://covers.openlibrary.org/b/ISBN/${doc.isbn[0]}-L.jpg`;
      else if (doc.key) {
        const olid = doc.key.replace("/works/", "");
        cover = `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
      }
      const poster = cover ? `${base}/img?u=${encodeURIComponent(cover)}` : null;

      return { id, type: "other", name: title, poster, description: "", author };
    });

    res.json({ metas });
  } catch (e) {
    console.warn("search warn:", e?.message || e);
    res.json({ metas: [] });
  }
});

// ------------------------ Auth -----------------------------
app.post("/auth/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare("INSERT INTO users (email, pass_hash) VALUES (?, ?)").run(email, hash);
    const user = { id: info.lastInsertRowid, email };
    const token = createToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    if (/UNIQUE/.test(String(e))) return res.status(409).json({ error: "email already registered" });
    res.status(500).json({ error: "register failed" });
  }
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row) return res.status(401).json({ error: "invalid credentials" });
  const ok = bcrypt.compareSync(password, row.pass_hash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });
  const token = createToken(row);
  res.json({ token, user: { id: row.id, email: row.email } });
});

app.get("/me", authRequired, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// ---------------------- Progress ---------------------------
app.put("/progress", authRequired, (req, res) => {
  const { item_id, position_sec, duration_sec, title, author, poster, src } = req.body || {};
  if (!item_id || position_sec == null) return res.status(400).json({ error: "item_id and position_sec required" });

  const stmt = db.prepare(
    "INSERT INTO progress (user_id, item_id, position_sec, duration_sec, title, author, poster, src, updated_at) " +
    "VALUES (@user_id, @item_id, @position_sec, @duration_sec, @title, @author, @poster, @src, datetime('now')) " +
    "ON CONFLICT(user_id, item_id) DO UPDATE SET " +
    "position_sec=excluded.position_sec, " +
    "duration_sec=COALESCE(excluded.duration_sec, progress.duration_sec), " +
    "title=COALESCE(excluded.title, progress.title), " +
    "author=COALESCE(excluded.author, progress.author), " +
    "poster=COALESCE(excluded.poster, progress.poster), " +
    "src=COALESCE(excluded.src, progress.src), " +
    "updated_at=datetime('now')"
  );

  stmt.run({
    user_id: req.user.id,
    item_id,
    position_sec: Math.max(0, Math.floor(position_sec)),
    duration_sec: duration_sec != null ? Math.max(0, Math.floor(duration_sec)) : null,
    title: title || null,
    author: author || null,
    poster: poster || null,
    src: src || null,
  });

  res.json({ ok: true });
});

app.get("/continue", authRequired, (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
  const rows = db.prepare(
    "SELECT item_id, position_sec, duration_sec, title, author, poster, src, updated_at " +
    "FROM progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?"
  ).all(req.user.id, limit);

  res.json({
    items: rows.map(r => ({
      id: r.item_id,
      title: r.title,
      author: r.author,
      poster: r.poster,
      position_sec: r.position_sec,
      duration_sec: r.duration_sec,
      src: r.src,
      updated_at: r.updated_at,
      progressPct: r.duration_sec ? Math.min(100, Math.round(100 * r.position_sec / r.duration_sec)) : 0
    }))
  });
});

// ------------------------ Health ---------------------------
app.get("/", (_req, res) => res.send("Audoria add-on running. See /manifest.json"));

// ------------------------ Listen ---------------------------
app.listen(PORT, HOST, () => {
  console.log(`Audiobook add-on listening on http://${HOST}:${PORT}`);
});
