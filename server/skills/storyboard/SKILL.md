---
name: storyboard
title: Storyboard
description: Turn an idea or brief into a shot-by-shot storyboard of keyframe images animated into video clips, added to the playlist.
icon: film
category: creative
inputs: [text, image]
tools: [get_canvas, create_nodes, generate, add_to_playlist, ask_user]
offline: true
---

Plan a storyboard, then build it on the canvas.

1. If the brief is missing essentials (subject, tone, length or platform), ask up to 3 short questions with `ask_user`. Otherwise go straight on.
2. Decide on 3–6 shots (a 15–30s piece is about 4–6 shots of 5s). Give every shot a title, a keyframe description and a motion/camera description.
3. Call `create_nodes` once with:
   - one **text** node titled "Style" holding the shared look (palette, lens, lighting, grade)
   - for each shot: an **image** node (keyframe prompt) and a **video** node (motion prompt, duration)
   - edges Style → every image, image → its video
4. Call `add_to_playlist` with the video node refs, in shot order.
5. Call `generate` on all image and video nodes (the canvas runs upstream nodes first).
6. Finish with a short summary of the shots.

Keyframe prompts: subject, action, setting, composition, lighting — concrete and visual.
Motion prompts: camera move (dolly, orbit, crane, tracking, handheld) plus subject action. Keep the character description identical across shots for consistency.
