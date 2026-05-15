import { secrets } from "flingit";

const VISION_MODEL = "claude-sonnet-4-6";
const SYNTH_MODEL = "claude-opus-4-7";
const ANTHROPIC_VERSION = "2023-06-01";

interface TextBlock { type: "text"; text: string }
interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}
type ContentBlock = TextBlock | ImageBlock;

interface MessagesResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

async function callMessages(body: {
  model: string;
  max_tokens: number;
  system: string | SystemBlock[];
  messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }>;
}): Promise<string> {
  const apiKey = secrets.get("ANTHROPIC_API_KEY");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = (await resp.json()) as MessagesResponse;
  return data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

const FRAME_SYSTEM = `You are a senior product designer and frontend engineer. You are looking at a single screenshot taken from a screen-recording walkthrough. Your job is to describe, with high precision, what is visible: the screen/page identity, the layout regions (header, sidebar, main, footer, panels, modals), the components present (tables, charts, forms, cards, buttons, inputs), the data shown (sample values, column names, labels), the visual style (color palette, typography, spacing, density, shape language), and any interaction implied (hover, selection, open menu, cursor position, focused field). Be concrete; reference what is actually visible. Return 4-10 short bullet points, no preamble.`;

export async function analyzeFrame(args: {
  imageBase64: string;
  mediaType: string;
  tsMs: number;
  nearbyTranscript: string;
  fullTranscript: string;
}): Promise<string> {
  const mt = args.mediaType.startsWith("image/") ? args.mediaType : "image/jpeg";
  return callMessages({
    model: VISION_MODEL,
    max_tokens: 800,
    system: [
      { type: "text", text: FRAME_SYSTEM },
      {
        type: "text",
        text: `Full walkthrough transcript (for global context):\n${args.fullTranscript || "(none)"}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mt, data: args.imageBase64 },
          },
          {
            type: "text",
            text: `Frame timestamp: ${fmt(args.tsMs)}. Narration around this moment: "${args.nearbyTranscript || "(silence)"}". Describe this frame.`,
          },
        ],
      },
    ],
  });
}

const SYNTH_SYSTEM = `You are an expert product/engineering planner. You will receive (1) a narrated transcript of a screen-recording walkthrough and (2) structured visual notes describing key frames from that recording. The user wants to BUILD an application inspired by what they showed and said. Your output is a single, self-contained Markdown document named plan.md that any AI app builder (Claude Code, Base44, Glide, Replit, etc.) can consume to construct the app — without seeing the original video.

Be thorough, opinionated, and specific. Avoid hedging. Where the source material is ambiguous, make a reasonable choice and call it out under "Open questions". Include concrete UI copy, field names, data shapes, and interactions where the recording supports them. Do not invent timestamps; you may reference frame timestamps that appear in the input.

Required sections, in order:
1. # Title — short product name + one-line pitch
2. ## Context — why this is being built, inferred from the narration
3. ## Goals & Non-goals
4. ## Target users & primary user stories (3-6 stories in "As a … I want … so that …" form)
5. ## Screens — one ### subsection per distinct screen observed. Each includes: purpose, layout description, components, data shown, interactions, referenced frame timestamps in [mm:ss] form
6. ## Component inventory — reusable components with props
7. ## Data model — tables/collections, fields with types, relationships
8. ## API / integrations — endpoints or external services implied
9. ## User flows — step-by-step for the main flows
10. ## Visual design — colors, typography, spacing, density, tone (cite frames)
11. ## Tech-agnostic build steps — ordered checklist any builder can follow
12. ## Acceptance criteria
13. ## Open questions

Write in clear, declarative Markdown. No code fences around the whole document. Inline code fences are fine for short identifiers.`;

export async function synthesizePlan(args: {
  title: string;
  transcript: string;
  frameNotes: string;
}): Promise<string> {
  return callMessages({
    model: SYNTH_MODEL,
    max_tokens: 8000,
    system: SYNTH_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Working title: ${args.title}\n\n## Transcript (with timestamps)\n${args.transcript || "(empty)"}\n\n## Visual notes per frame\n${args.frameNotes || "(none)"}\n\nProduce the plan.md now.`,
          },
        ],
      },
    ],
  });
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
