// src/lib/dedupe.ts

export type MetaLike = {
  id: string;
  name?: string;           // title
  author?: string;
  poster?: string;
  description?: string;
  duration?: number;
  // allow extra fields without typing everything
  [k: string]: any;
};

const cleanTitle = (s = "") =>
  s
    .toLowerCase()
    // remove subtitles after ":" or " - " or "("
    .replace(/[:\-–—(].*$/, "")
    // normalize apostrophes / punctuation
    .replace(/[’'".,!?]/g, "")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

const cleanAuthor = (s = "") =>
  s
    .toLowerCase()
    .replace(/[’'".,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Choose the "better" of two dup candidates */
function better(a: MetaLike, b: MetaLike): MetaLike {
  // Prefer poster
  const pa = Boolean(a.poster), pb = Boolean(b.poster);
  if (pa !== pb) return pa ? a : b;

  // Prefer has duration
  const da = Number.isFinite(a.duration), db = Number.isFinite(b.duration);
  if (da !== db) return da ? a : b;

  // Prefer longer description
  const la = (a.description || "").length, lb = (b.description || "").length;
  if (la !== lb) return la > lb ? a : b;

  // Fallback to more non-empty fields
  const score = (x: MetaLike) =>
    (x.poster ? 1 : 0) + (x.description ? 1 : 0) + (x.author ? 1 : 0);
  const sa = score(a), sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;

  // Finally, stable by id
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/** De-duplicate by normalized (title, author) key */
export function dedupeMetas<T extends MetaLike>(list: T[]): T[] {
  const picked = new Map<string, T>();
  for (const m of list) {
    if (!m || !m.id) continue;
    const key =
      cleanTitle(m.name || m["title"] || "") + "•" + cleanAuthor(m.author || "");
    const prev = picked.get(key);
    if (!prev) {
      picked.set(key, m);
    } else {
      // keep the better one
      picked.set(key, better(prev, m));
    }
  }
  return Array.from(picked.values());
}
