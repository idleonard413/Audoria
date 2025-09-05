// src/pages/Addons.tsx
import React from "react";
import {
  addAddon,
  loadAddons,
  removeAddon,
  setActiveAddon,
  getActiveAddon,
  validateAddon,
  type AddonInfo
} from "@/addons/store";

export default function Addons() {
  const [addons, setAddons] = React.useState<AddonInfo[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAddons(loadAddons());
    setActive(getActiveAddon());
  }, []);

  const onInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    try {
      const list = await addAddon(u);
      setAddons(list);
      // auto-activate the newly added add-on
      const added = list.find(a => a.url.replace(/\/+$/, "") === u.replace(/\/+$/, ""));
      if (added?.ok) {
        setActiveAddon(added.url);
        setActive(added.url);
      }
      setUrl("");
    } catch (e: any) {
      setErr(e?.message || "Failed to add add-on");
    } finally {
      setBusy(false);
    }
  };

  const onActivate = (a: AddonInfo) => {
    setActiveAddon(a.url);
    setActive(a.url);
  };

  const onRemove = (a: AddonInfo) => {
    const next = removeAddon(a.id);
    setAddons(next);
    if (active === a.url) {
      // Clearing active handled in store when removed
      setActive(getActiveAddon());
    }
  };

  const onRecheck = async (a: AddonInfo) => {
    const info = await validateAddon(a.url);
    const list = loadAddons();
    const idx = list.findIndex(x => x.id === a.id);
    if (idx >= 0) list[idx] = info;
    save(list);
  };

  const save = (list: AddonInfo[]) => {
    // local helper to refresh state from LS
    setAddons(list);
  };

  return (
    <section className="mx-auto w-full max-w-[960px] px-4">
      <h2 className="mb-4 mt-6 text-[22px] font-extrabold tracking-tight">Add-ons</h2>

      <form onSubmit={onInstall} className="mb-6 flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://host:7000  or  https://your-addon.example.com"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none"
        />
        <button
          disabled={busy || !url.trim()}
          className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Validating…" : "Install"}
        </button>
      </form>

      {err ? <div className="mb-4 text-red-300">{err}</div> : null}

      {!addons.length ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-white/70">
          No add-ons installed yet. Paste a URL above to install.
        </div>
      ) : (
        <div className="space-y-3">
          {addons.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{a.name || a.url}</div>
                <div className="truncate text-sm text-white/60">{a.description || a.url}</div>
                <div className="mt-1 text-xs">
                  Status: {a.ok ? <span className="text-emerald-400">OK</span> : <span className="text-amber-400">Unknown</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => onActivate(a)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${
                    active === a.url ? "bg-emerald-500 text-black" : "bg-white/10 hover:bg-white/15"
                  }`}
                >
                  {active === a.url ? "Active" : "Activate"}
                </button>
                <button
                  onClick={() => onRemove(a)}
                  className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-sm text-white/60">
        Tip: the active add-on is saved in <code>localStorage.ADDON_BASE</code>. All catalog/search/stream calls use it.
      </div>
    </section>
  );
}
