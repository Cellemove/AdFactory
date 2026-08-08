import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0a0a",
          800: "#171717",
          700: "#262626",
          600: "#404040",
          500: "#737373",
          400: "#a3a3a3",
          300: "#d4d4d4",
          200: "#e5e5e5",
          100: "#f5f5f5",
          50: "#fafafa",
        },
        brand: {
          pink: "#ff6db4",
          accent: "#0ea5e9",
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
        card: "0 1px 2px 0 rgb(10 10 10 / 0.04), 0 1px 1px -1px rgb(10 10 10 / 0.03)",
        "card-hover": "0 4px 12px -2px rgb(10 10 10 / 0.08), 0 2px 4px -2px rgb(10 10 10 / 0.04)",
        pop: "0 8px 24px -6px rgb(10 10 10 / 0.14), 0 2px 6px -2px rgb(10 10 10 / 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
