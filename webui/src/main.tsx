// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Addons from "@/pages/Addons";
import Player from "@/components/Player";
import AudiobookCard from "@/components/AudiobookCard";
import StreamPicker, { StreamItem } from "@/components/StreamPicker";
import Login from "./pages/Login";
import { auth } from "./auth/store";
import ErrorBoundary from "./components/ErrorBoundary";

// Tailwind v4 entry + tiny base
import "./styles/tailwind.css";
import "./styles/base.css";

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
  const ls = (() => {
    try { return localStorage.getItem("ADDON_BASE") || ""; } catch { return ""; }
  })();
  const win = (window as any).__ADDON_BASE as string | undefined;
  const env = ((import.meta as any)?.env?.VITE_ADDON_URL as string | undefined);
  const guess = `http://${location.hostname}:7000`;
  return (ls || win || env || guess).replace(/\/+$/, "");
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

type HomeItem = { id: string; title: string; author?: string; cover?: string; badge?: string };

/* -------------------------------- App ------------------------------------ */

function App() {
  const [addonBase, setAddonBase] = React.useState<string>(readAddonBase());

  React.useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "ADDON_BASE") {
      setAddonBase(readAddonBase());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
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
  const [pickerStreams, setPickerStreams] = React.useState<StreamItem[]>([]);

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
        const mapped: HomeItem[] = metas
          .filter((m) => m && typeof m.id === "string")
          .map((m) => ({
            id: m.id,
            title: m.name || "Untitled",
            author: m.author || "",
            cover: m.poster || undefined,
            // badge could be dynamic if you add pricing/flags later:
            // badge: "1 CREDIT",
          }));
        if (!alive) return;
        setHomeItems(uniqById(mapped));
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
        if (!stop) setResults(Array.isArray(j?.metas) ? j.metas : []);
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

  const openPicker = React.useCallback(async (id: string) => {
    // 1) Fetch metadata from addon
    const metaRes = await fetch(`${addonBase}/meta/other/${encodeURIComponent(id)}.json`);
    const metaJson = await metaRes.json();
    const m = metaJson?.meta || {};

    // 2) Fetch streams from addon
    const streamRes = await fetch(`${addonBase}/stream/other/${encodeURIComponent(id)}.json`);
    const sJson = await streamRes.json();
    const streams = Array.isArray(sJson?.streams) ? sJson.streams : [];

    // 3) Populate picker
    setPickerMeta({
      id,
      title: m.name || "Untitled",
      author: m?.audiobook?.author || "",
      cover: m.poster || undefined,
    });
    setPickerStreams(streams);
    setPickerOpen(true);
  }, [addonBase]);

  const chooseStream = React.useCallback(
    (s: StreamItem) => {
      if (!pickerMeta) return;
      setCurrent({
        id: pickerMeta.id,
        title: pickerMeta.title ?? (pickerMeta as any).name ?? "Playing",
        author: pickerMeta.author,
        src: s.url,
        sourceTitle: s.title || s.name,
        chapters: (pickerMeta as any).chapters,
        duration: s.duration ?? (pickerMeta as any).duration,
        cover: (pickerMeta as any).cover,
      });

      // attempt immediate playback
      const a = (window as any).__abAudioEl as HTMLAudioElement | undefined;
      if (a) {
        try {
          if (a.src !== s.url) {
            a.src = s.url;
            a.load();
          }
          void a.play();
        } catch (err) {
          console.warn("Autoplay blocked:", err);
        }
      }

      setPickerOpen(false);
    },
    [pickerMeta]
  );

  /* ------------------------------ Search view ------------------------------- */

  const SearchView = () => {
    const deduped = uniqById(results);
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
              onClick={() => openPicker(b.id)}
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
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[80px_minmax(0,1fr)]">
      {/* Sidebar / Rail */}
      <aside className="border-r border-white/10 bg-white/5 backdrop-blur p-2
                  flex flex-col items-center gap-2
                  md:sticky md:top-0 md:h-[100dvh]">
        <Sidebar activeTab={tab} onChange={setTab} />
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0f1118]/50 backdrop-blur">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-3">
            <TopBar query={query} setQuery={setQuery} />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 flex justify-center px-4 pt-6 pb-28 md:px-4">
          <div className="w-full max-w-[1440px]">
            {query.trim() ? (
              <ErrorBoundary>
                <SearchView />
              </ErrorBoundary>
            ) : tab === "discover" ? (
              // NEW: Audible-style Home using add-on catalog
              <ErrorBoundary>
                {homeError ? (
                  <div className="px-1 py-2 text-white/70">Failed to load catalog.</div>
                ) : (
                  <Home
                    heading="Explore new Audible-style picks"
                    items={homeItems}
                    onOpen={openPicker}
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

      {/* Picker + Player */}
      <StreamPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta?.title}
        author={pickerMeta?.author}
        cover={pickerMeta?.cover}
        streams={pickerStreams}
        onChoose={chooseStream}
      />

      <footer className="fixed bottom-0 left-0 md:left-[80px] right-0 h-[84px] border-t border-white/10 bg-[#0e1117]/90 backdrop-blur">
        <div className="mx-auto flex h-full w-full max-w-[1440px] items-center px-4">
          <Player
            id={current?.id}
            title={current?.title}
            author={current?.author}
            src={current?.src || ""}
            sourceTitle={current?.sourceTitle}
            chapters={current?.chapters}
            duration={current?.duration}
          />
        </div>
      </footer>
    </div>
  );

  return <>{body}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
