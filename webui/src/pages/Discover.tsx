import React from "react";
import AudiobookCard from "../components/AudiobookCard";
import { fetchContinue } from "../lib/progress";

/**
 * Continue Listening shelf
 */
function ContinueShelf({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = React.useState<Array<{
    id: string;
    title?: string;
    author?: string;
    poster?: string | null;
    progressPct?: number;
  }>>([]);

  React.useEffect(() => {
    let alive = true;
    fetchContinue(20).then((d) => {
      if (!alive) return;
      setItems(d.items || []);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!items.length) return null;

  return (
    <section className="container">
      <div className="row-head">
        <div className="row-title">Continue Listening</div>
      </div>
      <div className="row">
        {items.map((it) => (
          <AudiobookCard
            key={it.id}
            title={it.title || "Untitled"}
            author={it.author || ""}
            poster={it.poster || undefined}
            progressPct={it.progressPct || 0}
            onClick={() => onOpen(it.id)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Discover page
 * Expects parent to pass openItem(id) that opens the selected audiobook.
 */
export default function Discover({ openItem }: { openItem: (id: string) => void }) {
  return (
    <div className="container">
      {/* New shelf at the top */}
      <ContinueShelf onOpen={openItem} />

      {/* TODO: Keep your existing sections below.
          Example placeholder section (safe to delete/replace): */}
      <section className="container">
        <div className="row-head">
          <div className="row-title">Featured Audiobooks</div>
        </div>
        <div className="row">
          {/* Render your existing cards here */}
        </div>
      </section>
    </div>
  );
}
