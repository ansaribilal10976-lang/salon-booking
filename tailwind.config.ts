import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        ink: "var(--ink)",
        clay: "var(--clay)",
        paper: "var(--paper)",
        sand: "var(--sand)",
        sage: "var(--sage)",
        muted: "var(--muted)",
        line: "var(--line)",
        // Legacy aliases kept for any downstream customizations.
        forest: "var(--ink)",
        olive: "var(--sage)",
        cream: "var(--cream)",
      },
      fontFamily: {
        display: ["Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
