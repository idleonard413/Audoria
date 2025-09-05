// src/addons/store.ts
export type AddonInfo = {
  id: string;               // stable hash of URL
  url: string;              // base URL, e.g. http://192.168.2.175:7000
  name?: string;            // from manifest (if any)
  description?: string;     // from manifest
  ok?: boolean;             // last validation result
  lastChecked?: number;     // epoch ms
};

const LS_KEY = "ADDONS";
const LS_ACTIVE = "ADDON_BASE";

// Basic hash for stable IDs based on URL
function hash(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function loadAddons(): AddonInfo[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveAddons(list: AddonInfo[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export function getActiveAddon(): string | null {
  try { return localStorage.getItem(LS_ACTIVE); } catch { return null; }
}

export function setActiveAddon(url: string) {
  const clean = url.replace(/\/+$/, "");
  localStorage.setItem(LS_ACTIVE, clean);
  // Expose for code that reads window.__ADDON_BASE
  (window as any).__ADDON_BASE = clean;
  // Notify other tabs / listeners
  window.dispatchEvent(new StorageEvent("storage", { key: LS_ACTIVE, newValue: clean }));
}

export async function validateAddon(url: string): Promise<AddonInfo> {
  const base = url.replace(/\/+$/, "");
  // Try a few “well-known” endpoints:
  // 1) our custom audoria add-on: /health or /catalog ping
  // 2) stremio add-on: /manifest.json
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
      if (r.ok) { ok = true; name ||= "Audoria Add-on"; }
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
  // If active was removed, clear it
  const active = getActiveAddon();
  if (active && !list.some(a => a.url === active)) {
    localStorage.removeItem("ADDON_BASE");
  }
  return list;
}
