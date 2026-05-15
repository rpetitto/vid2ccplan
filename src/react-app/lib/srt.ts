export interface ParsedSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export function parseTranscriptFile(text: string): ParsedSegment[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/^WEBVTT/i.test(trimmed) || /\d\d:\d\d:\d\d[.,]\d\d\d\s*-->\s*\d\d:\d\d:\d\d[.,]\d\d\d/.test(trimmed)) {
    return parseCue(trimmed);
  }
  // Plain text: one segment per paragraph; no real timings.
  const chunks = trimmed.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  return chunks.map((t, i) => ({
    idx: i,
    start_ms: 0,
    end_ms: 0,
    text: t,
  }));
}

function parseCue(text: string): ParsedSegment[] {
  const out: ParsedSegment[] = [];
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

export function pickFrameTimestamps(
  segments: ParsedSegment[],
  durationMs: number,
  opts: { frameMode: "segments" | "scene" | "both"; maxFrames: number; sceneTimestamps?: number[] }
): Array<{ ts_ms: number; reason: string; segment_idx?: number }> {
  const picks: Array<{ ts_ms: number; reason: string; segment_idx?: number }> = [];
  const hasTimings = segments.some((s) => s.end_ms > s.start_ms);

  if ((opts.frameMode === "segments" || opts.frameMode === "both") && hasTimings) {
    for (const s of segments) {
      const mid = Math.floor((s.start_ms + s.end_ms) / 2);
      picks.push({ ts_ms: Math.max(0, s.start_ms + 200), reason: "segment-start", segment_idx: s.idx });
      if (s.end_ms - s.start_ms > 2500) {
        picks.push({ ts_ms: mid, reason: "segment-mid", segment_idx: s.idx });
      }
    }
  }

  if (opts.frameMode === "scene" || opts.frameMode === "both") {
    for (const t of opts.sceneTimestamps ?? []) {
      picks.push({ ts_ms: t, reason: "scene-change" });
    }
  }

  // Always sample a few uniform fallbacks if we got nothing useful.
  if (picks.length === 0 && durationMs > 0) {
    const n = Math.min(opts.maxFrames, 8);
    for (let i = 0; i < n; i++) {
      picks.push({ ts_ms: Math.floor(((i + 0.5) / n) * durationMs), reason: "uniform" });
    }
  }

  picks.sort((a, b) => a.ts_ms - b.ts_ms);
  const deduped: typeof picks = [];
  for (const p of picks) {
    if (deduped.length && Math.abs(deduped[deduped.length - 1].ts_ms - p.ts_ms) < 500) continue;
    deduped.push(p);
  }
  if (deduped.length <= opts.maxFrames) return deduped;
  const stride = deduped.length / opts.maxFrames;
  const out: typeof picks = [];
  for (let i = 0; i < opts.maxFrames; i++) out.push(deduped[Math.floor(i * stride)]);
  return out;
}
