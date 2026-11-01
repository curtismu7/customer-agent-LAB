import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 5600, npm start) and Vite on VITE_PORT (default 5602). /api is proxied, so the browser only ever talks to one
// origin (same-origin writes). Both ports stay inside 5600-5699 (5601 is the Docker host port).
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 5600}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5602, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", testTimeout: 30000 },
});
