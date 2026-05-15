import { app, db, migrate, storage, workflow, cron, NonRetryableError, type WorkflowContinuation, type WorkflowCtx } from "flingit";
import { analyzeFrame, synthesizePlan } from "./ai/claude.js";
import { transcribeAudio } from "./ai/whisper.js";

migrate("001_create_runs", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      video_key TEXT NOT NULL,
      transcript_key TEXT,
      audio_key TEXT,
      options_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      plan_md TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
});

migrate("002_create_frames", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      ts_ms INTEGER NOT NULL,
      segment_idx INTEGER,
      reason TEXT NOT NULL,
      image_key TEXT NOT NULL,
      caption TEXT
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_frames_run ON frames(run_id)`).run();
});

migrate("003_create_segments", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS transcript_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_segments_run ON transcript_segments(run_id)`).run();
});

interface SignBody {
  ext: string;
  contentType: string;
  kind: "video" | "transcript" | "audio" | "frame";
}

app.post("/api/uploads/sign", async (c) => {
  const body = (await c.req.json()) as SignBody;
  const safeExt = (body.ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const key = `${body.kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
  const { url, expiresAt } = await storage.createUploadUrl(key, {
    expiresIn: 1800,
    contentType: body.contentType,
  });
  return c.json({ key, url, expiresAt: expiresAt.toISOString() });
});

interface CreateRunBody {
  title: string;
  source: "upload" | "recording";
  video_key: string;
  transcript_key?: string;
  audio_key?: string;
  options: { frameMode: "segments" | "scene" | "both"; maxFrames: number };
  segments?: Array<{ idx: number; start_ms: number; end_ms: number; text: string }>;
  frames: Array<{ ts_ms: number; reason: string; key: string; segment_idx?: number }>;
}

app.post("/api/runs", async (c) => {
  const body = (await c.req.json()) as CreateRunBody;
  const result = await db
    .prepare(
      `INSERT INTO runs (title, source, video_key, transcript_key, audio_key, options_json, status, progress)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`
    )
    .bind(
      body.title || "Untitled run",
      body.source,
      body.video_key,
      body.transcript_key ?? null,
      body.audio_key ?? null,
      JSON.stringify(body.options)
    )
    .run();
  const runId = Number(result.meta.last_row_id);

  if (body.segments?.length) {
    for (const s of body.segments) {
      await db
        .prepare(`INSERT INTO transcript_segments (run_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)`)
        .bind(runId, s.idx, s.start_ms, s.end_ms, s.text)
        .run();
    }
  }
  for (const f of body.frames) {
    await db
      .prepare(`INSERT INTO frames (run_id, ts_ms, segment_idx, reason, image_key) VALUES (?, ?, ?, ?, ?)`)
      .bind(runId, f.ts_ms, f.segment_idx ?? null, f.reason, f.key)
      .run();
  }

  await workflow.start("buildPlan", { runId }, { id: `run-${runId}` });
  return c.json({ id: runId }, 201);
});

app.get("/api/runs", async (c) => {
  const { results } = await db
    .prepare(`SELECT id, title, status, progress, error, created_at FROM runs ORDER BY id DESC LIMIT 100`)
    .all();
  return c.json({ runs: results });
});

app.get("/api/runs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const run = await db.prepare(`SELECT * FROM runs WHERE id = ?`).bind(id).first();
  if (!run) return c.json({ error: "not found" }, 404);
  const frames = (await db
    .prepare(`SELECT id, ts_ms, segment_idx, reason, image_key, caption FROM frames WHERE run_id = ? ORDER BY ts_ms`)
    .bind(id)
    .all()).results;
  const segments = (await db
    .prepare(`SELECT idx, start_ms, end_ms, text FROM transcript_segments WHERE run_id = ? ORDER BY idx`)
    .bind(id)
    .all()).results;
  return c.json({ run, frames, segments });
});

app.get("/api/runs/:id/plan.md", async (c) => {
  const id = Number(c.req.param("id"));
  const run = await db
    .prepare(`SELECT plan_md, title FROM runs WHERE id = ?`)
    .bind(id)
    .first<{ plan_md: string | null; title: string }>();
  if (!run?.plan_md) return c.text("Plan not ready", 404);
  return new Response(run.plan_md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${run.title.replace(/[^a-z0-9-_]/gi, "_")}-plan.md"`,
    },
  });
});

app.get("/api/frames/:id/image", async (c) => {
  const id = Number(c.req.param("id"));
  const frame = await db
    .prepare(`SELECT image_key FROM frames WHERE id = ?`)
    .bind(id)
    .first<{ image_key: string }>();
  if (!frame) return c.text("not found", 404);
  const { url } = await storage.createDownloadUrl(frame.image_key, { expiresIn: 600 });
  return c.redirect(url);
});

