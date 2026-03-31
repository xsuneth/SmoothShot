import type { ExportRecordingResponse } from "../types";

type ExportResultProps = {
  lastExport: ExportRecordingResponse;
};

const inspectorCardClass =
  "rounded-[13px] border border-[#2a3448] bg-[rgba(13,19,30,0.92)]";

export function ExportResult({ lastExport }: ExportResultProps) {
  return (
    <section className={`${inspectorCardClass} mt-3 px-3 py-2.5`}>
      <p className="m-0 text-[0.84rem] text-[#d4e0f7]">Exported: {lastExport.outputPath}</p>
      <p className="mt-1 text-[0.84rem] text-[#d4e0f7]">
        {lastExport.width}x{lastExport.height} at {lastExport.targetFps}fps |{" "}
        {(lastExport.outputDurationMs / 1000).toFixed(2)}s
      </p>
    </section>
  );
}
