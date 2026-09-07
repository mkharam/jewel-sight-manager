import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages project sites are served from /<repo-name>/, not the domain root —
  // set GH_PAGES_BASE in CI (see .github/workflows/deploy-pages.yml) to that subpath.
  // Any other host (Lovable, a custom domain, local dev) serves from root, so this
  // defaults to "/" everywhere else.
  base: process.env.GH_PAGES_BASE || "/",
  server: {
    host: "::",
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
