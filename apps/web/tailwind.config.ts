import type { Config } from "tailwindcss";

/**
 * Restrained fintech-trust palette (PART 01 §34). Deliberately narrow —
 * one primary hue, neutral grays, and semantic status colors only. No
 * neon, no gradients-as-default, no glow.
 *
 * Every color is a CSS custom property (defined in `src/index.css` for
 * `:root` and `.dark`), referenced here via Tailwind's `rgb(var(...) /
 * <alpha-value>)` pattern so opacity utilities (`bg-surface/50`, etc.)
 * keep working. This is what makes dark mode automatic for every
 * existing component: they already use these semantic class names
 * (`bg-surface`, `text-ink`, `border-border`, …), never raw hex, so a
 * single variable swap under `.dark` re-themes the whole app with zero
 * per-component changes (PART 09 productization sprint — dark mode).
 */
function withOpacity(variable: string) {
  return `rgb(var(${variable}) / <alpha-value>)`;
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: withOpacity("--color-surface"),
          subtle: withOpacity("--color-surface-subtle"),
          sunken: withOpacity("--color-surface-sunken"),
          elevated: withOpacity("--color-surface-elevated"),
        },
        border: {
          DEFAULT: withOpacity("--color-border"),
          strong: withOpacity("--color-border-strong"),
        },
        ink: {
          DEFAULT: withOpacity("--color-ink"),
          muted: withOpacity("--color-ink-muted"),
          faint: withOpacity("--color-ink-faint"),
        },
        brand: {
          50: withOpacity("--color-brand-50"),
          100: withOpacity("--color-brand-100"),
          300: withOpacity("--color-brand-300"),
          500: withOpacity("--color-brand-500"),
          600: withOpacity("--color-brand-600"),
          700: withOpacity("--color-brand-700"),
        },
        success: {
          DEFAULT: withOpacity("--color-success"),
          subtle: withOpacity("--color-success-subtle"),
          text: withOpacity("--color-success-text"),
        },
        warning: {
          DEFAULT: withOpacity("--color-warning"),
          subtle: withOpacity("--color-warning-subtle"),
          text: withOpacity("--color-warning-text"),
        },
        danger: {
          DEFAULT: withOpacity("--color-danger"),
          subtle: withOpacity("--color-danger-subtle"),
          text: withOpacity("--color-danger-text"),
        },
        info: {
          DEFAULT: withOpacity("--color-info"),
          subtle: withOpacity("--color-info-subtle"),
          text: withOpacity("--color-info-text"),
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 1px 0 rgb(15 23 42 / 0.03)",
        popover: "0 8px 24px -4px rgb(15 23 42 / 0.12), 0 2px 6px -2px rgb(15 23 42 / 0.06)",
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
