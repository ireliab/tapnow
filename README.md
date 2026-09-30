# TapLocal

A local, node-based AI video creation canvas modelled on [TapNow](https://www.tapnow.ai/)'s Tapflow canvas and agent.
Connect **Text → Image → Video / Audio** nodes on an infinite canvas. A tool-using **Agent** with **Skills**
plans and builds the workflow for you, **editing tools** refine the results, and **Playlists** cut them into a finished MP4.
Everything (projects, generated media, API keys) stays on this machine, in `data/`.

## Run

```bash
npm install
npm run dev          # API on 127.0.0.1:8787, UI on http://localhost:5173
```

- **Production-style:** run `npm run build`, then `npm start -w server`. The server serves the built UI at http://127.0.0.1:8787.
- **Ports and host:** override with `API_PORT` / `API_HOST`. To share view-only links on your LAN, set `API_HOST=0.0.0.0`.
- **Sandbox:** `npm run dev:sandbox` starts an isolated instance on port 5180 with its own data in `.sandbox/` and no API keys, so only the mock models are used. It's handy for trying things without touching real projects or paying for cloud models.
- **Tests:** `npm test` runs the web and server unit tests, including real-ffmpeg tests and an agent loop against a scripted fake LLM.

## Features

### Agent and Skills
| | |
| --- | --- |
| **Tool-calling agent** | Reads the canvas; creates, updates, connects and deletes nodes; generates; builds playlists; searches the web; saves documents; asks you questions. Works with any OpenAI-compatible LLM. With no LLM available, a built-in planner runs the core skills through the same tools |
| **Modes** | **Auto** generates straight away. **Ask** shows a confirmation card (model, size, duration, count, paid-model warning) before anything is spent. **Brainstorm** develops the idea one decision at a time and generates nothing |
| **Skills (Apps)** | 9 built-in: Storyboard, Brainstorm, Script→Scenes, Product Shot Set, Character Sheet, Multilingual Dub, Ad Campaign, Web Research, Explain How It's Made. Write your own in the Skills tab; they're saved as `data/skills/<name>/SKILL.md` and can override built-ins |
| **Context** | `@` to mention nodes or elements, *Insert selected nodes*, attachments, skill chips, queued follow-up messages, question cards (up to 4 questions) |
| **Conversations** | Several per project, with rename, delete and **branch from any reply**. Model and thinking level (off / light / standard / heavy) are set per conversation |
| **Memory and outputs** | "Remember …" saves lasting preferences (editable in Settings). Briefs, scripts and research are saved to the **Outputs** tab |
| **Web search** | Tavily or Brave (add a key in Settings → Web search) |

### Canvas
- **Nodes:** text (rich markdown with format bar, background colours, full-screen editor), image, video, audio.
- **Organisation:** groups (frames), **stacks** (piles of up to 50, with a gallery), colour pins with a pin bar, comments with replies, and node search (`Ctrl+F`).
- **Selection toolbar:** create one downstream node connected to all selected, stack, group, create playlist, zip download, send to the Agent, pin, save as template.
- **Wiring:**
  - Upstream text feeds downstream prompts.
  - Images become references; for video, the upper image is the first frame and the lower one the last.
  - `@Title` in a node's prompt references a specific input.
  - The right-hand **+** on a node opens a menu that adds a node already connected to it.
- **Batch count:** ×1–×4 outputs per run. Extra results can stay in the node's history, spread out as new nodes, or pile into a stack (Settings → Canvas).
- **Run all:** generates everything that has no output yet, in dependency order, with independent branches running in parallel.

### Editing tools (the ✨ menu on a node's toolbar)
Every tool writes its result to a new connected node; the original is never overwritten.

- **Image, local (no model):** Crop, Resize, Quick Split (turns a grid into separate nodes), Annotate.
- **Image, AI:** Enhance/Upscale, Cutout, Redraw and Erase (with a brush mask), Outpaint, Relight, Multi-angle.
- **Video, local (ffmpeg):** Trim, Capture frame (first / current / last), Smart Clip (splits at scene cuts).
- **Video, AI:** Continue video, Add prologue, Retake (new view, shot size or camera move), Remove / Replace object (these two need a custom fal model), lip-sync (video + audio inputs).
- **Audio:** speech, music and sound-FX modes, with speed and pitch for speech, and a waveform preview.

### Playlists
- A Playlist node lives on the canvas; the editor docks at the bottom. Create one from a selection, from the toolbar, or by dropping clips onto an existing playlist.
- **Editing:** drag to reorder, drag edges to trim, `C` splits at the playhead, `Q` / `E` trim the clip to the playhead.
- **Export:**
  - **merged MP4** (rendered with ffmpeg)
  - **export to canvas** (the merged video as a new node)
  - **numbered clips (zip)**
  - **browser WebM**

### Library, Elements, Templates, Projects
- **Library:**
  - every asset, plus a searchable history across projects
  - saved items organised in folders
- **Elements:** reusable character, product or brand reference sets. Use `@Name` in any prompt and the element's references and description are attached automatically.
- **Templates:**
  - 5 public workflow templates (short film, product ad, character sheet, music video, multilingual VO)
  - your own, saved from a selection
- **Projects:**
  - clone
  - export / import as `.taplocal.zip`
  - view-only share links, with *Explain how it's made* and *Clone to edit*
  - a template gallery for starting new projects

### Use TapLocal from other agents (MCP)
TapLocal is also an MCP server at `http://127.0.0.1:8787/mcp` (localhost only). Tools:
- `list_projects`, `create_canvas`, `list_models`, `search_library`, `list_templates`
- `generate_image`, `generate_video`, `generate_audio`, `get_job`

Generated results appear live as nodes on the open canvas.

```bash
claude mcp add --transport http taplocal http://127.0.0.1:8787/mcp
```

### Shortcuts (press `?` in the app)

| Action | Shortcut |
| --- | --- |
| Add text / image / audio node | `T` · `I` · `A` |
| Add video node | tap `V` |
| Voice input to the Agent | hold `V` |
| Open or close the Agent | `Ctrl+J` |
| Point to Edit (send the selection to the Agent) | `Ctrl+I` |
| Search nodes | `Ctrl+F` |
| Copy / paste nodes | `Ctrl+C` / `Ctrl+V` |
| Duplicate | `Ctrl+D` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Zoom in / out | `Ctrl + =` / `Ctrl + -` |
| Pan | `Space` + drag |
| Comment mode | `C` |
| Generate the selected node | `Ctrl+Enter` |
| Save now | `Ctrl+S` |

## Model providers (Settings ⚙)

| Provider | Local? | Setup |
| --- | --- | --- |
| **Mock** | yes | Always on. Placeholder images, animated-SVG "videos", tones and noise, plus mock versions of every editing tool, so the whole workflow runs offline |
| **Local LLM** | yes | Any OpenAI-compatible endpoint: Ollama (`http://localhost:11434/v1`, the default) or LM Studio. Powers the Agent and text "Expand" |
| **ComfyUI** | yes | Paste an image and/or video workflow exported with *Save (API format)*, using the placeholders `"{{prompt}}"`, `"{{image}}"`, `"{{last_image}}"`, `"{{seed}}"`, `"{{width}}"`, `"{{height}}"`, `"{{frames}}"` |
| **fal.ai** | cloud | API key. Includes FLUX dev / Kontext / Fill, Nano Banana, Kling 2.1, Veo 3, Hailuo 02, Sync lip-sync, Clarity upscaler, BiRefNet, IC-Light, ElevenLabs TTS / SFX and Stable Audio. Add more under *Custom models*; editing tools can be added via `"tool"` |
| **OpenAI** | cloud | API key. GPT Image (generate, and edit with references) and TTS |

- **Paid models:** cloud models are marked "paid" in the agent's confirm card and the tool dialogs. Cancelling a job also cancels the request on fal.ai.
- **Model IDs change:** hosted model IDs change often. If a fal model returns 404, update its ID in `server/src/providers/index.ts` or add it under *Custom models*.

## Layout

```
server/src
  index.ts            Express API, WebSocket events, routers
  agent/              tool-calling loop (SSE), tools, prompts, offline planner, conversations/memory/outputs
  skills.ts           SKILL.md loader (server/skills built-ins + data/skills)
  jobs.ts             generation queue (batch count, progress, cancel)
  providers/          mock, comfyui, fal, openai (+ LLM), model catalog incl. tool models
  ffmpeg.ts, ops.ts   trim, frames, smart clip, playlist render (ffmpeg-static)
  library.ts          library, elements, templates, project clone/export/import
  mcp.ts              MCP server for other agents
  zip.ts, search.ts   zip/unzip, Tavily/Brave web search
web/src
  store.ts            canvas state, generation, run-all, undo; canvasOps.ts for groups/stacks/pins/playlists/templates
  graph.ts            inputs, @mentions, elements, layout, topo sort (unit-tested)
  agent/              agent panel, client-side tool execution, skills and outputs tabs
  nodes/, tools/      node views, composer, rich text, editing tools, mask editor
  panels/             chrome, library, playlist editor, settings, shortcuts
```
