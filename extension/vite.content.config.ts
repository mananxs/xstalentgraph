import { resolve } from "path";
import { defineConfig } from "vite";

// Build 2/2: content script → single self-contained IIFE (content scripts can't use ES module imports).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/content/resdex-observer.ts"),
      formats: ["iife"],
      name: "ResdexCopilotContent",
      fileName: () => "content.js",
    },
  },
});
