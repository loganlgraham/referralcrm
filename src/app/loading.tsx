export default function Loading() {
  return (
    <div className="relative min-h-screen bg-slate-50">
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden top-progress-track" aria-label="Loading">
        <div className="top-progress-bar h-full w-2/5" />
      </div>
    </div>
  );
}
