import React from "react";
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
    return () => { ok = false; };
  }, []);

  const continueListening = popular?.slice(0, 10) || [];

  return (
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
