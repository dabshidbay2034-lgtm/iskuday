import { useState, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";

interface ImageGalleryProps {
  images: string[];
  title: string;
}

/**
 * Spread onto the first slide only. The camelCase `fetchPriority` prop that
 * @types/react advertises is a React 19 feature — React 18's DOM does not know
 * it, forwards it verbatim and logs an unknown-prop warning on every render.
 * The lowercase attribute is what the browser actually reads, and a spread is
 * the only way to hand it over without the types rejecting it.
 */
const LCP_PRIORITY = { fetchpriority: "high" } as React.ImgHTMLAttributes<HTMLImageElement>;

const ImageGallery = ({ images, title }: ImageGalleryProps) => {
  const displayImages = images.length > 0 ? images : ["/placeholder.svg"];
  const [current, setCurrent] = useState(0);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    dragFree: false,
    containScroll: "trimSnaps",
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrent(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  );

  const canPrev = current > 0;
  const canNext = current < displayImages.length - 1;

  return (
    <div className="relative w-full">
      {/* Embla carousel */}
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex">
          {displayImages.map((src, i) => (
            <div
              key={i}
              className="flex-[0_0_100%] min-w-0 aspect-[4/3] md:aspect-[2.5/1]"
            >
              {/* Only the first slide is on screen at load — it is the LCP, so
                  it stays eager and gets priority. Every other slide used to
                  download eagerly too, which on a 17-photo listing meant the
                  whole gallery came down before the page settled. No width/
                  height attributes: the slide wrapper already reserves the box
                  via its aspect-[4/3] class, and the image is stretched to fill
                  it, so any intrinsic pair we wrote here would be a guess CSS
                  immediately overrides. */}
              <img
                src={src}
                alt={`${title} - photo ${i + 1}`}
                className="w-full h-full object-cover"
                draggable={false}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                {...(i === 0 ? LCP_PRIORITY : {})}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Nav arrows (desktop) */}
      {displayImages.length > 1 && (
        <>
          <button
            onClick={() => emblaApi?.scrollPrev()}
            className={`hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm items-center justify-center shadow-elevated hover:bg-card transition-all ${
              !canPrev ? "opacity-30 pointer-events-none" : ""
            }`}
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <button
            onClick={() => emblaApi?.scrollNext()}
            className={`hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm items-center justify-center shadow-elevated hover:bg-card transition-all ${
              !canNext ? "opacity-30 pointer-events-none" : ""
            }`}
          >
            <ChevronRight className="w-5 h-5 text-foreground" />
          </button>
        </>
      )}

      {/* Dots / counter indicator */}
      {displayImages.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {displayImages.length <= 10 ? (
            displayImages.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollTo(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === current
                    ? "bg-primary-foreground w-5"
                    : "bg-card/60 w-2"
                }`}
              />
            ))
          ) : (
            <span className="bg-card/80 backdrop-blur-sm text-foreground text-xs font-medium px-2.5 py-1 rounded-full">
              {current + 1} / {displayImages.length}
            </span>
          )}
        </div>
      )}

      {/* Thumbnail strip (desktop) */}
      {displayImages.length > 1 && (
        <div className="hidden md:flex gap-2 mt-2 overflow-x-auto px-1 pb-1">
          {displayImages.map((src, i) => (
            <button
              key={i}
              onClick={() => scrollTo(i)}
              className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                i === current
                  ? "border-primary ring-1 ring-primary/30"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* Desktop-only strip below the fold; the w-16 h-12 box gives us
                  real intrinsic dimensions to hand the browser. */}
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                width={64}
                height={48}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageGallery;
