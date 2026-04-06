import type { ComponentProps } from "react";

import { EditorHeader } from "../components/EditorHeader";
import { EditorInspector } from "../components/EditorInspector";
import { EditorPreview } from "../components/EditorPreview";
import { ExportResult } from "../components/ExportResult";
import { TimelinePanel } from "../components/TimelinePanel";

type EditorWindowProps = {
  headerProps: ComponentProps<typeof EditorHeader>;
  previewProps: ComponentProps<typeof EditorPreview>;
  inspectorProps: ComponentProps<typeof EditorInspector>;
  timelineProps: ComponentProps<typeof TimelinePanel>;
  lastExport: ComponentProps<typeof ExportResult>["lastExport"] | null;
  message: string;
};

export function EditorWindow({
  headerProps,
  previewProps,
  inspectorProps,
  timelineProps,
  lastExport,
  message,
}: EditorWindowProps) {
  return (
    <main className="grid h-screen grid-rows-[56px_minmax(0,1fr)_auto_auto] overflow-hidden bg-[#05060b] text-white">
      <EditorHeader {...headerProps} />

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden max-[1120px]:grid-cols-1">
        <EditorPreview {...previewProps} />
        <EditorInspector {...inspectorProps} />
      </section>

      <TimelinePanel {...timelineProps} />

      {lastExport && <ExportResult lastExport={lastExport} />}

      <p className="shrink-0 px-4 py-2 text-[0.82rem] text-[#8f9bb8]">{message}</p>
    </main>
  );
}
