import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Next/Turbopack doesn't walk up
  // past the repo when resolving files (matters when the developer's home
  // directory contains its own package.json/package-lock.json).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
