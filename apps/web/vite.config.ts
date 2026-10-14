import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.DSM_TERMINAL_BASE ?? "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": "http://127.0.0.1:4174",
      "/ws": {
        target: "ws://127.0.0.1:4174",
        ws: true
      }
    }
  },
  build: {
    target: "es2022"
  }
});
