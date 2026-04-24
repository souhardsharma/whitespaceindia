import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        headline: ["var(--font-newsreader)", "Georgia", "serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
        body: ["var(--font-public-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-public-sans)", "system-ui", "sans-serif"],
        label: ["var(--font-space-grotesk)", "monospace"],
        display: ["var(--font-newsreader)", "Georgia", "serif"],
      },
      colors: {
        ink: "#1c1c19",
        paper: "#fcf9f4",
        clay: "#BD402C",
        "clay-deep": "#9b2817",
        "surface-low": "#f6f3ee",
        "surface-high": "#ebe8e3",
        "surface-dim": "#dcdad5",
        muted: "#5b5f62",
      },
      borderRadius: {
        none: "0",
        DEFAULT: "0",
        sm: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
export default config;
