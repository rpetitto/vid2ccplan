import { secrets } from "flingit";

interface Segment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface VerboseJsonResponse {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export async function transcribeAudio(buf: ArrayBuffer, contentType: string): Promise<Segment[]> {
  const apiKey = secrets.get("WHISPER_API_KEY");
  let baseUrl: string;
  try {
    baseUrl = secrets.get("WHISPER_BASE_URL");
  } catch {
    baseUrl = "https://api.openai.com/v1";
  }
  let model: string;
  try {
    model = secrets.get("WHISPER_MODEL");
  } catch {
    model = "whisper-1";
  }

  const form = new FormData();
  const ext = guessExt(contentType);
  form.append("file", new Blob([buf], { type: contentType }), `audio.${ext}`);
  form.append("model", model);
  form.append("response_format", "verbose_json");

  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper API ${resp.status}: ${errText.slice(0, 400)}`);
  }
  const data = (await resp.json()) as VerboseJsonResponse;
  if (data.segments && data.segments.length > 0) {
    return data.segments.map((s, i) => ({
      idx: i,
      start_ms: Math.round(s.start * 1000),
      end_ms: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));
  }
  const fallback = (data.text || "").trim();
  if (!fallback) return [];
  return [{ idx: 0, start_ms: 0, end_ms: 0, text: fallback }];
}

function guessExt(contentType: string): string {
  if (contentType.includes("mp3") || contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("ogg") || contentType.includes("opus")) return "ogg";
  if (contentType.includes("m4a") || contentType.includes("mp4")) return "m4a";
  if (contentType.includes("webm")) return "webm";
  return "mp3";
}
