---
name: tweetclaw
description: Use when an agent needs OpenClaw X/Twitter automation through TweetClaw, including scrape tweets, search tweets, search tweet replies, post tweets, post tweet replies, follower export, user lookup, media workflows, direct messages, monitor tweets, webhooks, and giveaway draws.
version: 1.0.0
tags:
  - openclaw
  - twitter
  - x-twitter
  - automation
  - agent-tools
author:
  name: Xquik-dev
  url: https://github.com/Xquik-dev/tweetclaw
---

# TweetClaw

TweetClaw is an OpenClaw plugin and helper skill for X/Twitter automation through
Xquik. Use it when a coding or research agent needs structured X/Twitter data,
reviewed visible actions, or a concrete OpenClaw install path instead of ad hoc
browser scraping.

Install the plugin before using the skill guidance:

```bash
openclaw plugins install @xquik/tweetclaw
```

## When To Use

Use TweetClaw when the task includes any of these jobs:

- Scrape tweets from a public search query.
- Search tweets or search tweet replies for source discovery.
- Export followers or look up public user profile data.
- Upload or download media for reviewed X/Twitter workflows.
- Draft, post, or reply to tweets after explicit user approval.
- Read or send direct messages when the account owner requested it.
- Monitor tweets, keywords, or accounts and route webhook events.
- Run giveaway draws with transparent source data.

Do not use TweetClaw for unrelated social networks, private data that the user
cannot access, or silent posting. Keep visible actions review-gated and keep
credentials in local OpenClaw config or environment variables.

## Agent Workflow

1. Confirm the user wants X/Twitter data or account-backed X/Twitter action.
2. Ask the user to configure the Xquik API key outside chat if it is not already
   available in local OpenClaw settings.
3. Use TweetClaw to collect only the data needed for the task, such as tweet
   URLs, tweet IDs, author handles, reply counts, media URLs, and capture dates.
4. Summarize the source data before using it in a report, content draft, monitor,
   webhook handler, or giveaway draw.
5. For post tweets, post tweet replies, direct messages, and media upload, show
   the final action content to the user and wait for approval.

## Useful References

- GitHub repository: https://github.com/Xquik-dev/tweetclaw
- npm package: https://www.npmjs.com/package/@xquik/tweetclaw
- ClawHub browsing page: https://clawhub.ai/plugins/@xquik/tweetclaw
- Xquik docs: https://docs.xquik.com
