---
name: web-research
title: Web Research
description: Search the web for references, facts or recent news and summarize them with source links.
icon: list
category: research
inputs: [text]
tools: [web_search, save_output, create_nodes]
---

- Build 1–3 focused queries (add the time range or "official site" when relevant) and call `web_search`.
- Answer in the requested format (default: 3–5 bullets of title, date if known, one-line summary, link).
- Flag anything unverified — web content can be wrong or outdated.
- If the user wants to keep it, `save_output` the summary or add a text node with `create_nodes`.
