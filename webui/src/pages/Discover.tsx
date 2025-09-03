import React from "react";
import AudiobookCard from "@/components/AudiobookCard";
import { getAddonBase } from "@/config";

type Meta = {
  id: string;
  type: "other";
  name: string;
  poster?: string | null;
  author?: string;
  description?: string;
};

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

export default function Discover({ openItem }: { openItem: (id: string) => void }) {
  const ADDON_BASE = getAddonBase();
  const [items, setItems] = React.useState<Meta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(`${ADDON_BASE}/catalog/other/audiobook.popular.json?limit=30`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        const metas: Meta[] = Array.isArray(j?.metas) ? j.metas : [];
        setItems(uniqById(metas));
      })
      .catch(e => { if (alive) setError(e?.message || "Failed to load"); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [ADDON_BASE]);

  return (
    <section className="container">
      <div className="row-head">
        <div className="row-title">Popular Audiobooks</div>
        <div className="muted">
          {loading ? "Loading…" : error ? "Error" : `${items.length} titles`}
        </div>
      </div>

      {error ? (
        <div className="muted" style={{ padding: "1rem 0" }}>{error}</div>
      ) : (
        <div className="row">
          {items.map((b, i) => (
            <AudiobookCard
              key={`${b.id}#${i}`}
              title={b.name || "Untitled"}
              author={b.author || ""}
              poster={b.poster || undefined}   // already proxied via /img
              onClick={() => openItem(b.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
