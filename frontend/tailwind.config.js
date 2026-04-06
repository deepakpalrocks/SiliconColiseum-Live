/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--color-white) / <alpha-value>)",
        dark: {
          900: "rgb(var(--dark-900) / <alpha-value>)",
          800: "rgb(var(--dark-800) / <alpha-value>)",
          700: "rgb(var(--dark-700) / <alpha-value>)",
          600: "rgb(var(--dark-600) / <alpha-value>)",
          500: "rgb(var(--dark-500) / <alpha-value>)",
        },
        gray: {
          100: "rgb(var(--gray-100) / <alpha-value>)",
          200: "rgb(var(--gray-200) / <alpha-value>)",
          300: "rgb(var(--gray-300) / <alpha-value>)",
          400: "rgb(var(--gray-400) / <alpha-value>)",
          500: "rgb(var(--gray-500) / <alpha-value>)",
          600: "rgb(var(--gray-600) / <alpha-value>)",
          700: "rgb(var(--gray-700) / <alpha-value>)",
        },
        accent: {
          green: "#00ff88",
          red: "#ff4466",
          blue: "#4488ff",
          purple: "#8844ff",
          yellow: "#ffcc00",
        },
      },
    },
  },
  plugins: [],
};
