---
name: script-to-scenes
title: Script to Scenes
description: Split a pasted script or brief into scenes, each becoming a draftable keyframe + clip pair on the canvas.
icon: text
category: creative
inputs: [text]
tools: [get_canvas, create_nodes, add_to_playlist, generate, save_output]
offline: true
---

1. Read the script (from the message or referenced text nodes). Segment it into scenes at location/time changes or major beats. Keep dialogue lines attached to the scene they belong to.
2. Save a clean scene list with `save_output` (title "Scene breakdown").
3. `create_nodes`: for each scene a **text** node with the scene's script excerpt, an **image** keyframe node and a **video** node; edges text → image → video.
4. `add_to_playlist` with the video nodes in order.
5. In Auto mode, `generate` them; otherwise stop and tell the user the scenes are ready to review.
