# TapLocal

A local, node-based AI video creation canvas inspired by TapNow's Tapflow canvas.
Build workflows by connecting **Text → Image → Video / Audio** nodes on an infinite canvas,
let an **Agent** plan storyboards, and cut the results together on a **Timeline** that exports WebM.
Everything (projects, generated media, API keys) stays on this machine in `data/`.

## Run

```bash
npm install
npm run dev          # API on 127.0.0.1:8787, UI on http://localhost:5173
```

Production-style: `npm run build`, then `npm start -w server` serves the built UI on http://127.0.0.1:8787.
Override the API port or host with `API_PORT` / `API_HOST`.

## Features

| Area | What it does |
| --- | --- |
| Canvas | Infinite canvas, minimap, box select, pan with scroll, undo/redo, duplicate, autosave |
| Nodes | Text, Image, Video, Audio. Each has a docked prompt composer, model picker, aspect, duration, seed, and a generation history strip |
| Wiring | Upstream text is prepended to the prompt; images become references. For video, the top image is the first frame and the one below it the last frame. Drag a wire into empty space to create a connected node |
| Run all | Generates every node that has no output yet, in dependency order, with independent branches running in parallel |
| Agent | Turns an idea into a storyboard (style text → keyframe image → clip video for each shot) and runs it. Uses your local LLM, or a built-in heuristic planner when no LLM is reachable |
| Assets | Every upload and generation, filterable; drag assets onto the canvas. You can also drop or paste files onto the canvas directly |
| Timeline | Generated clips are added automatically; reorder, preview, and **export WebM** in the browser (no ffmpeg needed) |
| Projects | Multiple projects with thumbnails |

Shortcuts: `T` `I` `V` `A` add nodes · double-click canvas for the add menu · `Ctrl+Enter` generate ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `Delete` remove · `Ctrl+S` save.

## Model providers (Settings ⚙)

| Provider | Local? | Setup |
| --- | --- | --- |
| **Mock** | yes | Always on. Produces placeholder images, animated-SVG "videos", tones, and prompt rewrites, so the whole workflow runs offline |
| **Local LLM** | yes | Any OpenAI-compatible endpoint: Ollama (`http://localhost:11434/v1`, default) or LM Studio. Powers the Agent and text "Expand" |
| **ComfyUI** | yes | Paste an image and/or video workflow exported with *Save (API format)*, using placeholders `"{{prompt}}"`, `"{{image}}"`, `"{{last_image}}"`, `"{{seed}}"`, `"{{width}}"`, `"{{height}}"`, `"{{frames}}"`. Lets you run FLUX, SDXL, Wan, LTX-Video and similar models on your own GPU |
| **fal.ai** | cloud | API key. Built-in: FLUX dev, FLUX Kontext, Nano Banana edit, Kling 2.1 (T2V / I2V with tail frame), Veo 3, Hailuo 02. Add more under *Custom models* |
| **OpenAI** | cloud | API key. GPT Image (generate + edit with references) and TTS |

Hosted model IDs change often. If a fal model returns 404, update its id in
`server/src/providers/index.ts` or add it under *Custom models*.

## Layout

```
server/src
  index.ts           Express API + WebSocket job updates
  jobs.ts            queue (3 concurrent), progress, cancel, downloads results into data/files
  agent.ts           storyboard planner (LLM + offline fallback)
  store.ts           projects / assets / settings persisted as JSON in data/
  providers/         mock, comfyui, fal, openai (+ LLM), model catalog
web/src
  store.ts           zustand store: graph, generation, run-all, undo, timeline, storyboard builder
  graph.ts           input resolution, topo sort, connection rules (unit-tested)
  nodes/             node card + docked composer
  panels/            top bar, toolbar, agent, assets, timeline, settings, projects
  exporter.ts        canvas + MediaRecorder sequence player / WebM exporter
```