app.delete("/api/runs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const run = await db
    .prepare(`SELECT video_key, transcript_key, audio_key FROM runs WHERE id = ?`)
    .bind(id)
    .first<{ video_key: string; transcript_key: string | null; audio_key: string | null }>();
  const frames = (await db
    .prepare(`SELECT image_key FROM frames WHERE run_id = ?`)
    .bind(id)
    .all()).results as Array<{ image_key: string }>;
  if (run) {
    for (const k of [run.video_key, run.transcript_key, run.audio_key]) {
      if (k) try { await storage.delete(k); } catch {}
    }
    for (const f of frames) {
      try { await storage.delete(f.image_key); } catch {}
    }
  }
  await db.prepare(`DELETE FROM frames WHERE run_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM transcript_segments WHERE run_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM runs WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

async function setStatus(runId: number, status: string, progress: number, error?: string) {
  await db
    .prepare(`UPDATE runs SET status = ?, progress = ?, error = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, progress, error ?? null, runId)
    .run();
}

workflow(
  "buildPlan",
  {
    async start(ctx: WorkflowCtx): Promise<WorkflowContinuation> {
      const runId = (await ctx.get("runId")) as number;
      const run = await db
        .prepare(`SELECT * FROM runs WHERE id = ?`)
        .bind(runId)
        .first<{ transcript_key: string | null }>();
      if (!run) throw new NonRetryableError(`Run ${runId} not found`);
      const hasTranscript = !!run.transcript_key;
      await setStatus(runId, hasTranscript ? "analyzing" : "transcribing", 10);
      return { step: hasTranscript ? "loadProvidedTranscript" : "transcribe" };
    },

    async loadProvidedTranscript(ctx: WorkflowCtx): Promise<WorkflowContinuation> {
      const runId = (await ctx.get("runId")) as number;
      const existing = await db
        .prepare(`SELECT COUNT(*) as n FROM transcript_segments WHERE run_id = ?`)
        .bind(runId)
        .first<{ n: number }>();
      if (existing && existing.n > 0) return { step: "analyzeFrames" };
      const run = await db
        .prepare(`SELECT transcript_key FROM runs WHERE id = ?`)
        .bind(runId)
        .first<{ transcript_key: string }>();
      if (!run?.transcript_key) throw new NonRetryableError("No transcript key");
      const file = await storage.get(run.transcript_key);
      if (!file) throw new Error("Transcript file missing in storage");
      const text = await file.text();
      const segs = parseTranscript(text);
      for (const s of segs) {
        await db
          .prepare(`INSERT INTO transcript_segments (run_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)`)
          .bind(runId, s.idx, s.start_ms, s.end_ms, s.text)
          .run();
      }
      return { step: "analyzeFrames" };
    },

    async transcribe(ctx: WorkflowCtx): Promise<WorkflowContinuation> {
      const runId = (await ctx.get("runId")) as number;
      const existing = await db
        .prepare(`SELECT COUNT(*) as n FROM transcript_segments WHERE run_id = ?`)
        .bind(runId)
        .first<{ n: number }>();
      if (existing && existing.n > 0) return { step: "analyzeFrames" };
      const run = await db
        .prepare(`SELECT audio_key FROM runs WHERE id = ?`)
        .bind(runId)
        .first<{ audio_key: string | null }>();
      if (!run?.audio_key) throw new NonRetryableError("No audio_key for transcription");
      const audio = await storage.get(run.audio_key);
      if (!audio) throw new Error("Audio file missing");
      const buf = await audio.arrayBuffer();
      const segments = await transcribeAudio(buf, audio.contentType || "audio/mpeg");
      for (const s of segments) {
        await db
          .prepare(`INSERT INTO transcript_segments (run_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)`)
          .bind(runId, s.idx, s.start_ms, s.end_ms, s.text)
          .run();
      }
      await setStatus(runId, "analyzing", 35);
      return { step: "analyzeFrames" };
    },

    async analyzeFrames(ctx: WorkflowCtx): Promise<WorkflowContinuation> {
      const runId = (await ctx.get("runId")) as number;
      const frames = (await db
        .prepare(`SELECT id, ts_ms, segment_idx, image_key, caption FROM frames WHERE run_id = ? ORDER BY ts_ms`)
        .bind(runId)
        .all()).results as Array<{ id: number; ts_ms: number; segment_idx: number | null; image_key: string; caption: string | null }>;
      const segments = (await db
        .prepare(`SELECT idx, start_ms, end_ms, text FROM transcript_segments WHERE run_id = ? ORDER BY idx`)
        .bind(runId)
        .all()).results as Array<{ idx: number; start_ms: number; end_ms: number; text: string }>;
      const transcriptText = segments.map((s) => `[${fmtTs(s.start_ms)}] ${s.text}`).join("\n");

      let done = 0;
      for (const f of frames) {
        if (f.caption) { done++; continue; }
        const file = await storage.get(f.image_key);
        if (!file) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const b64 = bytesToBase64(bytes);
        const nearby = segments.filter(
          (s) => (s.start_ms <= f.ts_ms && s.end_ms >= f.ts_ms) || Math.abs(s.start_ms - f.ts_ms) < 5000
        );
        const caption = await analyzeFrame({
          imageBase64: b64,
          mediaType: file.contentType || "image/jpeg",
          tsMs: f.ts_ms,
          nearbyTranscript: nearby.map((s) => s.text).join(" "),
          fullTranscript: transcriptText,
        });
        await db.prepare(`UPDATE frames SET caption = ? WHERE id = ?`).bind(caption, f.id).run();
        done++;
        await setStatus(runId, "analyzing", 35 + Math.floor((done / Math.max(1, frames.length)) * 45));
      }
      return { step: "synthesize" };
    },

    async synthesize(ctx: WorkflowCtx): Promise<WorkflowContinuation> {
      const runId = (await ctx.get("runId")) as number;
      await setStatus(runId, "synthesizing", 85);
      const run = await db.prepare(`SELECT title FROM runs WHERE id = ?`).bind(runId).first<{ title: string }>();
      const frames = (await db
        .prepare(`SELECT ts_ms, reason, caption FROM frames WHERE run_id = ? ORDER BY ts_ms`)
        .bind(runId)
        .all()).results as Array<{ ts_ms: number; reason: string; caption: string | null }>;
      const segments = (await db
        .prepare(`SELECT idx, start_ms, end_ms, text FROM transcript_segments WHERE run_id = ? ORDER BY idx`)
        .bind(runId)
        .all()).results as Array<{ idx: number; start_ms: number; end_ms: number; text: string }>;

      const planMd = await synthesizePlan({
        title: run?.title || "Untitled",
        transcript: segments.map((s) => `[${fmtTs(s.start_ms)}-${fmtTs(s.end_ms)}] ${s.text}`).join("\n"),
        frameNotes: frames
          .map((f) => `- [${fmtTs(f.ts_ms)}] (${f.reason}) ${f.caption ?? "(no caption)"}`)
          .join("\n"),
      });
      await db
        .prepare(`UPDATE runs SET plan_md = ?, status = 'done', progress = 100, updated_at = datetime('now') WHERE id = ?`)
        .bind(planMd, runId)
        .run();
      return { done: true, result: { runId } };
    },
  },
  { maxAttempts: 3, stepTimeoutMS: 600000 }
);

