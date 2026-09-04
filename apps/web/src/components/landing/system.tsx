/**
 * Shared machinery for the Vettri Vaanigam landing page.
 *
 * WHY THERE IS NO ANIMATION LIBRARY HERE
 *
 * This app is Vite + React, and it does not ship Framer Motion.
 * Everything the page needs — scroll reveal, count-up, sequenced steps,
 * magnetic buttons, a pointer-reactive gradient, card spotlights — is a
 * few lines of state plus a CSS transition, and each one below is under
 * twenty. Adding a runtime dependency to the bundle of a payments console
 * to do that would be a poor trade.
 *
 * Every hook here checks `prefers-reduced-motion` and settles into the
 * FINISHED state rather than the initial one. A reader who has asked the
 * operating system for less motion gets the whole page, immediately —
 * never a page stuck at opacity zero.
 *
 * THE SPINE
 *
 * `SECTIONS` below is the page's single source of order. The rail on the
 * left, the stage number in every section header and the section elements
 * themselves all read from it, so the page reads as one transaction being
 * walked from intent to audit rather than as a stack of feature blocks.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** The order of the story. Everything positional derives from this. */
export const SECTIONS = [
  { id: "platform", label: "Architecture" },
  { id: "command-center", label: "Command center" },
  { id: "buyer-agent", label: "Buyer agent" },
  { id: "merchant-agent", label: "Merchant agent" },
  { id: "policy", label: "Policy" },
  { id: "ledger", label: "Ledger" },
  { id: "revenue", label: "Revenue" },
  { id: "failure", label: "Failure" },
  { id: "trust-layer", label: "Trust" },
  { id: "demo", label: "Run it" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

function sectionIndex(id: SectionId): number {
  return SECTIONS.findIndex((section) => section.id === id);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Which section owns the middle of the viewport right now. */
export function useActiveSection(): SectionId | null {
  const [active, setActive] = useState<SectionId | null>(null);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id as SectionId);
        }
      },
      // A band across the middle of the screen: whatever crosses it is
      // what the reader is looking at.
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return active;
}

/**
 * Adds `is-visible` to an element the first time it enters the viewport.
 *
 * ONE OBSERVER PER ELEMENT, AND A SYNCHRONOUS FIRST CHECK
 *
 * The obvious implementation — one shared observer, disconnected in an
 * effect cleanup — is subtly wrong here, and it failed exactly as you
 * would fear: under StrictMode's mount/unmount/remount the cleanup
 * disconnected the observer the already-attached refs were registered
 * with, and every revealed element on the page stayed at opacity zero.
 * A blank page is a far worse outcome than a missed animation, so this
 * takes the cheap route instead: an observer per element, disconnected by
 * itself the moment it fires, plus an immediate check for anything
 * already on screen at attach time. Nothing depends on effect ordering,
 * and nothing can leave content hidden.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(): (node: T | null) => void {
  return useCallback((node: T | null) => {
    if (!node || node.classList.contains("is-visible")) return;

    const box = node.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.92) {
      node.classList.add("is-visible");
      return;
    }

    if (!("IntersectionObserver" in window)) {
      node.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        node.classList.add("is-visible");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    observer.observe(node);
  }, []);
}

/** Runs `to` up from zero once the element is on screen. */
export function useCountUp(to: number, decimals = 0): { value: number; ref: (node: HTMLElement | null) => void } {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? to : 0);
  const started = useRef(false);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || started.current) return;
      if (reduced || !("IntersectionObserver" in window)) {
        started.current = true;
        setValue(to);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting) || started.current) return;
          started.current = true;
          observer.disconnect();
          const duration = 1400;
          const start = performance.now();
          const factor = 10 ** decimals;
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            // Ease-out cubic: fast enough to feel responsive, slow enough
            // at the end that the final number is readable as it lands.
            const eased = 1 - (1 - progress) ** 3;
            setValue(Math.round(to * eased * factor) / factor);
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        },
        { threshold: 0.4 },
      );
      observer.observe(node);
    },
    [to, decimals, reduced],
  );

  return { value, ref };
}

