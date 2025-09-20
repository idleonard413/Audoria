import React from "react";

export type StreamItem = {
  url: string;
  title?: string;
  mime?: string;
  name?: string;
  headers?: Record<string, string>;
  duration?: number;
};

export type StreamSourceGroup = {
  addonId: string;
  addonName: string;
  addonUrl: string;
  streams: StreamItem[];
  error?: string | null;
};

function isPlayable(stream: StreamItem) {
  if (stream.mime && stream.mime.startsWith("audio/")) return true;
  return /\.m4b(\?|$)/i.test(stream.url) || /\.mp3(\?|$)/i.test(stream.url);
}

function inferMime(stream: StreamItem) {
  if (stream.mime) return stream.mime;
  const match = stream.url.match(/\.(mp3|m4b)(\?|$)/i);
  if (!match) return "Unknown format";
  return match[1].toLowerCase() === "mp3" ? "audio/mpeg" : "audio/x-m4b";
}

function sourceLabel(stream: StreamItem) {
  if (stream.title) return stream.title;
  if (stream.name) return stream.name;
  try {
    const url = new URL(stream.url);
    if (url.pathname && url.pathname !== "/") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length) return segments[segments.length - 1];
    }
    return url.hostname;
  } catch {
    return stream.url;
  }
}

function fmtDuration(sec?: number) {
  if (!sec || !isFinite(sec)) return "";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(hours > 0 ? 2 : 1, "0");
  const seconds = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  title?: string;
  author?: string;
  cover?: string;
  groups: StreamSourceGroup[];
  onChoose: (payload: { stream: StreamItem; group: StreamSourceGroup }) => void;
};

export default function StreamPicker({
  open,
  onClose,
  loading = false,
  title,
  author,
  cover,
  groups,
  onChoose,
}: Props) {
  if (!open) return null;

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const hasGroups = Array.isArray(groups) && groups.length > 0;
  const hasPlayable = hasGroups && groups.some((group) => group.streams?.some?.((stream) => isPlayable(stream)));
  const showEmptyState = !loading && (!hasGroups || !hasPlayable);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0, 0, 0, 0.55)", backdropFilter: "blur(6px)" }}
      onClick={handleOverlayClick}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, 92vw)",
          borderRadius: 16,
          overflow: "hidden",
          background: "#11141a",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "80vh",
        }}
      >
        <div style={{ display: "flex", gap: 16, padding: 16, borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
          {cover ? (
            <img src={cover} alt="" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover" }} />
          ) : null}
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 800 }}>{title || "Choose a source"}</div>
            {author ? <div style={{ opacity: 0.8, fontSize: 13 }}>{author}</div> : null}
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {loading ? "Fetching sources..." : "Select a stream from the available add-ons."}
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 16px", overflowY: "auto", flex: 1 }}>
          {loading ? <div style={{ padding: 12, opacity: 0.8 }}>Loading sources...</div> : null}
          {showEmptyState ? (
            <div style={{ padding: 12, opacity: 0.8 }}>No playable streams found from the installed add-ons.</div>
          ) : null}

          {groups.map((group) => {
            const playable = (group.streams || []).filter((stream) => isPlayable(stream));
            const fallback = (group.streams || []).filter((stream) => !isPlayable(stream));
            return (
              <div
                key={group.addonId}
                style={{ border: "1px solid rgba(255, 255, 255, 0.06)", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}
              >
                <div style={{ padding: "10px 14px", background: "rgba(255, 255, 255, 0.04)" }}>
                  <div style={{ fontWeight: 700 }}>{group.addonName || group.addonUrl}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{group.addonUrl}</div>
                  {group.error ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#fca5a5" }}>Error: {group.error}</div>
                  ) : null}
                  {!group.error && !playable.length && !loading ? (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>This add-on did not return playable streams.</div>
                  ) : null}
                </div>

                {playable.map((stream, index) => (
                  <button
                    key={`${group.addonId}-playable-${index}`}
                    onClick={() => onChoose({ stream, group })}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 16px",
                      cursor: "pointer",
                      background: "transparent",
                      border: 0,
                      color: "#e6e7ea",
                      borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                    }}
                    title={stream.url}
                  >
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          display: "grid",
                          placeItems: "center",
                          background: "rgba(255, 255, 255, 0.08)",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        SRC
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{sourceLabel(stream)}</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          {inferMime(stream)}
                          {stream.duration ? ` | ${fmtDuration(stream.duration)}` : ""}
                        </div>
                      </div>
                      <div className="badge">Play</div>
                    </div>
                  </button>
                ))}

                {fallback.length ? (
                  <div style={{ padding: "10px 16px", fontSize: 12, opacity: 0.75, borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
                    Other sources from this add-on (not directly playable):
                    <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                      {fallback.map((stream, index) => (
                        <li key={`${group.addonId}-fallback-${index}`} style={{ marginBottom: 4 }}>
                          <a
                            href={stream.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#8ab4f8", textDecoration: "underline" }}
                          >
                            {stream.title || stream.name || stream.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={{ padding: 12, display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255, 255, 255, 0.15)",
              background: "rgba(255, 255, 255, 0.06)",
              color: "#e6e7ea",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
