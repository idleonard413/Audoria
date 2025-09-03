// server.js — Audoria add-on (LibriVox + RSS + AudioAZ + OL enrichment + Auth + Progress)

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // v2 CJS
const bodyParser = require("body-parser");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { URL: NodeURL } = require("url");

// ------------------------- Config -------------------------
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT || 7000;
const LV_BASE = "https://librivox.org/api/feed/audiobooks";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DB_PATH = process.env.DB_PATH || "./audoria.sqlite";
const OL_DISABLED = process.env.OL_DISABLED === "1";

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
    if (h === "audioaz.com" || h === "www.audioaz.com") return true;
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
async function safeFetchJson(url, { timeoutMs = 2500, headers = {} } = {}) {
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

// ------------------- Cover helpers ------------------------
function iaIdentifierFromUrl(url_iarchive) {
  if (!url_iarchive) return null;
  try {
    const u = new URL(url_iarchive);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("details");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    return parts[parts.length - 1] || null;
  } catch { return null; }
}
function bestCover({ olCover, url_iarchive, url_librivox }) {
  const iaId = iaIdentifierFromUrl(url_iarchive);
  if (iaId) return `https://archive.org/services/img/${encodeURIComponent(iaId)}`;
  if (olCover) return olCover;
  if (url_librivox) return `${url_librivox.replace(/\/$/, "")}/cover.jpg`;
  return null;
}

// ----------------- Open Library (safe) --------------------
async function olSearch(title, author) {
  if (OL_DISABLED) return null;
  const url = new URL("https://openlibrary.org/search.json");
  if (title) url.searchParams.set("title", title);
  if (author) url.searchParams.set("author", author);
  url.searchParams.set("limit", "1");

  const data = await safeFetchJson(url.toString(), { timeoutMs: 2500 });
  if (!data) return null;

  const doc = (data.docs || [])[0];
  if (!doc) return null;

  let cover = null;
  if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  else if (doc.isbn && doc.isbn.length) cover = `https://covers.openlibrary.org/b/ISBN/${doc.isbn[0]}-L.jpg`;
  else if (doc.key) {
    const olid = doc.key.replace("/works/", "");
    cover = `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
  }

  let description = "";
  if (doc.key && doc.key.startsWith("/works/")) {
    const work = await safeFetchJson(`https://openlibrary.org${doc.key}.json`, { timeoutMs: 2500 });
    if (work) {
      if (typeof work.description === "string") description = work.description;
      else if (typeof work.description?.value === "string") description = work.description.value;
    }
  }

  return {
    title: doc.title,
    author: (doc.author_name && doc.author_name[0]) || author || "",
    cover,
    description: description || "",
    year: doc.first_publish_year || null,
  };
}

// -------------- In-memory index for catalog IDs -----------
const catalogIndex = new Map(); // id -> { title, author, lvId }

// ------------------- LibriVox (by id) ---------------------
async function lvFetchById(lvId) {
  if (!lvId) return null;
  const url = new URL(LV_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("extended", "1");
  url.searchParams.set("id", String(lvId));

  const data = await safeFetchJson(url.toString(), { timeoutMs: 4000 });
  if (!data) return null;
  const rec = (data?.books || [])[0];
  if (!rec) return null;

  const cover = bestCover({
    olCover: null,
    url_iarchive: rec.url_iarchive,
    url_librivox: rec.url_librivox,
  });

  // Sections → MP3s, ASC order, numbered
  const mp3Streams = [];
  if (Array.isArray(rec.sections)) {
    const sections = [...rec.sections].sort((a, b) => {
      const an = Number(a?.section_number ?? a?.track_number ?? a?.id ?? 0);
      const bn = Number(b?.section_number ?? b?.track_number ?? b?.id ?? 0);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      const num = (s) => {
        const m = String(s?.section_title ?? "").match(/^\s*(\d{1,3})\b/);
        return m ? Number(m[1]) : Infinity;
      };
      const at = num(a), bt = num(b);
      if (at !== bt) return at - bt;
      return 0;
    });

    sections.forEach((s, i) => {
      const url = s?.file_url ? toHttps(s.file_url) : null;
      if (!url || (!url.endsWith(".mp3") && !url.includes(".mp3?"))) return;
      const dur =
        typeof s.playtime_seconds === "number" ? s.playtime_seconds :
        (typeof s.playtime === "string" ? parseHmsToSeconds(s.playtime) : undefined);
      const base = (s.section_title || "").trim();
      const label = base ? `Track ${i + 1}: ${base}` : `Track ${i + 1}`;
      mp3Streams.push({
        title: label,
        url,
        mime: "audio/mpeg",
        duration: dur,
        idx: i + 1,
      });
    });
  }

  const otherStreams = [];
  if (rec.url_zip_file) otherStreams.push({ title: "LibriVox ZIP (all tracks)", url: rec.url_zip_file, mime: "application/zip" });
  if (rec.url_rss) otherStreams.push({ title: "LibriVox RSS", url: rec.url_rss, mime: "application/rss+xml" });

  const author = rec.authors?.[0]
    ? `${rec.authors[0].first_name || ""} ${rec.authors[0].last_name || ""}`.trim()
    : undefined;

  return {
    title: rec.title,
    author,
    description: rec.description || "",
    cover,
    url_iarchive: rec.url_iarchive || null,
    streams: [...mp3Streams, ...otherStreams],
    duration: rec.totaltime_seconds ? Number(rec.totaltime_seconds) : undefined,
    chapters: Array.isArray(rec.sections)
      ? rec.sections.map((s, i) => ({ title: s.section_title || `Track ${i + 1}`, start: 0 }))
      : undefined,
    rss: rec.url_rss || null,
  };
}

// ---------------- LibriVox RSS helpers --------------------
async function fetchText(u) {
  try {
    const res = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Audoria Addon)",
        "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,text/html;q=0.8,*/*;q=0.7",
      },
    });
    if (!res.ok) throw new Error(`fetch ${u} -> ${res.status}`);
    return await res.text();
  } catch (e) { return ""; }
}

