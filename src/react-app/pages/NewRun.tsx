import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Recorder } from "../components/Recorder";
import { runPipeline, type ProgressEvent } from "../lib/pipeline";

export function NewRun() {
  const nav = useNavigate();
  const [tab, setTab] = useState<"upload" | "record">("upload");
  const [title, setTitle] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [frameMode, setFrameMode] = useState<"segments" | "scene" | "both">("both");
  const [maxFrames, setMaxFrames] = useState(40);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoBlob: Blob | null = tab === "upload" ? videoFile : recordedBlob;
  const canSubmit = !!videoBlob && !submitting;

  async function submit() {
    if (!videoBlob) return;
    setSubmitting(true);
    setError(null);
    try {
      const { runId } = await runPipeline(
        {
          title: title || (tab === "upload" ? videoFile?.name || "Upload" : "Screen recording"),
          source: tab === "upload" ? "upload" : "recording",
          videoBlob,
          transcriptFile,
          frameMode,
          maxFrames,
        },
        setProgress
      );
      nav(`/runs/${runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New run</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload a screen recording (or record one in-browser), optionally attach a transcript,
          and we'll synthesize a <code>plan.md</code> for any AI app builder.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(["upload", "record"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px " +
              (tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900")
            }
          >
            {t === "upload" ? "Upload video" : "Record screen"}
          </button>
        ))}
      </div>

      {tab === "upload" ? (
        <div className="border border-dashed border-gray-300 rounded-lg p-6 bg-white">
          <label className="block text-sm font-medium mb-2">Video file</label>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {videoFile && (
            <div className="text-xs text-gray-500 mt-2">
              {videoFile.name} • {(videoFile.size / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
        </div>
      ) : (
        <div>
          <Recorder onRecorded={setRecordedBlob} />
          {recordedBlob && (
            <div className="text-xs text-gray-500 mt-2">
              Captured {(recordedBlob.size / 1024 / 1024).toFixed(1)} MB
            </div>
          )}
        </div>
      )}

      <div className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are we building?"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Transcript file (optional — .srt, .vtt, .txt)</label>
          <input
            type="file"
            accept=".srt,.vtt,.txt,text/plain,text/vtt"
            onChange={(e) => setTranscriptFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            No transcript? We'll auto-transcribe the audio with Whisper.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Frame extraction</label>
            <select
              value={frameMode}
              onChange={(e) => setFrameMode(e.target.value as "segments" | "scene" | "both")}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="segments">Transcript segments</option>
              <option value="scene">Scene-change detection</option>
              <option value="both">Both (recommended)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max frames: {maxFrames}</label>
            <input
              type="range"
              min={10}
              max={120}
              value={maxFrames}
              onChange={(e) => setMaxFrames(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="px-5 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {submitting ? "Processing…" : "Build plan.md"}
      </button>

      {progress && (
        <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3">
          <div className="font-medium">{progress.phase}</div>
          <div className="text-xs text-gray-600">{progress.detail}</div>
          {typeof progress.percent === "number" && (
            <div className="mt-1 h-1.5 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </div>
      )}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
    </div>
  );
}
