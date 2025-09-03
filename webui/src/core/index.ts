// Core adapter for @stremio/stremio-core-web (WASM).
// This file provides a thin abstraction so the rest of the app doesn't need to know
// whether core is available. In dev, we can mock; in prod, we can use the real core.
export type AudiobookMeta = {
  id: string;
  title: string;
  author?: string;
  description?: string;
  cover?: string;
  duration?: number;
  chapters?: { title: string; start: number }[];
};

export type Stream = { url: string; mime?: string; title?: string; headers?: Record<string,string> };

export interface CoreLike {
  search(query: string): Promise<AudiobookMeta[]>;
  getCatalog(section: "popular" | "trending"): Promise<AudiobookMeta[]>;
  getStreams(id: string): Promise<Stream[]>;
  getMeta(id: string): Promise<AudiobookMeta>;
}

// >>> Point this at your add-on host
const ADDON_BASE = "http://192.168.2.175:7000";

class AddonBackedCore implements CoreLike {
  async getCatalog(section: "popular" | "trending") {
    if (section !== "popular") return [];
    const res = await fetch(`${ADDON_BASE}/catalog/other/audiobook.popular.json`);
    const data = await res.json();
    return (data.metas || []).map((m: any) => ({
      id: m.id,
      title: m.name,
      description: m.description,
      cover: m.poster,
      author: m.audiobook?.author,
      duration: m.audiobook?.duration
    }));
  }


  async getMeta(id: string) {
    const r = await fetch(`${ADDON_BASE}/meta/other/${encodeURIComponent(id)}.json`);
    const data = await r.json(); // { meta: {...} }
    const m = data.meta || {};
    return {
      id: m.id || id,
      title: m.name || "",
      description: m.description || "",
      cover: m.poster || "",
      author: m.audiobook?.author || "",
      duration: m.audiobook?.duration,
      chapters: Array.isArray(m.audiobook?.chapters) ? m.audiobook.chapters : [],
    };
  }

  async getStreams(id: string) {
    const r = await fetch(`${ADDON_BASE}/stream/other/${encodeURIComponent(id)}.json`);
    const data = await r.json();
    return (data.streams || []).map((s: any) => ({
      url: s.url,
      title: s.title,
      mime: s.mime,
    }));
  }

  // 🔎 use the add-on's real search
  async search(query: string) {
    if (!query.trim()) return [];
    const r = await fetch(`${ADDON_BASE}/search.json?q=${encodeURIComponent(query)}`);
    const data = await r.json(); // { metas: [] }
    return (data.metas || []).map((m: any) => ({
      id: m.id,
      title: m.name,
      description: m.description,
      cover: m.poster,
      author: m.audiobook?.author,
      duration: m.audiobook?.duration
    }));
  }
}

export async function getCore(): Promise<CoreLike> {
  return new AddonBackedCore();
}
