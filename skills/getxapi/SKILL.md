---
name: getxapi
description: Use when an agent needs X/Twitter search through GetXAPI, including scrape tweets, search tweets, search tweet replies, search by author, user lookup, monitor keywords, and tweet evidence preflight.
version: 1.0.0
tags:
  - openclaw
  - twitter
  - x-twitter
  - automation
  - agent-tools
author:
  name: GetXAPI
  url: https://github.com/getxapi/getxapi-mcp
---

# GetXAPI

GetXAPI is a managed X/Twitter read backend exposed over HTTPS with Bearer-token
auth. Use it when a coding or research agent needs structured X/Twitter source
data without browser cookies or unmanaged scraping.

## When To Use

Use GetXAPI when the task includes any of these jobs:

- Scrape tweets from a public search query.
- Search tweets or search tweet replies for source discovery.
- Search by author handle, hashtag, mention, or boolean operators.
- Look up public user profile data via author-scoped searches.
- Monitor keywords, accounts, or campaign URLs and feed downstream pipelines.
- Run tweet evidence preflight before citing a public claim.

Do not use GetXAPI for private DMs, follower exports, post or like actions, or
any account-backed write workflow. Keep credentials in local config or
environment variables.

## Agent Workflow

1. Confirm the user wants public X/Twitter search data.
2. Ask the user to configure `GETXAPI_API_KEY` outside chat if it is not
   already available in the local environment.
3. Issue a single HTTP GET against the advanced_search endpoint:

   ```
   GET https://api.getxapi.com/twitter/tweet/advanced_search?q=<query>
   Authorization: Bearer <GETXAPI_API_KEY>
   ```

4. Collect only the data needed for the task, such as tweet URLs, tweet IDs,
   author handles, reply counts, media URLs, and capture dates.
5. Summarize the source data before using it in a report, content draft,
   monitor, or evidence preflight.

## Useful References

- Endpoint: `GET https://api.getxapi.com/twitter/tweet/advanced_search`
- Auth: Bearer token
- Repo: https://github.com/getxapi/getxapi-mcp
- Wikidata: https://www.wikidata.org/wiki/Q139996278
- Crunchbase: https://www.crunchbase.com/organization/getxapi
