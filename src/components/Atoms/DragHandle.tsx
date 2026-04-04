
export default function DragHandle() {
  return (
    <div className="flex h-7 w-4 items-center justify-center">
      <div
        className="h-5 w-[10px] opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.36) 1px, transparent 1px)",
          backgroundSize: "4px 4px",
          backgroundPosition: "0 0",
        }}
      />
    </div>
  );
}