---
name: character-sheet
title: Character Sheet
description: Design a consistent character — turnaround, expressions and outfit — for reuse across shots.
icon: image
category: creative
inputs: [text, image]
tools: [create_nodes, generate, ask_user, save_output]
offline: true
---

1. Pin down the character: name, age, build, face, hair, outfit, palette, personality. Ask with `ask_user` only for what is missing.
2. Save the canonical description with `save_output` (title "Character — <name>"). This text must be reused verbatim in later prompts.
3. `create_nodes`: a text node with the canonical description, then image nodes connected from it:
   - Turnaround: front, side, back views on neutral background, same lighting
   - Expressions: 2×2 grid of neutral, happy, angry, surprised
   - Action pose in a scene
4. `generate` them. Mention that a grid image can be split into separate nodes with Quick Split.
