// src/config.ts
export function getAddonBase(): string {
  // Highest priority: user override saved in localStorage
  const ls = (() => {
    try { return localStorage.getItem("ADDON_BASE") || ""; } catch { return ""; }
  })();

  // Next: a global injected by index.html (see step 2)
  const win = (window as any).__ADDON_BASE as string | undefined;

  // Finally: build-time env (works if Vite loads your .env)
  const env = ((import.meta as any)?.env?.VITE_ADDON_URL as string | undefined);

  // Last-ditch fallback: same host, port 7000
  const guess = `http://${location.hostname}:7000`;

  return (ls || win || env || guess).replace(/\/+$/, "");
}
