# Ferrari call ia

Apoio em tempo real para ligações de WhatsApp em viva-voz. **Não é um CRM.**

O áudio vem do **microfone do computador** captando o alto-falante do celular. O app não se conecta ao WhatsApp.

## Estrutura (cada parte testável isoladamente)

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Captura | `src/audio/micCapture.ts` | getUserMedia (só áudio), perfis de captura, nível, pausa, parada de todas as faixas |
| Transcrição | `src/transcription/realtimeTranscription.ts` | Token efêmero via backend + WebRTC com a OpenAI; emite texto e estados |
| Sugestões | `src/scripts/suggestionEngine.ts` | Contrato `SuggestionEngine` (hoje um placeholder que não gera nada) |
| Orquestração | `src/hooks/useCallSession.ts` | Liga as três camadas |
| Backend | `supabase/functions/create-transcription-session` | Cria o token efêmero; guarda `OPENAI_API_KEY` |

## Rodar

```bash
npm install
cp .env.example .env     # preencha URL e chave publicável do Supabase
npm run dev              # http://localhost:5173 (localhost permite microfone)
```

Sem `.env`, a captura de microfone funciona (medidor de nível), mas a interface mostra "Transcrição não configurada" e não gera texto.

## Backend

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy create-transcription-session
```

No Lovable, conecte o projeto ao Supabase e peça para publicar a função e adicionar o segredo `OPENAI_API_KEY`.

## Testar a captura do viva-voz

1. Coloque o celular em viva-voz perto do microfone do computador.
2. Use o modo **Viva-voz (sinal bruto)**: ele desliga cancelamento de eco, supressão de ruído e ganho automático, que costumam atenuar a voz do alto-falante.
3. Se o medidor mal mexer, compare com **Padrão do navegador**.
4. Fones no computador e voz do operador no mesmo microfone: esta etapa não separa falantes.

## Privacidade

- Nada é gravado nem salvo; transcrição só existe na memória da página.
- Sem tabelas de banco.
- A chave da OpenAI nunca chega ao navegador.
- Avise o cliente que a conversa está sendo transcrita.

## Próximas etapas

- Edge Function `suggest-script` + implementação de `SuggestionEngine`.
- Separação de falantes (operador x cliente).
