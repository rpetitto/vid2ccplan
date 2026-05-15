import { useEffect, useRef, useState } from "react";

interface Props {
  onRecorded: (blob: Blob) => void;
}

export function Recorder({ onRecorded }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    recRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      streamsRef.current.push(display);

      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamsRef.current.push(mic);
      } catch {
        mic = null;
      }

      const combined = new MediaStream();
      display.getVideoTracks().forEach((t) => combined.addTrack(t));

      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      if (display.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      }
      if (mic && mic.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream(mic.getAudioTracks())).connect(dest);
      }
      dest.stream.getAudioTracks().forEach((t) => combined.addTrack(t));

      const mime = pickMime();
      const rec = new MediaRecorder(combined, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
        stopAll();
        setRecording(false);
        onRecorded(blob);
      };
      display.getVideoTracks()[0].addEventListener("ended", () => {
        if (rec.state === "recording") rec.stop();
      });
      rec.start(1000);
      recRef.current = rec;
      setRecording(true);
      setElapsed(0);
      const t0 = Date.now();
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stopAll();
    }
  }

  function stop() {
    if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-center gap-3">
        {!recording ? (
          <button
            onClick={start}
            className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
          >
            ● Start screen recording
          </button>
        ) : (
          <button
            onClick={stop}
            className="px-4 py-2 rounded-md bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium"
          >
            ■ Stop ({Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")})
          </button>
        )}
        <span className="text-xs text-gray-500">
          Records your screen + microphone. Stop sharing in the browser bar also stops the recording.
        </span>
      </div>
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </div>
  );
}

function pickMime(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}
