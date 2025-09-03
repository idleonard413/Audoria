import React from "react";
import AudiobookCard from "@/components/AudiobookCard";
import { getAddonBase } from "@/config";

type Meta = {
  id: string;
  type?: string;
  name?: string;
  poster?: string | null;
  author?: string;
  description?: string;
};

function uniqById<T extends { id?: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const id = String(it?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
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
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${ADDON_BASE}/catalog/other/audiobook.popular.json?limit=30`);
        const j = await r.json().catch(() => ({}));
        const metas = Array.isArray(j?.metas) ? j.metas : [];
        if (!alive) return;
        // keep only valid items (with id)
        const cleaned: Meta[] = metas
          .filter((m: any) => m && typeof m.id === "string" && m.id.length > 0)
          .map((m: any) => ({
            id: m.id,
            name: typeof m.name === "string" ? m.name : "Untitled",
            author: typeof m.author === "string" ? m.author : "",
            poster: typeof m.poster === "string" ? m.poster : undefined,
            description: typeof m.description === "string" ? m.description : ""
          }));
        const dd = uniqById(cleaned);
        setItems(dd);
        // one-time log to help diagnose if UI goes blank
        console.debug("Discover metas:", dd);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
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

      {error && <div className="muted" style={{ padding: "1rem 0" }}>{error}</div>}

      <div className="row">
        {items.map((b, i) => (
          <AudiobookCard
            key={`${b.id}#${i}`}
            title={b.name || "Untitled"}
            author={b.author || ""}
            poster={b.poster || undefined}
            onClick={() => openItem(b.id)}
          />
        ))}
      </div>
    </section>
  );
}
