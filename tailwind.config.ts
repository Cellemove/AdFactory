import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Plum-tinted neutral ramp: ink-800 is the brand plum, everything else derives from it.
        ink: {
          900: "#3B0F3C",
          800: "#4B164C",
          700: "#5C2A5D",
          600: "#6E4570",
          500: "#7D667B",
          400: "#A292A0",
          300: "#CFC4CE",
          200: "#E4DCE3",
          100: "#EFE9EE",
          50: "#F5F5F5",
        },
        brand: {
          pink: "#DD88CF",
          blush: "#F8E7F6",
          plum: "#4B164C",
          danger: "#ef4444",
          warn: "#f59e0b",
          ok: "#10b981",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        // Shadows carry the plum hue instead of neutral black.
        card: "0 1px 2px 0 rgb(75 22 76 / 0.05), 0 1px 1px -1px rgb(75 22 76 / 0.04)",
        "card-hover": "0 4px 12px -2px rgb(75 22 76 / 0.10), 0 2px 4px -2px rgb(75 22 76 / 0.05)",
        pop: "0 8px 24px -6px rgb(75 22 76 / 0.16), 0 2px 6px -2px rgb(75 22 76 / 0.07)",
      },
    },
  },
  plugins: [],
} satisfies Config;
