import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A sliding, swipeable photo carousel for the hotel page's gallery block.
 * Slides pan with CSS transforms, auto-advance every 5s (pauses on hover/touch)
 * with prev/next, dots and a "3 / 8" counter. No external dependencies.
 */
export function GalleryCarousel({
  images,
  altPrefix = "Hotel photo",
  accent = "#0f766e",
  className,
  autoPlay = true,
}: {
  images: string[];
  altPrefix?: string;
  accent?: string;
  className?: string;
  /** Off in the builder canvas — slides sliding under the owner's cursor is jarring. */
  autoPlay?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = images.length;

  const go = (next: number) => setIndex(((next % count) + count) % count);

  // Auto-advance.
  useEffect(() => {
    if (!autoPlay || count <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [autoPlay, count, paused]);

  // Deleting photos in the builder can leave `index` past the end. Auto-play is
  // off there, so nothing would ever correct it: the strip would sit on a blank
  // frame reading "4 / 2".
  useEffect(() => {
    if (count > 0 && index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  return (
    <div
      className={cn("relative overflow-hidden rounded-2xl border border-border bg-card", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; setPaused(true); }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        touchX.current = null;
        setPaused(false);
      }}
    >
      {/* Track */}
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {images.map((src, i) => (
          <div key={src + i} className="w-full shrink-0 aspect-[16/9] md:aspect-[21/9]">
            <img
              src={src}
              alt={`${altPrefix} ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Arrows */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/60 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/60 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Counter */}
      <span className="absolute bottom-3 right-3 rounded-full bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1">
        {index + 1} / {count}
      </span>

      {/* Dots */}
      {count > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to photo ${i + 1}`}
              onClick={() => go(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80",
              )}
              style={i === index && accent ? { backgroundColor: accent } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}