import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: https://open-skill-market.pages.dev/sitemap.xml\n`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
    }
  );
};
