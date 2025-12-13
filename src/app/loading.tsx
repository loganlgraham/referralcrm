export default function Loading() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden top-progress-track" role="status" aria-label="Loading">
      <div className="top-progress-bar top-progress-animate h-full w-2/5" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
