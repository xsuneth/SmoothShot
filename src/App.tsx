import { useState } from "react";

import { CameraPreviewApp } from "./apps/CameraPreviewApp";
import { detectWindowLabel, initialViewForWindow } from "./apps/appUtils";
import { DisplayPickerApp } from "./apps/DisplayPickerApp";
import { EditorApp } from "./apps/EditorApp";
import { LauncherApp } from "./apps/LauncherApp";

function App() {
  const [windowLabel] = useState(() => detectWindowLabel());
  const view = initialViewForWindow(windowLabel);
  if (view === "displayPicker") return <DisplayPickerApp />;
  if (view === "cameraPreview") return <CameraPreviewApp />;
  if (view === "editor") return <EditorApp />;
  return <LauncherApp />;
}

export default App;
