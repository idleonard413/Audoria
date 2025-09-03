
export type User = { id: number; email: string } | null;

const TOKEN_KEY = "ab_jwt";

export const auth = {
  get token(): string | null { return localStorage.getItem(TOKEN_KEY); },
  set token(v: string | null) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  },
  async me(addonBase: string) {
    const t = auth.token; if (!t) return null;
    try {
      const r = await fetch(`${addonBase}/me`, { headers: { Authorization: `Bearer ${t}` }});
      if (!r.ok) return null;
      const j = await r.json();
      return j.user ?? null;
    } catch { return null; }
  }
};

export function authHeaders() {
  const t = auth.token;
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}
