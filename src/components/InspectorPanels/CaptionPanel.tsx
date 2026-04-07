// Caption panel placeholder for future subtitle controls.
export function CaptionPanel() {
  return (
    <>
      <div className="shrink-0 border-b border-white/6 px-4 py-3">
        <p className="text-[0.72rem] font-semibold uppercase tracking-widest text-white/30">Caption</p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="rounded-lg border border-white/10 bg-white/4 p-3 text-[0.78rem] text-white/65">
          Caption controls are coming soon.
        </section>
      </div>
    </>
  );
}
