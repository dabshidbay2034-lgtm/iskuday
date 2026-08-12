import { createElement, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Click-and-type-on-the-page text editing.
 *
 * THE TRAP THIS COMPONENT EXISTS TO AVOID
 * ---------------------------------------
 * The naive version of this is `<div contentEditable>{value}</div>` with an
 * `onInput` that calls `setState`. It looks correct and is completely broken:
 * every keystroke re-renders, React swaps out the text node it owns, and the
 * browser drops the caret back to offset 0. You get "olleH" when you type
 * "Hello".
 *
 * The fix, which is the whole design of this file:
 *   1. The element is rendered with NO React children. React therefore never
 *      touches the child nodes during reconciliation, so it can re-render as
 *      often as it likes without disturbing the caret.
 *   2. Content is seeded IMPERATIVELY in an effect (`el.textContent = value`),
 *      and that effect refuses to write while the element has focus. External
 *      changes (undo, template switch, the settings rail) still flow in — they
 *      just wait until the user is not mid-word.
 *   3. Commits go OUT (debounced input + blur). Nothing ever comes back IN
 *      through the debounce path.
 *
 * Trace of the 2nd keystroke of a word: keydown "e" -> browser mutates the text
 * node -> `input` fires -> we reset a 300ms timer -> no React state changes ->
 * no re-render -> caret untouched. When the timer eventually fires, `onCommit`
 * bubbles the value up, the parent re-renders us with a new `value`, the sync
 * effect runs, sees `document.activeElement === el`, and returns without
 * touching the DOM. The caret still has not moved.
 */

export type InlineTextTag = "h1" | "h2" | "h3" | "p" | "span" | "div";

export interface InlineTextProps {
  value: string;
  onCommit: (next: string) => void;
  editable: boolean;
  as?: InlineTextTag;
  className?: string;
  placeholder?: string;
  /** Enter commits and blurs instead of inserting a newline. Default true. */
  singleLine?: boolean;
}

/** Long enough that a fast typist never trips it, short enough to feel live. */
const COMMIT_DEBOUNCE_MS = 300;

/**
 * Read the live text out of a contenteditable node.
 *
 * Browsers substitute a non-breaking space (U+00A0) for a trailing/repeated space so it does
 * not collapse visually. That character would then be saved to the database
 * and re-rendered on the public page, where it breaks word wrapping. We render
 * with `whitespace-pre-wrap` to discourage it and normalise it back out here.
 */
function readText(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\u00A0/g, " ");
}

/**
 * Insert text at the caret as PLAIN TEXT.
 *
 * `execCommand` is deprecated but it is still the only way to insert text that
 * participates in the browser's native contenteditable undo stack, so we prefer
 * it — except for multi-line text. Chrome turns newlines passed to `insertText`
 * into `<br>` / `<div>` elements, and `<br>` does not appear in `textContent`,
 * so the line break would be silently lost on commit. For anything containing a
 * newline we build a real "\n" text node instead (which `whitespace-pre-wrap`
 * renders correctly and `textContent` round-trips faithfully).
 */
