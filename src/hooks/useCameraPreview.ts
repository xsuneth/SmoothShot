import { useEffect, useRef, useState } from "react";

export interface UseCameraPreviewResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  streamRef: React.RefObject<MediaStream | null>;
  error: string | null;
  isStreaming: boolean;
}

interface UseCameraPreviewParams {
  cameraName: string | null;
}

/**
 * Finds a browser media device whose label matches the given camera name.
 * Returns the deviceId or null if no match is found.
 */
async function findDeviceByName(name: string): Promise<string | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  if (videoDevices.length === 0) return null;

  const nameLower = name.toLowerCase();
  const match = videoDevices.find((d) => {
    const label = d.label.toLowerCase();
    return label === nameLower || label.includes(nameLower) || nameLower.includes(label);
  });

  return match?.deviceId ?? videoDevices[0]?.deviceId ?? null;
}

/**
 * Uses the browser's native getUserMedia API for hardware-accelerated camera
 * preview. This bypasses all Rust IPC and gives OBS-level smooth rendering.
 */
export function useCameraPreview({ cameraName }: UseCameraPreviewParams): UseCameraPreviewResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!cameraName) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsStreaming(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        // Request a temporary stream to get permission and populate device labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach((t) => t.stop());

        if (cancelled) return;

        const deviceId = await findDeviceByName(cameraName);
        if (cancelled) return;

        if (!deviceId) {
          setError(`Camera "${cameraName}" not found`);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        // Stop the previous stream if switching cameras
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setIsStreaming(true);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setIsStreaming(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setIsStreaming(false);
    };
  }, [cameraName]);

  return { videoRef, streamRef, error, isStreaming };
}
