// src/config.ts
export function getAddonBase(): string {
  // 1) user override (survives rebuilds)
  const ls = (() => { try { return localStorage.getItem("ADDON_BASE") || ""; } catch { return ""; } })();

  // 2) runtime global from index.html
  const win = (window as any).__ADDON_BASE as string | undefined;

  // 3) build-time env (works if Vite envs load)
  const env = ((import.meta as any)?.env?.VITE_ADDON_URL as string | undefined);

  // 4) last-ditch guess: same host, :7000
  const guess = `http://${location.hostname}:7000`;

  return (ls || win || env || guess).replace(/\/+$/, "");
}
