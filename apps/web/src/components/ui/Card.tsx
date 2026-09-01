import type { HTMLAttributes } from "react";
import { clsx } from "clsx";

/**
 * The console runs on a white ground, so a card cannot rely on contrast
 * with the page to have edges — the hairline border and the low shadow are
 * doing that work, and neither is optional here the way it would be on
 * grey. `hover:shadow-raised` gives a card a small lift when it is
 * interactive, which reads as depth rather than as a colour change.
 */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-card border border-border bg-surface shadow-card transition-shadow duration-200", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // A lighter rule than the card's own border: an internal divider on a
  // white card should be quieter than the edge that defines the card.
  return <div className={clsx("border-b border-border-hair px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-sm font-semibold text-ink", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("px-5 py-4", className)} {...props} />;
}
