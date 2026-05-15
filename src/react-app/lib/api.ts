export interface RunRow {
  id: number;
  title: string;
  status: string;
  progress: number;
  error: string | null;
  created_at: string;
}

export interface FrameRow {
  id: number;
  ts_ms: number;
  segment_idx: number | null;
  reason: string;
  image_key: string;
  caption: string | null;
}

export interface SegmentRow {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface RunDetail {
  run: RunRow & {
    video_key: string;
    transcript_key: string | null;
    audio_key: string | null;
    options_json: string;
    plan_md: string | null;
    updated_at: string;
  };
  frames: FrameRow[];
  segments: SegmentRow[];
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function getSignedUpload(kind: string, ext: string, contentType: string): Promise<{ key: string; url: string }> {
  return j(
    await fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ext, contentType }),
    })
  );
}

export async function putToSignedUrl(url: string, blob: Blob): Promise<void> {
  const r = await fetch(url, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream" },
  });
  if (!r.ok) throw new Error(`Upload PUT failed: ${r.status} ${await r.text()}`);
}

export async function createRun(body: unknown): Promise<{ id: number }> {
  return j(
    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function listRuns(): Promise<{ runs: RunRow[] }> {
  return j(await fetch("/api/runs"));
}

export async function getRun(id: number): Promise<RunDetail> {
  return j(await fetch(`/api/runs/${id}`));
}

export async function deleteRun(id: number): Promise<void> {
  const r = await fetch(`/api/runs/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`${r.status}`);
}
