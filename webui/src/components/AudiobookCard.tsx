// src/components/AudiobookCard.tsx
import React from "react";

export default function AudiobookCard({
  poster,
  title,
  author,
  onClick
}: {
  poster?: string | null;
  title: string;
  author?: string;
  onClick?: () => void;
}) {
  return (
    <div className="ab-card" onClick={onClick} title={title}>
      <div className="ab-art">
        {poster ? (
          <img src={poster} alt={title} loading="lazy" />
        ) : (
          <div className="ab-fallback">No cover</div>
        )}
      </div>
      <div className="ab-meta">
        <div className="ab-title">{title}</div>
        {author ? <div className="ab-author">{author}</div> : null}
      </div>
    </div>
  );
}
