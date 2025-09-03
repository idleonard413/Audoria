// server.js — Audiobook add-on with LibriVox catalog, OL enrichment, AudioAZ & RSS expansion
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
function parseHmsToSeconds(hms) {
  if (!hms || typeof hms !== "string") return undefined;
  // Accept h:mm:ss or m:ss or s
  return hms.split(":").reduce((acc, v) => acc * 60 + Number(v), 0);
}

// In-memory index so /meta and /stream can resolve by id created from list results
// id => { title, author, lvId }
const catalogIndex = new Map();

// --- Safe allowlist for media proxying ---
function hostAllowed(u) {
  try {
    const h = new URL(u).host.toLowerCase();
    if (h.endsWith(".us.archive.org")) return /^ia\d{3,}\.us\.archive\.org$/.test(h);
    // Main Archive and common subdomains
    if (h === "archive.org" || h === "www.archive.org") return true;
    // Open Library covers
    if (h === "covers.openlibrary.org") return true;
    // LibriVox
    if (h === "librivox.org" || h === "www.librivox.org") return true;
    // AudioAZ (optional)
    if (h === "audioaz.com" || h === "www.audioaz.com") return true;
    return false;
  } catch { return false; }
}

function toHttps(u) {
  return typeof u === "string" ? u.replace(/^http:\/\//i, "https://") : u;
}

function iaIdentifierFromUrl(url_iarchive) {
  if (!url_iarchive) return null;
  try {
    const u = new URL(url_iarchive);
    // usually https://archive.org/details/<identifier>
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("details");
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
    // sometimes it's already the identifier
    return parts[parts.length - 1] || null;
  } catch { return null; }
}

/** Decide the best cover, without proxy prefix (we add /img later) */
function bestCover({ olCover, url_iarchive, url_librivox }) {
  const iaId = iaIdentifierFromUrl(url_iarchive);
  if (iaId) return `https://archive.org/services/img/${encodeURIComponent(iaId)}`;
  if (olCover) return olCover;
  if (url_librivox) return `${url_librivox.replace(/\/$/, "")}/cover.jpg`; // may 404 sometimes
  return null;
}

// copies a subset of headers from origin
function passThroughHeaders(originHeaders, res) {
  const ct = originHeaders.get("content-type");
  const cl = originHeaders.get("content-length");
  const ar = originHeaders.get("accept-ranges");
  const cd = originHeaders.get("content-disposition");
  if (ct) res.setHeader("Content-Type", ct);
  if (cl) res.setHeader("Content-Length", cl);
  if (ar) res.setHeader("Accept-Ranges", ar);
  if (cd) res.setHeader("Content-Disposition", cd);
  // Be permissive for browser consumption
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Timing-Allow-Origin", "*");
}

// CORS preflight
app.options("/proxy", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.status(204).end();
});

// Range-capable streaming proxy for audio (and images)
app.get("/proxy", async (req, res) => {
  const u = req.query.u ? String(req.query.u) : "";
  if (!u) return res.status(400).json({ error: "missing u" });
  const url = toHttps(u);

  if (!hostAllowed(url)) {
    return res.status(403).json({ error: "host not allowed" });
  }

  try {
    const headers = {};
    // forward Range for seeking
    if (req.headers.range) headers.Range = req.headers.range;

    const r = await fetch(url, { headers, redirect: "follow" });
    // Some IA endpoints 302 multiple times; after follow, check ok
    if (!r.ok && r.status !== 206) {
      return res.status(r.status || 502).end();
    }

    // Handle partial content status
    if (r.status === 206) res.status(206);
    passThroughHeaders(r.headers, res);

    // Stream body
    if (!r.body) return res.end();
    r.body.pipe(res);
  } catch (e) {
    console.error("proxy error", e);
    res.status(502).json({ error: "proxy failed" });
  }
});

