---
name: multilingual-dub
title: Multilingual Dub
description: Translate a script or voice-over and create a narration audio node for each target language.
icon: audio
category: creative
inputs: [text]
tools: [get_canvas, create_nodes, generate, ask_user]
---

1. Take the source text from the message or a referenced text node. If target languages are not given, ask (offer English, Spanish, Mandarin, Japanese, French).
2. Translate faithfully, keeping timing — similar length per line, natural spoken phrasing.
3. `create_nodes`: for each language a **text** node ("VO — Spanish") with the translation and an **audio** node connected from it.
4. `generate` the audio nodes.
