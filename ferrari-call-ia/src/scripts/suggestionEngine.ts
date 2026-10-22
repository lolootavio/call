/**
 * Geração de sugestões de script comercial.
 *
 * Nesta primeira etapa só existe o CONTRATO e uma implementação "vazia".
 * Ela não inventa sugestões: devolve `ready: false` para a interface mostrar
 * que o motor ainda não está conectado.
 *
 * Esta camada recebe apenas TEXTO (transcrição + contexto). Não sabe nada de
 * microfone, WebRTC ou OpenAI Realtime, então pode ser testada isolada.
 */

export interface SuggestionInput {
  /** Contexto comercial informado pelo usuário (opcional). */
  context: string;
  /** Trechos já finalizados da conversa, em ordem. */
  transcript: string[];
  /** Última fala do cliente (finalizada ou em andamento). */
  lastClientUtterance: string;
}

export type SuggestionResult =
  | { ready: false; reason: string }
  | { ready: true; text: string };

export interface SuggestionEngine {
  readonly name: string;
  suggest(input: SuggestionInput, signal?: AbortSignal): Promise<SuggestionResult>;
}

/** Placeholder honesto: não gera nada. */
export const notConnectedEngine: SuggestionEngine = {
  name: "not-connected",
  async suggest() {
    return {
      ready: false,
      reason:
        "O motor de sugestões ainda não está conectado. Esta etapa entrega captura e transcrição.",
    };
  },
};

/**
 * Próxima etapa: criar uma Edge Function `suggest-script` que receba
 * SuggestionInput, chame um modelo de texto e devolva { text }.
 * Basta implementar um SuggestionEngine que a chame e trocar o engine em
 * src/hooks/useCallSession.ts.
 */