function parseLibrivoxRss(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const chunk = m[0];
    const title = (chunk.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim();
    const encl = chunk.match(/<enclosure\b[^>]*url="([^"]+)"[^>]*>/i)?.[1] || null;
    const guid = chunk.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || null;
    const link = chunk.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] || null;
    const durStr =
      chunk.match(/<itunes:duration\b[^>]*>([\s\S]*?)<\/itunes:duration>/i)?.[1] ||
      chunk.match(/<duration\b[^>]*>([\s\S]*?)<\/duration>/i)?.[1] || null;
    const duration = durStr ? parseHmsToSeconds(durStr.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim()) : undefined;

    let url = null;
    if (encl && /\.mp3(\?|$)/i.test(encl)) url = encl;
    else if (guid && /\.mp3(\?|$)/i.test(guid)) url = guid;
    else if (link && /\.mp3(\?|$)/i.test(link)) url = link;
    if (!url) continue;

    url = toHttps(url);
    items.push({ title: title || "Track", url, mime: "audio/mpeg", duration });
  }

  // RSS is newest-first; we want ascending (Chapter 1 → …)
  items.reverse();

  return items.map((it, i) => ({
    ...it,
    title: `Track ${i + 1}: ${it.title}`.trim(),
    idx: i + 1,
  }));
}

async function expandRssToStreams(rssUrl) {
  const xml = await fetchText(toHttps(rssUrl));
  if (!xml) return [];
  return parseLibrivoxRss(xml);
}

// --------------------- AudioAZ resolve --------------------
async function fetchHtml(u) {
  try {
    const res = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Audoria Addon)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`fetch ${u} -> ${res.status}`);
    return await res.text();
  } catch (e) { return ""; }
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
  const lines = html.split(/\n/).map(s => s.trim()).filter(s => /^\d+\.\s+(Section|Chapter|Track)\b/i.test(s));
  return lines.map(s => s.replace(/^\d+\.\s+/, "").trim());
}
function fmtSecs(sec) {
  if (!sec || !isFinite(sec)) return undefined;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}
