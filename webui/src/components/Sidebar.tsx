// src/components/Sidebar.tsx
import React from "react";

export type Tab = "discover" | "library" | "addons";

type Props = {
  activeTab: Tab;
  onChange: (t: Tab) => void;
};

const Btn: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => (
  <button
    className={`w-11 h-11 rounded-xl grid place-items-center transition
      ${active ? "bg-white/15 text-white ring-1 ring-white/10"
               : "text-white/80 hover:bg-white/10"}`}
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
);

export default function Sidebar({ activeTab, onChange }: Props) {
  return (
    <nav className="rail">
      <div className="brand text-sm">A</div>

      <Btn
        active={activeTab === "discover"}
        onClick={() => onChange("discover")}
        title="Discover"
      >
        {/* Home icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z"/>
        </svg>
      </Btn>

      <Btn
        active={activeTab === "library"}
        onClick={() => onChange("library")}
        title="Library"
      >
        {/* Books icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 19h6a2 2 0 002-2V5a2 2 0 00-2-2H4v16zm0 2a2 2 0 002 2h6v-2H6V3H4v18zm10-2h6V3h-6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      </Btn>

      <Btn
        active={activeTab === "addons"}
        onClick={() => onChange("addons")}
        title="Add-ons"
      >
        {/* Puzzle icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 3a2 2 0 012 2v1h2a2 2 0 012 2v2h-1a2 2 0 100 4h1v2a2 2 0 01-2 2h-2v1a2 2 0 11-4 0v-1H8a2 2 0 01-2-2v-2H5a2 2 0 110-4h1V8a2 2 0 012-2h2V5a2 2 0 012-2z"/>
        </svg>
      </Btn>
    </nav>
  );
}
