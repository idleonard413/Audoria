import React from "react";

export default function PosterCard({
  title, poster, onClick, progressPct = 0.4,
}: { title: string; poster?: string; onClick?: ()=>void; progressPct?: number }) {
  return (
    <div className="poster" onClick={onClick}>
      {poster ? <img src={poster} alt={title}/> : <div style={{height:210}}/>}
      <div className="play"><div className="btn">▶︎</div></div>
      {progressPct > 0 ? (
        <div className="progress"><span style={{width:`${Math.min(100, Math.max(0, progressPct*100))}%`}}/></div>
      ) : null}
      <div className="title">{title}</div>
    </div>
  );
}

