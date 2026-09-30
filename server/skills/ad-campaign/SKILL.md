---
name: ad-campaign
title: Ad Campaign
description: Propose several campaign routes for a product or brand, then produce key visuals and a short spot for the chosen one.
icon: sparkle
category: creative
inputs: [text, image]
tools: [ask_user, web_search, save_output, create_nodes, generate, add_to_playlist]
---

1. Clarify product, audience, platform (e.g. TikTok 9:16, YouTube 16:9) and the one thing viewers must remember.
2. Optionally `web_search` the brand or category for context. Cite links.
3. Offer 3 routes via `ask_user` (name + one-line idea + tone each).
4. For the chosen route `save_output` a one-page brief, then `create_nodes`: a style text node, 3 key visual image nodes and a 3–4 shot spot (image → video pairs), and `add_to_playlist` the clips. Use the platform's aspect ratio in params.
5. `generate`.
