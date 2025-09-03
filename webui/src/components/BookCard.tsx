import React from "react";

type Props = {
  title: string;
  author?: string;
  cover?: string;
  onClick?: () => void;
};
export default function BookCard({ title, author, cover, onClick }: Props) {
  return (
    <div className="card" onClick={onClick} role="button" tabIndex={0}>
      <div className="thumb">{cover ? <img src={cover} alt={title} /> : title}</div>
      <div className="title">{title}</div>
      <div className="subtitle">{author}</div>
    </div>
  );
}