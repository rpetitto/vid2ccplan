interface Props {
  status: string;
  progress: number;
  error: string | null;
}

const STEPS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Queued" },
  { key: "transcribing", label: "Transcribe" },
  { key: "analyzing", label: "Analyze frames" },
  { key: "synthesizing", label: "Synthesize plan" },
  { key: "done", label: "Done" },
];

export function StepIndicator({ status, progress, error }: Props) {
  const activeIdx = Math.max(0, STEPS.findIndex((s) => s.key === status));
  return (
    <div>
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const reached = i <= activeIdx || status === "done";
          const active = i === activeIdx && status !== "done";
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium " +
                  (status === "failed" && i === activeIdx
                    ? "bg-red-600 text-white"
                    : reached
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-600")
                }
              >
                {i + 1}
              </div>
              <span className={"text-sm " + (active ? "font-semibold" : "text-gray-600")}>{s.label}</span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-300" />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 h-2 bg-gray-200 rounded overflow-hidden">
        <div
          className={"h-full transition-all " + (status === "failed" ? "bg-red-600" : "bg-blue-600")}
          style={{ width: `${progress}%` }}
        />
      </div>
      {error && <div className="mt-2 text-sm text-red-600">Error: {error}</div>}
    </div>
  );
}
