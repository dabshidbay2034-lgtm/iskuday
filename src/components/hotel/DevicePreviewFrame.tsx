import { cn } from "@/lib/utils";

/**
 * A responsive-preview frame for the page builder canvas.
 *
 * HONEST LIMITATION — READ BEFORE TRUSTING THIS TOGGLE
 * ----------------------------------------------------
 * This constrains the WIDTH OF A DIV. Tailwind's `md:` / `lg:` breakpoints are
 * viewport media queries, so they keep matching the real browser window no
 * matter how narrow we make this box. At the 390px "mobile" setting the hero
 * still renders its `md:` desktop classes — big type, side-by-side columns —
 * squeezed into a phone-width column. The layout you see is therefore a
 * plausible sketch, not what a phone will render.
 *
 * The accurate fix is an `<iframe>`: media queries inside an iframe resolve
 * against the iframe's own viewport. We deliberately did not do that for v1
 * because it means cloning every `<style>`/`<link>` from `document.head` into
 * the frame on mount, re-cloning them whenever Vite HMR swaps a stylesheet, and
 * re-parenting the React tree through a portal — a lot of moving parts for a
 * preview toggle. Container queries (`@container`) in the page sections would
 * be the other real fix, and would require touching every section component.
 *
 * Until one of those lands, we tell the user the truth: DEVICE_APPROXIMATE_NOTE
 * is rendered under the frame in every non-desktop mode. Do not remove it and
 * do not describe this preview as pixel-accurate.
 */

export type DeviceMode = "desktop" | "tablet" | "mobile";

/** Frame width in CSS pixels. `null` means "fill the canvas" (desktop). */
export const DEVICE_WIDTHS: Record<DeviceMode, number | null> = {
  desktop: null,
  tablet: 834,
  mobile: 390,
};

export const DEVICE_APPROXIMATE_NOTE =
  "Approximate preview. Responsive breakpoints follow your browser window, not the frame, so some desktop styling may still show.";

export const DEVICE_LABELS: Record<DeviceMode, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

export interface DevicePreviewFrameProps {
  device: DeviceMode;
  children: React.ReactNode;
  className?: string;
}

export function DevicePreviewFrame({ device, children, className }: DevicePreviewFrameProps): JSX.Element {
  const width = DEVICE_WIDTHS[device];
  const isDesktop = width === null;

  return (
    <div className={cn("w-full flex flex-col items-center", className)}>
      <div
        data-device={device}
        aria-label={`${DEVICE_LABELS[device]} preview`}
        className={cn(
          // Animate `width` rather than `max-width`: max-width has to
          // interpolate from a percentage to a pixel length, which some engines
          // refuse to tween. Width + `max-width: 100%` keeps the frame from
          // overflowing a canvas narrower than the requested device.
          "max-w-full transition-[width] duration-300 ease-out",
          !isDesktop && "rounded-[1.75rem] border border-border bg-card shadow-elevated overflow-hidden",
        )}
        style={{ width: isDesktop ? "100%" : `${width}px` }}
      >
        {children}
      </div>

      {!isDesktop && (
        <p role="note" className="mt-3 px-4 max-w-md text-center text-xs leading-relaxed text-muted-foreground">
          {DEVICE_APPROXIMATE_NOTE}
        </p>
      )}
    </div>
  );
}

export default DevicePreviewFrame;
