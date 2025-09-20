// src/addons/store.ts
export type AddonInfo = {
  id: string;               // stable hash of URL
  url: string;              // base URL, e.g. http://localhost:7000
  name?: string;            // from manifest (if any)
  description?: string;     // from manifest
  ok?: boolean;             // last validation result
  lastChecked?: number;     // epoch ms
};

const LS_KEY = "ADDONS";
const LS_ACTIVE = "ADDON_BASE";
export const ADDONS_CHANGED_EVENT = "audoria:addons-changed";
export const ACTIVE_ADDON_EVENT = "audoria:active-addon-changed";

// Basic hash for stable IDs based on URL
function hash(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function emit(name: string, detail?: any) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function defaultAddonUrl(): string {
  const env = (import.meta as any)?.env?.VITE_DEFAULT_ADDON_URL as string | undefined;
  if (env) return normalizeUrl(env);
  if (typeof window !== "undefined") {
    return normalizeUrl(`http://${window.location.hostname}:7000`);
  }
  return normalizeUrl("http://localhost:7000");
}

export function loadAddons(): AddonInfo[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((a: AddonInfo) => ({ ...a, url: normalizeUrl(a.url) })) : [];
  } catch {
    return [];
  }
}

export function saveAddons(list: AddonInfo[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  emit(ADDONS_CHANGED_EVENT, list);
}

export function getActiveAddon(): string | null {
  try {
    const value = localStorage.getItem(LS_ACTIVE);
    return value ? normalizeUrl(value) : null;
  } catch {
    return null;
  }
}

export function setActiveAddon(url: string) {
  const clean = normalizeUrl(url);
  localStorage.setItem(LS_ACTIVE, clean);
  // Expose for code that reads window.__ADDON_BASE
  if (typeof window !== "undefined") {
    (window as any).__ADDON_BASE = clean;
  }
  emit(ACTIVE_ADDON_EVENT, clean);
}

export async function validateAddon(url: string): Promise<AddonInfo> {
  const base = normalizeUrl(url);
  let name = "";
  let description = "";
  let ok = false;

  // Try /health
  try {
    const r = await fetch(`${base}/health`, { method: "GET" });
    if (r.ok) {
      ok = true;
      name = "Audoria Add-on";
      description = "Custom audiobook add-on";
    }
  } catch {}

  // Try /manifest.json (Stremio standard)
  if (!ok) {
    try {
      const r = await fetch(`${base}/manifest.json`, { method: "GET" });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        ok = true;
        name = j?.name || "Stremio Add-on";
        description = j?.description || "";
      }
    } catch {}
  }

  // Fallback ping: /catalog to see if it behaves like ours
  if (!ok) {
    try {
      const r = await fetch(`${base}/catalog/other/audiobook.popular.json?limit=1`);
      if (r.ok) {
        ok = true;
        if (!name) name = "Audoria Add-on";
      }
    } catch {}
  }

  return {
    id: hash(base),
    url: base,
    name: name || base,
    description,
    ok,
    lastChecked: Date.now(),
  };
}

export async function addAddon(url: string): Promise<AddonInfo[]> {
  const list = loadAddons();
  const info = await validateAddon(url);
  const idx = list.findIndex(a => a.id === info.id);
  if (idx >= 0) {
    list[idx] = info;
  } else {
    list.push(info);
  }
  saveAddons(list);
  return list;
}

export function removeAddon(id: string): AddonInfo[] {
  const list = loadAddons().filter(a => a.id !== id);
  saveAddons(list);
  const active = getActiveAddon();
  if (active && !list.some(a => a.url === active)) {
    localStorage.removeItem(LS_ACTIVE);
    emit(ACTIVE_ADDON_EVENT, null);
  }
  return list;
}

export async function ensureDefaultAddon(): Promise<AddonInfo[]> {
  const url = defaultAddonUrl();
  const list = loadAddons();
  const id = hash(url);
  if (!list.some(a => a.id === id)) {
    let info: AddonInfo = {
      id,
      url,
      name: "LibriVox Add-on",
      description: "Public domain audiobooks",
      ok: false,
      lastChecked: Date.now(),
    };
    try {
      const validated = await validateAddon(url);
      info = {
        ...info,
        ...validated,
        name: validated.name || info.name,
        description: validated.description || info.description,
      };
    } catch {}
    const next = [...list, info];
    saveAddons(next);
  }
  const updated = loadAddons();
  const active = getActiveAddon();
  if (!active) {
    setActiveAddon(url);
  }
  return updated;
}