async function resolveAudioAz(url) {
  let u;
  try { u = new NodeURL(url); } catch { throw new Error("Invalid AudioAZ URL"); }
  if (!/audioaz\.com\/(en|vi|es|de|ru|zh)\/audiobook\//i.test(u.href))
    throw new Error("Not an AudioAZ audiobook URL");

  const html = await fetchHtml(u.href);
  const nextData = tryParseNextData(html);
  let structured = null;

  if (nextData) {
    const stack = [nextData];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.sections) || Array.isArray(node.tracks)) {
        const list = node.sections || node.tracks;
        const items = list.map((s, i) => {
          const url = s?.file_url || s?.url;
          if (!url || !/\.mp3(\?|$)/i.test(url)) return null;
          const dur = typeof s?.playtime_seconds === "number"
            ? s.playtime_seconds
            : (typeof s?.playtime === "string" ? parseHmsToSeconds(s.playtime) : undefined);
          return { url, title: s?.section_title || s?.title || `Track ${i + 1}`, duration: dur };
        }).filter(Boolean);
        if (items.length) {
          const metaTitle = node?.title || node?.book?.title || node?.meta?.title;
          const metaAuthor = node?.author?.name || node?.book?.author || node?.meta?.author || undefined;
          structured = { title: metaTitle, author: metaAuthor, tracks: items };
          break;
        }
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

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

  const streams = structured.tracks.map((t) => ({
    name: "AudioAZ",
    title: t.duration ? `${t.title} • ${fmtSecs(t.duration)}` : t.title,
    url: t.url,
    mime: "audio/mpeg",
    duration: t.duration,
  }));

  return { title: structured.title, author: structured.author, streams };
}

// -------------- Resolve audiobook (LV + OL + RSS) --------
async function resolveAudiobook({ id, title, author, lvId, expandRss }) {
  const lv = await lvFetchById(lvId);
  let ol = null;
  try { ol = await olSearch(lv?.title || title, lv?.author || author); } catch {}

  const posterRaw =
    (bestCover({ olCover: ol?.cover || null, url_iarchive: lv?.url_iarchive || null, url_librivox: null }) ||
     lv?.cover || null);

  let baseStreams = Array.isArray(lv?.streams) ? [...lv.streams] : [];
  if (expandRss && lv?.rss) {
    const rssTracks = await expandRssToStreams(lv.rss);
    const seen = new Set(baseStreams.map(s => s.url));
    for (const t of rssTracks) {
      if (!seen.has(t.url)) { baseStreams.push(t); seen.add(t.url); }
    }
  }

  const meta = {
    id,
    type: "other",
    name: (ol?.title || lv?.title || title || "").trim(),
    description: (ol?.description || lv?.description || "").trim(),
    poster: posterRaw,
    audiobook: {
      author: (ol?.author || lv?.author || author || "").trim(),
      duration: lv?.duration,
      chapters: lv?.chapters || [],
    },
  };

  const streams = (baseStreams || []).map((s) => ({
    name: s.mime === "audio/mpeg" ? "LibriVox" : (s.mime === "application/rss+xml" ? "LibriVox RSS" : "LibriVox"),
    title: s.title,
    url: s.url,
    mime: s.mime,
    duration: s.duration,
  }));

  return { meta, streams };
}

// ---------------- LibriVox discovery list -----------------
async function lvList(limit = 50, offset = 0) {
  const u = new URL(LV_BASE);
  u.searchParams.set("format", "json");
  u.searchParams.set("extended", "1");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));

  const data = await safeFetchJson(u.toString(), { timeoutMs: 5000 });
  if (!data) return [];

  const books = Array.isArray(data?.books) ? data.books : [];
  const metas = books.map((b) => {
    const title = b.title || "Untitled";
    const author = (b.authors && b.authors[0])
      ? `${b.authors[0].first_name || ""} ${b.authors[0].last_name || ""}`.trim()
      : undefined;
    const id = `audiobook:${slugify(`${title}-${author || ""}`)}`;
    const poster = bestCover({ olCover: null, url_iarchive: b.url_iarchive, url_librivox: b.url_librivox });

    catalogIndex.set(id, { title, author, lvId: b.id });

    return { id, type: "other", name: title, poster, description: b.description || "" };
  });

  return metas;
}

// ------------------------- Routes -------------------------

// Manifest
app.get("/manifest.json", (_req, res) => {
  res.json({
    id: "com.audoria.audiobooks",
    version: "3.1.0",
    name: "Audoria Audiobooks (LibriVox + RSS + OL)",
    description: "Audiobooks from LibriVox with RSS expansion and optional Open Library enrichment",
    types: ["other"],
    idPrefixes: ["audiobook:"],
    catalogs: [{ type: "other", id: "audiobook.popular", name: "Popular Audiobooks" }],
    resources: ["catalog", "meta", "stream", "search"],
  });
});

