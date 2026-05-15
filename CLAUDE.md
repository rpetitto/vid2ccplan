# vid2ccplan

Fling app that turns a screen-recording walkthrough (+ optional transcript) into a thorough `plan.md` any AI app builder can consume.

Read the `fling` skill in detail!

## Architecture

- **Frontend** (`src/react-app/`): React 19 + Vite + Tailwind 4 + React Router. `ffmpeg.wasm` runs entirely in the browser to extract audio, detect scene changes, and grab keyframes — Cloudflare Workers cannot run native ffmpeg. Files upload directly to R2 via presigned URLs.
- **Backend** (`src/worker/index.ts`): Hono routes (`/api/*`), D1/SQLite tables (`runs`, `frames`, `transcript_segments`), a `buildPlan` Fling workflow (transcribe → analyze frames → synthesize), and a cron sweeper for stuck runs.
- **AI** (`src/worker/ai/`): Anthropic SDK. Vision per-frame via `claude-sonnet-4-6`; final plan synthesis via `claude-opus-4-7`. Transcription via any Whisper-compatible API (`WHISPER_BASE_URL`, default OpenAI).

## Required secrets

```
npx fling secret set ANTHROPIC_API_KEY=sk-ant-...
npx fling secret set WHISPER_API_KEY=sk-...
# optional:
npx fling secret set WHISPER_BASE_URL=https://api.openai.com/v1
npx fling secret set WHISPER_MODEL=whisper-1
```

## Constraints baked into the design

- Workers have **no ffmpeg / no child_process** → all audio/frame extraction is client-side (`@ffmpeg/ffmpeg`, single-threaded core from unpkg CDN).
- Worker bodies are limited to 100 MB → videos, audio, transcripts, and frames are uploaded via `storage.createUploadUrl` PUTs.
- Workflow steps are idempotent (re-check `transcript_segments` count, skip frames that already have captions).
