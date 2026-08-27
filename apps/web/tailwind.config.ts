import type { Config } from "tailwindcss";

/**
 * Restrained fintech-trust palette (PART 01 §34). Deliberately narrow —
 * one primary hue, neutral grays, and semantic status colors only. No
 * neon, no gradients-as-default, no glow.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#f8fafc",
          sunken: "#f1f5f9",
        },
        border: {
          DEFAULT: "#e2e8f0",
          strong: "#cbd5e1",
        },
        ink: {
          DEFAULT: "#0f172a",
          muted: "#475569",
          faint: "#94a3b8",
        },
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          300: "#93b4fb",
          500: "#3b63f5",
          600: "#2c4fde",
          700: "#243fb4",
        },
        success: { DEFAULT: "#16a34a", subtle: "#dcfce7", text: "#166534" },
        warning: { DEFAULT: "#d97706", subtle: "#fef3c7", text: "#92400e" },
        danger: { DEFAULT: "#dc2626", subtle: "#fee2e2", text: "#991b1b" },
        info: { DEFAULT: "#0891b2", subtle: "#cffafe", text: "#155e75" },
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
