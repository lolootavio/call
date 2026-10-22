/**
 * Conexão em tempo real com a API de transcrição da OpenAI (WebRTC).
 *
 * Fluxo:
 *  1. Pede ao backend (Supabase Edge Function) um token efêmero.
 *     A chave secreta da OpenAI NUNCA chega ao navegador.
 *  2. Abre RTCPeerConnection, adiciona a faixa do microfone e um data channel
 *     "oai-events" para receber os eventos de transcrição.
 *  3. Troca SDP com a OpenAI usando o token efêmero.
 *
 * Este módulo não captura áudio (recebe um MediaStream pronto) e não gera
 * sugestões: só emite texto e estados.
 */

export type TranscriptionState =
  | "idle"
  | "not_configured"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "closed";

export interface TranscriptionCallbacks {
  onState: (state: TranscriptionState, detail?: string) => void;
  /** Texto parcial de um trecho ainda em andamento. */
  onDelta: (itemId: string, text: string) => void;
  /** Trecho finalizado pelo modelo. */
  onCompleted: (itemId: string, text: string) => void;
}

export interface TranscriptionOptions {
  /** Contexto comercial opcional; ajuda o modelo com vocabulário. */
  context?: string;
}

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

function sessionEndpoint(): { url: string; anonKey: string } | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
    | string
    | undefined;
  if (!base || !anonKey) return null;
  return {
    url: `${base.replace(/\/$/, "")}/functions/v1/create-transcription-session`,
    anonKey,
  };
}

export function isBackendConfigured(): boolean {
  return sessionEndpoint() !== null;
}

class NotConfiguredError extends Error {}

async function fetchEphemeralToken(
  options: TranscriptionOptions
): Promise<string> {
  const endpoint = sessionEndpoint();
  if (!endpoint) {
    throw new NotConfiguredError(
      "Backend não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: endpoint.anonKey,
        Authorization: `Bearer ${endpoint.anonKey}`,
      },
      body: JSON.stringify({ context: options.context ?? "" }),
    });
  } catch {
    throw new Error("Não foi possível alcançar o backend (sem conexão?).");
  }

  const body = await res.json().catch(() => ({}));
  if (res.status === 503 && body?.code === "not_configured") {
    throw new NotConfiguredError(
      "A função existe, mas o segredo OPENAI_API_KEY não está configurado no Supabase."
    );
  }
  if (res.status === 404) {
    throw new NotConfiguredError(
      "A função create-transcription-session ainda não foi publicada no Supabase."
    );
  }
  if (!res.ok || typeof body?.value !== "string") {
    throw new Error(body?.error ?? `Falha ao criar sessão (HTTP ${res.status}).`);
  }
  return body.value as string;
}

export class RealtimeTranscription {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private closedByUser = false;
  private state: TranscriptionState = "idle";

  constructor(private cb: TranscriptionCallbacks) {}

  private setState(state: TranscriptionState, detail?: string) {
    this.state = state;
    this.cb.onState(state, detail);
  }

  async connect(stream: MediaStream, options: TranscriptionOptions = {}) {
    this.closedByUser = false;
    this.setState("connecting");

    let token: string;
    try {
      token = await fetchEphemeralToken(options);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        this.setState("not_configured", err.message);
      } else {
        this.setState("error", (err as Error).message);
      }
      return;
    }

    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;

      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      const channel = pc.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (e) => this.handleEvent(e.data));
      channel.addEventListener("open", () => this.setState("connected"));
      channel.addEventListener("close", () => {
        if (!this.closedByUser) this.setState("error", "Canal de transcrição encerrado.");
      });

      pc.addEventListener("connectionstatechange", () => {
        if (this.closedByUser) return;
        if (pc.connectionState === "disconnected") {
          this.setState("reconnecting", "Conexão instável com a transcrição…");
        } else if (pc.connectionState === "connected" && this.channel?.readyState === "open") {
          this.setState("connected");
        } else if (pc.connectionState === "failed") {
          this.setState("error", "A conexão com a transcrição caiu.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(OPENAI_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        throw new Error(`A OpenAI recusou a conexão (HTTP ${sdpRes.status}).`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
    } catch (err) {
      this.teardown();
      this.setState("error", (err as Error).message);
    }
  }

  private handleEvent(raw: unknown) {
    if (typeof raw !== "string") return;
    let evt: { type?: string; item_id?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }

    switch (evt.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (evt.item_id && evt.delta) this.cb.onDelta(evt.item_id, evt.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (evt.item_id) this.cb.onCompleted(evt.item_id, evt.transcript ?? "");
        break;
      case "error":
        this.setState("error", evt.error?.message ?? "Erro na transcrição.");
        break;
    }
  }

  private teardown() {
    try {
      this.channel?.close();
    } catch {
      /* ignora */
    }
    try {
      // Não para as faixas: quem é dono do microfone é o MicCapture.
      this.pc?.getSenders().forEach((s) => s.replaceTrack(null).catch(() => {}));
      this.pc?.close();
    } catch {
      /* ignora */
    }
    this.channel = null;
    this.pc = null;
  }

  close() {
    this.closedByUser = true;
    this.teardown();
    if (this.state !== "not_configured") this.setState("closed");
  }
}
