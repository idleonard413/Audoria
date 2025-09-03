
import { authHeaders } from "../auth/store";

const ADDON_BASE = import.meta.env.VITE_ADDON_URL || "http://localhost:7000";

export async function saveProgress(p: {
  item_id: string;
  position_sec: number;
  duration_sec?: number;
  title?: string;
  author?: string;
  poster?: string;
  src?: string;
}) {
  try {
    await fetch(`${ADDON_BASE}/progress`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(p)
    });
  } catch {}
}

export async function fetchContinue(limit = 20) {
  const r = await fetch(`${ADDON_BASE}/continue?limit=${limit}`, { headers: authHeaders() });
  if (!r.ok) return { items: [] };
  return r.json() as Promise<{ items: Array<any> }>;
}
