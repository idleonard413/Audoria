import React from "react";
import AudibleCard from "@/components/AudibleCard";

type Item = { id: string; title: string; author?: string; cover?: string; badge?: string };

export default function Home({
  items,
  onOpen,
  heading = "Explore new Audible Originals and exclusives",
}: {
  items: Item[];
  onOpen: (id: string) => void;
  heading?: string;
}) {
  return (
    <section className="mx-auto w-full max-w-[1440px] px-4">
      <h2 className="mb-4 mt-6 text-[22px] font-extrabold tracking-tight">{heading}</h2>

      <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
        {items.map((b, i) => (
          <AudibleCard
            key={`${b.id}#${i}`}
            cover={b.cover}
            title={b.title}
            author={b.author}
            badge={b.badge}              /* e.g., "1 CREDIT" */
            onClick={() => onOpen(b.id)}
          />
        ))}
      </div>
    </section>
  );
}
