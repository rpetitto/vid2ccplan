import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRun, getRun, type RunDetail as RunDetailT } from "../lib/api";
import { StepIndicator } from "../components/StepIndicator";
import { FrameGallery } from "../components/FrameGallery";
import { MarkdownView } from "../components/MarkdownView";

export function RunDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<RunDetailT | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"plan" | "frames" | "transcript">("plan");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const tick = () =>
      getRun(Number(id))
        .then((d) => { if (alive) setData(d); })
        .catch((e) => { if (alive) setErr(String(e)); });
    tick();
    const h = window.setInterval(() => {
      if (data?.run.status === "done" || data?.run.status === "failed") return;
      tick();
    }, 2000);
    return () => { alive = false; window.clearInterval(h); };
  }, [id, data?.run.status]);

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!data) return <div className="p-6 text-gray-500">Loading…</div>;
  const { run, frames, segments } = data;

  async function onDelete() {
    if (!run) return;
    if (!confirm("Delete this run and all its data?")) return;
    await deleteRun(run.id);
    nav("/");
  }

  async function onCopy() {
    if (!run.plan_md) return;
    await navigator.clipboard.writeText(run.plan_md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-blue-700 hover:underline">← All runs</Link>
          <h1 className="text-2xl font-bold mt-1">{run.title}</h1>
          <div className="text-xs text-gray-500">Run #{run.id} • {run.created_at}</div>
        </div>
        <div className="flex gap-2">
          {run.plan_md && (
            <>
              <button
                onClick={onCopy}
                className="px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 text-sm"
              >
                {copied ? "Copied!" : "Copy plan.md"}
              </button>
              <a
                href={`/api/runs/${run.id}/plan.md`}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
              >
                Download
              </a>
            </>
          )}
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 text-sm"
          >
            Delete
          </button>
        </div>
      </div>

      <StepIndicator status={run.status} progress={run.progress} error={run.error} />

      <div className="flex gap-1 border-b border-gray-200">
        {(["plan", "frames", "transcript"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize " +
              (tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900")
            }
          >
            {t} {t === "frames" ? `(${frames.length})` : t === "transcript" ? `(${segments.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "plan" && (
        run.plan_md ? (
          <div className="border border-gray-200 rounded-lg p-6 bg-white">
            <MarkdownView md={run.plan_md} />
          </div>
        ) : (
          <div className="text-sm text-gray-500">Plan will appear here when synthesis completes.</div>
        )
      )}

      {tab === "frames" && <FrameGallery frames={frames} />}

      {tab === "transcript" && (
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
          {segments.length === 0 && <div className="p-4 text-sm text-gray-500">No transcript yet.</div>}
          {segments.map((s) => (
            <div key={s.idx} className="p-3 text-sm flex gap-3">
              <span className="text-xs text-gray-500 font-mono shrink-0 w-20">
                {fmt(s.start_ms)}–{fmt(s.end_ms)}
              </span>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
