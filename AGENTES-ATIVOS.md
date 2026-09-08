# Agentes ativos

> Cada frente declara aqui o que está fazendo **antes de começar**, e marca como
> concluído ao terminar. É o único jeito de uma frente saber o que a outra está
> tocando — as sessões não se enxergam.
>
> **Antes de editar qualquer arquivo, veja se outra frente já declarou.**
> Se já declarou, pare e pergunte ao Danilo.

| Frente | Desde | Mexendo em | Status |
|---|---|---|---|
| configuração | 07/09 14:00 | `src/lib/odontoImport.ts` · `src/lib/webdental.ts` · `ImportOrcamentosDialog.tsx` · banco | **concluído** — publicado em `498dddb` |
| configuração | 07/09 15:00 | `src/lib/odontoImport.ts` (só ele) | **concluído** — bug de classificação de aprovados corrigido. **NÃO publicado**, aguarda o "pode" do Danilo |
| design | 07/09 13:30 | `globals.css` · `src/components/ui/*` · `src/app/layout/*` · `design/` | publicou `d940f21`, `d259d8e`, `e8669c0`, `0ebc09f` — verificar se segue ativa |
| configuração | 07/09 15:45 | `src/lib/dashboard.ts` · `src/hooks/useOdontoConversion.ts` (novo) · `src/components/dashboard/OdontoWidgets.tsx` (novo) · `src/app/routes/dashboard/DashboardPage.tsx` (**fronteira com design** — só lógica/dados, sem redesenho) | **concluído** — painel de conversão da odonto. **NÃO publicado**, aguarda o "pode" do Danilo |
| WhatsApp/IA | 07/09 15:20 | `supabase/functions/copilot-suggest/` (nova) · `src/components/inbox/CopilotPanel.tsx` (novo) · `src/components/inbox/MessageInput.tsx` · `src/app/routes/inbox/InboxPage.tsx` | **concluído** — copiloto do atendente. Edge Function publicada (v3, sha conferido). **Frontend NÃO publicado**, aguarda o "pode" do Danilo |
| configuração | 07/09 16:40 | `src/hooks/useUnreadConversations.ts` (novo) · `src/app/layout/nav-config.ts` · `Sidebar.tsx` · `MobileNav.tsx` · `ConversationList.tsx` · `InboxPage.tsx` · `useConversations.ts` (**território da frente de design** — só o selo de não lidas, pedido direto do Danilo; nenhuma cor, espaçamento ou estrutura alterada) | **concluído** — selo de não lidas + menu "marcar como não lida"/arquivar na lista |
| configuração | 07/09 17:30 | `_shared/meta-cloud.ts` · `_shared/inbox-delivery.ts` · `send-operator-message` · `send-operator-reaction` (nova) · `meta-webhook` · migration · `MessageThread.tsx` · `MessageActions.tsx` (novo) · `ForwardDialog.tsx` (novo) · `MessageInfoDialog.tsx` (novo) · `ConversationList.tsx` · `MessageInput.tsx` · `InboxPage.tsx` · `inbox-filters.ts` · `useMessages.ts` · `useConversations.ts` · `lib/conversationExport.ts` (novo) | **bloqueado** — recursos do WhatsApp na inbox. Migration aplicada; Edge Functions **não publicadas** (falta SUPABASE_ACCESS_TOKEN). Frontend NÃO publicado até elas subirem |
| comercial | — | textos e templates | não declarou |

---

## Territórios deste projeto

| Frente | Dona de | NÃO mexe em |
|---|---|---|
| **design** | `src/styles/*` · `src/components/ui/*` · `src/app/layout/*` · `design/` · tema e identidade | banco · Edge Functions · importação · canal WhatsApp |
| **comercial** | textos de template · cópia da interface | infraestrutura · banco · deploy |
| **configuração** | banco e migrations · Edge Functions · canal Meta/WhatsApp · importação WebDental · `api/*` · `src/lib/*` | estilos · componentes visuais · layout |

## Regras curtas (o detalhe está em `COORDENACAO-AGENTES.md`)

1. **Nunca `git add -A`.** Arquivo por arquivo, e liste ao Danilo antes de publicar.
2. **Só a frente de configuração aplica migração de banco.** As outras pedem.
3. **Build quebrado em arquivo alheio: relate, não conserte.**
4. **Registre no `MEMORIA.md` identificando a frente.**
5. **Nunca reverta trabalho de outra frente.**
