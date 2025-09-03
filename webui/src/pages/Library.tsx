// src/pages/Library.tsx
import React from "react";
import BookCard from "@/components/BookCard";

export default function Library() {
  const [items, setItems] = React.useState<any[]>(() => {
    const raw = localStorage.getItem("lib");
    return raw ? JSON.parse(raw) : [];
  });

  // Local import wiring
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const importLocal = () => fileInput.current?.click();
  const onFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files).map((f) => ({
      id: "local:" + f.name + ":" + f.size,
      title: f.name.replace(/\.(mp3|m4b|m4a)$/i, ""),
      author: "Local file",
      url: URL.createObjectURL(f),
    }));
    const cur = JSON.parse(localStorage.getItem("lib") || "[]");
    const next = [...cur, ...list];
    localStorage.setItem("lib", JSON.stringify(next));
    // refresh the in-memory state
    setItems(next);
  };

  React.useEffect(() => {
    const onStorage = () =>
      setItems(JSON.parse(localStorage.getItem("lib") || "[]"));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div className="container">
      <div className="section-title">
        <h2>Your Library</h2>
        <span className="pill">{items.length} items</span>
        <div>
          <button onClick={importLocal}>+ Import audio</button>
          <input
            multiple
            accept=".mp3,.m4b,.m4a,audio/*"
            type="file"
            ref={fileInput}
            onChange={(e) => onFiles(e.target.files)}
            hidden
          />
        </div>
      </div>

      <div className="grid">
        {items.map((b: any) => (
          <BookCard key={b.id} title={b.title} author={b.author} />
        ))}
      </div>
    </div>
  );
}