function insertPlainText(text: string): void {
  if (!text) return;

  if (!text.includes("\n") && typeof document.execCommand === "function") {
    try {
      if (document.execCommand("insertText", false, text)) return;
    } catch {
      /* fall through to the manual range path */
    }
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function InlineText({
  value,
  onCommit,
  editable,
  as = "span",
  className,
  placeholder,
  singleLine = true,
}: InlineTextProps): JSX.Element {
  const safeValue = value ?? "";

  const ref = useRef<HTMLElement>(null);
  /** The value the parent last agreed with — used to suppress no-op commits. */
  const committedRef = useRef<string>(safeValue);
  /** Value at focus time, so Escape can undo a whole editing session. */
  const baselineRef = useRef<string>(safeValue);
  /** Text waiting on the debounce, so unmount does not eat the last 300ms. */
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  /**
   * Keep the callback in a ref so the sync effect below never has to list
   * `onCommit` as a dependency — inline arrow props change identity on every
   * parent render, and re-running the sync effect that often is exactly how
   * caret bugs sneak back in.
   */
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const commit = useCallback((next: string) => {
    pendingRef.current = null;
    if (next === committedRef.current) return;
    committedRef.current = next;
    onCommitRef.current(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Debounced outbound commit. Deliberately one-way: it calls `onCommit` and
   * NEVER writes back into the node, so a sibling settings rail can mirror the
   * text while the user types without the round-trip stealing the caret.
   */
  const scheduleCommit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    pendingRef.current = readText(el);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const live = ref.current;
      if (live) commit(readText(live));
    }, COMMIT_DEBOUNCE_MS);
  }, [clearTimer, commit]);

  /**
   * Seed / re-sync the node's text.
   *
   * The focus guard is the load-bearing line: while the user is typing, the
   * incoming `value` is just an echo of what they already typed, and writing it
   * back would reset the caret. We accept the tradeoff that an external change
   * arriving mid-edit is applied on blur instead of instantly.
   */
  useEffect(() => {
    committedRef.current = safeValue;
    const el = ref.current;
    // In read-only mode React owns the children; never fight it for them.
    if (!el || !editable) return;
    if (document.activeElement === el) return;
    if (readText(el) !== safeValue) el.textContent = safeValue;
  }, [safeValue, editable]);

  // Flush a pending edit if we are torn down mid-keystroke (block reordered,
  // template swapped) — otherwise the last 300ms of typing is silently lost.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      if (pending !== null && pending !== committedRef.current) onCommitRef.current(pending);
    },
    [],
  );

  const handleFocus = useCallback(() => {
    baselineRef.current = committedRef.current;
  }, []);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Deleting the last character leaves a stray `<br>` behind in every
    // browser, which defeats the `:empty` placeholder selector. Clearing the
    // markup (not the text) is safe: the caret has nowhere else to go.
    if (el.textContent === "" && el.innerHTML !== "") el.innerHTML = "";
    scheduleCommit();
  }, [scheduleCommit]);

  const handleBlur = useCallback(() => {
    clearTimer();
    const el = ref.current;
    if (el) commit(readText(el));
  }, [clearTimer, commit]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLElement>) => {
      // Without this, pasting from Word/Docs injects styled HTML — fonts,
      // colours and all — straight into the published page.
      e.preventDefault();
      const raw = e.clipboardData.getData("text/plain");
      const text = singleLine ? raw.replace(/\s*\r?\n\s*/g, " ") : raw.replace(/\r\n?/g, "\n");
      insertPlainText(text);
      scheduleCommit();
    },
    [scheduleCommit, singleLine],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      // Same trap as paste: a dragged selection carries text/html with it.
      e.preventDefault();
      const raw = e.dataTransfer.getData("text/plain");
      const text = singleLine ? raw.replace(/\s*\r?\n\s*/g, " ") : raw.replace(/\r\n?/g, "\n");
      insertPlainText(text);
      scheduleCommit();
    },
    [scheduleCommit, singleLine],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const el = ref.current;
      if (!el) return;

      // Typing must never reach an ancestor. This element is nested inside the
      // builder's selectable block wrapper AND inside a framer-motion
      // Reorder.Item, both of which bind keyboard handlers (activate on
      // Enter/Space, keyboard drag). Either one calling preventDefault cancels
      // the character — default actions run after the event finishes bubbling,
      // so a guard up there is not enough. Stop it at the source instead.
      e.stopPropagation();

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        clearTimer();
        // The debounce may already have pushed half-typed text to the parent,
        // so reverting has to travel outward as well as into the DOM.
        const baseline = baselineRef.current;
        el.textContent = baseline;
        commit(baseline);
        el.blur();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (singleLine) {
          el.blur(); // blur handler performs the commit
          return;
        }
        // Native Enter produces `<br>`/`<div>`, which `textContent` drops — so
        // we insert a real newline character instead. See insertPlainText.
        // (Caveat: a newline typed as the very last character may not paint an
        // empty line until the next character arrives; the value is correct.)
        insertPlainText("\n");
        scheduleCommit();
      }
    },
    [clearTimer, commit, scheduleCommit, singleLine],
  );

  // Read-only: a plain element with React-owned children. No contenteditable
  // attribute at all, so the public page carries no editor affordances.
  if (!editable) {
    return createElement(as, { className: cn("whitespace-pre-wrap break-words", className) }, safeValue);
  }

  return createElement(as, {
    ref,
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-multiline": !singleLine,
    "aria-label": placeholder,
    "data-placeholder": placeholder,
    spellCheck: true,
    enterKeyHint: singleLine ? ("done" as const) : ("enter" as const),
    onFocus: handleFocus,
    onInput: handleInput,
    onBlur: handleBlur,
    onPaste: handlePaste,
    onDrop: handleDrop,
    onKeyDown: handleKeyDown,
    className: cn(
      // Inherit the surrounding typography: the caller's className wins via
      // tailwind-merge, so a hero headline still looks like a hero headline.
      "outline-none cursor-text whitespace-pre-wrap break-words rounded-sm",
      "transition-[box-shadow,background-color] duration-150",
      "hover:ring-1 hover:ring-primary/20 hover:bg-primary/[0.04]",
      "focus:ring-1 focus:ring-primary/40 focus:bg-primary/[0.03]",
      // Placeholder as a pseudo-element: a real child node would be wiped by
      // the imperative seeding above (and would end up in `textContent`).
      "empty:before:content-[attr(data-placeholder)]",
      "empty:before:text-muted-foreground empty:before:opacity-70",
      "empty:before:pointer-events-none empty:before:select-none",
      className,
    ),
  });
}

export default InlineText;
