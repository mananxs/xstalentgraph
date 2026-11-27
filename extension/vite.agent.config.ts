import { resolve } from "path";
import { defineConfig } from "vite";

// Build 3/3: the sourcing agent's page script → single self-contained IIFE (agent.js), loaded next to content.js.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: { entry: resolve(__dirname, "src/content/agent-content.ts"), formats: ["iife"], name: "XsHuntAgentContent", fileName: () => "agent.js" },
  },
});
