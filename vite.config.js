import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ["three", "mind-ar"],
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