/**
 * A looping sequence cursor: 0, 1, 2 … length, hold, restart. Used by the
 * hero network and anything else that replays a flow. `hold` extra ticks
 * are spent on the finished state so the end of the story is readable.
 */
export function useSequence(length: number, interval = 1800, hold = 2): number {
  const reduced = usePrefersReducedMotion();
  const [cursor, setCursor] = useState(reduced ? length : 0);

  useEffect(() => {
    if (reduced) {
      setCursor(length);
      return;
    }
    const id = window.setInterval(() => setCursor((n) => (n >= length + hold ? 0 : n + 1)), interval);
    return () => window.clearInterval(id);
  }, [length, interval, hold, reduced]);

  return Math.min(cursor, length);
}

/**
 * Magnetic hover. The control leans a few pixels toward the pointer and
 * springs back on exit. Bounded to 6px on purpose — enough to feel alive,
 * not enough to make a button hard to hit, and skipped entirely for
 * reduced motion and for coarse pointers, where it would just fight the
 * tap.
 */
export function useMagnetic<T extends HTMLElement>(strength = 6) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const onMove = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
      const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
      node.style.transform = `translate(${(dx * strength).toFixed(2)}px, ${(dy * strength * 0.6).toFixed(2)}px)`;
    };
    const onLeave = () => {
      node.style.transform = "";
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [strength, reduced]);

  return ref;
}

/** Writes `--os-mx` / `--os-my` so a gradient can follow the pointer. */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = node.getBoundingClientRect();
        node.style.setProperty("--os-mx", `${(((event.clientX - box.left) / box.width) * 100).toFixed(1)}%`);
        node.style.setProperty("--os-my", `${(((event.clientY - box.top) / box.height) * 100).toFixed(1)}%`);
      });
    };

    node.addEventListener("pointermove", onMove);
    return () => {
      node.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return ref;
}

/**
 * Card motion: spotlight + 3D tilt, from ONE listener on the grid.
 *
 * The pointer's position inside the hovered card is written into that card
 * as custom properties; CSS turns them into a highlight and a perspective
 * rotation (`.os-card-hover` in index.css). Doing it with variables rather
 * than React state matters — a nine-card grid costs one listener, one
 * rAF-throttled handler and zero re-renders, so the tilt stays at frame
 * rate while the rest of the page is doing its own work.
 *
 * The rotation is capped at a few degrees. Past roughly six the text on a
 * card starts to keystone visibly and the effect reads as a toy rather
 * than as depth.
 */
export function useCardMotion<T extends HTMLElement>(maxTilt = 5) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let frame = 0;
    let current: HTMLElement | null = null;

    const settle = (element: HTMLElement | null) => {
      if (!element) return;
      element.style.setProperty("--os-rx", "0deg");
      element.style.setProperty("--os-ry", "0deg");
    };

    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".os-card-hover") ?? null;
        if (target !== current) {
          settle(current);
          current = target;
        }
        if (!target) return;
        const box = target.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        target.style.setProperty("--os-cx", `${(event.clientX - box.left).toFixed(0)}px`);
        target.style.setProperty("--os-cy", `${(event.clientY - box.top).toFixed(0)}px`);
        target.style.setProperty("--os-ry", `${((x - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
        target.style.setProperty("--os-rx", `${((0.5 - y) * 2 * maxTilt).toFixed(2)}deg`);
      });
    };

    const onLeave = () => {
      settle(current);
      current = null;
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced, maxTilt]);

  return ref;
}

/** Single-element version of the tilt above, for a whole 3D stage. */
export function useTilt<T extends HTMLElement>(maxTilt = 3.5) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = node.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        node.style.setProperty("--os-ry", `${((x - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
        node.style.setProperty("--os-rx", `${((0.5 - y) * 2 * maxTilt * 0.7).toFixed(2)}deg`);
      });
    };
    const onLeave = () => {
      node.style.setProperty("--os-rx", "0deg");
      node.style.setProperty("--os-ry", "0deg");
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced, maxTilt]);

  return ref;
}

