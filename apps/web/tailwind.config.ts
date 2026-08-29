import type { Config } from "tailwindcss";

/**
 * Anumati design tokens.
 *
 * The original palette was deliberately narrow (PART 01 §34) — one hue,
 * cold slate neutrals, no elevation beyond a hairline. That restraint was
 * right for a back-office tool, but it read as unfinished for a product
 * whose whole pitch is that a merchant can UNDERSTAND what happened.
 *
 * What changed, and what deliberately did not:
 *
 * - Neutrals are now very slightly WARM. Cold slate on white reads
 *   clinical; a few degrees of warmth makes long reading (decision logs,
 *   explanations) markedly easier without anyone noticing why.
 * - The brand hue is a deeper indigo with a real 9-step scale, so hover,
 *   active and selected states are distinguishable instead of all being
 *   "the blue one".
 * - `accent` (amber) is new and used SPARINGLY — a step-up awaiting a
 *   human, and nothing else. A colour that means one thing stays
 *   meaningful; a colour used for decoration stops being a signal.
 * - Still no neon, still no gradient-as-default, still no glow. The
 *   restraint was never the problem; the flatness was.
 *
 * Every existing token NAME is preserved, so this is a lift rather than a
 * migration — no component had to change to receive it.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#fafaf9",
          sunken: "#f5f5f4",
          raised: "#ffffff",
          inverse: "#1c1917",
        },
        border: {
          DEFAULT: "#e7e5e4",
          strong: "#d6d3d1",
          subtle: "#f0efee",
        },
        ink: {
          DEFAULT: "#1c1917",
          muted: "#57534e",
          faint: "#a8a29e",
          inverse: "#fafaf9",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#5b5bd6",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        /** Reserved for "a human needs to decide this". Nothing else. */
        accent: {
          DEFAULT: "#d97706",
          subtle: "#fffbeb",
          border: "#fde68a",
          text: "#92400e",
        },
        success: { DEFAULT: "#15803d", subtle: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
        warning: { DEFAULT: "#d97706", subtle: "#fffbeb", border: "#fde68a", text: "#92400e" },
        danger: { DEFAULT: "#dc2626", subtle: "#fef2f2", border: "#fecaca", text: "#991b1b" },
        info: { DEFAULT: "#0e7490", subtle: "#ecfeff", border: "#a5f3fc", text: "#155e75" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // A dedicated step for metadata, so small text is a deliberate
        // choice rather than an arbitrary arbitrary-value each time.
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(28 25 23 / 0.04), 0 1px 3px 0 rgb(28 25 23 / 0.03)",
        raised: "0 2px 4px -1px rgb(28 25 23 / 0.06), 0 4px 12px -2px rgb(28 25 23 / 0.06)",
        popover: "0 8px 24px -4px rgb(28 25 23 / 0.12), 0 2px 6px -2px rgb(28 25 23 / 0.06)",
        focus: "0 0 0 3px rgb(91 91 214 / 0.15)",
      },
      borderRadius: {
        card: "0.75rem",
        pill: "9999px",
      },
      transitionTimingFunction: {
        // Slight overshoot-free ease. Motion should feel answered, not
        // animated.
        ui: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-up": "fade-up 180ms cubic-bezier(0.4, 0, 0.2, 1)",
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