// lightweight image proxy to avoid ORB on covers
app.get("/img", async (req, res) => {
  const u = req.query.u ? String(req.query.u) : "";
  if (!u) return res.status(400).end();
  const url = toHttps(u);
  if (!hostAllowed(url)) return res.status(403).end();

  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(r.status).end();
    // only allow images
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

  const cover = bestCover({
    olCover: null, // OL not available here yet
    url_iarchive: rec.url_iarchive,
    url_librivox: rec.url_librivox,
  });

  // Collect streams; prefer per-track MP3s from sections; keep ZIP/RSS (UI filters)
  const mp3Streams = [];
  if (Array.isArray(rec.sections)) {
    // Sort by an explicit number if present, else by title number, else by index
    const sections = [...rec.sections].sort((a, b) => {
      const an = Number(a?.section_number ?? a?.track_number ?? a?.id ?? 0);
      const bn = Number(b?.section_number ?? b?.track_number ?? b?.id ?? 0);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;

      // fallback: try to pull a leading number from section_title (e.g., "01 - Chapter One")
      const num = (s) => {
        const m = String(s?.section_title ?? "").match(/^\s*(\d{1,3})\b/);
        return m ? Number(m[1]) : Infinity;
      };
      const at = num(a), bt = num(b);
      if (at !== bt) return at - bt;

      // final fallback: stable order
      return 0;
    });

    sections.forEach((s, i) => {
      const url = s?.file_url ? toHttps(s.file_url) : null;
      if (!url || (!url.endsWith(".mp3") && !url.includes(".mp3?"))) return;

      const dur =
        typeof s.playtime_seconds === "number"
          ? s.playtime_seconds
          : (typeof s.playtime === "string" ? parseHmsToSeconds(s.playtime) : undefined);

      // Numbered, consistent titles
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
  if (rec.url_zip_file) {
    otherStreams.push({ title: "LibriVox ZIP (all tracks)", url: rec.url_zip_file, mime: "application/zip" });
  }
  if (rec.url_rss) {
    otherStreams.push({ title: "LibriVox RSS", url: rec.url_rss, mime: "application/rss+xml" });
  }

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
      ? rec.sections.map((s, i) => ({
          title: s.section_title || `Track ${i + 1}`,
          start: 0, // keep 0; treat per-track as separate sources
        }))
      : undefined,
    rss: rec.url_rss || null,
  };
}

// ---------------- LibriVox RSS -> per-track MP3s -------------
async function fetchText(u) {
  const res = await fetch(u, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Audiobook Addon; +https://github.com/your/repo)",
      "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,text/html;q=0.8,*/*;q=0.7",
    },
  });
  if (!res.ok) throw new Error(`fetch ${u} -> ${res.status}`);
  return await res.text();
}

/** LibriVox RSS -> [{ title, url, mime, duration, idx }] */
function parseLibrivoxRss(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const chunk = m[0];

    const title = (chunk.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .trim();

    const encl = chunk.match(/<enclosure\b[^>]*url="([^"]+)"[^>]*>/i)?.[1] || null;
    const guid = chunk.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || null;
    const link = chunk.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] || null;

    const durStr =
      chunk.match(/<itunes:duration\b[^>]*>([\s\S]*?)<\/itunes:duration>/i)?.[1] ||
      chunk.match(/<duration\b[^>]*>([\s\S]*?)<\/duration>/i)?.[1] || null;

    const duration = durStr
      ? parseHmsToSeconds(durStr.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim())
      : undefined;

    // Prefer enclosure; fall back to GUID/LINK if they are .mp3
    let url = null;
    if (encl && /\.mp3(\?|$)/i.test(encl)) url = encl;
    else if (guid && /\.mp3(\?|$)/i.test(guid)) url = guid;
    else if (link && /\.mp3(\?|$)/i.test(link)) url = link;
    if (!url) continue;

    url = toHttps(url);

    items.push({
      title: title || "Track",
      url,
      mime: "audio/mpeg",
      duration,
    });

    
  }

  // RSS is newest-first; show ascending
  items.reverse();

  // Number as Track 1..N
  return items.map((it, i) => ({
    ...it,
    title: `Track ${i + 1}: ${it.title}`.trim(),
    idx: i + 1,
  }));
}

async function expandRssToStreams(rssUrl) {
  try {
    const xml = await fetchText(toHttps(rssUrl));
    return parseLibrivoxRss(xml);
  } catch (e) {
    console.warn("RSS expand failed:", e.message);
    return [];
  }
}

