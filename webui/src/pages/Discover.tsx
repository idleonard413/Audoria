import React from "react";

import { fetchContinue } from "../lib/progress";
import AudiobookCard from "../components/AudiobookCard";

function ContinueShelf({ onOpen }:{ onOpen: (id:string)=>void }){
  const [items, setItems] = React.useState<Array<any>>([]);
  React.useEffect(()=>{ fetchContinue(20).then(d=>setItems(d.items || [])); }, []);
  if (!items.length) return null;
  return (
    <ContinueShelf onOpen={openItem} />

    <section className="container">
      <div className="row-head"><div className="row-title">Continue Listening</div></div>
      <div className="row">
        {items.map(it => (
          <AudiobookCard key={it.id} title={it.title || "Untitled"} author={it.author || ""}
            poster={it.poster || undefined} progressPct={it.progressPct || 0}
            onClick={()=>onOpen(it.id)} />
        ))}
      </div>
    </section>
  );
}

import { getCore } from "@/core";
import { Row, SkeletonRow } from "@/components/Row";
import AudiobookCard from "@/components/AudiobookCard";

export default function Discover({ onPlay }: { onPlay: (id: string) => void }) {
  const [popular, setPopular] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    let ok = true;
    getCore().then(async (core) => {
      const pop = await core.getCatalog("popular");
      if (ok) setPopular(pop);
    });
    return (
    <ContinueShelf onOpen={openItem} />
) => { ok = false; };
  }, []);

  const continueListening = popular?.slice(0, 10) || [];

  return (
    <ContinueShelf onOpen={openItem} />

    <div>
      {/* Continue listening row */}
      <section>
        <div className="row-head">
          <div className="row-title">Continue listening</div>
        </div>
        <div className="row-wrap">
          <div className="row">
            {(continueListening.length ? continueListening : Array.from({length:9}).map((_,i)=>({id:"s"+i}))).map((b:any, idx:number) => (
              <div key={b.id || idx} style={{width:180}}>
                {b.id ? (
                  <AudiobookCard
                    title={b.title}
                    author={b.author}
                    poster={b.cover}
                    durationSec={b.duration}
                    progressPct={0.35}
                    onClick={() => onPlay(b.id)}
                  />
                ) : (
                  <>
                    <div className="skeleton" />
                    <div className="ab-author" style={{height:14, marginTop:8, width:"80%"}}>&nbsp;</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recommended shelves */}
      {popular
        ? (<>
            <Row title="Recommended For You — Audiobooks" items={popular.slice(0,12)} onClickCard={onPlay} />
            <Row title="New & Noteworthy — Audiobooks"   items={popular.slice(0,12)} onClickCard={onPlay} />
          </>)
        : (<>
            <SkeletonRow title="Recommended For You — Audiobooks" />
            <SkeletonRow title="New & Noteworthy — Audiobooks" />
          </>)
      }
    </div>
  );
}
