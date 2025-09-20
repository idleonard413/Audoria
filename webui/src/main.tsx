// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import TopBar from "@/components/TopBar";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Addons from "@/pages/Addons";
import Player from "@/components/Player";
import AudiobookCard from "@/components/AudiobookCard";
import StreamPicker, { StreamItem, StreamSourceGroup } from "@/components/StreamPicker";
import Dock, { type DockItemData } from "@/components/Dock";
import Login from "./pages/Login";
import { auth } from "./auth/store";
import ErrorBoundary from "./components/ErrorBoundary";
import { dedupeMetas } from "@/lib/dedupe";
import {
  ensureDefaultAddon,
  loadAddons,
  getActiveAddon,
  ADDONS_CHANGED_EVENT,
  ACTIVE_ADDON_EVENT,
  type AddonInfo,
} from "@/addons/store";


// Tailwind v4 entry + tiny base
import "./styles/tailwind.css";
import "./styles/base.css";
import "./styles/glass.css";

/* -------------------------------- Helpers -------------------------------- */

function uniqById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// Runtime add-on base helper (no rebuild required)
function readAddonBase(): string {
  const active = getActiveAddon();
  if (active) return active;
  const win = (typeof window !== "undefined" ? (window as any).__ADDON_BASE : undefined) as string | undefined;
  const env = ((import.meta as any)?.env?.VITE_ADDON_URL as string | undefined);
  if (win) return win.replace(/\/+$/, "");
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const guess = `http://${window.location.hostname}:7000`;
    return guess.replace(/\/+$/, "");
  }
  return "http://localhost:7000";
}
//const ADDON_BASE = getAddonBase();
//console.log("ADDON_BASE =", ADDON_BASE);

/* -------------------------------- Types ---------------------------------- */

type Tab = "discover" | "library" | "addons"; // "discover" now renders Home
type Chapter = { title: string; start: number };
type CurrentTrack = {
  id?: string;
  title?: string;
  author?: string;
  src?: string;
  sourceTitle?: string;
  chapters?: Chapter[];
  duration?: number;
  cover?: string;
};

type HomeItem = { id: string; title: string; author?: string; cover?: string; badge?: string; type?: string };

/* -------------------------------- App ------------------------------------ */