// -------------- Enrichment: combine LV (by id) + OL --------
async function resolveAudiobook({ id, title, author, lvId, expandRss }) {
  // 1) Best-quality fetch: LV by numeric id for streams and base meta
  const lv = await lvFetchById(lvId);

  // 2) In parallel, ask OL for nicer cover/description
  const ol = await olSearch(lv?.title || title, lv?.author || author);

  // Decide final poster (IA → OL → LV fallback)
  const posterRaw =
    bestCover({
      olCover: ol?.cover || null,
      url_iarchive: lv?.url_iarchive || null,
      url_librivox: null, // only fallback if both are missing
    }) || lv?.cover || null;

  // 3) Merge streams: per-track MP3s from sections + (optionally) expanded RSS MP3s
  let baseStreams = Array.isArray(lv?.streams) ? [...lv.streams] : [];
  if (expandRss && lv?.rss) {
    const rssTracks = await expandRssToStreams(lv.rss);
    // Dedupe by URL; keep RSS order (already numbered ascending)
    const seen = new Set(baseStreams.map(s => s.url));
    for (const t of rssTracks) {
      if (!seen.has(t.url)) {
        baseStreams.push(t);   // append after section MP3s (or change to unshift if you prefer RSS first)
        seen.add(t.url);
      }
    }
  }

  const meta = {
    id,
    type: "other",
    name: (ol?.title || lv?.title || title || "").trim(),
    description: (ol?.description || lv?.description || "").trim(),
    poster: posterRaw, // <-- use the computed poster
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
    const poster = bestCover({
      olCover: null, // we keep catalog fast; OL is used at /meta time
      url_iarchive: b.url_iarchive,
      url_librivox: b.url_librivox,
    });

    // index for later resolution in /meta and /stream — include LV numeric id
    catalogIndex.set(id, { title, author, lvId: b.id });

    return {
      id,
      type: "other",
      name: title,
      poster,
      description: b.description || "",
    };
  });

  return metas;
}

// -------------------------- AudioAZ resolver --------------------------
async function fetchHtml(u) {
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
  let u;
  try { u = new NodeURL(url); } catch { throw new Error("Invalid AudioAZ URL"); }
  if (!/audioaz\.com\/(en|vi|es|de|ru|zh)\/audiobook\//i.test(u.href))
    throw new Error("Not an AudioAZ audiobook URL");

  const html = await fetchHtml(u.href);

  // Try Next.js data
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
              : (typeof s?.playtime === "string" ? parseHmsToSeconds(s.playtime) : undefined);
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
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  // Fallback: scrape any .mp3 links
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

  // Normalize into Stremio streams
  const streams = structured.tracks.map(t => ({
    name: "AudioAZ",
    title: t.duration ? `${t.title} • ${fmtSecs(t.duration)}` : t.title,
    url: t.url,
    mime: "audio/mpeg",
    duration: t.duration,
  }));

  return { title: structured.title, author: structured.author, streams };
}

// --------------------- Routes -------------------------------

// Manifest
app.get("/manifest.json", (_req, res) => {
  res.json({
    id: "com.example.audiobooks",
    version: "3.1.0",
    name: "Example Audiobooks (LibriVox + AudioAZ + RSS)",
    description: "LibriVox catalog with Open Library enrichment, AudioAZ streams, and LibriVox RSS expansion",
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
      expandRss: false,  // not needed for meta
    });

    const base = `${req.protocol}://${req.get("host")}`;
    if (meta.poster) {
      meta.poster = `${base}/img?u=${encodeURIComponent(toHttps(meta.poster))}`;
    }

    res.json({ meta });
  } catch (e) {
    console.error("meta error", e);
    res.status(500).json({ error: "resolver failed" });
  }
});

// Stream — include LibriVox streams; expand RSS to per-track MP3s; optionally blend AudioAZ via ?audioaz=<URL>
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  if (type !== "other") return res.status(404).json({ error: "wrong type" });

  const expandRss = String(req.query.expandRss || "1") !== "0"; // default true

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

    // Blend in AudioAZ if the UI passes a hint
    const audioAzHint = req.query.audioaz ? String(req.query.audioaz) : null;
    if (audioAzHint) {
      try {
        const az = await resolveAudioAz(audioAzHint);
        if (az.streams?.length) {
          // put AudioAZ tracks first so the picker shows them on top
          // also dedupe by URL
          const seen = new Set(streams.map(s => s.url));
          for (const t of az.streams) {
            if (!seen.has(t.url)) {
              streams.unshift(t);
              seen.add(t.url);
            }
          }
        }
      } catch (e) {
        console.warn("audioaz hint failed:", e.message);
      }
    }

    // Proxy streams so the browser doesn’t hit CORS/ORB
    const base = `${req.protocol}://${req.get("host")}`;
    for (const s of streams) {
      if (s && s.url) {
        s.url = `${base}/proxy?u=${encodeURIComponent(toHttps(s.url))}`;
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

// LibriVox RSS direct expansion — debug endpoint
// GET /librivox/rss.json?url=<rss-url>
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

// Health
app.get("/", (_req, res) => res.send("Audiobook add-on (LibriVox + AudioAZ + RSS) running. See /manifest.json"));

app.listen(PORT, HOST, () => {
  console.log(`Audiobook add-on listening on http://${HOST}:${PORT}`);
});
