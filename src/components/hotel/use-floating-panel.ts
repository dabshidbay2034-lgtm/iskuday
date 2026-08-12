import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Positioning for a floating inspector panel that edits a block in the canvas.
 *
 * THE FAILURE MODE THIS HOOK EXISTS TO PREVENT
 * --------------------------------------------
 * A floating panel is chosen over a split pane so the canvas can be full width.
 * The price is that the panel is free to land on top of the very block it is
 * editing — you click a headline, the editor for it covers the headline, and
 * you cannot see what you are typing. So the panel is only ever placed BESIDE
 * the anchor horizontally (right, else left). The vertical position is then
 * clamped freely, because two boxes that do not overlap on the x-axis cannot
 * overlap at all, whatever we do to y.
 *
 * When neither side fits — a narrow window, or a full-bleed hero that spans the
 * viewport — there is no "beside", so we dock to the bottom of the screen as a
 * bar. That CAN cover the anchor if the anchor sits at the very bottom; the
 * integrator should reserve bottom padding on the canvas in `bottom` placement.
 * We cap the bar's height so it never swallows the page.
 */

export type Placement = "right" | "left" | "bottom";

const DEFAULT_PANEL_WIDTH = 340;
const DEFAULT_MARGIN = 16;
/** Below this viewport width a side panel cannot fit next to anything usable. */
const MOBILE_BREAKPOINT = 768;
/** The docked bar must leave most of the canvas visible. */
const BOTTOM_MAX_HEIGHT = "45vh";
const PANEL_Z_INDEX = 50;

export interface FloatingPanelOptions {
  /** The selected block in the canvas. `null` while nothing is selected. */
  anchor?: HTMLElement | null;
  /**
   * Preferred over `anchor`: re-resolved on every measure, so a caller whose
   * DOM node gets replaced between renders can't end up pointing at a detached
   * element (which reads as "no anchor" and hides the panel).
   */
  anchorSelector?: string;
  enabled: boolean;
  panelWidth?: number;
  margin?: number;
}

export interface FloatingPanelResult {
  style: React.CSSProperties;
  placement: Placement;
  /** Attach to the panel element so its real height can be measured. */
  ref: React.RefObject<HTMLDivElement>;
}

interface PanelPosition {
  style: React.CSSProperties;
  placement: Placement;
}

/**
 * Parked off-screen rather than `display: none` so the panel still has layout
 * and the ResizeObserver can measure its height before the first placement.
 */
const HIDDEN_POSITION: PanelPosition = {
  placement: "right",
  style: {
    position: "fixed",
    top: 0,
    left: 0,
    zIndex: PANEL_Z_INDEX,
    visibility: "hidden",
    pointerEvents: "none",
  },
};

function samePosition(a: PanelPosition, b: PanelPosition): boolean {
  if (a.placement !== b.placement) return false;
  const ka = Object.keys(a.style) as (keyof React.CSSProperties)[];
  const kb = Object.keys(b.style) as (keyof React.CSSProperties)[];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a.style[k] === b.style[k]);
}

export function useFloatingPanel({
  anchor,
  anchorSelector,
  enabled,
  panelWidth = DEFAULT_PANEL_WIDTH,
  margin = DEFAULT_MARGIN,
}: FloatingPanelOptions): FloatingPanelResult {
  /**
   * Resolve the anchor at MEASURE time, not at render time.
   *
   * A caller that hands us a captured node loses: the canvas re-projects its
   * list on every keystroke, React swaps the element, and the node we were
   * given reports `isConnected === false` — which hides the panel outright.
   * `compute()` runs inside rAF, after commit, so a selector resolved here
   * always names the element that is currently on screen.
   */
  const resolveAnchor = useCallback(
    () => (anchorSelector ? document.querySelector<HTMLElement>(anchorSelector) : anchor),
    [anchor, anchorSelector],
  );
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<PanelPosition>(HIDDEN_POSITION);

  const compute = useCallback(() => {
    const anchor = resolveAnchor();
    if (!enabled || !anchor || !anchor.isConnected) {
      setPosition((prev) => (samePosition(prev, HIDDEN_POSITION) ? prev : HIDDEN_POSITION));
      return;
    }

    // ---- READ PHASE ----------------------------------------------------
    // Every layout read happens here, before any write. Interleaving reads and
    // writes inside the same frame is what forces a synchronous reflow per
    // scroll event and makes the panel stutter.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = anchor.getBoundingClientRect();
    const panelHeight = ref.current?.offsetHeight ?? 0;

    // ---- DECIDE ----------------------------------------------------------
    const fitsRight = rect.right + margin + panelWidth + margin <= vw;
    const fitsLeft = rect.left - margin - panelWidth - margin >= 0;
    const placement: Placement =
      vw < MOBILE_BREAKPOINT ? "bottom" : fitsRight ? "right" : fitsLeft ? "left" : "bottom";

    let next: PanelPosition;

    if (placement === "bottom") {
      next = {
        placement,
        style: {
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: PANEL_Z_INDEX,
          maxHeight: BOTTOM_MAX_HEIGHT,
          overflowY: "auto",
        },
      };
    } else {
      const left = placement === "right" ? rect.right + margin : rect.left - margin - panelWidth;

      // Align near the anchor's top, then clamp so the whole panel stays on
      // screen. When the panel is taller than the viewport, pin it to the top
      // margin and let it scroll internally rather than overflowing off-screen.
      const maxTop = vh - panelHeight - margin;
      const top = maxTop < margin ? margin : Math.min(Math.max(rect.top, margin), maxTop);

      next = {
        placement,
        style: {
          position: "fixed",
          top,
          left,
          width: panelWidth,
          zIndex: PANEL_Z_INDEX,
          maxHeight: vh - margin * 2,
          overflowY: "auto",
        },
      };
    }

    // ---- WRITE PHASE -----------------------------------------------------
    // Bail out when nothing moved. This is not an optimisation, it is the loop
    // breaker: the ResizeObserver below watches the panel, and the panel's size
    // is affected by the style we set here. Without the equality check that is
    // an infinite observe -> setState -> resize -> observe cycle.
    setPosition((prev) => (samePosition(prev, next) ? prev : next));
  }, [resolveAnchor, enabled, margin, panelWidth]);

  /** Coalesce bursts of scroll/resize/observer callbacks into one frame. */
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      compute();
    });
  }, [compute]);

  useEffect(() => {
    const anchor = resolveAnchor();
    if (!enabled || !anchor) {
      setPosition((prev) => (samePosition(prev, HIDDEN_POSITION) ? prev : HIDDEN_POSITION));
      return;
    }

    schedule();

    // Capture phase: the canvas may scroll inside its own overflow container,
    // and those scroll events never reach window in the bubble phase.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);

    const panel = ref.current;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule) // beats polling: fires only on real size changes
        : null;
    if (observer) {
      if (panel) observer.observe(panel);
      observer.observe(anchor);
    }

    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [resolveAnchor, enabled, schedule]);

  return { style: position.style, placement: position.placement, ref };
}

export default useFloatingPanel;
