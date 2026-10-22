import { useEffect, useMemo, useRef, useState } from "react";
import { useCallSession } from "@/hooks/useCallSession";
import type { CaptureProfileId } from "@/audio/micCapture";
import type { TranscriptionState } from "@/transcription/realtimeTranscription";

const CONTEXT_PRESETS = [
  "Venda de imóveis na planta",
  "Primeiro imóvel",
  "Financiamento habitacional",
];

const T_LABEL: Record<TranscriptionState, string> = {
  idle: "Transcrição inativa",
  not_configured: "Transcrição não configurada",
  connecting: "Conectando à transcrição…",
  connected: "Transcrição conectada",
  reconnecting: "Reconectando…",
  error: "Erro na transcrição",
  closed: "Transcrição encerrada",
};

const T_TONE: Record<TranscriptionState, string> = {
  idle: "muted",
  not_configured: "warn",
  connecting: "info",
  connected: "ok",
  reconnecting: "warn",
  error: "bad",
  closed: "muted",
};

export default function App() {
  const s = useCallSession();
  const [context, setContext] = useState("");
  const [profile, setProfile] = useState<CaptureProfileId>("speakerphone");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const live = s.phase === "active" || s.phase === "paused";
  const micOn = s.phase === "active";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [s.items]);

  const lastItem = s.items[s.items.length - 1];
  const suggestionText =
    s.suggestion && s.suggestion.ready ? s.suggestion.text : null;

  const copy = async () => {
    if (!suggestionText) return;
    try {
      await navigator.clipboard.writeText(suggestionText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard bloqueado */
    }
  };

  const appliedSummary = useMemo(() => {
    if (!s.applied) return "";
    const f = (v: boolean | undefined) => (v ? "ligado" : "desligado");
    return `Eco: ${f(s.applied.echoCancellation)} · Ruído: ${f(
      s.applied.noiseSuppression
    )} · Ganho auto: ${f(s.applied.autoGainControl)}`;
  }, [s.applied]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <h1>Ferrari call ia</h1>
            <p>Apoio em tempo real para ligações em viva-voz</p>
          </div>
        </div>

        <div className="statuses" role="status" aria-live="polite">
          <span className={`pill ${micOn ? "rec" : s.phase === "paused" ? "warn" : "muted"}`}>
            <i className={`dot ${micOn ? "pulse" : ""}`} />
            {micOn
              ? "Microfone ativo"
              : s.phase === "paused"
              ? "Microfone pausado"
              : "Microfone desligado"}
          </span>
          <span className={`pill ${T_TONE[s.tState]}`}>
            <i className="dot" />
            {T_LABEL[s.tState]}
          </span>
        </div>
      </header>

      <main className="grid">
        <section className="card controls">
          <div className="source-note">
            <strong>Fonte do áudio:</strong> microfone do computador. O app
            escuta o viva-voz do celular; ele <u>não</u> se conecta ao WhatsApp.
          </div>

          <label className="field">
            <span>Contexto comercial (opcional)</span>
            <input
              type="text"
              value={context}
              maxLength={200}
              disabled={live}
              placeholder="Ex.: venda de imóveis na planta"
              onChange={(e) => setContext(e.target.value)}
            />
            <div className="chips">
              {CONTEXT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chip"
                  disabled={live}
                  onClick={() => setContext(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Modo de captura</span>
            <select
              value={profile}
              disabled={live}
              onChange={(e) => setProfile(e.target.value as CaptureProfileId)}
            >
              {Object.values(s.profiles).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <small>{s.profiles[profile].description}</small>
          </label>

          <div className="actions">
            {!live && (
              <button
                className="btn primary"
                disabled={s.phase === "requesting"}
                onClick={() => s.start(profile, context)}
              >
                {s.phase === "requesting"
                  ? "Aguardando permissão…"
                  : s.phase === "ended"
                  ? "Iniciar nova captura"
                  : "Iniciar captura"}
              </button>
            )}
            {live && (
              <>
                {micOn ? (
                  <button className="btn" onClick={s.pause}>
                    Pausar
                  </button>
                ) : (
                  <button className="btn" onClick={s.resume}>
                    Retomar
                  </button>
                )}
                <button className="btn danger" onClick={s.end}>
                  Encerrar sessão
                </button>
              </>
            )}
            {s.phase === "ended" && (
              <button className="btn ghost" onClick={s.reset}>
                Limpar tela
              </button>
            )}
          </div>

          <div className="meter" aria-label="Nível do microfone">
            <div
              className="meter-fill"
              style={{ width: `${Math.round(s.level * 100)}%` }}
            />
          </div>
          {live && (
            <p className="hint">
              {s.deviceLabel}
              <br />
              {appliedSummary}
            </p>
          )}

          {s.micError && <p className="alert bad">{s.micError}</p>}
          {s.micNotice && <p className="alert warn">{s.micNotice}</p>}
          {s.tState === "not_configured" && (
            <p className="alert warn">
              O microfone está captando, mas <strong>nenhum texto será gerado</strong>:{" "}
              {s.tDetail}
            </p>
          )}
          {s.tState === "error" && s.tDetail && (
            <p className="alert bad">{s.tDetail}</p>
          )}
          {s.phase === "ended" && (
            <p className="hint">
              Sessão encerrada. Microfone liberado. A transcrição só existe nesta
              tela e some ao recarregar a página.
            </p>
          )}
        </section>

        <section className="card transcript">
          <h2>Transcrição</h2>
          <div className="scroll" ref={scrollRef}>
            {s.items.length === 0 ? (
              <p className="empty">
                {live
                  ? s.tState === "connected"
                    ? "Aguardando fala…"
                    : "Sem transcrição ativa."
                  : "A transcrição aparecerá aqui, aos poucos, durante a ligação."}
              </p>
            ) : (
              s.items.map((i) => (
                <p key={i.id} className={i.done ? "line" : "line partial"}>
                  {i.text}
                </p>
              ))
            )}
          </div>
        </section>

        <section className="card client">
          <h2>O que o cliente está dizendo</h2>
          <p className="big">
            {lastItem ? lastItem.text : <span className="empty">—</span>}
          </p>
          <small className="hint">
            Esta etapa não separa quem fala: mostra a fala mais recente captada
            pelo microfone.
          </small>
        </section>

        <section className="card suggestion">
          <h2>Sugestão do que falar agora</h2>
          <div className="big suggestion-body">
            {suggestionText ? (
              suggestionText
            ) : (
              <span className="empty">
                {s.suggestion && !s.suggestion.ready
                  ? s.suggestion.reason
                  : "O motor de sugestões ainda não está conectado nesta versão."}
              </span>
            )}
          </div>
          <div className="actions">
            <button
              className="btn"
              disabled={!suggestionText}
              onClick={copy}
            >
              {copied ? "Copiado" : "Copiar sugestão"}
            </button>
            {s.suggesting && <span className="hint">Gerando…</span>}
          </div>
        </section>
      </main>

      <footer className="foot">
        Nada é gravado nem salvo. Avise o cliente que a conversa está sendo
        transcrita, conforme a legislação aplicável.
      </footer>
    </div>
  );
}