cron("sweep-stuck-runs", "*/5 * * * *", async () => {
  await db
    .prepare(
      `UPDATE runs SET status = 'failed', error = COALESCE(error, 'Timed out (no progress for >30 min)')
       WHERE status IN ('pending','transcribing','analyzing','synthesizing')
       AND datetime(updated_at) < datetime('now', '-30 minutes')`
    )
    .run();
});

function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function parseTranscript(text: string) {
  const trimmed = text.trim();
  if (/^WEBVTT/i.test(trimmed) || /\d\d:\d\d:\d\d[.,]\d\d\d\s*-->\s*\d\d:\d\d:\d\d[.,]\d\d\d/.test(trimmed)) {
    return parseCueFormat(trimmed);
  }
  const chunks = trimmed.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const dur = 60000;
  return chunks.map((t, i) => ({
    idx: i,
    start_ms: Math.floor((i / Math.max(1, chunks.length)) * dur),
    end_ms: Math.floor(((i + 1) / Math.max(1, chunks.length)) * dur),
    text: t,
  }));
}

function parseCueFormat(text: string) {
  const out: Array<{ idx: number; start_ms: number; end_ms: number; text: string }> = [];
  const re = /(\d\d):(\d\d):(\d\d)[.,](\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d)[.,](\d\d\d)[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    const start_ms = +m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4];
    const end_ms = +m[5] * 3600000 + +m[6] * 60000 + +m[7] * 1000 + +m[8];
    const body = m[9].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (body) out.push({ idx: idx++, start_ms, end_ms, text: body });
  }
  return out;
}
