/**
 * Voice input via the Web Speech API (SpeechRecognition).
 *
 * Browser support is uneven: works in Chromium-based browsers (Chrome,
 * Edge, Opera) + recent Safari; Firefox has it behind a flag. We
 * feature-detect and expose `isSupported` so the mic button can hide
 * when unsupported.
 *
 * The recognizer is reset between turns to avoid stale buffering. We
 * use `continuous: false` so it auto-stops after the user pauses;
 * `interimResults: true` so the textarea shows live transcript as the
 * user speaks (instead of waiting until they pause).
 *
 * Production deployers should consider:
 *   - Server-side STT (Whisper / Gemini Live) for better accuracy + privacy
 *   - Push-to-talk vs auto-detect ending
 *   - Language selection beyond browser default
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Browser typings — SpeechRecognition is vendor-prefixed.
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResult };
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  // Cast extends lib.dom Window without the banned `as unknown as T` form —
  // Window structurally satisfies SpeechRecognitionWindow's required
  // members (the two extra fields are optional, so the cast is safe).
  const w = window as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputResult {
  isSupported: boolean;
  isRecording: boolean;
  /** Most recent transcript fragment (interim + final). Cleared on start. */
  transcript: string;
  /** Last error event from the recognizer (e.g. 'no-speech', 'not-allowed'). */
  error: string | null;
  /** Start listening. No-op when unsupported or already recording. */
  start: () => void;
  /** Stop listening immediately. */
  stop: () => void;
  /** Toggle convenience. */
  toggle: () => void;
}

export function useVoiceInput(opts: {
  /** Called with the final transcript when recognition ends. */
  onFinal?: (text: string) => void;
  /** Called with each interim transcript update. */
  onInterim?: (text: string) => void;
  /** BCP-47 language code (e.g. 'en-US'). Falls back to browser default. */
  lang?: string;
} = {}): UseVoiceInputResult {
  const Ctor = getSpeechRecognitionCtor();
  const isSupported = Ctor !== null;
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => () => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const start = useCallback(() => {
    if (!Ctor || isRecording) return;
    setError(null);
    setTranscript('');
    let rec: SpeechRecognitionInstance;
    try {
      rec = new Ctor();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = opts.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const text = (final || interim).trimStart();
      setTranscript(text);
      if (final) opts.onFinal?.(final.trim());
      else if (interim) opts.onInterim?.(interim.trim());
    };
    rec.onend = () => {
      setIsRecording(false);
      recRef.current = null;
    };
    rec.onerror = (e) => {
      const reason = e.error ?? 'unknown';
      // `aborted` fires on manual stop — not a real error.
      if (reason !== 'aborted') {
        setError(`Voice input error: ${reason}`);
      }
      setIsRecording(false);
      recRef.current = null;
    };
    try {
      rec.start();
      recRef.current = rec;
      setIsRecording(true);
    } catch (err) {
      // Chrome throws InvalidStateError if a previous instance is still
      // tearing down. Surface as a friendly message.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [Ctor, isRecording, opts]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else start();
  }, [isRecording, start, stop]);

  return { isSupported, isRecording, transcript, error, start, stop, toggle };
}
