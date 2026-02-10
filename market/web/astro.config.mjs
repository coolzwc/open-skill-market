import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://skillmarket.cc",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh"],
    routing: {
      prefixDefaultLocale: true,
    },
  },
});
