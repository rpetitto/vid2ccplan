import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { NewRun } from "./pages/NewRun";
import { RunsList } from "./pages/RunsList";
import { RunDetail } from "./pages/RunDetail";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <header className="border-b border-gray-200 bg-white">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link to="/" className="font-bold text-lg">vid2ccplan</Link>
            <Link to="/new" className="text-sm text-blue-700 hover:underline">New run</Link>
          </div>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<RunsList />} />
            <Route path="/new" element={<NewRun />} />
            <Route path="/runs/:id" element={<RunDetail />} />
          </Routes>
        </main>
        <a
          href="https://flingit.io"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-4 left-4 flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full shadow-sm text-xs text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
        >
          <img src="/fling.svg" alt="Fling" className="w-4 h-4" />
          Made with Fling
        </a>
      </div>
    </BrowserRouter>
  );
}
