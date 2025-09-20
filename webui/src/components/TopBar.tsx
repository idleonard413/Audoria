import React from "react";
import MetallicLogo from "@/components/metallic/MetallicLogo";

type TopBarProps = {
  query: string;
  setQuery: (value: string) => void;
  onHome?: () => void;
};

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="11" cy="11" r="6" />
      <line x1="16.65" y1="16.65" x2="21" y2="21" />
    </svg>
  );
}

export default function TopBar({ query, setQuery, onHome }: TopBarProps) {
  return (
    <div className="glass-shell glass-topbar">
      <button
        type="button"
        className="glass-brand"
        onClick={onHome}
        aria-label="Go to home"
        disabled={!onHome}
      >
        <MetallicLogo />
        <span>Audoria</span>
      </button>

      <label className="glass-search" htmlFor="topbar-search">
        <SearchIcon />
        <input
          id="topbar-search"
          type="search"
          placeholder="Search or paste link"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search catalogue"
        />
      </label>
    </div>
  );
}
