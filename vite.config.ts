import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const resolvePath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  plugins: [
    tailwindcss(),
    TanStackRouterVite({
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
      quoteStyle: "double",
    }),
    react(),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@server": resolvePath("./src/server"),
      "@client": resolvePath("./src/client"),
      "@shared": resolvePath("./src/shared"),
      "@": resolvePath("./src/client"),
    },
  },
});
