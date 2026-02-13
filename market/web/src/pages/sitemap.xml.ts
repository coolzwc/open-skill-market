import type { APIRoute } from "astro";
import { getExpandedSkills } from "@/lib/market-data";

export const GET: APIRoute = async () => {
  const skills = await getExpandedSkills();
  const siteUrl = "https://skillmarket.cc";
  const urls: string[] = [
    `${siteUrl}/en/`,
    `${siteUrl}/zh/`
  ];

  for (const skill of skills) {
    urls.push(`${siteUrl}/en/skill/${skill.id}`);
    urls.push(`${siteUrl}/zh/skill/${skill.id}`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
};