function App() {
  const [addons, setAddons] = React.useState<AddonInfo[]>(() => loadAddons());
  const [addonBase, setAddonBase] = React.useState<string>(readAddonBase());

  React.useEffect(() => {
    let cancelled = false;

    ensureDefaultAddon().then((list) => {
      if (cancelled) return;
      setAddons(list);
      const currentActive = getActiveAddon();
      setAddonBase(currentActive || readAddonBase());
    });

    const syncAddons = () => setAddons(loadAddons());
    const syncActive = () => {
      const activeUrl = getActiveAddon();
      setAddonBase(activeUrl || readAddonBase());
    };
    const storageListener = (e: StorageEvent) => {
      if (e.key === "ADDON_BASE" || e.key === "ADDONS") {
        syncAddons();
        syncActive();
      }
    };

    window.addEventListener(ADDONS_CHANGED_EVENT, syncAddons as EventListener);
    window.addEventListener(ACTIVE_ADDON_EVENT, syncActive as EventListener);
    window.addEventListener("storage", storageListener);

    return () => {
      cancelled = true;
      window.removeEventListener(ADDONS_CHANGED_EVENT, syncAddons as EventListener);
      window.removeEventListener(ACTIVE_ADDON_EVENT, syncActive as EventListener);
      window.removeEventListener("storage", storageListener);
    };
  }, []);
  // stable hooks order
  const [tab, setTab] = React.useState<Tab>("discover");
  const [current, setCurrent] = React.useState<CurrentTrack | null>(null);

  // auth
  const [user, setUser] = React.useState<any>(null);

  // search
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<any[]>([]);

  // Home (Popular) catalog
  const [homeItems, setHomeItems] = React.useState<HomeItem[]>([]);
  const [homeLoading, setHomeLoading] = React.useState(true);
  const [homeError, setHomeError] = React.useState<string | null>(null);

  // stream picker
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerMeta, setPickerMeta] = React.useState<{
    id: string;
    title?: string;
    author?: string;
    cover?: string;
  } | null>(null);
  const [pickerSources, setPickerSources] = React.useState<StreamSourceGroup[]>([]);
  const [pickerLoading, setPickerLoading] = React.useState(false);
  const pickerRequestRef = React.useRef<symbol | null>(null);

  /* -------------------------- Effects / Data fetches -------------------------- */

  // load current user (JWT) once
  React.useEffect(() => {
    auth.me(addonBase).then(setUser);
  }, [addonBase]);

  // load "Popular Audiobooks" for Home page (add-on catalog)
  React.useEffect(() => {
    setHomeItems([]);
    let alive = true;
    (async () => {
      setHomeLoading(true);
      setHomeError(null);
      try {
        const r = await fetch(`${addonBase}/catalog/other/audiobook.popular.json?limit=30`);
        const j = await r.json().catch(() => ({}));
        const metas: any[] = Array.isArray(j?.metas) ? j.metas : [];
        const deduped = dedupeMetas(metas);
        const mapped: HomeItem[] = deduped
          .filter((m) => m && typeof m.id === "string")
          .map((m) => ({
            id: m.id,
            title: m.name || "Untitled",
            author: m.author || "",
            cover: m.poster || undefined,
            type: m.type || 'other',
            // badge could be dynamic if you add pricing/flags later:
            // badge: "1 CREDIT",
          }));
        if (!alive) return;
        setHomeItems(mapped);
      } catch (e: any) {
        if (alive) setHomeError(e?.message || "Failed to load");
      } finally {
        if (alive) setHomeLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [addonBase]);

  // debounced search (pulls up to 10 from addon)
  React.useEffect(() => {
    let stop = false;
    const run = async () => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const r = await fetch(`${addonBase}/search.json?q=${encodeURIComponent(q)}&limit=10`);
        const j = await r.json();
        if (!stop) {
          const metas = Array.isArray(j?.metas) ? j.metas : [];
          setResults(dedupeMetas(metas));
          }
      } catch {
        if (!stop) setResults([]);
      } finally {
        if (!stop) setSearching(false);
      }
    };
    const t = setTimeout(run, 300);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [query, addonBase]);

  // read hash on load
  React.useEffect(() => {
    const h = (location.hash || "").replace(/^#/, "");
    if (h === "addons" || h === "library" || h === "discover") setTab(h as any);
  }, []);

  // write hash when tab changes
  React.useEffect(() => {
    const next = `#${tab}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }, [tab]);


  /* -------------------------------- Callbacks -------------------------------- */

  const handleAuthed = React.useCallback(() => {
    auth.me(addonBase).then(setUser);
  }, []);

  const openPicker = React.useCallback(
    async (id: string, type: string = 'other', seed?: { title?: string; author?: string; cover?: string }) => {
      const normalizedId = id.replace(/-ol[a-z0-9]+$/i, '');
      setPickerLoading(true);
      setPickerSources([]);
      setPickerMeta({
        id: normalizedId,
        title: seed?.title || '',
        author: seed?.author,
        cover: seed?.cover,
      });

      const requestId = Symbol('picker');
      pickerRequestRef.current = requestId;

      setPickerOpen(true);

      const addonList = addons.length
        ? addons
        : [{
            id: `fallback-${addonBase}` || 'fallback',
            url: addonBase,
            name: 'Active Add-on',
            description: '',
            ok: true,
            lastChecked: Date.now(),
          } as AddonInfo];

      const uniqueByUrl: AddonInfo[] = [];
      const seenUrls = new Set<string>();
      for (const addon of addonList) {
        if (!addon?.url) continue;
        const cleanUrl = addon.url.replace(/\/+$/, '');
        if (seenUrls.has(cleanUrl)) continue;
        seenUrls.add(cleanUrl);
        uniqueByUrl.push({ ...addon, url: cleanUrl });
      }

      const sortedAddons = uniqueByUrl.sort((a, b) => {
        if (a.url === addonBase) return -1;
        if (b.url === addonBase) return 1;
        return 0;
      });

      try {
        const results = await Promise.all(
          sortedAddons.map(async (addon) => {
            const base = addon.url;
            const group: StreamSourceGroup = {
              addonId: addon.id,
              addonName: addon.name || base,
              addonUrl: base,
              streams: [],
              error: null,
            };

            const metaInfo: { title?: string; author?: string; cover?: string } = {};

            try {
              const metaRes = await fetch(`${base}/meta/${encodeURIComponent(type)}/${encodeURIComponent(normalizedId)}.json`);
              if (metaRes.ok) {
                const metaJson = await metaRes.json().catch(() => ({}));
                const meta = metaJson?.meta || {};
                if (meta?.name) metaInfo.title = meta.name;
                if (meta?.audiobook?.author) metaInfo.author = meta.audiobook.author;
                if (meta?.poster) metaInfo.cover = meta.poster;
              } else if (metaRes.status !== 404) {
                group.error = `Meta ${metaRes.status}`;
              }
            } catch (err) {
              group.error = err instanceof Error ? err.message : 'Failed to fetch metadata';
            }

            try {
              const streamRes = await fetch(`${base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(normalizedId)}.json`);
              if (streamRes.ok) {
                const sJson = await streamRes.json().catch(() => ({}));
                group.streams = Array.isArray(sJson?.streams) ? sJson.streams : [];
                if (!group.streams.length && !group.error) {
                  group.error = 'No streams available';
                }
              } else {
                group.error = `Streams ${streamRes.status}`;
              }
            } catch (err) {
              group.error = err instanceof Error ? err.message : 'Failed to fetch streams';
            }

            return { group, metaInfo };
          })
        );

        if (pickerRequestRef.current !== requestId) {
          return;
        }

        const aggregate = results.reduce(
          (acc, item) => {
            if (!acc.title && item.metaInfo.title) acc.title = item.metaInfo.title;
            if (!acc.author && item.metaInfo.author) acc.author = item.metaInfo.author;
            if (!acc.cover && item.metaInfo.cover) acc.cover = item.metaInfo.cover;
            return acc;
          },
          { title: seed?.title || '', author: seed?.author, cover: seed?.cover } as { title?: string; author?: string; cover?: string }
        );

        setPickerMeta({
          id: normalizedId,
          title: aggregate.title || seed?.title || 'Untitled',
          author: aggregate.author || seed?.author,
          cover: aggregate.cover || seed?.cover,
        });
        setPickerSources(results.map((r) => r.group));
      } catch (err) {
        if (pickerRequestRef.current !== requestId) {
          return;
        }
        console.error('Failed to load streams from add-ons:', err);
        setPickerSources([]);
      } finally {
        if (pickerRequestRef.current === requestId) {
          setPickerLoading(false);
        }
      }
    },
    [addons, addonBase]
  );
  const chooseStream = React.useCallback(
    ({ stream, group }: { stream: StreamItem; group: StreamSourceGroup }) => {
      const meta = pickerMeta;
      if (!stream?.url) return;

      const title = meta?.title || stream.title || 'Untitled';
      const author = meta?.author;
      const cover = meta?.cover;

      setCurrent({
        id: meta?.id || stream.url,
        title,
        author,
        cover,
        src: stream.url,
        sourceTitle: group.addonName || group.addonUrl,
        duration: stream.duration,
      });

      setPickerOpen(false);

      setTimeout(() => {
        try {
          const audio = (window as any).__abAudioEl as HTMLAudioElement | undefined;
          if (!audio) return;
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err: unknown) => {
              console.warn('Autoplay blocked:', err);
            });
          }
        } catch (err) {
          console.warn('Autoplay blocked:', err);
        }
      }, 50);
    },
    [pickerMeta]
  );

  const dockItems: DockItemData[] = [
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z" />
        </svg>
      ),
      label: "Discover",
      onClick: () => setTab("discover"),
      className: tab === "discover" ? "glass-chipActive" : "glass-chipInactive",
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 19h6a2 2 0 002-2V5a2 2 0 00-2-2H4v16zm0 2a2 2 0 002 2h6v-2H6V3H4v18zm10-2h6V3h-6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      label: "Library",
      onClick: () => setTab("library"),
      className: tab === "library" ? "glass-chipActive" : "glass-chipInactive",
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13 3a2 2 0 012 2v1h2a2 2 0 012 2v2h-1a2 2 0 100 4h1v2a2 2 0 01-2 2h-2v1a2 2 0 11-4 0v-1H8a2 2 0 01-2-2v-2H5a2 2 0 110-4h1V8a2 2 0 012-2h2V5a2 2 0 012-2z" />
        </svg>
      ),
      label: "Add-ons",
      onClick: () => setTab("addons"),
      className: tab === "addons" ? "glass-chipActive" : "glass-chipInactive",
    },
  ];

  // Layout spacing helpers for the floating player and dock.
  const dockPanelHeight = 82;
  const dockBaseItemSize = 52;
  const dockMagnification = 82;
  const dockDistance = 200;
  const dockBottomOffset = 32;
  const playerPanelHeight = 84;
  const playerFloatOffset = dockBottomOffset + Math.max(dockPanelHeight, playerPanelHeight) + 32;
  const contentBottomPadding = playerFloatOffset + 60;
  const handleHomeClick = React.useCallback(() => {
    setTab("discover");
    setQuery("");
    setResults([]);
    setSearching(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [setTab, setQuery, setResults, setSearching]);
  /* ------------------------------ Search view ------------------------------- */

  const SearchView = () => {
    const deduped = results;
    return (
      <div className="mt-7">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <div className="text-[clamp(16px,1.6vw,20px)] font-extrabold tracking-tight">Search</div>
          <div className="text-xs text-white/60">
            {searching ? "Searching…" : `${deduped.length} result${deduped.length === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {deduped.map((b: any, i: number) => (
            <AudiobookCard
              key={`${b.id}#${i}`}
              title={b.name || "Untitled"}
              author={b.author || ""}
              poster={b.poster || undefined}
              onClick={() => openPicker(b.id, (b as any).type || 'other')}
            />
          ))}
        </div>
      </div>
    );
  };

  /* --------------------------------- Body ---------------------------------- */

  const body = !user ? (
    <Login addonBase={addonBase} onAuthed={handleAuthed} />
  ) : (
    <>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 px-4 pt-6 pb-4 md:px-6">
          <div className="mx-auto w-full max-w-[1440px]">
            <TopBar query={query} setQuery={setQuery} onHome={handleHomeClick} />
          </div>
        </header>

        <main className="flex flex-1 justify-center px-4 pt-6 md:px-4" style={{ paddingBottom: contentBottomPadding }}>
          <div className="w-full max-w-[1440px]">
            {query.trim() ? (
              <ErrorBoundary>
                <SearchView />
              </ErrorBoundary>
            ) : tab === "discover" ? (
              <ErrorBoundary>
                {homeError ? (
                  <div className="px-1 py-2 text-white/70">Failed to load catalog.</div>
                ) : (
                  <Home
                    heading="Explore new Audible-style picks"
                    items={homeItems}
                    onOpen={(id, type) => openPicker(id, type || 'other')}
                  />
                )}
              </ErrorBoundary>
            ) : tab === "library" ? (
              <ErrorBoundary>
                <Library />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary>
                <Addons />
              </ErrorBoundary>
            )}
          </div>
        </main>
      </div>

      <StreamPicker
        open={pickerOpen}
        loading={pickerLoading}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta?.title}
        author={pickerMeta?.author}
        cover={pickerMeta?.cover}
        groups={pickerSources}
        onChoose={chooseStream}
      />

      <div
        className="pointer-events-none fixed inset-x-0 z-40 px-4 pb-4 md:px-6"
        style={{ bottom: dockBottomOffset }}
      >
        <div className="pointer-events-auto mx-auto flex w-full max-w-[1440px] flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
          <div className="w-full flex-1 md:max-w-[880px]">
            <Player
              floatOffset={playerFloatOffset}
              id={current?.id}
              title={current?.title}
              author={current?.author}
              src={current?.src || ""}
              sourceTitle={current?.sourceTitle}
              chapters={current?.chapters}
              duration={current?.duration}
            />
          </div>

          {dockItems.length > 0 ? (
            <Dock
              items={dockItems}
              panelHeight={dockPanelHeight}
              baseItemSize={dockBaseItemSize}
              magnification={dockMagnification}
              distance={dockDistance}
              className="pointer-events-auto shrink-0 w-full md:w-auto md:ml-auto"
            />
          ) : null}
        </div>
      </div>

    </>
  );

  return <>{body}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);














