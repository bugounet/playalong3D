import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project below /playalong3D/. Keep "/" locally
  // so the development URL remains http://localhost:5173/.
  base: command === "build" ? "/playalong3D/" : "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
}));
