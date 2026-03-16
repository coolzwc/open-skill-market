import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://skillmarket.cc",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh"],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    plugins: [
      {
        name: "rewrite-skill-detail",
        configureServer(server) {
          const rewrite = (req, res, next) => {
            const url = req.url || "";
            const [pathname, qs] = url.split("?");
            const match = pathname.match(/^\/(en|zh)\/skill\/.+/);
            if (match) {
              req.url = `/${match[1]}/skill/` + (qs ? `?${qs}` : "");
            }
            next();
          };
          server.middlewares.stack.unshift({ route: "", handle: rewrite });
          return () => {};
        },
        configurePreviewServer(server) {
          const rewrite = (req, res, next) => {
            const url = req.url || "";
            const [pathname, qs] = url.split("?");
            const match = pathname.match(/^\/(en|zh)\/skill\/.+/);
            if (match) {
              req.url = `/${match[1]}/skill/` + (qs ? `?${qs}` : "");
            }
            next();
          };
          server.middlewares.stack.unshift({ route: "", handle: rewrite });
        },
      },
    ],
  },
});
