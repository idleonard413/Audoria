// src/components/Player.tsx
import React from "react";
import { saveProgress } from "../lib/progress";

type Chapter = { title: string; start: number };

type Props = {
  id?: string;
  title?: string;
  author?: string;
  cover?: string;
  src?: string;
  sourceTitle?: string;
  duration?: number;
  chapters?: Chapter[];
  onPrev?: () => void;
  onNext?: () => void;
  floatOffset?: number;
};

const SKIP_SECONDS = 30;

export default function Player(p: Props) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const PROG_INTERVAL = 5000;
  React.useEffect(() => {
    const a = audioRef.current;
    if (!a || !p.id) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const position = Math.floor(a.currentTime || 0);
      const duration = Math.floor((p.duration ?? a.duration) || 0);
      saveProgress({
        item_id: p.id!,
        position_sec: position,
        duration_sec: duration || undefined,
        title: p.title,
        author: p.author,
        poster: p.cover,
        src: p.src,
      });
    };
    const onPlay = () => {
      tick();
      timer = setInterval(tick, PROG_INTERVAL);
    };
    const onPause = () => {
      tick();
      if (timer) clearInterval(timer);
    };
    const onSeeked = () => tick();

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("seeked", onSeeked);
    window.addEventListener("beforeunload", tick);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("beforeunload", tick);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("seeked", onSeeked);
    };
  }, [p.id, p.src, p.duration, p.author, p.cover, p.title]);

  React.useEffect(() => {
    (window as any).__abAudioEl = audioRef.current || null;
    return () => {
      (window as any).__abAudioEl = null;
    };
  }, []);

  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [mediaDur, setMediaDur] = React.useState<number>(0);

  const duration = (Number.isFinite(p.duration ?? NaN) ? (p.duration as number) : mediaDur) || 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    const next = Math.max(0, Math.min(sec, a.duration || duration || sec));
    a.currentTime = next;
    setTime(next);
    if (a.paused) {
      void a.play();
      setPlaying(true);
    }
  };

  const fmt = (seconds: number) => {
    if (!Number.isFinite(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
  };

  const hasUsefulChapters = Array.isArray(p.chapters) && p.chapters.some((c) => (c.start || 0) > 0);
  const chapterOffset = (p.floatOffset ?? 120) + 24;

  return (
    <>
      {hasUsefulChapters ? (
        <div
          className="glass-shell glass-chapters"
          style={{ position: "sticky", bottom: chapterOffset, zIndex: 5 }}
        >
          <div className="glass-chapters__title">Chapters</div>
          <div className="glass-chapters__grid">
            {p.chapters!.map((chapter, index) => (
              <button
                key={index}
                type="button"
                className="glass-chapters__button"
                onClick={() => seek(chapter.start)}
                title={`Go to ${fmt(chapter.start)}`}
              >
                {chapter.title}
                <span className="badge">{fmt(chapter.start)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="player glass-shell glass-player">
        <div className="player__meta">
          <div className="player__title">{p.title ?? "Nothing playing"}</div>
          <div className="player__badges">
            {p.author ? <span className="badge">{p.author}</span> : null}
            {p.sourceTitle ? <span className="badge">{p.sourceTitle}</span> : null}
          </div>
        </div>

        <div className="player__controls">
          <button
            type="button"
            className="player__button"
            onClick={() => seek(Math.max(0, time - SKIP_SECONDS))}
            title={`Back ${SKIP_SECONDS} seconds`}
            aria-label={`Rewind ${SKIP_SECONDS} seconds`}
          >
            {"<< "}{SKIP_SECONDS}s
          </button>
          <button
            type="button"
            className="player__button"
            onClick={toggle}
            title={playing ? "Pause playback" : "Play"}
            aria-pressed={playing}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="player__button"
            onClick={() => seek(time + SKIP_SECONDS)}
            title={`Forward ${SKIP_SECONDS} seconds`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            {">> "}{SKIP_SECONDS}s
          </button>
          <input
            className="player__scrubber"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(time, duration)}
            onChange={(event) => {
              const a = audioRef.current;
              if (!a) return;
              const value = Number(event.target.value);
              a.currentTime = value;
              setTime(value);
            }}
          />
          <div className="player__time">
            {fmt(time)} / {fmt(duration)}
          </div>
        </div>

        <audio
          ref={audioRef}
          src={p.src}
          crossOrigin="anonymous"
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const element = event.currentTarget as HTMLAudioElement;
            if (Number.isFinite(element.duration)) setMediaDur(element.duration);
          }}
          onTimeUpdate={(event) => setTime((event.currentTarget as HTMLAudioElement).currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      </footer>
    </>
  );
}



