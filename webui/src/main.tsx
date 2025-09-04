// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Discover from "@/pages/Discover";
import Library from "@/pages/Library";
import Addons from "@/pages/Addons";
import Player from "@/components/Player";
import AudiobookCard from "@/components/AudiobookCard";
import StreamPicker, { StreamItem } from "@/components/StreamPicker";
import Login from "./pages/Login";
import { auth } from "./auth/store";
import ErrorBoundary from "./components/ErrorBoundary";

// Tailwind v4 entry + tiny base
import './styles/tailwind.css'
import './styles/base.css'

// -------- helpers --------
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
function getAddonBase(): string {
  const ls = (() => {
    try { return localStorage.getItem("ADDON_BASE") || ""; } catch { return ""; }
  })();
  const win = (window as any).__ADDON_BASE as string | undefined;
  const env = ((import.meta as any)?.env?.VITE_ADDON_URL as string | undefined);
  const guess = `http://${location.hostname}:7000`;
  return (ls || win || env || guess).replace(/\/+$/, "");
}
const ADDON_BASE = getAddonBase();
console.log("ADDON_BASE =", ADDON_BASE);

// -------- types --------
type Tab = "discover" | "library" | "addons";
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

function App() {
  // hooks (stable order)
  const [tab, setTab] = React.useState<Tab>("discover");
  const [current, setCurrent] = React.useState<CurrentTrack | null>(null);

  // search state
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<any[]>([]);

  // auth state
  const [user, setUser] = React.useState<any>(null);

  // stream picker state
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerMeta, setPickerMeta] = React.useState<{ id: string; title?: string; author?: string; cover?: string } | null>(null);
  const [pickerStreams, setPickerStreams] = React.useState<StreamItem[]>([]);

  // load current user (JWT) once
  React.useEffect(() => {
    auth.me(ADDON_BASE).then(setUser);
  }, []);

  // debounced search (pulls up to 10 from addon)
  React.useEffect(() => {
    let stop = false;
    const run = async () => {
      const q = query.trim();
      if (!q) { setResults([]); setSearching(false); return; }
      setSearching(true);
      try {
        const r = await fetch(`${ADDON_BASE}/search.json?q=${encodeURIComponent(q)}&limit=10`);
        const j = await r.json();
        if (!stop) setResults(Array.isArray(j?.metas) ? j.metas : []);
      } catch {
        if (!stop) setResults([]);
      } finally {
        if (!stop) setSearching(false);
      }
    };
    const t = setTimeout(run, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [query]);

  // callbacks
  const handleAuthed = React.useCallback(() => {
    auth.me(ADDON_BASE).then(setUser);
  }, []);

  const openPicker = React.useCallback(async (id: string) => {
    // 1) Fetch metadata from addon
    const metaRes = await fetch(`${ADDON_BASE}/meta/other/${encodeURIComponent(id)}.json`);
    const metaJson = await metaRes.json();
    const m = metaJson?.meta || {};

    // 2) Fetch streams from addon
    const streamRes = await fetch(`${ADDON_BASE}/stream/other/${encodeURIComponent(id)}.json`);
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
  }, []);

  const chooseStream = React.useCallback((s: StreamItem) => {
    if (!pickerMeta) return;
    // Update UI state (title/cover/duration)
    setCurrent({
      id: pickerMeta.id,
      title: pickerMeta.title ?? (pickerMeta as any).name ?? "Playing",
      author: pickerMeta.author,
      src: s.url,
      sourceTitle: s.title || s.name,
      chapters: (pickerMeta as any).chapters,
      duration: s.duration ?? (pickerMeta as any).duration,
      cover: (pickerMeta as any).cover
    });

    // Try to start playback immediately within the same user gesture
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

    setPickerOpen(false); // close picker
  }, [pickerMeta]);

  // ---- Search view (Tailwind grid) ----
  const SearchView = () => {
    const deduped = uniqById(results);
    return (
      <div className="mt-7">
        <div className="flex items-baseline justify-between px-1 mb-3">
          <div className="font-extrabold tracking-tight text-[clamp(16px,1.6vw,20px)]">Search</div>
          <div className="text-white/60 text-xs">
            {searching ? "Searching…" : `${deduped.length} result${deduped.length === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
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

  // ---- Body (no hooks below) ----
  const body = !user ? (
    <Login addonBase={ADDON_BASE} onAuthed={handleAuthed} />
  ) : (
    <div className="min-h-screen grid grid-cols-[72px_1fr] md:grid-cols-1">
      {/* Sidebar / Rail */}
      <aside className="border-r border-white/10 bg-white/5 backdrop-blur p-2 flex flex-col items-center gap-2">
        <Sidebar />
      </aside>

      {/* Main column */}
      <div className="flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0f1118]/50 backdrop-blur">
          <div className="w-full max-w-[1440px] mx-auto px-4 py-3">
            <TopBar query={query} setQuery={setQuery} />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 flex justify-center px-4 md:px-4 pt-6 pb-28">
          <div className="w-full max-w-[1440px]">
            {query.trim()
              ? <ErrorBoundary><SearchView /></ErrorBoundary>
              : tab === "discover" ? <ErrorBoundary><Discover openItem={openPicker} /></ErrorBoundary>
              : tab === "library"  ? <ErrorBoundary><Library /></ErrorBoundary>
              : <ErrorBoundary><Addons /></ErrorBoundary>}
          </div>
        </main>
      </div>

      {/* Picker + Player (outside scrolling content) */}
      <StreamPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta?.title}
        author={pickerMeta?.author}
        cover={pickerMeta?.cover}
        streams={pickerStreams}
        onChoose={chooseStream}
      />

      <footer className="fixed left-[72px] md:left-0 right-0 bottom-0 h-[84px] bg-[#0e1117]/90 border-t border-white/10 backdrop-blur">
        <div className="w-full max-w-[1440px] mx-auto h-full px-4 flex items-center">
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
