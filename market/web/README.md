# Open Skill Market Web

Astro + Cloudflare web app for browsing skills from `market/skills.json`.

## Features

- EN/ZH routes: `/en/` and `/zh/`
- SEO primitives: canonical, hreflang, OpenGraph, Twitter, robots, sitemap, JSON-LD
- Progressive data load: first `skills.json`, then chunk files from `meta.chunks`
- Independent project: this folder has its own `package.json`

## Local Development

```bash
cd market/web
npm install
npm run dev
```

## Build

```bash
cd market/web
npm run build
```

`build` runs `scripts/sync-market-data.mjs` to copy `../skills.json` and `../skills-*.json` into `public/data`.
