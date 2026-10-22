import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_PROFILES,
  MicCapture,
  describeMicError,
  type CaptureProfileId,
} from "@/audio/micCapture";
import {
  RealtimeTranscription,
  isBackendConfigured,
  type TranscriptionState,
} from "@/transcription/realtimeTranscription";
import {
  notConnectedEngine,
  type SuggestionEngine,
  type SuggestionResult,
} from "@/scripts/suggestionEngine";

export type Phase = "idle" | "requesting" | "active" | "paused" | "ended";

export interface TranscriptItem {
  id: string;
  text: string;
  done: boolean;
}

// Troque aqui quando existir um motor real de sugestões.
const suggestionEngine: SuggestionEngine = notConnectedEngine;

/**
 * Orquestra as três peças independentes:
 *   MicCapture (áudio) → RealtimeTranscription (texto) → SuggestionEngine (script).
 * Tudo fica apenas em memória; nada é gravado.
 */
export function useCallSession() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [deviceLabel, setDeviceLabel] = useState<string>("");
  const [applied, setApplied] = useState<MediaTrackSettings | null>(null);
  const [tState, setTState] = useState<TranscriptionState>("idle");
  const [tDetail, setTDetail] = useState<string>("");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const micRef = useRef<MicCapture | null>(null);
  const transRef = useRef<RealtimeTranscription | null>(null);
  const contextRef = useRef("");
  const itemsRef = useRef<TranscriptItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const commitItems = (next: TranscriptItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const runSuggestion = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const current = itemsRef.current;
    if (current.length === 0) return;
    setSuggesting(true);
    try {
      const result = await suggestionEngine.suggest(
        {
          context: contextRef.current,
          transcript: current.filter((i) => i.done).map((i) => i.text),
          lastClientUtterance: current[current.length - 1].text,
        },
        ctrl.signal
      );
      if (!ctrl.signal.aborted) setSuggestion(result);
    } catch {
      if (!ctrl.signal.aborted)
        setSuggestion({ ready: false, reason: "Falha ao gerar a sugestão." });
    } finally {
      if (!ctrl.signal.aborted) setSuggesting(false);
    }
  }, []);

  const releaseAll = useCallback(() => {
    abortRef.current?.abort();
    transRef.current?.close();
    transRef.current = null;
    micRef.current?.stop(); // interrompe todas as faixas
    micRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(
    async (profileId: CaptureProfileId, context: string) => {
      if (phase === "requesting" || phase === "active" || phase === "paused") return;
      setMicError(null);
      setMicNotice(null);
      setSuggestion(null);
      commitItems([]);
      contextRef.current = context.trim();
      setPhase("requesting");

      const mic = new MicCapture({
        onLevel: setLevel,
        onInterrupted: (reason) =>
          setMicNotice(
            reason === "ended"
              ? "O microfone foi desconectado. Encerre a sessão e inicie de novo."
              : "O sistema silenciou o microfone. Verifique o mudo do computador ou do fone."
          ),
        onResumed: () => setMicNotice(null),
      });
      micRef.current = mic;

      try {
        const { stream, deviceLabel, appliedSettings } = await mic.start(profileId);
        setDeviceLabel(deviceLabel);
        setApplied(appliedSettings);
        setPhase("active");

        const trans = new RealtimeTranscription({
          onState: (s, detail) => {
            setTState(s);
            setTDetail(detail ?? "");
          },
          onDelta: (id, delta) => {
            const list = itemsRef.current;
            const idx = list.findIndex((i) => i.id === id);
            if (idx === -1) {
              commitItems([...list, { id, text: delta, done: false }]);
            } else {
              const copy = list.slice();
              copy[idx] = { ...copy[idx], text: copy[idx].text + delta };
              commitItems(copy);
            }
          },
          onCompleted: (id, text) => {
            const list = itemsRef.current;
            const idx = list.findIndex((i) => i.id === id);
            const trimmed = text.trim();
            if (idx === -1) {
              if (trimmed) commitItems([...list, { id, text: trimmed, done: true }]);
            } else {
              const copy = list.slice();
              copy[idx] = { id, text: trimmed || copy[idx].text, done: true };
              commitItems(copy);
            }
            void runSuggestion();
          },
        });
        transRef.current = trans;
        // Se o backend não estiver configurado, o microfone continua ativo
        // e a interface mostra claramente que NÃO há transcrição.
        await trans.connect(stream, { context: contextRef.current });
      } catch (err) {
        const e = describeMicError(err);
        setMicError(e.message);
        releaseAll();
        setPhase("idle");
      }
    },
    [phase, releaseAll, runSuggestion]
  );

  const pause = useCallback(() => {
    micRef.current?.pause();
    setPhase("paused");
  }, []);

  const resume = useCallback(() => {
    micRef.current?.resume();
    setPhase("active");
  }, []);

  const end = useCallback(() => {
    releaseAll();
    setTState("idle");
    setTDetail("");
    setPhase("ended");
  }, [releaseAll]);

  const reset = useCallback(() => {
    commitItems([]);
    setSuggestion(null);
    setApplied(null);
    setDeviceLabel("");
    setMicNotice(null);
    setPhase("idle");
  }, []);

  // Garante liberação do microfone se a página for fechada ou o componente desmontar.
  useEffect(() => {
    const onHide = () => micRef.current?.stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      releaseAll();
    };
  }, [releaseAll]);

  return {
    phase,
    micError,
    micNotice,
    level,
    deviceLabel,
    applied,
    tState,
    tDetail,
    items,
    suggestion,
    suggesting,
    backendConfigured: isBackendConfigured(),
    profiles: CAPTURE_PROFILES,
    start,
    pause,
    resume,
    end,
    reset,
  };
}
