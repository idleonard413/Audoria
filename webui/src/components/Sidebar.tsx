import React from "react";

export default function Sidebar({ active = "home" }: { active?: "home"|"pen"|"calendar"|"gear"|"settings" }) {
  const Item = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <div className={"ico" + (active === id ? " active" : "")} title={id}>{children}</div>
  );
  return (
    <aside className="sidebar">
      <div className="rail">
        <div className="brand">▶︎</div>
        <Item id="home">🏠</Item>
        <Item id="pen">✏️</Item>
        <Item id="calendar">🗓️</Item>
        <Item id="gear">⚙️</Item>
        <Item id="settings">🔧</Item>
      </div>
    </aside>
  );
}