// Catalog
app.get("/catalog/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other" || id !== "audiobook.popular") return res.json({ metas: [] });

  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const metas = await lvList(limit, offset);
    const base = `${req.protocol}://${req.get("host")}`;
    const metasProxied = metas.map(m => {
      const url = m.poster ? `${base}/img?u=${encodeURIComponent(toHttps(m.poster))}` : null;
      return { ...m, poster: url };
    });
    res.json({ metas: metasProxied });
  } catch (e) {
    console.error("catalog error", e);
    res.json({ metas: [] });
  }
});

// Meta
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
      lvId: intent.lvId,
      expandRss: false,
    });

    const base = `${req.protocol}://${req.get("host")}`;
    if (meta.poster) meta.poster = `${base}/img?u=${encodeURIComponent(toHttps(meta.poster))}`;

    res.json({ meta });
  } catch (e) {
    console.error("meta error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Stream (proxy URLs + optional RSS expansion + optional AudioAZ blend)
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  const expandRss = String(req.query.expandRss || "1") !== "0";
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
      expandRss,
    });

    // Optional AudioAZ blend
    const audioAzHint = req.query.audioaz ? String(req.query.audioaz) : null;
    if (audioAzHint) {
      try {
        const az = await resolveAudioAz(audioAzHint);
        if (az.streams?.length) {
          const seen = new Set(streams.map(s => s.url));
          for (const t of az.streams) {
            if (!seen.has(t.url)) { streams.unshift(t); seen.add(t.url); }
          }
        }
      } catch (e) { console.warn("audioaz resolve failed:", e.message); }
    }

    // Proxy stream URLs
    const base = `${req.protocol}://${req.get("host")}`;
    for (const s of streams) {
      if (s && s.url) s.url = `${base}/proxy?u=${encodeURIComponent(toHttps(s.url))}`;
    }

    res.json({ streams });
  } catch (e) {
    console.error("stream error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Search (Open Library multi-result)
app.get("/search.json", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const limit = Math.max(1, Math.min(10, parseInt(req.query.limit, 10) || 10));
  if (!q) return res.json({ metas: [] });

  try {
    // If you like "title - author" format, keep this split; otherwise just use q as a whole
    const [titleGuess, authorGuess] = q.split(" - ").map((s) => s.trim());

    const url = new URL("https://openlibrary.org/search.json");
    if (titleGuess) url.searchParams.set("title", titleGuess);
    if (authorGuess) url.searchParams.set("author", authorGuess);
    if (!titleGuess && !authorGuess) url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));

    const data = await safeFetchJson(url.toString(), { timeoutMs: 4000 });
    if (!data || !Array.isArray(data.docs)) return res.json({ metas: [] });

    const base = `${req.protocol}://${req.get("host")}`;
    const metas = [];
    for (const doc of data.docs.slice(0, limit)) {
      const title = doc.title || "Untitled";
      const author = (doc.author_name && doc.author_name[0]) || "";
      const id = `audiobook:${slugify(`${title}-${author}`)}`;

      // cache minimal intent for meta/stream resolution later
      catalogIndex.set(id, { title, author });

      // Build best-effort cover and proxy it through /img
      let cover = null;
      if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      else if (doc.isbn && doc.isbn.length) cover = `https://covers.openlibrary.org/b/ISBN/${doc.isbn[0]}-L.jpg`;
      else if (doc.key) {
        const olid = doc.key.replace("/works/", "");
        cover = `https://covers.openlibrary.org/b/olid/${olid}-L.jpg`;
      }
      if (cover) cover = `${base}/img?u=${encodeURIComponent(cover)}`;

      metas.push({
        id,
        type: "other",
        name: title,
        poster: cover,
        description: "", // we can enrich in /meta via OL/LV later
        author
      });
    }

    res.json({ metas });
  } catch (e) {
    console.warn("search warn:", e?.message || e);
    res.json({ metas: [] });
  }
});


// AudioAZ debug
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

// LibriVox RSS debug
app.get("/librivox/rss.json", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).json({ error: "missing url" });
  try {
    const items = await expandRssToStreams(url);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "rss expand failed" });
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