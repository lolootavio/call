// Edge Function: create-transcription-session
//
// Cria um token efêmero da OpenAI para o navegador abrir uma sessão de
// transcrição em tempo real via WebRTC. A chave real (OPENAI_API_KEY) fica
// apenas nos segredos do Supabase. Nada é gravado: sem banco, sem logs de áudio.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json(
      { code: "not_configured", error: "OPENAI_API_KEY não configurada." },
      503
    );
  }

  let context = "";
  try {
    const body = await req.json();
    if (typeof body?.context === "string") context = body.context.slice(0, 500);
  } catch {
    /* corpo vazio é aceito */
  }

  const model = Deno.env.get("TRANSCRIPTION_MODEL") ?? "gpt-4o-transcribe";
  const language = Deno.env.get("TRANSCRIPTION_LANGUAGE") ?? "pt";

  // O "prompt" orienta vocabulário, não é instrução de conversa.
  const prompt = [
    "Conversa de vendas por telefone em português do Brasil, captada por viva-voz.",
    context ? `Contexto: ${context}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const openaiRes = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "transcription",
          audio: {
            input: {
              // far_field: indicado para voz vinda de um alto-falante à distância.
              noise_reduction: { type: "far_field" },
              transcription: { model, language, prompt },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 600,
              },
            },
          },
        },
      }),
    }
  );

  if (!openaiRes.ok) {
    // Não repassa o corpo cru da OpenAI para o cliente.
    console.error("OpenAI client_secrets falhou", openaiRes.status);
    return json(
      { error: `A OpenAI recusou a criação da sessão (HTTP ${openaiRes.status}).` },
      502
    );
  }

  const data = await openaiRes.json();
  return json({ value: data.value, expires_at: data.expires_at });
});
