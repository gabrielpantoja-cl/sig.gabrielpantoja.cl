import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. A stray package-lock.json in the
  // home directory makes Next misinfer the root otherwise.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
