import React from "react";

function fmtMin(seconds?: number) {
  if (!seconds || !isFinite(seconds)) return "";
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

export default function AudiobookCard({
  title, author, poster, durationSec, progressPct = 0, onClick,
}: {
  title: string; author?: string; poster?: string; durationSec?: number;
  progressPct?: number; onClick?: () => void;
}) {
  const ref = React.useRef<HTMLDivElement|null>(null);

  // simple tilt on mouse move
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const dx = (e.clientX - cx)/r.width;   // -0.5..0.5
    const dy = (e.clientY - cy)/r.height;  // -0.5..0.5
    el.style.transform = `perspective(700px) rotateX(${(-dy*6).toFixed(2)}deg) rotateY(${(dx*8).toFixed(2)}deg) translateY(-2px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ""; };

  return (
    <div className="ab-card" ref={ref} onMouseMove={onMove} onMouseLeave={reset} onClick={onClick}>
      <div className="ab-thumb">{poster ? <img src={poster} alt={title}/> : <div/>}</div>
      <div className="ab-play"><div className="btn">▶︎</div></div>
      {progressPct > 0 && <div className="progress"><span style={{width:`${Math.min(100, Math.max(0, progressPct*100))}%`}}/></div>}
      <div className="ab-overlay"></div>
      <div className="ab-meta">
        <div className="ab-title">{title}</div>
        {author && <div className="ab-author">{author}</div>}
        <div className="ab-badges">
          {durationSec ? <span className="badge">{fmtMin(durationSec)}</span> : null}
          <span className="badge">Audiobook</span>
        </div>
      </div>
    </div>
  );
}
