/**
 * Audio recorder for multi-modal chat input.
 *
 * Captures mic audio via MediaRecorder, exposes the recorded blob +
 * duration on stop. Caller bundles into a ContentPart and sends it as
 * part of the next chat message — bypassing the Web Speech API entirely
 * (which fails when `*.googleapis.com` is blocked).
 *
 * Works in any browser that supports MediaRecorder + getUserMedia
 * (i.e., everything modern except Safari < 14). No external service
 * is required for capture itself; transcription happens on the model
 * server-side when the audio part lands in the chat turn.
 *
 * Format note: Chrome produces `audio/webm;codecs=opus` by default,
 * Firefox `audio/ogg;codecs=opus`, Safari `audio/mp4`. We probe
 * MediaRecorder.isTypeSupported for the best provider-compatible
 * format. Gemini accepts ogg/opus + webm/opus + mp4; we go with
 * webm/opus on Chromium, falling back to whatever the browser does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecordedAudio {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

export interface UseAudioRecorderResult {
  isSupported: boolean;
  isRecording: boolean;
  /** Last error from getUserMedia or MediaRecorder. */
  error: string | null;
  /** Start a new recording. Resolves once the mic stream is live. */
  start: () => Promise<void>;
  /** Stop the in-flight recording. Resolves with the captured audio. */
  stop: () => Promise<RecordedAudio | null>;
  /** Abort + discard any in-flight recording. */
  cancel: () => void;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'audio/webm';
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const isSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof MediaRecorder !== 'undefined';

  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const stopResolveRef = useRef<((value: RecordedAudio | null) => void) | null>(null);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = useCallback(async () => {
    if (!isSupported || isRecording) return;
    setError(null);
    chunksRef.current = [];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError(`Microphone access denied or unavailable: ${reason}`);
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const durationSeconds = Math.max(0.1, (Date.now() - startedAtRef.current) / 1000);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setIsRecording(false);
      stopResolveRef.current?.({ blob, mimeType, durationSeconds });
      stopResolveRef.current = null;
    };
    rec.onerror = (e) => {
      const reason = (e as ErrorEvent).message ?? 'unknown recorder error';
      setError(reason);
    };
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    rec.start();
    setIsRecording(true);
  }, [isSupported, isRecording]);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return null;
    return new Promise<RecordedAudio | null>((resolve) => {
      stopResolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rec && rec.state !== 'inactive') {
      stopResolveRef.current = () => {/* discard */};
      try { rec.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
  }, []);

  return { isSupported, isRecording, error, start, stop, cancel };
}

/** Convert a Blob to a base64-encoded string (no data URI prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string for audio blob'));
        return;
      }
      // result is "data:audio/webm;base64,<...>" — strip the prefix.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
