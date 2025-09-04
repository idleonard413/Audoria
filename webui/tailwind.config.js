/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,jsx,js}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1440px" } },
    extend: {
      colors: {
        ink: { DEFAULT: "#e9edf6", muted: "#aab0bd" },
        line: "rgba(255,255,255,.06)",
        primary: { 400: "#22c55e", 500: "#16a34a", 600: "#15803d" },
        accent:  { 400: "#fb923c", 500: "#f97316", 600: "#ea580c" },
      },
      boxShadow: {
        card: "0 10px 30px rgba(0,0,0,.40)",
        glow: "0 8px 24px rgba(14,159,110,.25)",
      },
    },
  },
  plugins: [],
}
