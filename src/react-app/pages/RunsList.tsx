import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listRuns, type RunRow } from "../lib/api";

export function RunsList() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      listRuns()
        .then((r) => { if (alive) { setRuns(r.runs); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
    tick();
    const h = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(h); };
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Runs</h1>
        <Link
          to="/new"
          className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          + New run
        </Link>
      </div>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && runs.length === 0 && (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center text-sm text-gray-600">
          No runs yet. <Link className="text-blue-700 underline" to="/new">Start one</Link>.
        </div>
      )}
      <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg bg-white">
        {runs.map((r) => (
          <li key={r.id}>
            <Link to={`/runs/${r.id}`} className="block px-4 py-3 hover:bg-gray-50">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-gray-500">{r.created_at}</div>
                </div>
                <StatusBadge status={r.status} progress={r.progress} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status, progress }: { status: string; progress: number }) {
  const tone =
    status === "done" ? "bg-green-100 text-green-800"
    : status === "failed" ? "bg-red-100 text-red-800"
    : "bg-blue-100 text-blue-800";
  return (
    <span className={`text-xs px-2 py-1 rounded ${tone}`}>
      {status === "done" || status === "failed" ? status : `${status} (${progress}%)`}
    </span>
  );
}
