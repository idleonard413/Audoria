import { defineConfig } from "vite";
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import legacy from "@vitejs/plugin-legacy";
import path from "path";

export default defineConfig({
  server: { host: true, port: 5173, strictPort: true, hmr: {host: '192.168.2.175', port: 5173 }},
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      targets: ["Chrome >= 69", "Firefox >= 68", "Safari >= 12"],
      // modernPolyfills: false  // usually not needed
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
