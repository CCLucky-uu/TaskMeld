import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: parseInt(loadEnv(mode, process.cwd(), "").VITE_DEV_PORT || "5173", 10),
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${loadEnv(mode, process.cwd(), "").API_PORT || "54320"}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));

