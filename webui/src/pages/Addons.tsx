import React from "react";

export default function Addons() {
  return (
    <div className="container">
      <div className="section-title"><h2>Add-ons</h2><span className="pill">Connect audiobook sources</span></div>
      <p style={{opacity:.8}}>Add-ons supply catalogs, metadata and audio streams. This Audiobook app is compatible with Stremio's add-on protocol; for audiobooks, use the <code>type: "other"</code> with <code>idPrefix: "audiobook:"</code> or implement the audiobook extension proposal in the README.</p>
      <ul>
        <li>Paste manifest URL</li>
        <li>Enable/disable add-ons</li>
        <li>Reorder priority</li>
      </ul>
    </div>
  );
}