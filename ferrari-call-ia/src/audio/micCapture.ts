/**
 * Captura de áudio do microfone do computador.
 *
 * Este módulo NÃO conhece transcrição nem geração de scripts.
 * Ele só abre o microfone, expõe o MediaStream, mede o nível do sinal e
 * garante que todas as faixas sejam interrompidas ao final.
 *
 * Importante: o áudio vem do MICROFONE do computador captando o alto-falante
 * do celular (viva-voz). Não há acesso direto ao WhatsApp.
 */

export type CaptureProfileId = "speakerphone" | "browser-default";

export interface CaptureProfile {
  id: CaptureProfileId;
  label: string;
  description: string;
  constraints: MediaTrackConstraints;
}

/**
 * Perfis de captura.
 *
 * "speakerphone": desliga cancelamento de eco, supressão de ruído e AGC do
 * navegador. Esses filtros foram feitos para chamadas de vídeo e tendem a
 * tratar a voz que sai de um alto-falante próximo como "eco" e atenuá-la.
 * Para captar o viva-voz do celular, o sinal bruto costuma funcionar melhor.
 *
 * "browser-default": mantém os filtros padrão, útil para comparar.
 */
export const CAPTURE_PROFILES: Record<CaptureProfileId, CaptureProfile> = {
  speakerphone: {
    id: "speakerphone",
    label: "Viva-voz (sinal bruto)",
    description:
      "Sem cancelamento de eco, sem supressão de ruído e sem ganho automático. Recomendado para captar o alto-falante do celular.",
    constraints: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  },
  "browser-default": {
    id: "browser-default",
    label: "Padrão do navegador",
    description:
      "Usa os filtros automáticos do navegador. Pode reduzir a voz do viva-voz.",
    constraints: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  },
};

export type MicErrorCode =
  | "unsupported"
  | "insecure-context"
  | "permission-denied"
  | "no-device"
  | "device-busy"
  | "overconstrained"
  | "unknown";

export class MicError extends Error {
  constructor(public code: MicErrorCode, message: string) {
    super(message);
    this.name = "MicError";
  }
}

export function describeMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new MicError(
        "permission-denied",
        "O navegador bloqueou o acesso ao microfone. Libere a permissão no ícone de cadeado da barra de endereço e tente de novo."
      );
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new MicError(
        "no-device",
        "Nenhum microfone foi encontrado neste computador."
      );
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new MicError(
        "device-busy",
        "Não foi possível abrir o microfone. Ele pode estar em uso por outro programa."
      );
    case "OverconstrainedError":
      return new MicError(
        "overconstrained",
        "O microfone selecionado não aceita a configuração pedida."
      );
    default:
      return new MicError(
        "unknown",
        `Erro inesperado ao acessar o microfone${name ? ` (${name})` : ""}.`
      );
  }
}

export interface MicCaptureEvents {
  /** Nível de 0 a 1, ~30 vezes por segundo, enquanto a captura está ativa. */
  onLevel?: (level: number) => void;
  /** O microfone foi desconectado, silenciado pelo sistema ou a faixa terminou. */
  onInterrupted?: (reason: "ended" | "muted") => void;
  /** O sinal voltou depois de um "muted". */
  onResumed?: () => void;
}

export interface MicStartResult {
  stream: MediaStream;
  deviceLabel: string;
  /** Configurações realmente aplicadas pelo navegador (podem diferir do pedido). */
  appliedSettings: MediaTrackSettings;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private rafId: number | null = null;
  private paused = false;

  constructor(private events: MicCaptureEvents = {}) {}

  get active(): boolean {
    return this.stream !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** Deve ser chamado somente a partir de um clique do usuário. */
  async start(profileId: CaptureProfileId): Promise<MicStartResult> {
    if (this.stream) throw new MicError("unknown", "A captura já está ativa.");

    if (!window.isSecureContext) {
      throw new MicError(
        "insecure-context",
        "O microfone só funciona em HTTPS ou em localhost."
      );
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError(
        "unsupported",
        "Este navegador não suporta captura de microfone."
      );
    }

    const profile = CAPTURE_PROFILES[profileId];
    let stream: MediaStream;
    try {
      // Somente áudio. Câmera nunca é solicitada.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: profile.constraints,
        video: false,
      });
    } catch (err) {
      throw describeMicError(err);
    }

    this.stream = stream;
    this.paused = false;

    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => this.events.onInterrupted?.("ended"));
    track.addEventListener("mute", () => this.events.onInterrupted?.("muted"));
    track.addEventListener("unmute", () => this.events.onResumed?.());

    this.startLevelMeter(stream);

    return {
      stream,
      deviceLabel: track.label || "Microfone padrão",
      appliedSettings: track.getSettings(),
    };
  }

  /** Pausa: a faixa continua aberta, mas envia silêncio. */
  pause(): void {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = false));
    this.paused = true;
  }

  resume(): void {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = true));
    this.paused = false;
  }

  /** Interrompe TODAS as faixas e libera o microfone. Seguro chamar várias vezes. */
  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }
    this.audioContext = null;
    this.paused = false;
    this.events.onLevel?.(0);
  }

  private startLevelMeter(stream: MediaStream) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    this.audioContext = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // não conecta ao destino: sem retorno de áudio

    const data = new Uint8Array(analyser.fftSize);
    let lastEmit = 0;

    const tick = (now: number) => {
      if (!this.stream) return;
      if (now - lastEmit > 33) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Escala simples para ficar legível na UI.
        this.events.onLevel?.(this.paused ? 0 : Math.min(1, rms * 4));
        lastEmit = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
