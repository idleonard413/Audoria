import React from "react";
import AudiobookCard from "./AudiobookCard";

export function Row({
  title, items, onClickCard, seeAll,
}: {
  title: string;
  items: { id: string; title: string; author?: string; cover?: string; duration?: number }[];
  onClickCard: (id: string) => void;
  seeAll?: () => void;
}) {
  const scroller = React.useRef<HTMLDivElement|null>(null);

  const scrollBy = (dir: 1|-1) => {
    const el = scroller.current; if (!el) return;
    const step = Math.floor(el.clientWidth * 0.8);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <section>
      <div className="row-head">
        <div className="row-title">{title}</div>
        <div className="see-all" onClick={seeAll}>See All</div>
      </div>
      <div className="row-wrap">
        <button className="row-btn left"  onClick={()=>scrollBy(-1)} aria-label="Scroll left">‹</button>
        <div className="row" ref={scroller}>
          {items.map((it) => (
            <AudiobookCard
              key={it.id}
              title={it.title}
              author={it.author}
              poster={it.cover}
              durationSec={it.duration}
              onClick={() => onClickCard(it.id)}
            />
          ))}
        </div>
        <button className="row-btn right" onClick={()=>scrollBy(1)}  aria-label="Scroll right">›</button>
      </div>
    </section>
  );
}

export function SkeletonRow({ title }: { title: string }) {
  return (
    <section>
      <div className="row-head"><div className="row-title">{title}</div></div>
      <div className="row-wrap">
        <div className="row">
          {Array.from({length:9}).map((_,i)=>(
            <div key={i} style={{width:180}}>
              <div className="skeleton" />
              <div className="ab-author" style={{height:14, marginTop:8, width:"80%"}}>&nbsp;</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