/**
 * Depth parallax. The element drifts against the scroll at a fraction of
 * its speed, which is what separates a foreground plane from the page
 * behind it. Transform only — never `top` — so it never causes a layout.
 */
export function useParallax<T extends HTMLElement>(strength = 0.05) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      // Distance of the element's centre from the viewport's centre.
      const offset = box.top + box.height / 2 - window.innerHeight / 2;
      node.style.transform = `translate3d(0, ${(-offset * strength).toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [strength, reduced]);

  return ref;
}

/**
 * Scroll-linked rotation: the element lies back on the X axis and
 * straightens as it rises through the viewport, so a flat row of chips
 * arrives as a ribbon and settles into a chain. Writes `--os-rot`.
 */
export function useScrollTilt<T extends HTMLElement>(maxDeg = 14) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      node.style.setProperty("--os-rot", "0deg");
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      const travel = window.innerHeight * 0.55;
      const progress = Math.min(1, Math.max(0, (window.innerHeight - box.top) / travel));
      node.style.setProperty("--os-rot", `${((1 - progress) * maxDeg).toFixed(2)}deg`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [maxDeg, reduced]);

  return ref;
}

/* ── Presentational primitives ─────────────────────────────── */

export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section" | "article";
}) {
  const ref = useReveal<HTMLElement>();
  const style = { transitionDelay: `${delay}ms` } as CSSProperties;
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={`os-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}

export function StatusDot({
  tone = "cyan",
  pulse = true,
}: {
  tone?: "cyan" | "success" | "danger" | "warn";
  pulse?: boolean;
}) {
  const color = {
    cyan: "var(--os-cyan)",
    success: "var(--os-success)",
    danger: "var(--os-danger)",
    warn: "var(--os-warn)",
  }[tone];
  return (
    <span
      aria-hidden
      className={`relative inline-block h-1.5 w-1.5 shrink-0 rounded-full ${pulse ? "os-pulse-ring" : ""}`}
      style={{ backgroundColor: color, color }}
    />
  );
}

/**
 * One section of the story.
 *
 * TWO LAYOUTS, ALTERNATED ON PURPOSE
 *
 * `split` pins the heading to the left while its evidence scrolls past on
 * the right; `stack` gives the heading a line of its own above full-width
 * instrumentation. A page where every section is heading-then-card-grid
 * is the shape every other product page has, and the reader stops seeing
 * the sections at all. Alternating the two — and numbering each one as a
 * stage on the same transaction — is what makes this read as a walk
 * through one system rather than a list of features.
 */
export function SectionShell({
  id,
  eyebrow,
  title,
  lede,
  children,
  layout = "stack",
}: {
  id: SectionId;
  eyebrow: string;
  title: ReactNode;
  lede?: string;
  children: ReactNode;
  layout?: "stack" | "split";
}) {
  const index = sectionIndex(id);
  const titleId = `${id}-title`;

  const head = (
    <Reveal>
      <p className="os-label flex items-center gap-2.5 text-[var(--os-cyan)]">
        <span className="os-mono text-[var(--os-faint)]">{String(index + 1).padStart(2, "0")}</span>
        <span aria-hidden className="h-px w-6 bg-[var(--os-line-2)]" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="os-display mt-4 text-[2rem] text-[var(--os-text)] sm:text-[2.6rem]">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-pretty text-[15px] leading-relaxed text-[var(--os-dim)]">{lede}</p> : null}
    </Reveal>
  );

  return (
    <section id={id} aria-labelledby={titleId} className="relative scroll-mt-24 border-t border-[var(--os-line)]">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
        {layout === "split" ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
            <div className="lg:sticky lg:top-28 lg:self-start">{head}</div>
            <div className="mt-10 lg:mt-0">{children}</div>
          </div>
        ) : (
          <>
            {head}
            <div className="mt-12">{children}</div>
          </>
        )}
      </div>
    </section>
  );
}

/** ₹ figures, formatted the way the rest of the product formats them. */
