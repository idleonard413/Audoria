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
import { getCore } from "@/core";
import StreamPicker, { StreamItem } from "@/components/StreamPicker";
import Login from "./pages/Login";
import { auth } from "./auth/store";
import "./styles/app.css";

// -------- Runtime add-on base helper (no rebuild required) --------
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

// -------- Types --------
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
  // ✅ All hooks declared unconditionally and in the same order
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

  // ---- Effects ----
  // Load current user (JWT) once
  React.useEffect(() => {
    auth.me(ADDON_BASE).then(setUser);
  }, []);

  // Debounced search (pulls up to 10 from addon)
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


  // ---- Callbacks (no hooks inside) ----
  const handleAuthed = React.useCallback(() => {
    auth.me(ADDON_BASE).then(setUser);
  }, []);

  const openPicker = React.useCallback(async (id: string) => {
    const core = await getCore();
    const meta = await core.getMeta(id);
    const streams = await core.getStreams(id);
    setPickerMeta({ id, title: meta.title, author: meta.author, cover: meta.cover });
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

  // ---- Small inline view for search results ----
  const SearchView = () => (
    <div>
      <div className="row-head">
        <div className="row-title">Search</div>
        <div className="muted">{searching ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}</div>
      </div>
      <div className="row-wrap">
        <div className="row">
          {results.map((b: any) => (
            <AudiobookCard
              key={b.id}
              title={b.name || "Untitled"}
              author={b.author}
              poster={b.cover}
              durationSec={b.duration}
              onClick={() => openPicker(b.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );

  // ---- Compute body (no hooks below this line) ----
  const body = !user ? (
    <Login addonBase={ADDON_BASE} onAuthed={handleAuthed} />
  ) : (
    <div className="app">
      <Sidebar />
      <TopBar query={query} setQuery={setQuery} />

      <main className="content">
        {query.trim()
          ? <SearchView />
          : tab === "discover" ? <Discover openItem={openPicker} />
          : tab === "library"  ? <Library />
          : <Addons />}
      </main>

      <StreamPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta?.title}
        author={pickerMeta?.author}
        cover={pickerMeta?.cover}
        streams={pickerStreams}
        onChoose={chooseStream}
      />

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
  );

  return <>{body}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
