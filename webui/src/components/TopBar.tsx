import React from "react";

export default function TopBar({ query, setQuery }:{ query:string; setQuery:(v:string)=>void }) {
  return (
    <div className="topbar">
      <div className="topbar-wrap">
        <div className="searchbar">
          <span>🔎</span>
          <input
            placeholder="Search or paste link"
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
          />
        </div>
        <div className="top-actions">
          <div className="action-btn" title="Fullscreen">⛶</div>
          <div className="action-btn" title="Account">👤</div>
        </div>
      </div>
    </div>
  );
}
