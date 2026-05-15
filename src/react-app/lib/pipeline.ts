import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { parseTranscriptFile, pickFrameTimestamps, type ParsedSegment } from "./srt";
import { getSignedUpload, putToSignedUrl, createRun } from "./api";

const CORE_VERSION = "0.12.9";
// Vite builds the ffmpeg worker as a module worker, so we need the ESM build
// of ffmpeg-core (the UMD build relies on importScripts, unavailable in module workers).
const CORE_BASES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

let _ffmpeg: FFmpeg | null = null;
let _loaded = false;

async function fetchBlobUrl(paths: string[], mime: string): Promise<string> {
  let lastErr: unknown;
  for (const url of paths) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      const blob = await r.blob();
      return URL.createObjectURL(new Blob([blob], { type: mime }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to fetch from any CDN. Last error: ${String(lastErr)}`);
}

async function getFfmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (_ffmpeg && _loaded) return _ffmpeg;
  const ff = new FFmpeg();
  if (onLog) ff.on("log", ({ message }) => onLog(message));
  const coreURL = await fetchBlobUrl(
    CORE_BASES.map((b) => `${b}/ffmpeg-core.js`),
    "text/javascript"
  );
  const wasmURL = await fetchBlobUrl(
    CORE_BASES.map((b) => `${b}/ffmpeg-core.wasm`),
    "application/wasm"
  );
  try {
    await ff.load({ coreURL, wasmURL });
  } catch (e) {
    throw new Error(`ffmpeg.load() failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  _ffmpeg = ff;
  _loaded = true;
  return ff;
}

export interface PipelineOptions {
  title: string;
  source: "upload" | "recording";
  videoBlob: Blob;
  transcriptFile?: File | null;
  frameMode: "segments" | "scene" | "both";
  maxFrames: number;
}

export interface ProgressEvent {
  phase: string;
  detail?: string;
  percent?: number;
}

export async function runPipeline(opts: PipelineOptions, onProgress: (e: ProgressEvent) => void): Promise<{ runId: number }> {
  onProgress({ phase: "init", detail: "Loading ffmpeg…" });
  const logLines: string[] = [];
  const ff = await getFfmpeg((line) => {
    logLines.push(line);
    if (logLines.length > 4000) logLines.shift();
  });

  const videoName = "input." + guessExt(opts.videoBlob.type, "webm");
  await ff.writeFile(videoName, await fetchFile(opts.videoBlob));

  onProgress({ phase: "probe", detail: "Probing duration…" });
  let durationMs = 0;
  try {
    const before = logLines.length;
    await ff.exec(["-i", videoName, "-hide_banner"]);
    durationMs = parseDuration(logLines.slice(before).join("\n"));
  } catch {
    durationMs = parseDuration(logLines.join("\n"));
  }

  let segments: ParsedSegment[] = [];
  let transcriptKey: string | undefined;
  let audioKey: string | undefined;

  if (opts.transcriptFile) {
    const text = await opts.transcriptFile.text();
    segments = parseTranscriptFile(text);
    onProgress({ phase: "transcript", detail: `Parsed ${segments.length} segments from transcript.` });

    const ext = (opts.transcriptFile.name.split(".").pop() || "txt").toLowerCase();
    const signed = await getSignedUpload("transcript", ext, opts.transcriptFile.type || "text/plain");
    await putToSignedUrl(signed.url, opts.transcriptFile);
    transcriptKey = signed.key;
  } else {
    onProgress({ phase: "extract-audio", detail: "Extracting audio for transcription…" });
    await ff.exec([
      "-i", videoName,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      "-f", "mp3",
      "audio.mp3",
    ]);
    const audioBytes = (await ff.readFile("audio.mp3")) as Uint8Array;
    const audioBuf = audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength) as ArrayBuffer;
    const audioBlob = new Blob([audioBuf], { type: "audio/mpeg" });
    const signed = await getSignedUpload("audio", "mp3", "audio/mpeg");
    await putToSignedUrl(signed.url, audioBlob);
    audioKey = signed.key;
  }

  let sceneTimestamps: number[] = [];
  if (opts.frameMode === "scene" || opts.frameMode === "both") {
    onProgress({ phase: "scene-detect", detail: "Detecting scene changes…" });
    const before = logLines.length;
    try {
      await ff.exec([
        "-i", videoName,
        "-vf", "select='gt(scene,0.3)',showinfo",
        "-vsync", "vfr",
        "-f", "null", "-",
      ]);
    } catch {}
    sceneTimestamps = parseSceneTimes(logLines.slice(before).join("\n"));
  }

  const picks = pickFrameTimestamps(segments, durationMs, {
    frameMode: opts.frameMode,
    maxFrames: opts.maxFrames,
    sceneTimestamps,
  });
  onProgress({ phase: "frames", detail: `Extracting ${picks.length} frames…`, percent: 0 });

  const frameUploads: Array<{ ts_ms: number; reason: string; segment_idx?: number; key: string }> = [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const outName = `frame_${i}.jpg`;
    const tsSec = (p.ts_ms / 1000).toFixed(3);
    try {
      await ff.exec([
        "-ss", tsSec,
        "-i", videoName,
        "-frames:v", "1",
        "-vf", "scale='min(1280,iw)':-2",
        "-q:v", "4",
        outName,
      ]);
      const bytes = (await ff.readFile(outName)) as Uint8Array;
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([buf], { type: "image/jpeg" });
      const signed = await getSignedUpload("frame", "jpg", "image/jpeg");
      await putToSignedUrl(signed.url, blob);
      frameUploads.push({ ts_ms: p.ts_ms, reason: p.reason, segment_idx: p.segment_idx, key: signed.key });
      try { await ff.deleteFile(outName); } catch {}
    } catch (e) {
      console.warn("frame extract failed at", tsSec, e);
    }
    onProgress({ phase: "frames", detail: `Uploaded ${i + 1}/${picks.length}`, percent: Math.floor(((i + 1) / picks.length) * 100) });
  }

  onProgress({ phase: "upload-video", detail: "Uploading source video…" });
  const videoSigned = await getSignedUpload("video", guessExt(opts.videoBlob.type, "webm"), opts.videoBlob.type || "video/webm");
  await putToSignedUrl(videoSigned.url, opts.videoBlob);

  try { await ff.deleteFile(videoName); } catch {}

  onProgress({ phase: "submit", detail: "Submitting run…" });
  const { id } = await createRun({
    title: opts.title,
    source: opts.source,
    video_key: videoSigned.key,
    transcript_key: transcriptKey,
    audio_key: audioKey,
    options: { frameMode: opts.frameMode, maxFrames: opts.maxFrames },
    segments: segments.length ? segments : undefined,
    frames: frameUploads,
  });

  onProgress({ phase: "done", detail: "Submitted." });
  return { runId: id };
}

function guessExt(mime: string, fallback: string): string {
  if (!mime) return fallback;
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
  if (mime.includes("matroska") || mime.includes("mkv")) return "mkv";
  return fallback;
}

function parseDuration(log: string): number {
  const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return (+m[1]) * 3600000 + (+m[2]) * 60000 + Math.floor(parseFloat(m[3]) * 1000);
}

function parseSceneTimes(log: string): number[] {
  const out: number[] = [];
  const re = /pts_time:([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    out.push(Math.floor(parseFloat(m[1]) * 1000));
  }
  return out;
}
