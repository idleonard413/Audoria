// src/components/Player.tsx
import React from "react";

type Chapter = { title: string; start: number };

type Props = {
  title?: string;
  author?: string;
  cover?: string;
  src?: string;
  sourceTitle?: string;
  duration?: number;            // seconds (optional; we'll also read from <audio>)
  chapters?: Chapter[];         // optional
  onPrev?: () => void;
  onNext?: () => void;
};

export default function Player(p: Props) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [mediaDur, setMediaDur] = React.useState<number>(0);

  // Prefer prop duration if valid; otherwise use loaded metadata duration
  const duration = (Number.isFinite(p.duration ?? NaN) ? (p.duration as number) : mediaDur) || 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  };

  const seek = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    const next = Math.max(0, Math.min(sec, (a.duration || duration || sec)));
    a.currentTime = next;
    setTime(next);
    if (a.paused) { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, "0");
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };

  const hasUsefulChapters = Array.isArray(p.chapters) && p.chapters.some(c => (c.start || 0) > 0);

  return (
    <>
      {/* Chapters (only if they have starts > 0) */}
      {hasUsefulChapters ? (
        <div style={{
          position: "sticky", bottom: 64, zIndex: 5,
          background: "rgba(15,17,21,.9)", backdropFilter: "saturate(140%) blur(8px)",
          borderTop: "1px solid rgba(255,255,255,.06)", padding: "8px 16px"
        }}>
          <div style={{ fontSize: 12, opacity: .8, marginBottom: 6 }}>Chapters</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>
            {p.chapters!.map((c, i) => (
              <button key={i} onClick={() => seek(c.start)} title={`Go to ${fmt(c.start)}`}
                style={{ textAlign: "left" }}>
                {c.title} <span className="badge">· {fmt(c.start)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="player">
        <div className="player-wrap" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "10px 16px" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 700 }}>{p.title ?? "Nothing playing"}</div>
            <div>
              {p.author ? <span className="badge">{p.author}</span> : null}
              {p.sourceTitle ? <span className="badge" style={{ marginLeft: 6 }}>{p.sourceTitle}</span> : null}
            </div>
          </div>

          <div className="controls" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 420 }}>
            <button onClick={() => seek(Math.max(0, time - 30))} title="Back 30s">⏮︎ 30s</button>
            <button onClick={toggle}>{playing ? "⏸︎ Pause" : "▶︎ Play"}</button>
            <button onClick={() => seek(time + 30)} title="Forward 30s">⏭︎ 30s</button>
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              value={Math.min(time, duration)}
              onChange={(e) => {
                const a = audioRef.current; if (!a) return;
                const v = Number(e.target.value);
                a.currentTime = v;
                setTime(v);
              }}
              style={{ flex: 1 }}
            />
            <div className="badge">{fmt(time)} / {fmt(duration)}</div>
          </div>

          <audio
            ref={audioRef}
            src={p.src}
            crossOrigin="anonymous"
            preload="metadata"
            onLoadedMetadata={(e) => {
              const a = e.currentTarget as HTMLAudioElement;
              if (Number.isFinite(a.duration)) setMediaDur(a.duration);
            }}
            onTimeUpdate={(e) => setTime((e.currentTarget as HTMLAudioElement).currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
      </footer>
    </>
  );
}
