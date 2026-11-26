import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pino and pino-pretty use Node internals; keep them out of the bundler.
  // pdf-parse / mammoth / word-extractor read files with Node APIs: keep them out of the bundler too.
  serverExternalPackages: ["pino", "pino-pretty", "pdf-parse", "mammoth", "word-extractor", "pdf-lib", "unpdf"],
};

export default nextConfig;
