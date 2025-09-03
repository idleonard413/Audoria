import React from "react";

export type StreamItem = {
  url: string;
  title?: string;
  mime?: string;
  name?: string;
  headers?: Record<string,string>;
  duration?: number; // seconds (optional)
};

function isPlayable(s: StreamItem) {
  return (s.mime && s.mime.startsWith("audio/")) || /\.m4b(\?|$)/i.test(s.url) || /\.mp3(\?|$)/i.test(s.url);
}

function sourceLabel(s: StreamItem) {
  const label = s.title || s.name || "Source";
  const host = (() => { try { return new URL(s.url).host; } catch { return ""; } })();
  return host ? `${label} — ${host}` : label;
}

function fmtDur(sec?: number) {
  if (!sec || !isFinite(sec)) return "";
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  const mm = h > 0 ? String(m).padStart(2,"0") : String(m);
  const ss = String(s).padStart(2,"0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function StreamPicker({
  open, onClose, title, author, cover, streams, onChoose
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  author?: string;
  cover?: string;
  streams: StreamItem[];
  onChoose: (s: StreamItem) => void;
}) {
  if (!open) return null;

  const playable = streams.filter(isPlayable);
  const others   = streams.filter(s => !isPlayable(s));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(700px, 92vw)", borderRadius: 16, overflow: "hidden",
          background: "#11141a", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 18px 48px rgba(0,0,0,.5)"
        }}
      >
        <div style={{ display: "flex", gap: 16, padding: 16, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          {cover ? <img src={cover} alt="" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover" }} /> : null}
          <div style={{ display: "grid" }}>
            <div style={{ fontWeight: 800 }}>{title}</div>
            {author ? <div style={{ opacity: .8, fontSize: 13 }}>{author}</div> : null}
            <div style={{ fontSize: 12, opacity: .7 }}>Choose a source</div>
          </div>
        </div>

        <div style={{ maxHeight: "50vh", overflowY: "auto", padding: 8 }}>
          {playable.length === 0 ? (
            <div style={{ padding: 16, opacity: .8 }}>No direct MP3/M4B sources found for this title.</div>
          ) : playable.map((s, i) => (
            <button
              key={`p-${i}`}
              onClick={() => onChoose(s)}
              style={{
                width: "100%", textAlign: "left", padding: "12px 16px", cursor: "pointer",
                background: "transparent", border: "0", color: "#e6e7ea",
                borderBottom: "1px solid rgba(255,255,255,.06)"
              }}
              title={s.url}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center",
                              background: "rgba(255,255,255,.08)" }}>
                  🎧
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{sourceLabel(s)}</div>
                  <div style={{ fontSize: 12, opacity: .8 }}>
                    {s.mime || (s.url.match(/\.(mp3|m4b)(\?|$)/i)?.[1] === "mp3" ? "audio/mpeg" : "audio/x-m4b")}
                    {s.duration ? ` • ${fmtDur(s.duration)}` : ""}
                  </div>
                </div>
                <div className="badge">Play</div>
              </div>
            </button>
          ))}

          {others.length ? (
            <div style={{ padding: "10px 16px", fontSize: 12, opacity: .75 }}>
              Other sources (not directly playable): {others.map((s)=>s.title || s.name || s.url).join(", ")}
            </div>
          ) : null}
        </div>

        <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)",
                     background: "rgba(255,255,255,.06)", color: "#e6e7ea", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
