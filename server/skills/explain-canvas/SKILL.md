---
name: explain-canvas
title: Explain How It's Made
description: Walk through how the current canvas was built — the pipeline, prompts, models and connections — so it can be learned or remixed.
icon: grid
category: utility
inputs: []
tools: [get_canvas, save_output]
offline: true
---

Call `get_canvas`, then explain the workflow in order of the connections:
- what each stage is for (style → keyframes → clips → audio → playlist)
- the key prompt ideas and which models were used
- how outputs flow downstream (text feeds prompts, images are references or first/last frames)
- 2–3 concrete tips to remix it

Keep it skimmable with short headings. Offer to save it with `save_output`.
