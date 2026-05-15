import type { FrameRow } from "../lib/api";

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function FrameGallery({ frames }: { frames: FrameRow[] }) {
  if (!frames.length) return <div className="text-sm text-gray-500">No frames yet.</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {frames.map((f) => (
        <div key={f.id} className="border border-gray-200 rounded-md overflow-hidden bg-white">
          <img
            src={`/api/frames/${f.id}/image`}
            alt={`Frame at ${fmt(f.ts_ms)}`}
            className="w-full aspect-video object-cover bg-gray-100"
            loading="lazy"
          />
          <div className="p-2">
            <div className="text-xs text-gray-500 flex justify-between">
              <span>{fmt(f.ts_ms)}</span>
              <span>{f.reason}</span>
            </div>
            <div className="text-sm mt-1 whitespace-pre-wrap text-gray-800">
              {f.caption || <span className="text-gray-400 italic">Pending…</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
