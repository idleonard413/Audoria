import React from "react";

type Props = {
  poster?: string | null;
  title: string;
  author?: string;
  onClick?: () => void;
  /** optional: used by shelves for tooltips/labels if you want later */
  durationSec?: number;
  /** optional: 0..100 – draw a progress strip over the art */
  progressPct?: number;
};

export default function AudiobookCard({
  poster,
  title,
  author,
  onClick,
  durationSec,   // (kept for compatibility / future use)
  progressPct,   // (optional visual)
}: Props) {
  // clamp to 0..100 if provided
  const pct = typeof progressPct === "number"
    ? Math.max(0, Math.min(100, progressPct))
    : null;

  return (
    <div className="ab-card" onClick={onClick} title={title}>
      <div className="ab-art">
        {poster ? (
          <img src={poster} alt={title} loading="lazy" />
        ) : (
          <div className="ab-fallback">No cover</div>
        )}

        {pct !== null ? (
          <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        ) : null}
      </div>

      <div className="ab-meta">
        <div className="ab-title">{title}</div>
        {author ? <div className="ab-author">{author}</div> : null}
      </div>
    </div>
  );
}
