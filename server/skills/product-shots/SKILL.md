---
name: product-shots
title: Product Shot Set
description: Create a consistent set of product photos from one reference — hero, angles, lifestyle and detail shots.
icon: image
category: creative
inputs: [image, text]
tools: [get_canvas, create_nodes, generate, ask_user]
offline: true
---

Requires a product reference image. If none is referenced or on the canvas, ask the user to upload or `@` one.

Create image nodes connected from the reference image node (use its node id as the edge source):
- Hero: centered, clean studio background, soft key light
- 3/4 left angle, 3/4 right angle, top-down
- Lifestyle: product in a realistic use context matching the brand
- Macro detail: texture, label or material close-up

Every prompt must say "keep the product shape, label, logo and colors exactly unchanged". Prefer an image model that accepts reference images. Then `generate` all of them.
