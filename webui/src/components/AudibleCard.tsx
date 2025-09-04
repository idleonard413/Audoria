import React from "react";

type Props = {
  cover?: string | null;
  title: string;
  author?: string;
  badge?: string;         // e.g., "1 CREDIT", "FREE", etc.
  onClick?: () => void;
};

export default function AudibleCard({ cover, title, author, badge, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="group text-left"
      title={title}
    >
      <div
        className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-card)]
                   bg-black/20 shadow-[var(--shadow-card)] transition-transform
                   group-hover:-translate-y-0.5 group-active:translate-y-0"
      >
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="block h-full w-full object-cover object-center"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-white/60">
            No cover
          </div>
        )}

        {/* corner ribbon (optional) */}
        {/* <div className="absolute right-0 top-0">
          <div className="origin-top-right rotate-45 translate-x-[28%] -translate-y-[65%]
                          bg-brand text-black font-bold text-[10px] tracking-wide px-4 py-1 shadow">
            ONLY FROM AUDORIA
          </div>
        </div> */}
      </div>

      <div className="mt-3 space-y-1">
        <div className="line-clamp-2 font-semibold leading-tight text-[15px]">
          {title}
        </div>
        {author && (
          <div className="text-[13px] text-ink-muted">
            By: <span className="text-white/90">{author}</span>
          </div>
        )}

        {badge && (
          <div className="mt-1 inline-flex items-center rounded-sm border border-brand/40
                          bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">
            {badge}
          </div>
        )}
      </div>
    </button>
  );
}
