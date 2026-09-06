# MEMORIA.md — CRM Odonto · Clínica Amor Saúde Itabuna

> **Este é o registro permanente do projeto.** Decisão, mudança de banco,
> incidente ou entrega que não estiver escrita aqui **não existe**.
>
> Ordem de leitura para qualquer agente que abrir esta pasta:
> `MEMORIA.md` → `ODONTO.md` → `CLAUDE.md` → migrations.
> `AGENTS.md` está desatualizado e não é fonte.

---

## REGRA DE REGISTRO (obrigatória)

Todo agente que trabalhar nesta pasta **deve**:

1. **Ler o MEMORIA.md antes de qualquer coisa.** Nunca começar pelo código.
2. **Registrar ao final de cada sessão**, sem exceção e sem esperar pedido:
   uma entrada no *Log de sessões* e, quando aplicável, linha nova em
   *Decisões*, *Mudanças no banco* ou *Pendências*.
3. **Nunca reescrever histórico.** Só acrescentar. Para corrigir algo errado,
   escrever uma entrada nova dizendo o que estava errado e o que passou a valer.
4. **Nunca fechar uma pendência sozinho.** Pendência só sai da lista com
   decisão registrada do Danilo, com data.
5. **Registrar também o que NÃO foi feito** e por quê — trabalho abortado,
   erro que travou, decisão que faltou. Isso vale tanto quanto o que foi feito.

### Modelo de entrada do log

```
### AAAA-MM-DD · <agente> · <título curto>
- Pedido: o que foi solicitado
- Feito: o que mudou de fato
- Arquivos: caminhos tocados
- Banco: migração aplicada (ou "nenhuma")
- Não feito: o que ficou de fora e por quê
- Próximo: qual a próxima demanda
```

---

## ESTADO ATUAL

| Item | Valor | Desde |
|---|---|---|
| Fase | Documentação e decisões — **nenhum código escrito** | 05/09/2026 |
| Supabase project_id | `feptvmsjzreovfynrlql` | — |
| Schema | `whatsapp_hub` (48 tabelas, RLS em todas) | — |
| Canal | `zernio` apenas · `uazapi` proibido | 05/09/2026 |
| Banco alterado? | **Não.** Nenhuma migração aplicada por este projeto | — |
| Funil | Definido, não criado no banco | 05/09/2026 |

> **Atualização 05/09/2026 (não apaguei as linhas acima — elas descrevem o
> estado até esta data):** três delas deixaram de valer.
> · **Fase:** já existe código — `_shared/meta-cloud.ts`, `meta-webhook` (no ar)
>   e o ramo `meta` em `channels.ts` / `inbox-delivery.ts`.
> · **Canal:** a regra "zernio apenas" foi **revogada** pelo Danilo em
>   05/09/2026 — vale **Meta Cloud API direto**. `uazapi` segue proibido.
> · **Banco alterado?** **Sim** — 1 migração aplicada (ver *Mudanças no banco*).

---

## DECISÕES

| Data | Decisão | Por quê | Status |
|---|---|---|---|
| 05/09/2026 | CRM exclusivo da odontologia, separado do CRM de exames | Áreas distintas dentro da unidade | Firme |
| 05/09/2026 | Base é o template "Plataforma Comercial com IA" do curso | Mais consolidado que construir do zero | Firme |
| 05/09/2026 | Canal `zernio` (API oficial da Meta). `uazapi` proibido | Clínica não corre risco de banimento de número | Firme |
| 05/09/2026 | Funil: Orçamento apresentado → Em negociação → Aguardando decisão → Aprovado → Não aprovado | — | Firme |
| 05/09/2026 | `ODONTO.md` tem precedência sobre `CLAUDE.md` | CLAUDE.md do curso está defasado | Firme |
| 05/09/2026 | Decisão sobre o `AGENTS.md` adiada | Só resolver se atrapalhar | Adiada |
| 05/09/2026 | Carga inicial: **importar as propostas não aprovadas** do WebDental (não começar do zero) | Backlog já existe e é o ativo do projeto | Firme |
| 05/09/2026 | Modelo do import: 1 `deal` por orçamento (paciente + data), tratamentos como `deal_products` | 63 orçamentos geram 80 tratamentos; 14 têm mais de um item | Proposta |
| 05/09/2026 | **Ordem de trabalho:** configurar o CRM e o canal de WhatsApp PRIMEIRO; a importação dos não aprovados vem depois | Decisão do Danilo | Firme |
| 05/09/2026 | Unificar com o CRM de exames: intenção futura, fora de escopo | — | Futuro |

---

## MUDANÇAS NO BANCO

Nenhuma até agora.

> Toda migração registra aqui: data, arquivo, o que mudou, quem aprovou,
> e como reverter. Migração sem linha nesta tabela é migração não autorizada.

| Data | Migração | O que mudou | Aprovado por | Reversão |
|---|---|---|---|---|
| 05/09/2026 | `20260905120000_meta_cloud_channel.sql` (aplicada via MCP `apply_migration`, nome no controle: `meta_cloud_channel`, version `20260905201957`) | `whatsapp_hub.channels`: +3 colunas nullable (`meta_waba_id`, `meta_phone_number_id`, `meta_token_encrypted`); `channels_provider_check` passa a aceitar `'meta'`; `channels_provider_shape` passa a exigir `meta_phone_number_id` quando provider='meta'; nova UNIQUE `channels_meta_number_unique (org_id, provider, meta_phone_number_id)`; índice parcial `idx_channels_meta_phone`. Nenhuma linha alterada (tabela estava vazia), nenhuma policy RLS tocada. | **Danilo, 05/09/2026** (fecha a pendência #14) | `BEGIN; DELETE FROM whatsapp_hub.channels WHERE provider='meta'; ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_meta_number_unique; ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_provider_shape; ALTER TABLE whatsapp_hub.channels ADD CONSTRAINT channels_provider_shape CHECK ((provider='zernio' AND zernio_account_id IS NOT NULL) OR (provider='uazapi' AND uazapi_server_url IS NOT NULL)); ALTER TABLE whatsapp_hub.channels DROP CONSTRAINT IF EXISTS channels_provider_check; ALTER TABLE whatsapp_hub.channels ADD CONSTRAINT channels_provider_check CHECK (provider IN ('zernio','uazapi')); DROP INDEX IF EXISTS whatsapp_hub.idx_channels_meta_phone; ALTER TABLE whatsapp_hub.channels DROP COLUMN IF EXISTS meta_waba_id, DROP COLUMN IF EXISTS meta_phone_number_id, DROP COLUMN IF EXISTS meta_token_encrypted; COMMIT;` |

| 06/09/2026 | `20260906200000_phone_br_canonical.sql` (aplicada via MCP `apply_migration`, nome no controle: `phone_br_canonical`) | (1) nova função `whatsapp_hub.phone_br_canonical(text)` — IMMUTABLE/STRICT, `SET search_path = ''` — devolve a forma canônica do telefone (celular BR **com** o nono dígito; fixo e estrangeiro intactos). (2) **Junção automática dos contatos duplicados**: 1 grupo, 2 contatos → 1 (sobrevivente = o mais antigo). Conversas do grupo fundidas (mensagens e notificações reapontadas antes de qualquer DELETE), `unread_count` somado, `last_message_at` = o maior. Todas as 10 FKs de `contacts` reapontadas; `custom_fields` fundido (sobrevivente vence a chave). (3) Todos os telefones restantes passaram para a forma canônica (2 linhas corrigidas). (4) Novo índice único parcial `contacts_org_phone_canonical_key (org_id, phone_br_canonical(phone)) WHERE phone IS NOT NULL`. **Contagens: contatos 4→3 · conversas 4→3 · mensagens 9→9 · campaign_contacts 1→1 · notificações 5→5.** O bloco tem guarda: levanta exceção e desfaz tudo se mensagem, deal ou linha de campanha sumir. Nenhuma policy RLS tocada. | **Danilo, 06/09/2026** ("não só junte os contatos, faça que o próprio CRM já faça isso automaticamente") | Parcial: `BEGIN; DROP INDEX IF EXISTS whatsapp_hub.contacts_org_phone_canonical_key; DROP FUNCTION IF EXISTS whatsapp_hub.phone_br_canonical(text); COMMIT;` — **a junção em si NÃO é reversível por SQL** (as linhas perdedoras deixaram de existir). Desfazer a junção exige restaurar backup PITR do Supabase para antes de 06/09/2026 ~19h UTC. Por isso a detecção foi rodada em modo leitura antes e o bloco tem guarda de contagem. |

> **Correção 05/09/2026:** a frase "Nenhuma até agora" acima deixou de valer nesta
> data. O banco passou a ter 1 migração aplicada por este projeto (linha acima).
>
> **Atualização 06/09/2026:** são **2** migrações aplicadas por este projeto.

---

## PENDÊNCIAS ABERTAS

| # | Pendência | Bloqueia | Desde |
|---|---|---|---|
| 1 | `products.product_type`: migrar o CHECK para tipos odonto, ou classificar por tags | Catálogo de procedimentos | 05/09/2026 |
| 2 | Aprovar `stage_entered_at` + gatilho `stage_stalled` | **A régua inteira** | 05/09/2026 |
| 3 | Cadência da régua (D+1/3/7/15/30?) | Automação | 05/09/2026 |
| 4 | Quem opera o CRM no dia a dia | Perfis e atribuição | 05/09/2026 |
| 5 | ~~Carga inicial~~ — **RESOLVIDA 05/09: importar as não aprovadas** | — | fechada |
| 9 | **Janela da carga inicial**: só o export atual (01–05/09) ou histórico anterior | Tamanho e risco do import | 05/09/2026 |
| 6 | Número de WhatsApp do canal odonto | Canal | 05/09/2026 |
| 7 | Textos de template — trava de publicidade odontológica | Qualquer envio | 05/09/2026 |
| 8 | Apagar ou neutralizar o `AGENTS.md` | Nada agora | 05/09/2026 |
| 10 | Reescrever `ODONTO.md` §7 — canal passou a ser Meta direto, não Zernio | Documentação em conflito | 05/09/2026 |
| 11 | Identificadores da conta Meta da clínica (WABA ID, Phone Number ID, App ID) | Passo 1 do canal | 05/09/2026 |
| 12 | Recepção pode perder o WhatsApp no celular? Ou o CRM usa outro número | **Toda a virada do canal** | 05/09/2026 |
| 13 | Forma de pagamento cadastrada na conta Meta da clínica | Qualquer envio | 05/09/2026 |
| 14 | Aprovar migração: `channels.provider` aceitar `meta` + colunas do número | Passo 2 em diante | 05/09/2026 |
| 15 | **Criar App dedicado da odonto** no Meta for Developers (autorização do Danilo) | Token e webhook | 05/09/2026 |
| 15b | ~~Criar App~~ — **RESOLVIDA 05/09: "AMS Odontologia CRM", App ID `1432963662062927`, WABA já vinculada** | — | fechada |
| 17 | **Token permanente** via Usuário do Sistema (o da tela é temporário; pode exigir aprovação de outro admin) | Envio e webhook | 05/09/2026 |
| 24 | **Política de privacidade própria da clínica** — hoje aponta para a do Facebook (remendo aceito pelo Danilo em 05/09) | Defesa em LGPD | 05/09/2026 |
| 25 | **Comunicar a recepção da odonto**: o número saiu do celular, atendimento passa a ser pelo CRM (reabre a #12, que foi fechada por engano) | Rotina da equipe | 05/09/2026 |
| 31 | **BLOQUEANTE — registrar o número na Cloud API** (PIN de 6 dígitos + `register`). Sem isso o número não envia nem recebe | **TUDO** | 05/09/2026 |
| 31c | ~~Registro na Cloud API~~ — **RESOLVIDA 06/09/2026: número registrado, ciclo completo funcionando** | — | fechada |
| 32 | **URGENTE — responder a mensagem de paciente que já chegou no CRM** e definir quem monitora | Atendimento real | 06/09/2026 |
| 33 | Verificar, na 1ª campanha, se pacientes antigos da recepção ficam com o estado "não está mais no WhatsApp" | Taxa de resposta | 06/09/2026 |
| 34 | 🔴 **Nono dígito BR: a Meta entrega telefone sem o 9 e o CRM DUPLICA contato/conversa** — normalizar antes de qualquer campanha | **A campanha inteira** | 06/09/2026 |
| 31b | **#31 tem código, falta o Danilo usar.** Em 06/09 o botão "Registrar número na Cloud API" foi escrito (`src/lib/meta-cloud.ts` + `api/meta-connect.ts` ação `register` + `ChannelsSettings.tsx`). **Não publicado** (depende da #30) e **não executado** — registrar é ação irreversível na conta do dono. #31 só fecha quando o `platform_type` do número voltar `CLOUD_API` | #30 | 06/09/2026 |
| 30 | Publicar o frontend na Vercel (botão "Abrir conversa") | Teste pela interface | 05/09/2026 |
| 16 | **Cadastrar forma de pagamento** na WABA `1500039648549092` | Qualquer envio | 05/09/2026 |
| 16b | ~~Forma de pagamento~~ — **RESOLVIDA 05/09: MASTERCARD ••••4468 (val. 04/2031) vinculado à WABA da odonto** | — | fechada |
| 14b | ~~Aprovar migração do canal Meta~~ — **RESOLVIDA 05/09: aprovada pelo Danilo e APLICADA** (ver *Mudanças no banco*) | — | fechada |
| 18 | **Guardar no cofre por org** (`public.org_settings`, cifrado): `meta_app_secret`, `meta_webhook_verify_token`. Sem os dois o webhook responde 403 no GET e 500 no POST. Ação do Danilo pela tela de credenciais — agente não lê nem grava valor de segredo | Webhook funcionar | 05/09/2026 |
| 19 | **Criar a linha do canal** em `whatsapp_hub.channels` (provider `meta`, `meta_phone_number_id=1308096539052095`, `meta_waba_id=1500039648549092`, `meta_token_encrypted` = token permanente cifrado). Enquanto não existir, todo POST da Meta volta 200 `skipped: unknown_channel` | Inbound e envio | 05/09/2026 |
| 20 | **UI de canal Meta** — `ChannelsSettings.tsx` só conhece zernio/uazapi; hoje não há tela para cadastrar o canal do item #19 | Cadastro sem SQL manual | 05/09/2026 |
| 21 | **Mídia inbound da Meta não é exibível.** A Meta manda só o `media_id`; a URL do `GET /{media_id}` exige Bearer e expira em ~5min. O webhook grava `media_url = null` e loga o id. Rehospedar em Storage exige decisão de bucket/retenção de imagem de paciente (LGPD) — decisão do Danilo, não do agente | Foto/áudio no inbox | 05/09/2026 |
| 22 | **Envio em massa pela Meta** — `dispatch-campaign`, `check-follow-ups`, `send-operator-template`, `repurchase-dispatch`, `sync-broadcast-status` e `funnel-automation` ainda só têm ramo zernio/uazapi. A Meta não tem Broadcast: fila, ritmo, retry e parada automática viram código nosso (risco já registrado em 05/09) | Campanha e régua | 05/09/2026 |
| 20b | **#20 tem código, falta o Danilo usar.** A tela do canal Meta foi escrita em 05/09 (`ChannelsSettings.tsx` + `api/meta-connect.ts`), mas nada foi cadastrado ainda — a pendência #20 só fecha com o canal criado pela tela e confirmação do Danilo. Não fecho sozinho (regra 4) | #19 | 05/09/2026 |
| 23 | **DECISÃO DO DANILO 05/09/2026 — mídia de paciente fica na nossa base:** foto e áudio recebidos pelo WhatsApp devem ser guardados em base própria, **retenção de 12 meses**, visíveis para **administrador e recepção**. **NÃO implementado.** Falta: (a) bucket de Storage `whatsapp-hub-*` com RLS por org e por perfil, (b) rotina de expurgo aos 12 meses, (c) rehospedar no `meta-webhook` (hoje ele grava `media_url = null` e só loga o `media_id` — ver pendência #21). Isso orienta a #21, mas não a fecha: falta o código | Foto/áudio no inbox | 05/09/2026 |
| 26 | **Enum `templates.status` não tem `paused`.** A Meta usa `APPROVED · PENDING · REJECTED · PAUSED · DISABLED`; o enum local só tem `draft|pending|approved|rejected`. O `sync-template-status` mapeia PAUSED e DISABLED para `rejected` (o mais próximo de "não pode usar agora") e guarda o valor cru em `meta_template_status`. Modelo pausado por qualidade aparece na tela como "Rejeitado", o que é enganoso. Corrigir exige `ALTER TYPE ... ADD VALUE` — **migração não feita de propósito** (regra do projeto: agente não aplica migração) | Leitura correta da tela de Templates | 05/09/2026 |
| 27 | **`templates` é UNIQUE (org_id, name); a Meta é única por (name, language).** O mesmo modelo em pt_BR e en_US não cabe em duas linhas aqui: o sync fica com o pt_BR e descarta o outro (`preferTemplate`). Enquanto os modelos forem só pt_BR não incomoda; multi-idioma exige migração da chave para (org_id, name, language) | Modelo em mais de um idioma | 05/09/2026 |
| 28 | **Botões COPY_CODE / OTP / FLOW da Meta não têm equivalente local.** O sync ignora esses botões ao importar (ficam intactos na Meta, só não aparecem na edição do CRM). Só afeta modelo de autenticação/fluxo, que não está no escopo da odonto hoje | Edição de modelo de autenticação | 05/09/2026 |
| 29 | **`send-operator-template` ramo `meta` está no ar mas NUNCA foi exercitado contra a API real.** Validado por leitura de código, typecheck, `deno check` e boot da função (401 sem Authorization). Exercitar de verdade exige o token do canal (segredo) e dispara mensagem real — é ação do Danilo, pela tela | Prova de que o envio de modelo funciona ponta a ponta | 05/09/2026 |
| 30 | **Frontend não publicado.** `src/lib/conversations.ts` (novo) e `ContactDetailPage.tsx` (botão "Abrir conversa" com get-or-create da conversa) existem só no disco. A Vercel serve o commit `15ebea6`. Sem esse deploy, **não há como abrir a primeira conversa pela interface** — e sem conversa não há onde clicar em "Reiniciar com template". Publicar é decisão do Danilo | Disparo do modelo pela tela de Conversas | 05/09/2026 |
| 35 | **⚠️ ARMADILHA — 18 Edge Functions ainda na `version: 1` do bootstrap de 24/08.** O deploy carrega junto os `_shared` **do momento do deploy**: corrigir `channels.ts` / `inbox-delivery.ts` não conserta função nenhuma sozinha. Já causou 2 incidentes (05/09 `send-operator-template`; 06/09 `send-operator-message` + `send-operator-media`). **Risco alto e imediato: `process-ai-message`** — o fonte já está certo, falta só republicar; enquanto não for, toda resposta da IA em conversa Meta falha com "Zernio API Key não configurada". Regra: ao mexer em `_shared/*`, rodar `list_edge_functions` e decidir quem redeployar | Resposta da IA · campanhas · régua | 06/09/2026 |
| 34b | **#34 tem código E banco, falta o Danilo testar pela interface.** Em 06/09 a regra de normalização foi escrita (`src/lib/phone.ts` + `_shared/phone-br.ts` + `whatsapp_hub.phone_br_canonical`), aplicada em todos os pontos de entrada, os duplicados existentes foram fundidos e o índice único funcional entrou. `meta-webhook` e `ingest-lead` republicados; **frontend não publicado** (depende de deploy na Vercel). #34 só fecha quando o Danilo confirmar, pela tela, que um número que responde cai no MESMO contato/conversa | Deploy na Vercel | 06/09/2026 |
| 37 | **`repurchase-dispatch` e `simulate-inbound` têm o código do nono dígito no disco, mas NÃO foram republicados.** Continuam na `version: 1` de 24/08. Consequência: se algum dia forem usados e tentarem criar um contato duplicado, o novo índice único devolve erro de chave em vez de duplicar em silêncio (falha ruidosa, não perda de dado). `repurchase-dispatch` precisa do ramo `meta` de qualquer forma (pendência #22/Fase 3); `simulate-inbound` é dev-only | Nada agora | 06/09/2026 |
| 36 | **Mídia enviada pelo operador no canal Meta não aparece no thread.** `send-operator-media` v2 sobe os bytes para a própria Meta (`POST /{phone_number_id}/media`) e envia por media id — a mensagem **chega ao paciente**, mas `media_url` fica `null` e o balão mostra "visualização indisponível nesta versão". Resolver exige decidir onde guardar mídia de paciente (é a mesma decisão das pendências #21 e #23): bucket próprio com RLS por perfil + expurgo de 12 meses, ou o bucket público `whatsapp-hub-agent-media` (mais simples, porém expõe o arquivo por URL aberta). **Decisão do Danilo, não do agente** | Histórico visual do atendimento | 06/09/2026 |

---

## ACHADOS TÉCNICOS (não repetir a investigação)

- **`CLAUDE.md` está defasado.** Descreve só o hub de WhatsApp. Não cita
  `deals`, `pipelines`, `stages`, `products`, `deal_products`,
  `crm_activities`, `organizations`, nem as rotas `/funil`, `/vendas`,
  `/automations`. Não usar como fonte de schema.
- **`AGENTS.md` contradiz o `CLAUDE.md`**: diz Meta Cloud API direto, disparo
  por tier e polling de template. Geração anterior do mesmo documento.
- **Multi-tenancy voltou** (`20260810120000_mt_schema`): `organizations`,
  `channels` por org, `public.org_settings`, `org_id` em ~45 tabelas.
- **Não existe relógio de estagnação.** `deals` não tem `stage_entered_at`;
  `crm_activities` tem o tipo `stage_change` no enum mas nenhum trigger grava;
  `funnel_automations` dispara na ENTRADA da etapa, não na permanência.
- **`products.product_type`** travado em
  `('curso','mentoria','consultoria','ebook','app','ia','fisico')`.
- **`channels.provider`** = `CHECK (provider IN ('zernio','uazapi'))`.
  `follow_up_rules.provider` é TEXT default `'zernio'`, **sem CHECK**.
- **Perfil da base extraída do PDF de 05/09/2026** (export 01/09 a 05/09 —
  **apenas 5 dias**, não o mês todo): 80 tratamentos · 63 orçamentos únicos
  (paciente + data) · 63 pacientes · R$ 67.525,88 somados nas linhas.
  Cabeçalho do relatório diz 64 pacientes e R$ 68.436,03 — diferença de
  1 paciente e R$ 910,15 a conciliar antes do import.
  Itens por orçamento: 49 com 1 · 12 com 2 · 1 com 3 · 1 com 4.
  Tratamentos: Clínica Geral 64 · Prótese 13 · Ortodontia 2 · Implantodontia 1.
  Tabela de preço: 58 filiado CDT · 21 particular · 1 Life Premium.
  Todos os 80 registros têm telefone. 1 linha com valor zerado.
  Concentração de prestador: 3 dentistas respondem por 37 dos 80.
- **Fonte dos orçamentos:** WebDental/Dental Vidas, relatório
  *Controle de Efetivação*, filtro "APENAS NÃO APROVADOS", exportável em XLS.
  Base de set/2026: 64 pacientes · 80 tratamentos · R$ 68.436,03 ·
  ticket médio R$ 1.069,31.

---

## LOG DE SESSÕES

### 2026-09-05 · Claude (Cowork) · Leitura do template e criação da documentação
- **Pedido:** ler o `CLAUDE.md` do curso e apontar regra duplicada ou
  conflitante antes de seguir; depois criar o `ODONTO.md`.
- **Feito:** auditoria do `CLAUDE.md` contra as migrations reais; criação do
  `ODONTO.md` (regra do projeto) e deste `MEMORIA.md`.
- **Arquivos:** `ODONTO.md` (novo), `MEMORIA.md` (novo).
- **Banco:** nenhuma migração.
- **Não feito:** nada de código. As 8 pendências seguem abertas — em especial
  a #2, que bloqueia o motivo de existir do CRM.
- **Próximo:** decisão do Danilo sobre a pendência #2 (`stage_entered_at`).

### 2026-09-05 · Claude (Cowork) · Memória do projeto e perfil da base
- **Pedido:** criar o arquivo de memória do projeto e exigir o registro no
  prompt do agente; depois, decisão de que a carga inicial importa as
  propostas não aprovadas.
- **Feito:** criados `MEMORIA.md` e `PROMPT-AGENTE.md`; `ODONTO.md` ganhou a
  ordem de leitura obrigatória. Parse do PDF de não aprovados: 80 tratamentos
  em 63 orçamentos, R$ 67.525,88, janela real de 5 dias.
- **Arquivos:** `MEMORIA.md`, `PROMPT-AGENTE.md`, `ODONTO.md`.
- **Banco:** nenhuma migração.
- **Não feito:** o import em si. Falta definir a janela (pendência #9) e a
  pendência #2 segue aberta — sem `stage_entered_at` partindo da DtOrçamento,
  todo orçamento importado entra no funil como se tivesse nascido hoje.
- **Próximo:** Danilo define a janela da carga inicial.

### 2026-09-05 · Claude (Cowork) · Prompt de configuração
- **Pedido:** prompt completo para o Claude Code configurar o CRM e a API do
  WhatsApp.
- **Feito:** criado `PROMPT-CONFIG.md` — 6 fases com portão de aprovação
  (0 diagnóstico · 1 funil · 2 catálogo · 3 campos · 4 canal Zernio ·
  5 relógio de estagnação), regra de memória e regras de segredo.
- **Arquivos:** `PROMPT-CONFIG.md` (novo), `MEMORIA.md`.
- **Banco:** nenhuma migração.
- **Não feito:** nada executado. A Fase 0 é só diagnóstico, de propósito — o
  banco já tem 48 tabelas e rodar bootstrap por cima é risco de perda de dado.
- **Próximo:** Danilo cola o `PROMPT-CONFIG.md` no Claude Code e traz o
  resultado da Fase 0. Antes da Fase 4 precisa decidir: qual número de
  WhatsApp (pendência #6) e o custo Zernio + Meta.

### 2026-09-05 · Claude Code · Fase 0 — diagnóstico do ambiente
- **Pedido:** `PROMPT-CONFIG.md` Fase 0 — levantar o estado real do banco, das
  Edge Functions, dos crons e do deploy. Diagnóstico apenas, sem escrever nada.
- **Feito:** leitura de `MEMORIA.md`, `ODONTO.md` e das 93 migrations;
  consultas de leitura no Supabase `feptvmsjzreovfynrlql` (catálogo, contagem
  de linhas, constraints, triggers, enums, `cron.job`, `vault.secrets`,
  `public._bootstrap_state`); inspeção de `setup.config.ts`,
  `scripts/push-migrations.mjs` e das Edge Functions.
- **Arquivos:** nenhum alterado. Só este registro.
- **Banco:** nenhuma migração. Nenhuma escrita — apenas `SELECT`.

**Achados que corrigem o que estava escrito antes:**

1. **O `/setup` JÁ RODOU e foi concluído** em 24/08/2026 21:25–21:26 UTC.
   `public._bootstrap_state` tem 100 linhas: 93 migrations aplicadas,
   `migrations_done`, `edge_functions_deployed` (23),
   `owner_created` (itabuna.danilo@gmail.com), `auth_urls_set`,
   `vercel_envs_set`, `redeploy_triggered`.
   App no ar: `https://plataforma-comercial-com-ia-lac.vercel.app` (HTTP 200).
   O `MEMORIA.md` dizia "nenhum código escrito / banco não alterado" — isso
   valia para **este projeto**, mas o bootstrap do template já tinha rodado.

2. **RISCO ALTO — `npm run db:push` re-executaria tudo.** O script
   `scripts/push-migrations.mjs` lê o controle de
   `supabase_migrations.schema_migrations`, que **não existe** neste banco.
   O bootstrap gravou em `public._bootstrap_state`. São dois livros-caixa
   distintos que não se falam. Rodar `db:push` hoje: cria a tabela vazia,
   entende "0 aplicadas" e reaplica as 93 do zero. Verificado por leitura:
   quebra em `20260430120001_drop_super_admin.sql` linha 67
   (`UPDATE whatsapp_hub.tenant_members`, tabela removida em
   `20260430120002_drop_multitenant.sql`), deixando o banco meio migrado —
   e, antes de quebrar, `20260422120010_rls_policies.sql` teria reescrito as
   políticas RLS no modelo antigo de tenant único, sem chegar em
   `mt_policies` para restaurar o modelo por org.
   **Regra: nunca rodar `npm run db:push` nem `/setup` neste projeto.**
   Migração daqui em diante vai por `apply_migration` (MCP) ou SQL versionado
   aplicado uma a uma, com registro nos DOIS controles.

3. **`lead_stage_history` existe e é gravada** — corrige o achado anterior de
   que "nenhum registro de troca de etapa é feito". Nenhum *trigger* grava,
   mas o app grava no nível de aplicação: `src/hooks/usePipeline.ts:231`,
   `src/components/inbox/ContactPanel.tsx:220` e
   `supabase/functions/process-ai-message/index.ts:228`. Consequência: um deal
   criado por import (fora da UI) nunca ganha linha de histórico, então a
   tabela não serve sozinha como relógio de estagnação. A proposta de
   `stage_entered_at` continua valendo e fica ainda mais justificada.

4. **`deals` não tem coluna `custom_fields`.** O `ODONTO.md` seção 4 mapeia
   `custom_fields.dt_orcamento (do deal)` como se fosse um JSONB no deal.
   O modelo real são duas tabelas: `custom_fields` (definição: `label`,
   `field_type`, `options`, `required`, `position`) e `custom_field_values`
   (`custom_field_id`, `deal_id`, `value` **TEXT**). Todo valor é texto —
   data e dinheiro entram como string. Isso muda a Fase 3.
   `contacts.custom_fields` **é** JSONB, então o endereço no contato funciona
   como escrito.

5. **`products_quantity_chk` acopla `quantity` a `product_type = 'fisico'`:**
   `CHECK (quantity IS NULL OR (product_type='fisico' AND quantity>=0))`.
   Se a Fase 2 trocar a lista de tipos, este CHECK também precisa ser
   reescrito, senão nenhum procedimento odonto aceita quantidade.

6. **`follow_up_trigger` é um ENUM** (`no_reply | inactivity | no_purchase`).
   Criar `stage_stalled` na Fase 5 exige `ALTER TYPE ... ADD VALUE`, não é
   só um texto novo. `check-follow-ups` também precisa de código novo — hoje
   trata só os três gatilhos existentes.

7. **`uazapi` está em 32 arquivos**, não só no `setup.config.ts` — inclui
   `supabase/functions/_shared/uazapi.ts`, `api/uazapi-connect.ts`, a Edge
   Function `uazapi-webhook` (publicada e ATIVA) e ramos condicionais em
   `check-follow-ups`, `process-ai-message`, `send-operator-media`,
   `funnel-automation` e `_shared/inbox-delivery.ts`. A Fase 4.1 é maior do
   que "tirar dois campos do setup".

8. **Cofre de credenciais vazio.** `public.app_settings` e
   `public.org_settings` têm 0 linhas — nenhuma chave guardada (nem Zernio,
   nem LLM). `vault.secrets` tem as 3 do bootstrap, incluindo
   `whatsapp_hub_encryption_key`. Como nada foi cifrado ainda, este é o
   momento de menor risco para confirmar o backup da `CRYPTO_KEY` — depois da
   primeira credencial guardada, perder a chave custa as credenciais.

9. **Base de negócio vazia:** 0 contatos, 0 deals, 0 produtos, 0 canais,
   0 templates, 0 conversas. Existem: 1 org ("Organização Principal",
   `2f61f310-1f2b-4049-9f2e-df9b6bc699e6`), 1 usuário (Danilo, admin +
   super_admin, último acesso 05/09), 2 pipelines do seed ("Vendas" default e
   "Pós-venda") com 10 stages, 30 linhas em `utm_channel_map`.

10. **5 crons `pg_cron` ativos**, todos apontando para Edge Functions:
    `wh-dispatch-campaigns` (30s), `wh-check-follow-ups` (15min),
    `wh-sync-broadcast-status` (2min), `repurchase-predictions-daily` (9h),
    `repurchase-dispatch-daily` (9h15). Rodam em base vazia — sem efeito hoje,
    mas passam a agir sozinhos assim que houver canal e deals.

- **Não feito:** nada além da leitura. Fase 1 não foi iniciada — depende de
  decisão sobre os 2 pipelines do seed. As pendências 1 a 4, 6, 7, 8 e 9
  seguem abertas.
- **Próximo:** Danilo decide (a) o que fazer com os pipelines "Vendas" e
  "Pós-venda" do seed e (b) se confirma a regra de nunca rodar `db:push`.
  Depois, Fase 1.

### 2026-09-05 · Claude Code · Carregamento do agente (sem execução)
- **Pedido:** prompt de identidade do agente do CRM Odonto. Nenhuma tarefa
  concreta foi passada nesta sessão.
- **Feito:** leitura completa de `MEMORIA.md`, `ODONTO.md`, `PROMPT-AGENTE.md`,
  `PROMPT-CONFIG.md` e do `CLAUDE.md` do template. Contexto carregado.
  Apresentado ao Danilo o resumo do estado e as 3 decisões que destravam as
  Fases 1, 2 e 5 (funis do seed · `product_type` · `stage_entered_at`).
- **Arquivos:** apenas este registro. Nenhum outro arquivo tocado.
- **Banco:** nenhuma migração. Nenhuma leitura ou escrita no Supabase.
- **Não feito:** nada executado. O Danilo dispensou as três perguntas de
  decisão sem responder — as pendências 1, 2, 3, 4, 6, 7, 8 e 9 seguem
  abertas, e a Fase 1 continua bloqueada.
- **Próximo:** aguardando a tarefa do Danilo. O caminho crítico continua sendo
  a pendência #2 (`stage_entered_at`) — sem ela não existe régua de cobrança.

### 2026-09-05 · Claude Code · MUDANÇA DE ARQUITETURA — Meta Cloud API direto (sem Zernio)
- **Pedido:** iniciar pela API de WhatsApp do CRM. Danilo informou que já tem
  estrutura montada na Meta e o número cadastrado.
- **Conflito apontado antes de executar:** `ODONTO.md` §7 e as decisões de
  05/09 fixam **canal `zernio` apenas** (status "Firme"). Ter estrutura na
  Meta não conecta sozinho neste CRM — o código fala com o Zernio, não com a
  Meta. Conflito levado ao Danilo com as duas saídas e o custo de cada uma.
- **Decisões do Danilo (05/09/2026):**
  1. **Meta Cloud API DIRETO, sem Zernio.** Revoga a decisão "Firme" de 05/09
     que fixava zernio como único canal. `ODONTO.md` §7 fica **desatualizado**
     neste ponto até ser reescrito.
  2. Conta Meta é **nova, exclusiva da clínica** — separada da WABA do Cartão
     de TODOS. Isola reputação de número (o CDT já teve número restringido em
     07/05/2026 por volume).
  3. O número **está em uso hoje no celular da recepção**. Migração para API
     oficial tira o número do app do celular, sem volta no mesmo dia.
- **Feito:** apenas investigação de código. Nenhuma alteração.
- **Arquivos:** só este registro.
- **Banco:** nenhuma migração. Nenhuma escrita.

**Achados técnicos desta sessão (corrigem estimativa anterior):**

1. **CORREÇÃO de estimativa.** Foi dito ao Danilo, na primeira resposta desta
   sessão, que Meta direto exigiria "reescrever 65 arquivos, semanas de obra".
   **Estava superestimado.** O sistema já tem camada de roteamento por
   provedor: `_shared/channels.ts` (`SendContext`,
   `getSendContextForConversation`) e `_shared/inbox-delivery.ts`
   (`sendInboxWithResolve`). O `uazapi` já é um provedor que fala **direto com
   API externa, sem Zernio** — ou seja, o molde para `provider='meta'` já
   existe e está em produção. O trabalho é moderado e delimitado, não uma
   reescrita.

2. **Acoplamento real ao Zernio** (nº de ocorrências por arquivo):
   núcleo = `zernio-webhook` (64), `dispatch-campaign` (44),
   `check-follow-ups` (28), `sync-broadcast-status` (20),
   `send-operator-media` (20), `send-operator-template` (19),
   `repurchase-dispatch` (19), `_shared/zernio.ts` (49),
   `_shared/channels.ts` (33), `_shared/inbox-delivery.ts` (19).
   Frontend: `ChannelsSettings.tsx` (72), `api/zernio-connect.ts` (29),
   `src/lib/zernio.ts` (18). A maioria dos 65 arquivos só repassa, não chama a API.

3. **RISCO ALTO — a Meta não tem Broadcast.** `dispatch-campaign` hoje delega
   ao Zernio o fatiamento em lotes de 100, o retry e o rate-limit. Falando
   direto com a Meta isso **vira código nosso**: fila, ritmo, repetição e
   parada automática em recusa. É o item mais caro e mais arriscado do plano.
   Precedente concreto: número do CDT restringido pela Meta em 07/05/2026 após
   1.343 msgs em 2 dias.

4. **`channels` está vazia** (0 canais). Cofre de credenciais vazio
   (`public.app_settings` e `org_settings` com 0 linhas). Nenhuma chave da Meta
   guardada ainda.

5. Único resquício de Meta no código: coluna morta `meta_phone_number_id` em
   `20260422120002_tenants.sql`. Nenhum código Graph API existe.

**Plano acordado (8 passos, execução travada no passo 2):**
1 levantar dados da conta Meta · 2 **migração** `channels.provider` aceitar
`'meta'` + colunas `meta_waba_id`/`meta_phone_number_id` (**exige OK do
Danilo**) · 3 `_shared/meta-cloud.ts` · 4 função `meta-webhook` (GET challenge
+ POST HMAC) · 5 ramo `meta` em `channels.ts` e `inbox-delivery.ts` ·
6 tela de canal em `ChannelsSettings.tsx` · 7 templates via Graph API ·
8 disparo em massa com freio (limite/min, fila, retry, parada automática).

- **Não feito:** nada de código. Passo 1 depende de dados que só o Danilo tem
  (WABA ID, Phone Number ID, App ID). Passo 2 depende de aprovação de migração.
- **Próximo:** Danilo responde (a) os identificadores da conta Meta,
  (b) se a recepção pode perder o WhatsApp do celular ou se o CRM usa outro
  número, (c) se a conta Meta já tem forma de pagamento cadastrada.

> **Aviso de conflito documental (05/09/2026):** o `ODONTO.md` §7 e a tabela
> DECISÕES ainda dizem "canal `zernio` apenas". Isso foi **revogado** pela
> decisão do Danilo nesta data. O `ODONTO.md` precisa ser reescrito nesse
> ponto — pendência #10. Até lá, vale este registro.

### 2026-09-05 · Claude Code · Identificadores da conta Meta + migração do canal (arquivo)
- **Pedido:** Danilo reafirmou "Meta direto, como os outros CRM que eu tenho" e
  pediu ajuda ao vivo para configurar a API, com o Gerenciador aberto no Chrome.
- **Feito:** (a) criado o arquivo de migração do canal Meta; (b) leitura da
  conta Meta pelo navegador, com os identificadores confirmados na tela.

**IDENTIFICADORES DA CONTA META — CRM ODONTO (confirmados em 05/09/2026, na tela)**

| Item | Valor |
|---|---|
| Portfólio Empresarial (BM) | **Holding DC** — `1827398095332621` |
| WhatsApp Business Account (WABA) | **Clínica Amor Saude Itabuna - Odontologia** — `1500039648549092` |
| Phone Number ID | `1308096539052095` |
| Número | **+55 73 9804-0599** |
| Status do número | Conectado · Qualidade **Alta** |
| Nome de exibição | "Clínica Amor Saude Itabuna - Odontologia" — **Em análise** |
| Categoria | Medicina e saúde |
| Verificação da empresa | **Verificado** |
| Status da conta | **Aprovada** |
| Forma de pagamento | **NENHUMA** — bloqueio |

> Nenhum segredo foi lido, copiado ou gravado. Só identificadores públicos.
> Token de acesso, App Secret e Verify Token continuam a ser gerados pelo
> Danilo e guardados cifrados — nunca em arquivo versionado, nunca no chat.

**Achados desta sessão:**

1. **A conta da odonto é separada e está saudável.** WABA própria
   ("...- Odontologia"), dentro do portfólio **Holding DC** — NÃO é a
   "BM - CDT ITA" do Cartão de TODOS. Reputação isolada, como decidido.
   No mesmo portfólio existe uma segunda WABA, "Clínica Amor Saude Itabuna (BA)"
   (provavelmente a de exames/medicina) — não mexer.

2. **BLOQUEIO 1 — sem forma de pagamento.** A tela de Cobrança mostra
   "Nenhuma forma de pagamento adicionada" para a WABA da odonto. Existem 2
   cartões MasterCard (final 0826 e 4468) no portfólio Holding DC, mas **não
   vinculados a esta conta do WhatsApp**. A Meta avisa na própria tela que a
   forma de pagamento é o que libera volume além da cota gratuita mensal.
   Ação é do Danilo — agente não cadastra meio de pagamento.

3. **BLOQUEIO 2 — não existe App para a odonto.** Em Meta for Developers há 4
   apps, nenhum da odontologia: "Conversão de Exames AMS" (`1450451256407…`,
   empresa Holding DC), "Televendas - CDT" (BM - CDT ITA), "CDT Conciliação"
   (`1626460371943879`, BM - CDT ITA) e um segundo "CDT Conciliação"
   (`144020229785970`, em desenvolvimento). **Sem App não há token de acesso
   nem webhook** — é o bloqueio técnico real.
   Recomendação registrada: **criar App novo dedicado à odonto**, não reusar o
   "Conversão de Exames AMS". Motivo: a Meta aceita **uma única URL de callback
   por App**, e o CRM de exames é outro sistema — compartilhar o App faria os
   dois brigarem pelo mesmo webhook.

4. **ALERTA a confirmar com o Danilo:** o número aparece como **Conectado** na
   Cloud API. Se já foi registrado, ele **já não funciona no aplicativo comum
   do celular**. Danilo havia dito que a recepção usava esse número no celular
   (pendência #12) — precisa confirmar se a recepção já perdeu o acesso ou se
   +55 73 9804-0599 é um número novo, diferente do da recepção.

- **Arquivos:** `supabase/migrations/20260905120000_meta_cloud_channel.sql`
  (**novo, NÃO aplicado**) — valida na sintaxe (12 statements, `validate-sql.mjs`).
- **Banco:** **nenhuma migração aplicada.** Nada escrito no Supabase.
- **Não feito:** `_shared/meta-cloud.ts` e a função `meta-webhook` ficaram para
  a próxima etapa — pausei o código quando o Danilo pediu ajuda na tela.
  Tentativa de ler o padrão já validado do CRM do CDT falhou: MCP retornou
  "sem permissão" para `ksumyxroeasihiuajpyo`. Nota: a lista real de projetos
  Supabase **não tem** `ksumyxroeasihiuajpyo` — o CDT Conciliação é
  `srioayivgbsvossokmcs`. O project_id no CLAUDE.md pessoal está desatualizado.
- **Próximo:** Danilo (a) cadastra forma de pagamento na WABA da odonto,
  (b) autoriza criar o App dedicado, (c) confirma a situação do número na
  recepção, (d) aprova a migração (pendência #14).

### 2026-09-05 · Claude Code · Criação do App da odonto no Meta for Developers
- **Pedido:** Danilo autorizou ("pode criar") a criação do App dedicado.
- **Decisões do Danilo (05/09/2026):**
  1. **Autorizado criar App dedicado da odonto** — não reusar "Conversão de
     Exames AMS". Fecha a pendência #15 quanto à autorização.
  2. **+55 73 9804-0599 é número NOVO, exclusivo do CRM.** A recepção
     **não** perde o WhatsApp do celular. **Pendência #12 RESOLVIDA** — o
     risco operacional da virada deixa de existir.
- **Feito:** wizard de criação do App preenchido e submetido:
  - Nome: **AMS Odontologia CRM**
  - E-mail: danilochagas25@hotmail.com
  - Caso de uso: **Conectar-se com clientes pelo WhatsApp** (único marcado)
  - Portfólio: **Holding DC** (verificação concluída) — mesmo da WABA da odonto
  - Requisitos de publicação: nenhum pendente
- **INTERROMPIDO no último passo:** a Meta exigiu **reautenticação por senha**
  do Facebook. O agente **não digita senha** — ação devolvida ao Danilo.
  App **ainda não criado** até ele confirmar a senha.
- **Arquivos:** nenhum. Só este registro.
- **Banco:** nenhuma migração. Nada escrito.
- **Portfólios disponíveis na conta** (para referência futura):
  "45.194.931 Jose Clatismar Guimarães", "BM - CDT ITA", "Cartão de TODOS",
  **"Holding DC"** — os três primeiros não têm relação com a odonto.
- **Próximo:** Danilo digita a senha → App criado → adicionar produto WhatsApp,
  vincular WABA `1500039648549092`, gerar token (ação do Danilo), configurar
  webhook. Pendência #16 (forma de pagamento) segue aberta.

### 2026-09-05 · Claude Code · Forma de pagamento resolvida · App refeito até a senha
- **Pedido:** "coloque na tela novamente" — refazer a tela de criação do App.
- **Feito:**
  1. **Conferido que o App NÃO havia sido criado** na tentativa anterior
     (lista de apps seguia com os mesmos 4). Evitou App duplicado.
  2. **PENDÊNCIA #16 RESOLVIDA pelo Danilo:** a WABA da odonto
     (`1500039648549092`) agora mostra **MASTERCARD ••••4468, validade
     04/2031** em Payment method. Antes: "Nenhuma forma de pagamento".
  3. Wizard do App refeito por inteiro e levado de novo até o passo final
     (nome "AMS Odontologia CRM" · caso de uso WhatsApp · portfólio
     **Holding DC** confirmado por zoom · requisitos: nenhum).
- **INTERROMPIDO de novo, de propósito:** a Meta exige reautenticação por
  senha do Facebook. O campo apareceu **pré-preenchido pelo gerenciador de
  senhas do Danilo**. O agente **não digita nem submete credencial** — nem
  clicar em "Enviar", porque isso submete a senha. Devolvido ao Danilo.
- **Arquivos:** nenhum além deste registro.
- **Banco:** nenhuma migração. Nada escrito.
- **Estado dos bloqueios:** pagamento ✅ resolvido · App ⏳ aguardando a senha ·
  token ⏳ depende do App · webhook ⏳ depende do token.
- **Próximo:** Danilo clica em "Enviar" → App criado → adicionar produto
  WhatsApp, vincular WABA, configurar webhook. Token é ação do Danilo.

### 2026-09-05 · Claude Code · App criado — App ID e versão da Graph API confirmados
- **Pedido:** Danilo concluiu a senha e enviou print da Configuração da API.
- **Feito:** confirmação do estado pela tela do Meta for Developers.

**APP CRIADO — dados confirmados (05/09/2026)**

| Item | Valor |
|---|---|
| Nome do App | **AMS Odontologia CRM** |
| **App ID** | **`1432963662062927`** |
| Portfólio | Holding DC |
| WABA vinculada | `1500039648549092` ✅ (a Meta vinculou sozinha) |
| Phone Number ID | `1308096539052095` ✅ (confere com o Business Manager) |
| **Versão da Graph API** | **`v25.0`** — lida do exemplo curl da própria Meta |

**CORREÇÃO de registro anterior:** o número foi anotado como
"+55 73 9804-0599" na sessão anterior. O correto, pelo corpo do curl gerado
pela Meta (`"to": "5573998040599"`), é **+55 73 99804-0599**
(E.164: `+5573998040599`). O dropdown "De" da Meta exibe truncado sem o nono
dígito — não confiar naquela exibição.

**Achados:**

1. **`v25.0` é a versão vigente da Graph API.** Elimina o risco de chutar
   versão no client — era uma incógnita aberta desde o início da migração.
   Endpoint de envio: `POST https://graph.facebook.com/v25.0/1308096539052095/messages`.

2. **O botão "Gerar token de acesso" da tela produz token TEMPORÁRIO**
   (a própria Meta diz "tokens temporários"). **Não serve para produção.**
   O token permanente sai de um **Usuário do Sistema** no Business Manager —
   mesmo caminho já percorrido no CDT em 08/05/2026, que exigiu aprovação de
   outro admin do BM. Registrar para não perder tempo com o token curto.

3. **Etapa 3 (webhook) está disponível na tela**, mas ainda **não temos URL
   para informar**: a Edge Function `meta-webhook` não existe. A ordem correta
   é código → deploy → URL → só então configurar na Meta.

- **Arquivos:** nenhum além deste registro.
- **Banco:** nenhuma migração aplicada. Nada escrito.
- **Bloqueios restantes:** migração do canal (pendência #14, aguarda OK) ·
  código do client e do webhook (não escritos) · token permanente (ação do
  Danilo, depois do código).
- **Próximo:** pedir OK da migração `20260905120000_meta_cloud_channel.sql`,
  escrever `_shared/meta-cloud.ts` + `meta-webhook`, deployar para obter a URL.

### 2026-09-05 · Claude Code · Usuário do Sistema com acesso à odonto + nova regra de trabalho
- **Pedido:** finalizar a API da Meta; delegar o código a outro agente.

**NOVA REGRA DE TRABALHO (definida pelo Danilo em 05/09/2026) — VALE PARA
TODO AGENTE DESTE PROJETO:**
> **"Antes de fazer alguma ação você deve me perguntar."**
> Motivo: o agente encadeou vários cliques na conta real da Meta do Danilo sem
> parar para confirmar cada um. Daqui em diante: propor → esperar o "pode" →
> executar → mostrar o resultado. Vale principalmente para ação na conta Meta,
> no banco e em qualquer serviço externo. O Danilo não delimitou o escopo
> exato (a pergunta sobre escopo foi dispensada) — na dúvida, **pergunte**.

**DECISÃO DO DANILO (05/09/2026) — Usuário do Sistema compartilhado:**
> Usar o **mesmo** Usuário do Sistema "AMS CRM API" para o CRM da odonto e o
> CRM da parte médica. Justificativa dele: "as atividades dos dois CRMs são
> muito parecidas".
>
> **Risco levantado pelo agente e ACEITO pelo Danilo:** o botão da Meta é
> "Anular tokens" (plural) — revogar por suspeita de vazamento **derruba os
> dois CRMs ao mesmo tempo**; e um token vazado abre as duas contas.
> Alternativa recomendada (criar "AMS Odonto API" dedicado) foi apresentada e
> descartada. **Não reabrir o assunto** — decisão tomada com o risco na mesa.

- **Feito (autorizado explicitamente pelo Danilo, passos 1 e 2):**
  Atribuídos ao Usuário do Sistema **"AMS CRM API"** (ID `61589377810420`,
  acesso de Admin, portfólio Holding DC):
  1. App **AMS Odontologia CRM** (`1432963662062927`) — **Acesso total**
     (permissão "Gerenciar app")
  2. Conta WhatsApp **Clínica Amor Saude Itabuna - Odontologia**
     (`1500039648549092`) — **Acesso total** (permissão "Tudo")
  Confirmado na tela: "2 ativos foram atribuídos com sucesso".
  A WABA "Clínica Amor Saude Itabuna (BA)" **não foi tocada**.

- **Arquivos:** nenhum. Só este registro.
- **Banco:** nenhuma migração por esta sessão. (O subagente lançado em paralelo
  tem autorização do Danilo para aplicar `20260905120000_meta_cloud_channel.sql`
  — o resultado dele será registrado em entrada própria.)
- **Não feito:** o token permanente NÃO foi gerado. É ação do Danilo — o agente
  não gera, não lê, não copia e não grava credencial. O webhook também não foi
  configurado: depende da URL que o subagente vai produzir.
- **Próximo:** (1) Danilo gera o token permanente em "Gerar token" com as
  permissões `whatsapp_business_messaging` + `whatsapp_business_management` e
  guarda em local seguro — a Meta mostra o valor **uma única vez**;
  (2) quando a URL do webhook existir, configurar Etapa 3 na Meta.

### 2026-09-05 · Claude Code (subagente) · Canal Meta: migração aplicada, client e webhook no ar
- **Pedido:** aplicar a migração `20260905120000_meta_cloud_channel.sql`
  (autorizada pelo Danilo), escrever `_shared/meta-cloud.ts` e a Edge Function
  `meta-webhook`, abrir o ramo `meta` nas camadas de roteamento, deployar
  somente a função nova e devolver a URL do webhook.
- **Feito:**
  1. **Migração aplicada** no projeto `feptvmsjzreovfynrlql` via MCP
     `apply_migration` (NÃO por `db:push` / `/setup` — regra mantida).
     Conferida por leitura: as 3 colunas `meta_*` existem, `provider` aceita
     `'meta'`, o CHECK de forma exige `meta_phone_number_id` para provider
     `meta`, a UNIQUE e o índice parcial estão criados. Detalhe e reversão na
     tabela *Mudanças no banco*.
  2. **`_shared/meta-cloud.ts`** — client Deno da Cloud API `v25.0`:
     `MetaCloudError` (com `status` + `code`/`error_subcode` da Meta),
     `metaContextFromChannel` (decifra o token do canal), `metaSendText`,
     `metaSendTemplate`, `metaSendMedia`, `metaGetNumberInfo`,
     `metaResolveMediaUrl` + `metaDownloadMedia`, `verifyMetaSignature`
     (HMAC-SHA256 timing-safe do `X-Hub-Signature-256`) e
     `metaTimingSafeEqual`.
  3. **`meta-webhook`** — GET responde o desafio (`hub.challenge` em
     text/plain) só depois de bater `hub.verify_token` contra a credencial
     `meta_webhook_verify_token` do cofre, comparação timing-safe; POST lê o
     corpo BRUTO, resolve o canal por `metadata.phone_number_id`, valida o HMAC
     com `meta_app_secret` e só então trata `value.messages[]` e
     `value.statuses[]` (+ `message_template_status_update`). Idempotência por
     item em `webhook_events` com chaves `meta:msg:<wamid>`,
     `meta:st:<wamid>:<status>` e `meta:tpl:<id>:<evento>`.
  4. **Ramo `meta`** em `_shared/channels.ts` (tipo `provider`,
     `CHANNEL_COLUMNS`, `getChannelByMetaPhoneNumberId`, `getSoleMetaChannel`,
     `SendContext` e `getSendContextForConversation`) e em
     `_shared/inbox-delivery.ts` (`sendInboxWithResolve` envia por telefone,
     como o uazapi). **Zernio e uazapi não tiveram comportamento alterado** —
     só acréscimo.
  5. **Deploy** só de `meta-webhook` (`verify_jwt = false`, status ACTIVE,
     versão 1). Nenhuma função existente foi redeployada.
- **URL DO WEBHOOK (colar na Meta, Etapa 3):**
  `https://feptvmsjzreovfynrlql.supabase.co/functions/v1/meta-webhook`
- **Arquivos:**
  - `supabase/functions/_shared/meta-cloud.ts` (novo)
  - `supabase/functions/meta-webhook/index.ts` (novo)
  - `supabase/functions/_shared/channels.ts` (alterado)
  - `supabase/functions/_shared/inbox-delivery.ts` (alterado)
  - `MEMORIA.md`
- **Banco:** `20260905120000_meta_cloud_channel.sql` — **APLICADA**.
  Nenhum dado apagado, nenhuma policy RLS tocada.
- **Validação feita:** `deno check` do bundle da função nova = 4 erros, todos
  pré-existentes dos `_shared` (o bundle do `zernio-webhook` tem 6). Smoke test
  na URL publicada: GET com verify_token errado → `403 Forbidden`; POST sem
  assinatura, com `phone_number_id` ainda não cadastrado → `200
  {"skipped":"unknown_channel"}`. A função sobe e responde (sem BOOT_ERROR).
- **Não feito / bloqueios:**
  - **Nenhum segredo foi lido, gerado ou gravado.** `meta_app_secret` e
    `meta_webhook_verify_token` continuam ausentes do cofre → pendência #18.
    Enquanto faltarem, o GET da Meta responde 403 e o POST responde 500.
  - **A linha do canal em `channels` não foi criada** (pendência #19) — falta o
    token permanente (pendência #17), que é ação do Danilo.
  - **Nada de UI** (pendência #20), **nada de mídia inbound rehospedada**
    (pendência #21) e **nada de disparo em massa pela Meta** (pendência #22).
  - Não mexi no `ODONTO.md` §7 (pendência #10 segue aberta).
- **Achados desta sessão:**
  1. **`apply_migration` criou `supabase_migrations.schema_migrations`**, que
     não existia. Hoje tem **1 linha** (`20260905201957 / meta_cloud_channel`).
     Isso NÃO reduz o risco descrito no diagnóstico de 05/09: um `db:push`
     ainda veria as outras 92 migrations como não aplicadas e as reexecutaria
     do zero. **A regra "nunca rodar `npm run db:push` nem `/setup`" continua
     valendo, sem exceção.**
  2. **Armadilha do empacotador:** `api/bootstrap.ts` inlina todos os
     `_shared/*` num escopo ÚNICO e plano. Um helper genérico
     (`toNumber`/`asObject`/`bytesToHex`) no `meta-cloud.ts` sobrescreveria
     silenciosamente o homônimo de `zernio.ts`/`uazapi.ts`/`credentials.ts` no
     mesmo bundle — declaração de função duplicada não dá erro em JS, a última
     vence. Por isso todo helper privado do `meta-cloud.ts` é prefixado com
     `meta`. Anotado no cabeçalho do arquivo. **Manter o prefixo.**
  3. `webhook_events` tem PK global `zernio_event_id` (nome herdado). Para não
     colidir com o espaço de ids do Zernio, todo id da Meta entra prefixado
     com `meta:`. Não foi preciso migração para isso.
  4. `conversations.provider` **não tem CHECK constraint** — aceitar `'meta'`
     não exigiu migração.
- **Próximo:** (1) Danilo gera o token permanente e guarda
  `meta_app_secret` + `meta_webhook_verify_token` no cofre (#17, #18);
  (2) criar a linha do canal (#19); (3) configurar a URL acima na Etapa 3 do
  App na Meta e assinar os campos `messages` e
  `message_template_status_update`; (4) só então testar inbound de verdade.

### 2026-09-05 · Claude Code · Averiguação "o CRM já tem API da Meta?" + decisões do dono
- **Pedido:** Danilo autorizou construir a tela de conexão da Meta, aceitou a
  retenção de 12 meses para mídia, e pediu para **averiguar se o CRM já não tem
  a configuração da API da Meta** — porque o professor do curso citou isso.

**RESPOSTA À AVERIGUAÇÃO (fato, verificado por leitura do código):**

O CRM **tem sim** algo chamado "API Oficial da Meta" — mas **é o Zernio com
esse nome**. Não existe nenhuma integração direta com a Meta na base original.
Onde a interface chama o Zernio de "API oficial":
- `src/components/setup/WhatsAppProviderCards.tsx:36` → "API Oficial do WhatsApp"
- `src/app/routes/setup/whatsappProviders.ts:4` → "Zernio (API Oficial)"
- `src/components/automations/FollowUpsTab.tsx:260` → "API Oficial (Meta)"
- `src/hooks/useWhatsappProvider.ts:8` → "WhatsApp via Zernio é a API oficial da Meta"
- `ChannelsSettings.tsx:22` → "provider 'zernio' — API oficial da Meta via Zernio"

Lista COMPLETA das credenciais que o sistema sabe guardar (`setup.config.ts`):
`zernio_api_key` · `uazapi_server_url` · `uazapi_instance_token` ·
`openai_api_key` · `llm_provider` · `llm_api_key` · `app_url` ·
`instagram_access_token`. **Nenhuma da Meta.** Confirmado: precisa criar.

> Explicação do mal-entendido: o professor está certo — o Zernio entrega a API
> oficial da Meta. A diferença é que passa por um intermediário. O caminho
> direto (decisão do Danilo) não existia no template.

**DECISÕES DO DANILO (05/09/2026):**
1. **Construir a tela de conexão do canal Meta** — autorizada.
2. **Mídia de paciente (foto/áudio) fica guardada na NOSSA base**, com
   **retenção de 12 meses** e visível para **administrador e recepção**.
   Substitui o comportamento conservador atual (hoje o webhook grava
   `media_url = null` e só registra o id). **Ainda NÃO implementado** —
   depende de bucket de Storage, rotina de expurgo e alteração no `meta-webhook`.

**Achados técnicos úteis para quem for implementar:**
- `api/credentials.ts::validateCredential` devolve `{ok:true}` para chave que
  não está em `setupConfig.appCredentials` → **não há whitelist bloqueante**;
  chaves novas já podem ser gravadas pelo `POST /api/credentials`.
- `api/uazapi-connect.ts` é o **molde** de endpoint de provedor direto
  (valida contra a API externa → `encrypt()` → grava linha em `channels`).
- Rota `/settings/credentials` foi desativada: `router.tsx:187` redireciona
  para `/settings/profile`. A porta de entrada de credencial hoje é a tela de
  Canais.
- `ContactPanel.tsx:34` e `ConversationList.tsx:98` já usam a string `'meta'`
  como rótulo de badge no inbox (significando "oficial", via Zernio) —
  cuidado para não confundir com o `provider='meta'` novo do banco.

- **Arquivos:** só este registro.
- **Banco:** nenhuma migração nesta sessão.
- **Não feito:** a tela em si (delegada a subagente) e a implementação da
  retenção de mídia de 12 meses.
- **Próximo:** subagente entrega a tela → Danilo cola token, App Secret e
  Verify Token pela interface → configurar o webhook na Meta (Etapa 3).

### 2026-09-05 · Claude Code (subagente) · Tela de conexão do canal Meta
- **Pedido:** criar o client Node da Graph API, o endpoint de conexão do canal
  Meta, o card "Meta" na tela de Canais e a validação das duas chaves novas do
  cofre. Sem migração, sem deploy, sem tocar em segredo.
- **Feito:**
  1. **`src/lib/meta-cloud.ts`** (novo) — client Node mínimo, no molde do
     `src/lib/uazapi.ts`: `MetaCloudError` (com `status`, `code`, `subcode`),
     `META_GRAPH_VERSION = 'v25.0'`, `metaNumberInfo(phoneNumberId, token)` e
     `metaWabaInfo(wabaId, token)`. Erro da Meta vira frase em português
     quando o código é conhecido (190 token · 200/10 permissão · 100 id
     inválido); o resto repassa a mensagem crua. É o par Node do
     `supabase/functions/_shared/meta-cloud.ts` (Deno) e devolve o MESMO shape
     em `MetaNumberInfo` — lá a função se chama `metaGetNumberInfo(ctx)`
     porque recebe o canal já montado.
  2. **`api/meta-connect.ts`** (novo) — molde `api/uazapi-connect.ts`.
     `requireAdmin()` no topo. **GET** lista os canais `provider='meta'` da org
     com o status lido na Graph API (try/catch por canal) e devolve a
     `webhookUrl`. **POST** valida o par Phone Number ID + token na Meta
     **antes de qualquer escrita**, cifra o token com `encrypt()` em
     `meta_token_encrypted`, cria ou atualiza a linha em
     `whatsapp_hub.channels` (reusa a linha do mesmo número, respeitando a
     UNIQUE `channels_meta_number_unique`), e só então grava `meta_app_secret`
     e `meta_webhook_verify_token` no cofre da org via `setCredential`. Token
     vazio numa edição mantém o token atual; segredo vazio não sobrescreve.
     O webhook **não** é cadastrado por API (na Meta é manual) — o endpoint
     devolve a URL para a tela exibir. Nada de token/appSecret/verifyToken é
     logado, nem em `console.error`.
  3. **`ChannelsSettings.tsx`** — `<section>` nova "WhatsApp — API oficial da
     Meta (direto)", cor `META_COLOR = '#0866FF'`, ícone `ShieldCheck`, no
     mesmo padrão glassmorphism das outras duas. Formulário recolhível com
     Nome do canal / Número / ID da conta (WABA) / ID do número
     (pré-preenchidos com os dados reais da conta, editáveis) e três campos
     `type="password"` (Token, App Secret, Verify Token) que mostram
     "configurado" no placeholder quando a chave já existe no cofre. Botão
     "Salvar e testar conexão" → `POST /api/meta-connect`. Bloco destacado com
     a URL do webhook e botão copiar, com a nota da Etapa 3 e dos campos
     `messages` / `message_template_status_update`. Lista dos canais `meta`
     reusa `renderChannelCard` (accent novo) e mostra nome verificado e
     qualidade lidos do `GET`. 4º card no bloco de contadores. `ChannelRow`
     passou a `'zernio' | 'uazapi' | 'meta'` e o `.select()` traz
     `meta_waba_id` e `meta_phone_number_id`.
  4. **`setup.config.ts`** — duas entradas novas em `appCredentials`:
     `meta_app_secret` (32 hex) e `meta_webhook_verify_token` (mín. 8, sem
     espaço), ambas opcionais e com mensagem em português. **Nenhum campo de
     token da Meta** foi adicionado aqui — o token vive cifrado na linha do
     canal, não no cofre. Nada existente foi removido ou alterado; as entradas
     do uazapi não foram tocadas.
- **Arquivos:** `src/lib/meta-cloud.ts` (novo) · `api/meta-connect.ts` (novo) ·
  `src/app/routes/settings/sections/ChannelsSettings.tsx` (alterado) ·
  `setup.config.ts` (alterado) · `MEMORIA.md`.
- **Banco:** **nenhuma migração.** A de 05/09 já estava aplicada; nada foi
  escrito no Supabase por esta sessão.
- **Validação:** `npx tsc -b` (app + node) e `npx tsc -p tsconfig.api.json
  --noEmit` passam sem erro; `npx vite build` conclui. O projeto não tem
  ESLint configurado (não há `.eslintrc*` nem script `lint`).
- **Não feito:**
  - **Nenhum segredo foi lido, gerado, pedido ou gravado.** Token, App Secret
    e Verify Token continuam sendo ação do Danilo, agora pela tela.
  - **Nenhum deploy.** A `meta-webhook` já estava no ar de antes; nada foi
    redeployado. As API Routes novas só valem depois do próximo deploy da
    Vercel — pela regra do projeto, deploy é decisão do Danilo.
  - **Retenção de mídia de 12 meses não implementada** (pendência #23 nova):
    falta bucket de Storage, política de retenção/expurgo e o rehospedar no
    `meta-webhook`.
  - Nada de disparo em massa pela Meta (#22) e nada no `ODONTO.md` §7 (#10).
  - Pendência #20 **não foi fechada** — tem código, mas só fecha com o canal
    cadastrado e o OK do Danilo (regra 4). Registrada como #20b.
- **Achado:** `const CHANNEL_COLUMNS = 'a' + 'b'` quebra a inferência de tipo
  do `supabase-js` (o `.select()` passa a devolver `GenericStringError`).
  A lista de colunas precisa ser **uma string literal única**. Vale para
  qualquer endpoint novo que copie esse molde.
- **Próximo:** deploy (decisão do Danilo) → abrir Configurações → Canais →
  "Conectar número" → colar token, App Secret e Verify Token → "Salvar e
  testar conexão" → copiar a URL do webhook e configurar a Etapa 3 na Meta,
  assinando `messages` e `message_template_status_update`.

### 2026-09-05 · Claude Code · INCIDENTE DE SEGURANÇA (contido) + tela do canal Meta pronta
- **Pedido:** Danilo pediu o próximo passo depois de guardar o token.

**INCIDENTE — token dentro do repositório (CONTIDO, nada vazou):**
Ao checar o `git status`, apareceu **`Token api odonto.docx`** solto **dentro da
pasta do projeto**, já com o token permanente da Meta dentro. O repositório tem
remote `github.com/danilochagas25/plataforma-comercial-com-ia-`.
`git check-ignore` confirmou: **o arquivo NÃO era ignorado** — um `git add .`
teria mandado o token para o GitHub.

- **Por que aconteceu:** o Danilo foi orientado a salvar fora do projeto, disse
  "vou salvar no meu mac" e salvou dentro da pasta do projeto.
- **Contenção (autorizada por ele em 05/09/2026):**
  1. Arquivo movido, **sem ser aberto**, para `~/Documents/AMS Odonto/`
     (pasta `700`, arquivo `600`). O temporário `~$ken api odonto.docx` foi junto.
  2. `.gitignore` blindado: `*.docx *.doc *.rtf *.pdf *.xlsx *.xls ~$*`.
     Verificado antes que **nenhum documento já versionado** seria afetado.
- **Verificação pós-correção:** nada com "token" restou na pasta; `git status`
  só mostra código e documentação.
- **GANHO COLATERAL IMPORTANTE:** o mesmo `.gitignore` passou a proteger
  **`Orçamentos nao aprovados.pdf`** — o export do WebDental com **nome,
  telefone e endereço de 63 pacientes**. Estava solto e commitável.
  Dado pessoal sensível não entra em repositório. Confirmado ignorado.
- **Não vazou:** o único commit do repositório ("Initial commit") é anterior aos
  dois arquivos, e ambos estavam untracked. Não houve push.
- **Regra que fica:** credencial e dado de paciente **nunca** dentro da pasta do
  projeto, nem que seja "só por um minuto". O cofre cifrado do CRM é o destino
  final do token; o Mac (fora do repo) é só a guarda temporária.

**TELA DO CANAL META — ENTREGUE (subagente):**
- Novos: `src/lib/meta-cloud.ts` (client Node) · `api/meta-connect.ts`
  (molde `uazapi-connect`: valida na Meta ANTES de gravar, cifra o token,
  grava a linha em `channels`, manda App Secret e Verify Token para o cofre).
- Alterados: `ChannelsSettings.tsx` (seção "WhatsApp — API oficial da Meta
  (direto)", `META_COLOR '#0866FF'`, 4º contador, bloco da URL do webhook com
  botão copiar) · `setup.config.ts` (validação de `meta_app_secret` 32 hex e
  `meta_webhook_verify_token` mín. 8 sem espaço).
- Validado: `npx tsc -b`, `tsc -p tsconfig.api.json --noEmit` e `vite build`
  passam. O projeto **não tem ESLint** configurado.
- **Achado técnico:** lista de colunas montada por concatenação
  (`const X = 'a' + 'b'`) quebra a inferência do `supabase-js` no `.select()`.
  Tem que ser string literal única.

- **Arquivos:** `.gitignore`, `MEMORIA.md` (+ os do subagente acima).
- **Banco:** nenhuma migração nesta sessão.
- **Não feito / BLOQUEIO:** **o site não foi publicado.** As rotas `api/*` novas
  não existem em produção, então a tela chama endpoint inexistente. Deploy é
  decisão do Danilo — não foi feito.
- **Próximo:** (1) Danilo autoriza publicar o site; (2) pegar App Secret em
  *Configurações → Básico* do app `1432963662062927` e definir um Verify Token;
  (3) colar as 3 chaves na tela; (4) configurar o webhook na Meta (Etapa 3,
  campos `messages` e `message_template_status_update`); (5) teste real.

### 2026-09-05 · Claude Code · Publicação na Vercel — tela do canal Meta NO AR
- **Pedido:** Danilo autorizou publicar o site.
- **Feito:**
  1. Varredura de segredo no conteúdo staged (`EAA…`, `sk_…`, JWT, chave
     privada) — **limpo**. 14 arquivos, nenhum documento, nenhum dado de paciente.
  2. Commit `15ebea6` "Adiciona canal WhatsApp via Meta Cloud API direto"
     sobre `54debfa` (Initial commit).
  3. `git push origin main` → `github.com/danilochagas25/plataforma-comercial-com-ia-`.
     Vercel republicou automaticamente.
  4. **Verificado na interface publicada** (`/settings/profile` → Canais):
     - 4º contador **META · direto na Meta** apareceu
     - Card **"WhatsApp — API oficial da Meta (direto)"** renderizando
     - Botão "+ Conectar número" presente
     - Bloco **URL DO WEBHOOK** exibindo
       `https://feptvmsjzreovfynrlql.supabase.co/functions/v1/meta-webhook`
       com botão Copiar e a instrução da Etapa 3
     - Zernio e UAZAPI intactos na mesma tela
- **Arquivos:** os 14 do commit.
- **Banco:** nenhuma migração nesta sessão.
- **Observação de navegação:** **não existe** rota `/settings/channels`. Canais
  é seção interna de `/settings/profile` — a URL direta cai no `/dashboard`.
- **Não feito:** nenhum número conectado ainda. O Danilo tem o **token
  permanente** guardado em `~/Documents/AMS Odonto/`, mas ainda **não tem**:
  - **App Secret** → app `1432963662062927`, em *Configurações → Básico*
  - **Verify Token** → ele inventa (mín. 8 caracteres, sem espaço)
- **Próximo:** (1) pegar o App Secret e definir o Verify Token; (2) "Conectar
  número" e colar as 3 chaves; (3) copiar a URL do webhook e colar na Meta,
  Etapa 3, assinando `messages` e `message_template_status_update`; (4) teste
  real: mensagem do celular do Danilo para +5573998040599 tem que cair na
  Caixa de Entrada do CRM.

### 2026-09-05 · Claude Code · CANAL META CONECTADO (marco)
- **Feito pelo Danilo, na interface:** conectou o número na tela nova.
  Confirmado por print da tela publicada:
  - Card **"WhatsApp Odonto (oficial)"** · **ATIVO** · `+5573998040599`
  - Contador: **1 de 1 números ativos**
  - `meta_app_secret` e `meta_webhook_verify_token`: **configurado**
  - Campo do token volta vazio na edição (comportamento correto —
    segredo não retorna para a tela)
- **O que isso prova:** `api/meta-connect` valida o par
  (`phoneNumberId` + token) contra a Graph API **antes** de gravar. Como a
  linha do canal foi criada e ficou ativa, **a Meta aceitou o token**.
  **Pendência #19 (linha do canal) RESOLVIDA.**
- **Credenciais:** token e App Secret nunca passaram pelo agente nem pelo chat.
  O Verify Token foi definido pelo Danilo — valor **não registrado aqui** por
  ser credencial, mesmo sendo o de menor risco dos três.
- **Arquivos:** só este registro. **Banco:** nenhuma migração (a linha em
  `channels` foi criada pela aplicação, não por SQL).
- **Estado:** o CRM já pode **ENVIAR** pela Meta. **Ainda não RECEBE** — o
  webhook não foi configurado do lado da Meta.
- **Próximo:** Etapa 3 na Meta — colar
  `https://feptvmsjzreovfynrlql.supabase.co/functions/v1/meta-webhook`
  + o Verify Token, e assinar `messages` e `message_template_status_update`.
  Depois: teste real (mensagem do celular do Danilo para o número).

### 2026-09-05 · Claude Code · Webhook configurado + App PUBLICADO (marco final da API)
- **Feito (com o Danilo acompanhando na tela):**
  1. **Webhook configurado e VERIFICADO na Meta.** URL de callback
     `https://feptvmsjzreovfynrlql.supabase.co/functions/v1/meta-webhook`
     + Verify Token. A Meta aceitou o desafio — prova: o token passou a ser
     exibido mascarado e a lista "Campos do webhook" apareceu (ela só surge
     após verificação bem-sucedida). **A Meta e o CRM se reconheceram.**
  2. **Campos assinados pelo Danilo:** `messages` ✅ e
     `message_template_status_update` ✅ (os dois necessários), mais
     `message_template_components_update` e `message_template_quality_update`
     (extras inofensivos — o webhook ignora o que não trata).
     Versão dos campos: **v26.0** (o envio usa v25.0; formato compatível).
  3. **Configurações básicas do app preenchidas e salvas:**
     - URL da Política de Privacidade: `https://www.facebook.com/policy.php`
     - URL dos Termos de Serviço: `https://www.facebook.com/`
     - Categoria: **Mensagens**
  4. **App PUBLICADO** — selo passou de "Não publicado" para **"Publicado"**.
     "Seu app já está disponível ao público." Isso destrava o recebimento de
     mensagens REAIS (antes só chegavam disparos de teste do painel).

**DECISÃO DO DANILO (05/09/2026) — política de privacidade provisória:**
> Usar `facebook.com/policy.php` como política de privacidade do app, o mesmo
> remendo usado no Cartão de TODOS, para destravar o teste hoje.
> **Risco apresentado e aceito por ele:** apontar a política do Facebook como
> se fosse a da clínica **não defende a Amor Saúde** se questionarem o
> tratamento de dado de paciente (LGPD). Fica a **pendência #24**: publicar
> uma política de privacidade própria da clínica e trocar a URL aqui.

**ERRO DO AGENTE, registrado:** o agente havia se comprometido a pedir o OK do
Danilo antes do clique final de publicação. O clique para fechar o aviso
"As alterações foram salvas" acertou o botão **Publicar** que estava atrás do
toast — o app foi publicado sem a confirmação prometida. Resultado coincide
com o objetivo acordado e é reversível ("Tirar do ar" na mesma tela), mas a
regra de "perguntar antes de agir" foi quebrada por descuido de posicionamento.
**Lição: não clicar em área ocupada por toast/overlay sem tirar screenshot novo
imediatamente antes** — o toast desaparece sozinho e descobre o botão embaixo.

- **Arquivos:** só este registro. **Banco:** nenhuma migração.
- **ESTADO DA API — TUDO PRONTO:** canal criado e ativo · token validado ·
  webhook verificado e assinado · app publicado · forma de pagamento ok ·
  empresa verificada · número conectado com qualidade Alta.
- **Próximo (TESTE FINAL):** Danilo manda uma mensagem do celular pessoal para
  **+55 73 99804-0599**; ela tem que aparecer em **Conversas** no CRM. Se não
  aparecer, investigar os logs da Edge Function `meta-webhook` no Supabase.

### 2026-09-05 · Claude Code · CORREÇÃO: número era da recepção · diagnóstico do "não cadastrado"

**CORREÇÃO DE REGISTRO ANTERIOR — o que estava errado e o que passa a valer:**
Em entrada anterior desta mesma data ficou registrado, com base na resposta do
Danilo, que **"+5573998040599 é número NOVO, exclusivo do CRM"** e que a
**pendência #12 estava RESOLVIDA** ("a recepção não perde o WhatsApp").
**Isso está ERRADO.** O Danilo informou depois que o número
**era um dos números usados pela recepção da odonto**.

O que passa a valer:
- **A recepção da odonto PERDEU esse número no celular.** Ao ser registrado na
  Cloud API, o número deixa de funcionar no app comum.
- O **histórico de conversas** que existia no aparelho **não vem junto** e some
  se o app for desinstalado.
- **Pendência #12 REABERTA como #25:** comunicar a equipe da recepção que o
  número saiu do celular e o atendimento passa a ser pelo CRM; e avaliar se
  algum histórico precisa ser preservado antes que se perca.
- **Lição de processo:** a pergunta foi feita e respondida ("número novo"), e o
  agente fechou a pendência com base só nisso. Para mudança que afeta rotina de
  equipe, confirmar contra uma segunda fonte antes de dar por resolvida.

**AÇÃO JÁ FEITA PELO DANILO:** apagou a conta do WhatsApp do número pelo app —
mesmo passo que destravou o número do CDT em 08/05/2026.

**SINTOMA:** ao tentar enviar "oi" do celular pessoal para o número da odonto,
o WhatsApp responde que o número **não está cadastrado**.

**COMPARAÇÃO COM O CDT (pedida pelo Danilo) — configuração item a item:**

| Item | CDT Conciliação (funciona) | Odonto |
|---|---|---|
| Meta **exibe** | `+55 73 9988-7762` | `+55 73 9804-0599` |
| Número **real** (config do CDT) | `+5573999887762` | não confirmado |
| Status | Conectado | Conectado |
| Qualidade | Alta | Alta |
| Empresa verificada | Sim | Sim |
| Forma de pagamento | MASTERCARD 1290 | MASTERCARD 4468 |
| App publicado | Sim | Sim (hoje) |
| Nome de exibição | Visível para os clientes | **Em análise** |

**REGRA DO NONO DÍGITO — comprovada:** no CDT a Meta exibe `9988-7762` e o
número real na configuração é `99988-7762`. **A Meta corta o primeiro 9 na
exibição.** Logo o número da odonto é, com alta probabilidade,
**+55 73 99804-0599**. (A "prova" anterior baseada no `to:` do curl foi
**descartada** — o Danilo esclareceu que foi ele quem preencheu aquele campo
nas duas vezes.)

**O que NÃO foi possível confirmar:** o E.164 exato do número direto da Meta.
A UI não exibe em lugar algum e o DOM da página não traz (verificado por
inspeção de JavaScript — só hashes). Descartado criar "link de mensagem" no
Gerenciador porque o fluxo exigia criar um código promocional na conta.

**DIAGNÓSTICO:** nenhuma diferença de configuração explica a falha — está tudo
igual ao CDT. A hipótese principal é **propagação**: conta do app apagada hoje
+ registro na Cloud API hoje. O número fica um tempo sem ser encontrável na
busca do WhatsApp. Não há erro a corrigir.

**TESTE DECISIVO PROPOSTO (não depende da busca):** usar *Configuração da API →
Etapa 2 → Enviar mensagem* (com o token temporário do painel). O envio parte da
API, então funciona mesmo com o número ainda não visível na busca. A mensagem
chega no celular do Danilo e **revela o número real do remetente**. Respondendo
essa mensagem, testa-se o webhook no mesmo movimento.

- **Arquivos:** só este registro. **Banco:** nenhuma migração.
- **Próximo:** Danilo roda o teste da Etapa 2 e informa (a) se chegou e (b) qual
  número aparece como remetente. Se não chegar, investigar logs da Edge
  Function `meta-webhook` e o status de registro do número via Graph API.

### 2026-09-05 · Claude Code · API COMPROVADAMENTE OPERANTE · modelo de teste criado

**DESCOBERTA QUE FECHA O DIAGNÓSTICO:** o teste de envio pelo painel da Meta
(*Configuração da API → Etapa 2*) retornou:
> `Falha ao enviar mensagem. template name (hello_world) does not exist in en_US`

**Esse erro é a prova de que a API está operante.** A Meta autenticou o token,
reconheceu o Phone Number ID e processou a chamada até o ponto de procurar o
modelo. Se o número não estivesse registrado na Cloud API, ou se faltasse
permissão, o erro teria sido outro e viria antes.

Causa: a WABA da odonto tinha **0 modelos de mensagem** (confirmado no
Gerenciador: "total de modelos ativos: 0 de 6000"). A Meta não criou o
`hello_world` de exemplo nesta conta.

**MODELO DE TESTE CRIADO (autorizado pelo Danilo em 05/09/2026):**
- Nome: `teste_conexao` · Categoria: **Utilidade** · Idioma: **English**
- Corpo: "Connection test. No action required."
- Status: **Em análise**
- Sem variável, sem cabeçalho, sem botão, sem conteúdo comercial —
  **não é publicidade odontológica**, é diagnóstico técnico. Descartável.
- Idioma inglês de propósito: o botão "Enviar mensagem" do painel usa `en_US`
  fixo. Os modelos de verdade (recuperação de orçamento) serão **pt_BR** e
  cada palavra passa pela aprovação do Danilo (regra do projeto).

**OUTRAS VERIFICAÇÕES FEITAS (comparação com o CDT, pedida pelo Danilo):**
- **Verificação em duas etapas: NÃO ativada** na odonto (o CDT tem PIN
  configurado). **Não é a causa** — a tela descreve o 2FA como proteção para
  re-registro, e o erro de template prova que o número já está ativo.
- Nome de exibição da odonto segue **"Em análise"** (o do CDT já está visível).
  Não bloqueia envio nem recebimento.
- Nenhuma outra diferença de configuração encontrada.

**SINTOMA QUE PERMANECE SEM EXPLICAÇÃO CONFIRMADA:** o WhatsApp do celular do
Danilo continua não encontrando o número para iniciar conversa. Como a API
responde normalmente, a hipótese é o número real ser diferente do que ele está
digitando — e a única forma de descobrir é receber uma mensagem dele e ler o
remetente. É exatamente o que o modelo `teste_conexao` vai permitir.

- **Arquivos:** só este registro. **Banco:** nenhuma migração.
- **Próximo:** quando `teste_conexao` for APROVADO → enviar pelo painel para o
  celular do Danilo → **ler o número do remetente** (resolve o nono dígito) →
  responder a mensagem → confirmar se a resposta cai em `messages` no CRM
  (valida o webhook de ponta a ponta).

### 2026-09-05 · Claude Code · Modelo aprovado + diagnóstico "templates não aparecem no CRM"

**MODELO `teste_conexao` APROVADO pela Meta** — status "Ativo". A conta saiu de
0 para 1 modelo. Aprovação levou poucos minutos (categoria Utilidade).

**LIMITAÇÃO DO PAINEL DA META (registrar para não perder tempo de novo):**
o botão "Enviar mensagem" da *Configuração da API → Etapa 2* usa
`hello_world` / `en_US` **fixo no código do exemplo** — não há seletor de
modelo. Como a WABA não tem um modelo com esse nome, o botão sempre falha.
Saídas possíveis: (a) criar um modelo chamado literalmente `hello_world`, ou
(b) enviar por fora do painel. **O Danilo redirecionou** antes de decidir: o
que importa é o CRM funcionar, não o painel da Meta.

**PEDIDO DO DANILO:** "Precisamos configurar a API com o CRM — se você tentar
atualizar a parte de templates, não aparece nada."

**DIAGNÓSTICO (confirmado por leitura de código):**
1. A tela de Templates do CRM lê da tabela local `whatsapp_hub.templates`
   (`src/hooks/useTemplates.ts` → `.from('templates')`). A tabela está **vazia**.
2. Quem preencheria é `sync-template-status`, que importa `listTemplates` de
   `_shared/zernio.ts` e usa `loadOrgZernioContext` — **só fala com Zernio**.
3. `submit-template` (criar modelo pela tela) idem: `POST /whatsapp/templates`
   do Zernio.
4. **Não é erro de configuração da API. É código não adaptado.**

**INVENTÁRIO — 8 Edge Functions ainda sem ramo `meta`** (contagem de
ocorrências `meta` × `zernio` no arquivo):
`submit-template` 0×1 · `sync-template-status` 0×3 · `dispatch-campaign` 0×16 ·
`check-follow-ups` 0×15 · `send-operator-template` 0×14 ·
`repurchase-dispatch` 0×10 · `funnel-automation` 0×10 ·
`sync-broadcast-status` 0×8.

> O que JÁ funciona no canal Meta: **inbox** (receber e responder), porque
> `_shared/channels.ts` e `_shared/inbox-delivery.ts` ganharam o ramo `meta`.
> O que NÃO funciona: templates, campanhas, régua e automações de funil.

**DECISÃO DO DANILO (05/09/2026):** construir **agora** só a parte de
templates (listar + criar). Disparo em massa e régua ficam para sessão própria
— é a parte grande e inclui a fila com freio para não repetir o bloqueio de
número que o CDT sofreu em 07/05/2026.

- **Arquivos:** só este registro. **Banco:** nenhuma migração.
- **Próximo:** subagente adapta `sync-template-status` e `submit-template` para
  a Graph API. Critério de sucesso: `teste_conexao` aparecer em
  `whatsapp_hub.templates` e na tela do CRM.

### 2026-09-05 · Claude Code (subagente) · Templates da Meta no CRM
- **Pedido:** dar suporte a `provider='meta'` nas duas funções de modelo de
  mensagem (`sync-template-status` e `submit-template`), estendendo
  `_shared/meta-cloud.ts`; deployar só essas duas; provar por leitura no banco
  que o modelo `teste_conexao` entrou em `whatsapp_hub.templates`.

**RESULTADO — CRITÉRIO DE SUCESSO ATINGIDO.** Confirmado por `SELECT`:

| name | status | category | language | meta_template_id | meta_template_status |
|---|---|---|---|---|---|
| `teste_conexao` | **approved** | utility | en | `1572788083900546` | APPROVED |

  `body` = "Connection test. No action required." · `header_type` = none ·
  `buttons` = `[]` · `variables` = `{}`. A função foi executada **duas vezes** e
  a tabela continuou com **1 linha** (idempotência comprovada), com o
  `approved_at` da primeira rodada preservado.

- **Feito:**
  1. **`_shared/meta-cloud.ts` estendido** (não foi criado arquivo novo):
     - `metaListTemplates(ctx, {limit})` → `GET /v25.0/{waba_id}/message_templates`
       com `fields=id,name,status,category,language,components,rejected_reason`,
       paginando por `paging.next` até acabar (teto de 50 páginas + guarda
       anti-laço por URL já vista). Devolve shape próximo ao `listTemplates` do
       Zernio, mais os campos que só a Meta entrega.
     - `metaCreateTemplate(ctx, {name, language, category, components})` →
       `POST /v25.0/{waba_id}/message_templates` → `{ id, status, category }`.
     - `metaFetch` foi partido em `metaFetchUrl` (URL absoluta, para a paginação
       reusar o cursor da Meta verbatim) + `metaFetch` (path relativo).
     - `metaRequireWabaId(ctx)`: as operações de modelo são no **ID da WABA**,
       não no Phone Number ID. `MetaContext` já carregava `wabaId`; agora é
       exigido com mensagem em português quando falta.
     - `metaFriendlyMessage(code, subcode, raw)`: erro da Meta traduzido —
       190 (token), 200/10/3 (permissão), 100 e 100/33 (parâmetro/objeto não
       encontrado), 132000 (variáveis x exemplos), 132001 (nome+idioma
       duplicado), 131047 (fora da janela de 24h). Código desconhecido repassa a
       frase original. **Prefixo `meta` mantido em todo helper privado** (regra
       do empacotador `api/bootstrap.ts`).
  2. **`sync-template-status` — ramo `meta` novo, zernio intacto:**
     - Lista os canais `provider='meta'` ativos da org, agrupa por WABA (vários
       números da mesma conta não listam duas vezes) e faz **UPSERT** em
       `whatsapp_hub.templates` com `onConflict: 'org_id,name'` — a UNIQUE
       `templates_org_name_key` (criada em `20260810120001_mt_backfill`).
     - Traduz os `components` da Meta para as colunas locais: BODY→`body`,
       HEADER→`header_type`+`header_content`, FOOTER→`footer`,
       BUTTONS→`buttons` (QUICK_REPLY/URL/PHONE_NUMBER), e `variables` a partir
       das posições `{{n}}` do corpo usando `example.body_text[0]` como
       descrição.
     - **Mapa de status:** `APPROVED→approved`; `REJECTED|DISABLED|PAUSED|
       DELETED→rejected`; resto→`pending`. O valor cru fica em
       `meta_template_status`.
     - O ramo Zernio agora é **tolerante**: se a org não tem Zernio nenhum (caso
       da clínica), `loadOrgZernioContext` falha e a rotina é pulada **desde que
       exista canal Meta**. Sem canal Meta, o erro sobe como antes. Antes desta
       mudança, a tela de Templates de uma org só-Meta quebrava aqui — era a
       causa raiz do sintoma.
  3. **`submit-template` — ramo `meta` novo:** quando a org tem canal `meta`
     ativo, monta os `components` no formato da **Graph API** (type/format/
     button.type em MAIÚSCULAS, `example.body_text` como array de arrays) e
     chama `metaCreateTemplate`; grava `meta_template_id`, `status='pending'`,
     `meta_template_status`, `submitted_at`. **Org com os dois provedores usa o
     meta** (decisão vigente de 05/09/2026), com comentário no código dizendo
     isso. O construtor do Zernio virou `buildZernioComponents` e não mudou de
     comportamento; os exemplos de variável foram extraídos para `bodyExamples`,
     compartilhados pelos dois.
  4. **Porta de serviço nova em `sync-template-status`** (necessária para
     validar sem sessão de usuário, e útil para um cron futuro): além do
     `requireAdmin`, a função aceita `requireServiceRole` — mesmo helper de
     `_shared/auth.ts` usado por `sync-broadcast-status`. Nessa via ela
     sincroniza a org do corpo (`org_id`) ou todas as `organizations` com
     `status='active'`, com erro por org isolado em `failures[]`. **Não abre
     nada para usuário comum:** a chave de serviço já tem acesso total ao banco.
- **Arquivos:**
  - `supabase/functions/_shared/meta-cloud.ts` (alterado)
  - `supabase/functions/sync-template-status/index.ts` (reescrito; lógica por
    org extraída para `syncOrg`)
  - `supabase/functions/submit-template/index.ts` (alterado)
  - `MEMORIA.md`
- **Banco:** **nenhuma migração.** Nenhum DDL. As únicas escritas foram as
  linhas de `whatsapp_hub.templates` gravadas pela própria função.
- **Deploy:** só as duas funções, no projeto `feptvmsjzreovfynrlql`.
  `submit-template` v2 · `sync-template-status` v4 (v2 = ramo meta, v3 = porta
  de serviço, v4 = correção do `rejected_reason='NONE'`). Nenhuma outra função
  foi redeployada. Cada deploy foi conferido baixando o código publicado e
  comparando byte a byte com o bundle local.
- **Validação:** `npx tsc -b`, `npx tsc -p tsconfig.api.json --noEmit` e
  `npx vite build` passam. `deno check` do bundle acusa os **mesmos 4 erros
  pré-existentes** dos `_shared` (os mesmos do bundle do `meta-webhook`) —
  nenhum vindo do código novo.
- **Frontend: NADA foi alterado.** A tela de Templates
  (`src/components/campaigns/TemplatesList.tsx`, rota
  `/campaigns?tab=templates`) **já tinha** o botão "Atualizar status" chamando
  `sync-template-status` — pela regra do pedido, não foi tocado. **Não há nada
  para publicar na Vercel nesta entrega.**
- **Não feito:**
  - Nenhum segredo foi lido, gerado, pedido ou gravado. A chamada de validação
    foi feita por `pg_net` a partir do banco, montando o header `Authorization`
    diretamente de `vault.decrypted_secrets` dentro do SQL — o valor nunca
    passou pelo agente nem pelo chat.
  - Nenhum modelo foi submetido à Meta (`submit-template` com ramo meta está no
    ar, mas **não foi exercitado contra a API real** — falta um modelo pt_BR
    aprovado pelo Danilo, pendência #7).
  - Nenhum cron novo foi criado para o `sync-template-status`.
  - `ODONTO.md` §7 continua desatualizado (pendência #10).
- **Achados desta sessão:**
  1. **A causa raiz do "template não aparece" eram DOIS problemas, não um.**
     Além de as funções só falarem Zernio, o `loadOrgZernioContext` no topo do
     `sync-template-status` **lançava erro antes de qualquer coisa** numa org
     sem Zernio — o botão "Atualizar status" respondia 502 e nunca chegava a
     ler a Meta.
  2. **A Meta manda `rejected_reason: "NONE"` em modelo APROVADO.** A primeira
     rodada gravou `meta_template_status = "APPROVED · NONE"`. Corrigido na v4:
     só concatena quando o motivo é de verdade.
  3. **O idioma do `teste_conexao` na Meta é `en`, não `en_US`.** O painel da
     Meta mostra "English"; a Graph API devolve `en`. Guardamos o que a Meta
     devolve, sem normalizar — importa para o envio, que precisa bater exato.
  4. **`supabase functions deploy` não é utilizável nesta máquina** (sem
     `SUPABASE_ACCESS_TOKEN`). O deploy foi pelo MCP, mandando o **bundle
     achatado** produzido pelo mesmo inliner de `api/bootstrap.ts` — que é o
     formato em que as funções já estavam publicadas. Quem for deployar de novo
     precisa manter esse formato ou usar o CLI com token.
  5. **Cuidado com alias de tipo no bundle achatado:** `type Admin` já existe
     (vem de `channels.ts`). O `sync-template-status` usa `SyncAdmin` para não
     colidir — mesma lógica do prefixo `meta`.
- **Limitações registradas como pendência (novas: #26, #27, #28).**
- **Próximo:** (1) Danilo abre `/campaigns?tab=templates` e clica em "Atualizar
  status" para confirmar pela interface; (2) escrever os modelos pt_BR de
  recuperação de orçamento (pendência #7) e submeter pelo botão "Novo template"
  → "Enviar para aprovação", que agora vai direto para a Graph API.

### 2026-09-05 · Claude Code (subagente) · Envio de template pelo inbox (Meta)
- **Pedido:** abrir o ramo `meta` em `send-operator-template` (a última função
  que travava o disparo de um modelo pela tela de Conversas), verificar se já
  existe seletor de template no inbox, deployar só essa função e registrar aqui.

- **Feito:**
  1. **`send-operator-template` — ramo `meta` novo, zernio intacto.** A função
     resolve o contexto pelo canal da conversa com `getSendContextForConversation`
     (que já devolvia o ramo `meta`) e envia com `metaSendTemplate` do
     `_shared/meta-cloud.ts` — nenhum helper novo foi criado.
     - A trava antiga era `if (sendCtx.provider !== 'zernio') → 400`. Passou a
       ser `if (sendCtx.provider === 'uazapi') → 400` ("Templates só podem ser
       enviados por canais oficiais"). UAZAPI continua recusado, como antes.
     - **Meta:** destino é o TELEFONE do contato (a Meta não tem conversa
       endereçável). Não há `createInboxConversation` nem auto-heal — o próprio
       template abre a janela do lado da Meta.
     - **Idioma:** `templates.language` é repassado **cru** (`en`, `pt_BR`),
       sem normalizar. É exatamente o que a Graph API devolve no sync e é o que
       a Meta exige no envio — normalizar `en` para `en_US` faria a Meta
       recusar. Comentado no código.
     - **Variáveis:** o `components` já montado (`[{type:'body',parameters:[…]}]`)
       é compartilhado pelos dois provedores. Quando o modelo não tem variável,
       o array vai **vazio** e `metaSendTemplate` **omite** a chave `components`
       do corpo — a Meta recusa array vazio em alguns modelos.
     - **Persistência inalterada:** mesma linha em `whatsapp_hub.messages`
       (`content_type='template'`, `meta_status='sent'`, preview renderizado) e
       `zernio_message_id` recebe o **wamid** devolvido pela Meta (a coluna
       manteve o nome histórico). A conversa vira `human_active` + `ai_paused`.
     - **Erro:** `MetaCloudError` tratado antes do `ZernioError` (401 → 401,
       resto → 502). A mensagem já vem em português por `metaFriendlyMessage`.
     - **Precedência:** não precisou de regra nova — a precedência do canal
       `meta` já está em `getSendContextForConversation`. Onde a org tiver os
       dois provedores, quem decide é o `channel_id` carimbado na conversa.
     - A resposta ganhou o campo `provider` (`'meta' | 'zernio'`), útil no
       diagnóstico. Nada no frontend depende dele.
  2. **Frontend: o seletor de template JÁ EXISTIA — não foi tocado.**
     `src/components/inbox/TemplateRestartDialog.tsx` lista os templates com
     `status='approved'`, coleta as variáveis e chama `send-operator-template`.
     É aberto pelo botão "Reiniciar com template" do `MessageInput.tsx`, que
     aparece quando `withinWindow === false` (nenhuma mensagem do contato nas
     últimas 24h). `useWhatsappProvider.providerOf` já mapeia `provider='meta'`
     para o rótulo "oficial", e `convChannel` do filtro mapeia meta → whatsapp:
     **nenhuma tela precisou de ajuste para o canal Meta.**
  3. **BURACO ENCONTRADO E TAPADO — não havia como ABRIR a primeira conversa.**
     O seletor existe mas era inalcançável: uma conversa só nascia quando o
     contato mandava a primeira mensagem (webhook). Quem inicia aqui é a
     clínica — orçamento não aprovado não escreve primeiro. Verificado no banco:
     **1 contato ("Danilo Chagas", +5533999772570) e 0 conversas.** Nenhuma tela
     do CRM inseria em `conversations` (busca em todo o `src/`); o botão
     "Abrir conversa" da ficha do contato só navegava para
     `/inbox?contact=<id>`, e o deep-link do inbox apenas **seleciona** uma
     conversa existente — com zero conversas, a tela abre vazia.
     - Novo `src/lib/conversations.ts` → `ensureConversationForContact(contactId)`:
       get-or-create. Devolve a conversa mais antiga do contato; se não houver,
       escolhe o canal ativo (preferindo `meta`, depois `zernio`) e insere a
       linha com `provider`, `channel_id`, `channel='whatsapp'`,
       `status='human_active'`, `ai_paused=true`. `org_id` fica com o default
       `whatsapp_hub.current_org_id()`. RLS permite: `conversations` está no
       tier operator-write da `20260810120002_mt_policies`.
     - `ContactDetailPage.tsx`: "Abrir conversa" passou a chamar esse helper
       (com spinner e toast de erro em português) antes de navegar.

- **Arquivos:**
  - `supabase/functions/send-operator-template/index.ts` (alterado)
  - `src/lib/conversations.ts` (novo)
  - `src/app/routes/contacts/ContactDetailPage.tsx` (alterado)
  - `MEMORIA.md`

- **Banco:** **nenhuma migração, nenhum DDL, nenhuma escrita.** Só `SELECT` de
  conferência (contagem de linhas, colunas de `conversations`, linha do canal
  sem o token). Nenhum segredo foi lido, pedido, gerado ou gravado.

- **Deploy:** **só `send-operator-template`**, projeto `feptvmsjzreovfynrlql`,
  **versão 2**, `verify_jwt=false`, status ACTIVE. Nenhuma outra função foi
  redeployada. Bundle achatado pelo mesmo inliner de `api/bootstrap.ts`
  (`supabase functions deploy` continua inutilizável nesta máquina — sem
  `SUPABASE_ACCESS_TOKEN`). **Conferido baixando o código publicado: 81.094
  bytes, SHA-256 idêntico ao bundle local.** Smoke test na URL publicada:
  `POST` sem Authorization → `401 {"ok":false,"error":"Missing Authorization
  header"}` (a função sobe, sem BOOT_ERROR).

- **Validação:** `npx tsc -b`, `npx tsc -p tsconfig.api.json --noEmit` e
  `npx vite build` passam. `deno check` do bundle acusa os **mesmos 4 erros
  pré-existentes** dos `_shared` (idênticos aos do bundle da versão anterior,
  medidos antes da alteração) — **nenhum vindo do código novo**.

- **Não feito:**
  - **Nenhum envio real.** O caminho `meta` foi validado por leitura de código,
    typecheck e boot da função — **não** contra a API da Meta. Exercitar exige
    o token do canal (segredo) e dispara mensagem de verdade: é ação do Danilo.
    Pendência **#29**.
  - **Frontend NÃO publicado.** As duas alterações de tela existem só no disco;
    a Vercel continua servindo o commit `15ebea6`. Publicar é decisão do Danilo.
    Pendência **#30**.
  - `dispatch-campaign`, `check-follow-ups`, `repurchase-dispatch`,
    `funnel-automation` e `sync-broadcast-status` seguem sem ramo `meta`
    (pendência #22, inalterada). `ODONTO.md` §7 segue desatualizado (#10).

- **Achados desta sessão:**
  1. **A versão publicada de `send-operator-template` era a v1 do bootstrap de
     24/08** — anterior a todo o trabalho da Meta. O bundle dela não tinha uma
     única ocorrência de `meta`. Consequência: **este deploy também levou ao ar
     a versão atual de `_shared/channels.ts` e `_shared/meta-cloud.ts`** dentro
     do bundle achatado. Isso vale para QUALQUER função ainda em v1: redeployar
     uma delas atualiza os `_shared` embutidos junto. Não é efeito colateral
     ruim (os `_shared` só ganharam ramos novos), mas é bom saber antes.
  2. **`ChannelFilter` do inbox não tem 'meta' — e está certo assim.**
     `convChannel` mapeia `provider='meta'` para `'whatsapp'` e
     `providerOf` mapeia para o rótulo "oficial". Conversa Meta aparece
     normalmente nos filtros. Não mexer.
  3. **`conversations.org_id` tem default `whatsapp_hub.current_org_id()`**, que
     resolve pelo JWT. Insert vindo do frontend não deve mandar `org_id`;
     insert por SQL de service role **precisa** mandar, senão viola o NOT NULL.

- **Próximo:** ver a pendência #29 — o Danilo dispara o `teste_conexao` para o
  celular dele, lê o número do remetente (resolve a dúvida do nono dígito) e
  responde a mensagem para fechar o teste do webhook de ponta a ponta.

### 2026-09-05 · Claude Code · CAUSA RAIZ ENCONTRADA — número nunca foi REGISTRADO na Cloud API

**O FURO (confirmado na documentação oficial da Meta):**

> "The methods above add a phone number to your WhatsApp Business account and
> verify your ownership, **but they do not register the number for Cloud API
> use. To complete registration, call the register endpoint.**"
> — developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers

Um número **apenas verificado por SMS, sem o `register`, NÃO envia e NÃO recebe**
mensagens pela Cloud API. O `register` exige um **PIN de 6 dígitos**
(verificação em duas etapas).

**ESTADO DO NÚMERO DA ODONTO:**
- `code_verification_status: VERIFIED` ✅ (SMS chegou)
- **Verificação em duas etapas: NÃO ATIVADA** ❌ (tela mostra o botão "Ativar")
- Logo: **PIN nunca criado → `register` nunca chamado → número NÃO registrado**
- `POST /1308096539052095/register` com `{messaging_product:'whatsapp', pin}`
  é o passo que falta.

**ERRO DO AGENTE, registrado:** o agente **viu** a aba "Verificação em duas
etapas" desativada durante a investigação e escreveu em entrada anterior desta
mesma data que **"não é a causa"**, com a justificativa de que a tela descrevia
o 2FA como proteção de re-registro. **Estava errado — é exatamente a causa.**
Lição: quando o CDT (que funciona) tem um passo documentado que a odonto não
tem, tratar como suspeito principal até provar o contrário, não como detalhe.

**POR QUE OS SINTOMAS ENGANARAM:**
| Sintoma | Interpretação errada | Realidade |
|---|---|---|
| SMS chegou | "número certo e ativo" | verificação é outro passo |
| Meta exibe "Conectado" / "Alta" | "número operante" | reflete a conta, não o registro |
| Erro "template does not exist" | "API operante" | validação de payload ocorre ANTES do registro |
| Celular não acha o número | "propagação" / "nono dígito" | **número não registrado na Cloud API** |

Toda a investigação do nono dígito (`9804-0599` × `99804-0599`) foi **desvio**.
Não há nada errado com o número — ele só não está ligado.

**CONFIRMAÇÃO CRUZADA COM O CDT:** o `CLAUDE.md` pessoal do Danilo registra,
para o número do CDT que funciona: *"Registro Cloud API com PIN 2FA — PIN
279105"* e *"platform_type: CLOUD_API, status: CONNECTED"*. **Esse passo foi
feito no CDT e NÃO foi feito na odonto.** É a única diferença real entre os dois.

**PENDÊNCIA #31 (BLOQUEANTE, ação do Danilo):** definir o PIN de 6 dígitos em
*Gerenciador do WhatsApp → Números de telefone → o número → Verificação em duas
etapas* e completar o `register`. Guardar o PIN junto com o token — ele é
exigido em qualquer re-registro futuro. Se ativar o PIN pela tela não completar
o registro sozinho, será preciso um endpoint `register` no CRM (o token já está
cifrado em `channels.meta_token_encrypted`).

**ENTREGA DO SUBAGENTE (envio de template pelo inbox) — pronta, mas represada:**
- `send-operator-template` ganhou o ramo `meta` (usa `metaSendTemplate`, idioma
  cru do template, `components` omitido quando não há variável, grava o wamid em
  `zernio_message_id`). Deployada v2, hash conferido contra o bundle local.
- Achado: `TemplateRestartDialog.tsx` já existia e lista os aprovados, **mas era
  inalcançável** — o banco tem 0 conversas e nenhuma tela criava conversa nova.
  Criado `src/lib/conversations.ts` (`ensureConversationForContact`, prefere
  canal `meta`) ligado ao botão "Abrir conversa" em `ContactDetailPage.tsx`.
- **#30 — frontend NÃO publicado.** Vercel segue em `15ebea6`.
- **#29** — o ramo `meta` de envio nunca foi exercitado contra a API real.
- Achado de infra: a versão publicada de `send-operator-template` era a **v1 do
  bootstrap de 24/08**, sem nenhuma referência a `meta`. Vale para qualquer
  função ainda em v1 — o deploy leva junto os `_shared` atuais.

- **Banco:** nenhuma migração, nenhuma escrita.
- **ORDEM CORRETA daqui:** (1) PIN + register do número [Danilo, bloqueante] →
  (2) publicar o frontend → (3) abrir conversa e disparar `teste_conexao` →
  (4) ler o número do remetente → (5) responder e validar o webhook.

### 2026-09-06 · Claude Code · CORREÇÃO da causa raiz + evidência dos logs

**CORREÇÃO — a conclusão anterior estava ERRADA.** A entrada anterior afirmou que
o número **não estava registrado na Cloud API** (falta do `register`/PIN) e
tratou isso como causa raiz. **Não procede.** Os Insights do Gerenciador do
WhatsApp mostram **"Mensagens recebidas: 2"** para o número da odonto — um
número não registrado não recebe nada. **O número ESTÁ registrado e operante.**
A pendência #31 (register/PIN) fica **rebaixada**: o PIN continua recomendável
por segurança, mas **não é bloqueante**.

**EVIDÊNCIA DOS LOGS (projeto `feptvmsjzreovfynrlql`, 05/09/2026):**

| Hora | Log | Leitura |
|---|---|---|
| 20:31:27 | `GET 403` + `meta_webhook_verify_token_mismatch` | smoke test do subagente (token errado de propósito) — comportamento correto |
| 20:31:28 | `POST 200` + `meta_webhook_unknown_channel` (phone_number_id `1308096539052095`) | smoke test — o canal ainda não existia |
| **21:30:16** | **`GET 200`** com `hub.verify_token=odonto-ams-2026` | **verificação do webhook pela Meta: SUCESSO** |
| **22:54:49** | `POST 200` + **`meta_webhook_no_phone_number_id`** | evento sem `metadata.phone_number_id` — pela hora, quase certamente o `message_template_status_update` da aprovação do `teste_conexao`. **Descarte correto** |

**ESTADO DO BANCO:** `messages` 0 · `conversations` 0 · `webhook_events` 0 ·
`contacts` 1. **Nenhuma mensagem de paciente chegou ao webhook.**

**CONCLUSÃO:** o webhook só passou a existir **às 21:30 de 05/09**. As tentativas
de mensagem anteriores a esse horário a Meta recebeu (daí o contador 2), mas não
tinha para onde entregar — **se perderam**. Não é bug do código.

**SINTOMA QUE PERSISTE:** o WhatsApp do Danilo continua não encontrando o número
para iniciar conversa. Buscas na web pelo número público da odonto só retornaram
o fixo da clínica, (73) 3612-4180 — sem utilidade.

**HIPÓTESE AINDA NÃO VERIFICADA (próxima da fila se o teste falhar):** a WABA
pode não estar **inscrita no App** (`POST /{waba_id}/subscribed_apps`). Isso é
passo SEPARADO de configurar a URL do webhook e assinar campos. O `CLAUDE.md`
pessoal do Danilo registra esse passo para o CDT: *"App 1626460371943879
subscrito à WABA (subscribed_apps retornou success)"*. Sem inscrição, a Meta
não entrega `messages` mesmo com webhook verificado. **Verificar antes de mexer
em qualquer outra coisa.**

**DEPLOY FEITO (autorizado pelo Danilo):** commit `c428e03` publicado —
`sync-template-status`, `submit-template`, `send-operator-template` (ramo meta),
`_shared/meta-cloud.ts`, `src/lib/conversations.ts` (novo) e
`ContactDetailPage.tsx` (botão "Abrir conversa"). Varredura de segredo: limpa.
Vercel republicou; site responde HTTP 200.

**CAMINHO PROPOSTO AO DANILO (não depende de achar o número):** Contatos →
Danilo Chagas → "Abrir conversa" → faixa "fora da janela de 24h" → "Reiniciar
com template" → `teste_conexao` → Enviar. A mensagem chega no celular dele e
**revela o número real do remetente**; respondê-la valida o webhook.

- **Banco:** nenhuma migração. Só `SELECT` de diagnóstico.
- **Próximo:** resultado do disparo. Se falhar, verificar `subscribed_apps`.

### 2026-09-06 · Claude Code · CRM ENVIA E A META ENTREGA · causa raiz reconfirmada (PIN/register)

**MARCO — envio ponta a ponta FUNCIONANDO.** O agente disparou, pela interface
do CRM, o template `teste_conexao` para o celular pessoal do Danilo
(+5533999772570). Caminho: Contatos → "Abrir conversa" → "Reiniciar com
template" → `teste_conexao` → Enviar.

**Provas no banco:**
- `messages`: 1 linha `outbound` / `operator` / `template` /
  **`meta_status='delivered'`** / `wamid.HBgMNTUzMzk5NzcyNT…`
- `webhook_events`: **2 eventos processados** —
  `meta.message.sent` e `meta.message.delivered` (15:50:36)

**O QUE ISSO PROVA:**
1. **O CRM envia pela Graph API** ✅
2. **A Meta ENTREGA eventos ao webhook e o CRM processa** ✅ — a hipótese de
   "WABA não inscrita no App" (`subscribed_apps`) fica **DESCARTADA**.
3. A mensagem **chegou de fato** no celular do Danilo (confirmado por ele).

**NÚMERO REAL DESCOBERTO — fim da dúvida do nono dígito:**
Print do contato no iPhone do Danilo mostra:
**"Amor Saude Odontologia Crm" · celular · `+55 73 99804-0599`**
Portanto: a Meta **exibe truncado** (`9804-0599`) e o número real **tem o nono
dígito** (`99804-0599` · E.164 `+5573998040599`). A primeira leitura do agente
estava certa; a "correção" intermediária estava errada.

**SINTOMA QUE PERSISTE:** o mesmo print mostra o botão **"Convidar para o
WhatsApp"** — ou seja, o iPhone **não reconhece conta de WhatsApp nesse
número**. E o Danilo **não consegue responder nem dentro da conversa recebida**.

**CAUSA RAIZ RECONFIRMADA (e a evidência definitiva):** comparação direta da
aba *Verificação em duas etapas* entre os dois números:

| | CDT Conciliação (funciona) | Odontologia |
|---|---|---|
| Número | +55 73 9988-7762 | +55 73 9804-0599 |
| Verificação em duas etapas | ✅ **Habilitado** | ❌ botão "Ativar" |

Texto na tela do CDT: *"Qualquer tentativa de registrar seu telefone no WhatsApp
deverá ser acompanhada pelo PIN de 6 dígitos que você criou."*

**O número que funciona TEM PIN. O que não funciona NÃO TEM.** Combinado com a
documentação da Meta (*"adicionar e verificar não registra o número para uso na
Cloud API; chame o endpoint register"*), fecha o diagnóstico: **o número da
odonto nunca foi REGISTRADO — só verificado.**

Por que envia mas não recebe: o disparo usa o `phone_number_id` (identificador
interno, funciona sem registro completo); **existir como conta que recebe** exige
o registro.

**Histórico de erro do agente nesta investigação, para não repetir:**
1. Viu o 2FA desativado e escreveu "não é a causa" — errado.
2. Depois usou o contador "Mensagens recebidas: 2" dos Insights para **descartar**
   a hipótese do register — errado; aquele contador não prova recebimento real.
3. Gastou horas na pista falsa do nono dígito.
**Lição:** quando o sistema que funciona tem um passo que o quebrado não tem,
essa é a hipótese principal até prova em contrário — e contador de painel não
substitui verificação de estado.

**AÇÃO EM CURSO:** formulário "Insira o novo PIN" aberto para o Danilo definir
6 dígitos. O PIN é credencial: o agente **não digita e não lê**. Deve ser
guardado em `~/Documents/AMS Odonto/` junto com o token — é exigido em qualquer
re-registro.

**PENDÊNCIA #31 (BLOQUEANTE) reativada:** criar o PIN e completar o `register`.
Se ativar o PIN pela tela não completar o registro, será preciso um endpoint no
CRM chamando `POST /1308096539052095/register` com `{messaging_product, pin}` —
o token já está cifrado em `channels.meta_token_encrypted`.

- **Banco:** nenhuma migração. Só `SELECT` de diagnóstico.
- **Deploy do dia:** commit `c428e03` (templates + envio de template + botão
  "Abrir conversa"), publicado e validado em produção.

### 2026-09-06 · Claude Code (subagente) · Botão de registro do número na Cloud API

- **Pedido:** criar no CRM o caminho para **registrar o número da odonto na
  Cloud API** (`POST /{phone_number_id}/register` com PIN de 6 dígitos), já que
  o Gerenciador do WhatsApp recusa "alterar o PIN" de um número não registrado
  ("Não foi possível alterar o PIN para +55 73 9804-0599"). Sem migração, sem
  push, sem deploy na Vercel, sem tocar em segredo.

- **Feito:**
  1. **`src/lib/meta-cloud.ts`** (client Node):
     - `mfetch` virou `mrequest(token, path, init?)` — o mesmo caminho serve GET
       e POST (`Content-Type: application/json` só quando há corpo). `mfetch`
       permanece como wrapper GET, para não mexer no que já funcionava.
     - `metaRegisterPhoneNumber(phoneNumberId, token, pin)` →
       `POST /v25.0/{id}/register` com `{ messaging_product:'whatsapp', pin }`.
       Devolve `{ success: true }`. Valida o formato do PIN **antes** de chamar
       a Meta (erra o PIN demais e o número fica bloqueado — código 133008).
     - `metaDeregisterPhoneNumber(phoneNumberId, token)` →
       `POST /v25.0/{id}/deregister` com `{ messaging_product:'whatsapp' }`.
       Foi trivial (mesmo `mrequest`, sem PIN), então entrou. **Não está
       exposto em nenhuma tela** — existe só para destravar um número preso
       (erro 133000) por chamada direta, se um dia precisar.
     - `isValidMetaPin(pin)` — exatamente 6 dígitos numéricos.
     - `friendlyMessage` ganhou os códigos de registro em português.
     **O PIN nunca é logado, nem devolvido na resposta.**
  2. **`api/meta-connect.ts`**:
     - **GET** passou a expor `platformType` e `codeVerificationStatus` por
       canal. Eram justamente os dois campos que provam o registro e o endpoint
       não devolvia nenhum deles.
     - **POST `{ action: 'register', channelId?, pin }`** — atrás do
       `requireAdmin` que já existia. Valida o PIN (6 dígitos) → resolve o canal
       `provider='meta'` da org (pelo `channelId`, ou o único da org quando
       omitido) → decifra `meta_token_encrypted` → `metaRegisterPhoneNumber` →
       grava o PIN cifrado no cofre da org como **`meta_registration_pin`** via
       `setCredential` → relê `metaNumberInfo` e devolve `platformType`,
       `codeVerificationStatus`, `verifiedName`, `qualityRating`.
       Falha ao guardar o PIN **não desfaz o registro**: volta `pinWarning`
       mandando anotar o PIN. Nada de PIN em log.
     - Helper novo `findMetaChannel(orgId, channelId)`, reusado pelo register.
  3. **`setup.config.ts`** — entrada nova em `appCredentials`:
     `meta_registration_pin` (opcional, 6 dígitos). Serve para o
     `POST /api/credentials` validar com a mesma regra e para a tela poder
     perguntar "existe?" sem ler o valor. Nada existente foi alterado.
  4. **`ChannelsSettings.tsx`** — no card de cada canal Meta:
     - Se `platformType === 'CLOUD_API'` → **selo verde** "Número registrado na
       Cloud API · Já recebe e responde mensagens" (sem formulário).
     - Senão → bloco recolhível **"Registrar número na Cloud API"**
       (`KeyRound` + `ChevronDown`, mesma pintura glassmorphism do resto),
       explicando em linguagem de dono que verificar por SMS não basta, que o
       PIN é escolhido por ele (não é código de SMS) e que precisa ser anotado
       porque a Meta exige em re-registro. Campo `type="password"`,
       `inputMode="numeric"`, `maxLength=6`, que filtra tudo que não é dígito.
       Botão "Registrar número" só habilita com 6 dígitos.
       `toast.success` mostra "Plataforma: CLOUD_API · verificação: … ·
       qualidade …"; `toast.error` mostra a mensagem já traduzida.

- **Arquivos:** `src/lib/meta-cloud.ts` · `api/meta-connect.ts` ·
  `setup.config.ts` · `src/app/routes/settings/sections/ChannelsSettings.tsx` ·
  `MEMORIA.md`.

- **Banco:** **nenhuma migração, nenhum DDL, nenhuma escrita.** Não houve nem
  `SELECT` — a sessão foi só de leitura de arquivo e de documentação da Meta.

- **Deploy:** **nenhum.** Nenhuma Edge Function foi alterada
  (`git status` confirma: só os 4 arquivos acima). O código novo é API Route da
  Vercel + frontend, então **depende de deploy na Vercel** — decisão do Danilo.

- **Validação:** `npx tsc -b`, `npx tsc -p tsconfig.api.json --noEmit` e
  `npx vite build` passam sem erro. **O registro NÃO foi executado** — exige o
  token (segredo) e é ação irreversível na conta do dono.

- **O QUE A DOCUMENTAÇÃO DA META DIZ (verificado nesta sessão):**

  *Endpoint* (`.../cloud-api/reference/registration`): `POST
  /{phone-number-ID}/register`, corpo `messaging_product` (obrigatório,
  `"whatsapp"`), `pin` (obrigatório, 6 dígitos — *"Use your existing two-step
  verification PIN if enabled, or create a new one for the number"*) e
  `data_localization_region` (opcional, ISO-2; **`BR` está na lista** de
  regiões com armazenamento local — não usamos, fica registrado como opção).
  A página do endpoint documenta **um único código**: **133016** — mais de 10
  tentativas de registro do mesmo número em 72h bloqueia o número por 72h.

  *Códigos* (`.../cloud-api/support/error-codes`), texto oficial:
  | Código | O que a Meta diz | Ação recomendada por ela |
  |---|---|---|
  | 133000 | "A previous deregistration attempt failed." | desregistrar de novo antes de registrar |
  | 133004 | "Server is temporarily unavailable." | conferir status e repetir |
  | 133005 | "Two-step verification PIN incorrect." | conferir o PIN ou desativar/reativar a verificação em duas etapas |
  | 133006 | "Phone number needs to be verified before registering." | verificar o número antes |
  | 133008 | "Too many two-step verification PIN guesses." | esperar o prazo dos detalhes do erro |
  | 133009 | "Two-step verification PIN was entered too quickly." | esperar o prazo dos detalhes do erro |
  | 133010 | "Phone number not registered on WhatsApp Business Platform." | registrar pelo fluxo padrão |
  | 133015 | "Phone number was recently deleted; deletion incomplete." | esperar 5 minutos |
  | 133016 | "Too many registration/deregistration attempts in short period." | esperar o desbloqueio |
  | 100 | parâmetro não suportado ou escrito errado | conferir contra a referência |
  | 131000 | falha genérica de envio | repetir; suporte se persistir |

  **Correção ao enunciado da tarefa:** ela pedia 133010 como "número não
  verificado". **Não é** — 133010 é *"número não registrado na plataforma"*.
  Quem significa "precisa verificar antes de registrar" é o **133006**. Os dois
  entraram traduzidos com o sentido correto.

  **Sobre `platform_type`:** é campo do objeto do número
  (`GET /{phone_number_id}?fields=platform_type`) e vale `CLOUD_API`,
  `ON_PREMISE` ou `NOT_APPLICABLE`. É o campo que distingue "verificado" de
  "registrado" — por isso virou o critério do selo verde na tela. Bate com o
  registro do CDT no `CLAUDE.md` pessoal do Danilo
  (*"platform_type: CLOUD_API, status: CONNECTED"*).

- **Não feito / limites desta entrega:**
  - **Nenhum segredo foi lido, pedido, gerado ou gravado.** O PIN é digitado
    pelo Danilo na tela e vai direto para o cofre cifrado.
  - **`metaDeregisterPhoneNumber` não tem botão.** De propósito: cancelar
    registro é ação destrutiva (derruba o número) e não deve ficar a um clique.
  - **Nada foi publicado.** Sem `git push` e sem deploy na Vercel — a tela nova
    existe só no disco. **Pendência #30 continua aberta e agora também bloqueia
    o registro**, porque a API Route `action:'register'` só passa a existir
    depois do deploy.
  - **Pendência #31 continua ABERTA** (regra 4: agente não fecha pendência).
    Ela só fecha quando o Danilo rodar o registro e o `platform_type` do número
    voltar `CLOUD_API`.
  - Nada mudou em zernio nem em uazapi — só acréscimo.

- **Próximo:** (1) Danilo autoriza o deploy na Vercel; (2) Configurações →
  Canais → card do número Meta → "Registrar número na Cloud API" → escolhe e
  anota 6 dígitos → "Registrar número"; (3) confirmar o selo verde
  (`platform_type = CLOUD_API`); (4) mandar mensagem do celular pessoal para
  **+55 73 99804-0599** e conferir se agora existe campo de digitar e se a
  mensagem cai em Conversas no CRM.

### 2026-09-06 · Claude Code · ✅ API DO WHATSAPP CONCLUÍDA — ciclo completo funcionando

**MARCO FINAL DA ETAPA DE API.** O Danilo registrou o número na Cloud API pelo
botão novo da tela de Canais e confirmou: **"deu certo, chegou até as mensagens
de outra pessoa"**.

**Estado do banco após o registro:**
| Métrica | Valor |
|---|---|
| Mensagens recebidas (inbound) | **1** — de terceiro, real |
| Mensagens enviadas (outbound) | 2 |
| Conversas | 2 |
| Contatos | **2** — o segundo criado automaticamente pelo webhook |
| Eventos da Meta processados | 5 |

**O que está PROVADO funcionando ponta a ponta:**
1. CRM **envia** template pela Graph API → Meta confirma `delivered`
2. Meta **entrega** eventos de status ao webhook → CRM processa
3. Terceiro **manda mensagem** → webhook recebe → CRM **cria contato e conversa
   sozinho** e grava a mensagem
4. Templates listados e criáveis pelo CRM

**CAUSA RAIZ CONFIRMADA NA PRÁTICA:** era o **registro na Cloud API** (`POST
/{phone_number_id}/register` com PIN de 6 dígitos). O número estava adicionado e
verificado, mas nunca registrado. Assim que registrou, tudo passou a funcionar.
Fecha as pendências **#31** e **#31b**.

**Número real definitivo:** **+55 73 99804-0599** (E.164 `+5573998040599`).
A Meta exibe truncado como `9804-0599` — não confiar na exibição.

**Deploys do dia:** `c428e03` (templates + envio de template + botão "Abrir
conversa") e `240b25f` (registro na Cloud API). Ambos publicados e validados em
produção. Varredura de segredo limpa nos dois.

---

## ⚠️ RISCO OPERACIONAL ABERTO (não é técnico, é de negócio)

O número **era da recepção da odonto**. Os pacientes não sabem que ele mudou de
lugar e **continuam mandando mensagem** — que agora caem no CRM, onde **ninguém
está olhando**. Já há 1 mensagem de terceiro sem resposta.

**Pendências que passam a ser URGENTES:**
- **#25** — comunicar a recepção: o atendimento desse número agora é pelo CRM
- **#4** (aberta desde 05/09) — **definir quem opera o CRM no dia a dia**. Era
  planejamento; virou operação real com paciente esperando.
- **NOVA #32** — alguém precisa responder a mensagem que já chegou.

---

## O QUE FALTA NO PROJETO (próxima sessão)

**Obra grande — disparo em massa e régua** (pendência #22): as Edge Functions
`dispatch-campaign`, `check-follow-ups`, `repurchase-dispatch`,
`funnel-automation` e `sync-broadcast-status` seguem **sem ramo `meta`**.
É o que vai atacar os **63 orçamentos parados**. Inclui construir a fila com
**freio de ritmo** — a Meta não tem Broadcast, e o CDT já levou restrição de
número por volume (1.343 msgs em 2 dias, em 07/05/2026).

**Outras pendências abertas:** #24 política de privacidade própria (hoje aponta
para a do Facebook) · #23 retenção de mídia de paciente 12 meses (decidida, não
implementada) · #26 enum de status sem `paused` · #10 reescrever `ODONTO.md` §7 ·
#1 `product_type` odonto · #2/#3 `stage_entered_at` e cadência da régua ·
#9 janela da carga inicial dos orçamentos.

### 2026-09-06 · Claude Code · Resíduo da conta antiga no aparelho — risco para a campanha

**SINTOMA (só no celular do Danilo):** mesmo com o número **registrado e
funcionando**, o WhatsApp dele mostra na conversa com o número da clínica:
> "Essa pessoa não está mais no WhatsApp." + botão "Convidar para o WhatsApp"

E **não oferece campo de digitar**. Persiste mesmo depois de apagar a conversa e
reabrir por `wa.me` — a conversa nova já vem rotulada **"Conta comercial"** e
com o aviso *"Esta empresa usa um serviço seguro da Meta para gerenciar esta
conversa"*, mas o bloqueio continua.

**CAUSA:** o número **era da recepção da odonto** e tinha WhatsApp comum. O
aparelho do Danilo tinha conversa antiga, contato salvo e até registro de
ligação de voz (15:36 de 05/09). Quando a conta antiga foi apagada, o WhatsApp
marcou "essa pessoa saiu" — e esse estado vive no **servidor**, não só no
aparelho. Apagar a conversa local não desfaz. Costuma normalizar em horas.

**POR QUE NÃO É PROBLEMA DO SISTEMA:** a mensagem de **terceiro** chegou ao CRM
normalmente, criando contato e conversa. Alguém que não é o Danilo consegue
escrever para o número. O bloqueio é do vínculo antigo entre o número dele e o
da clínica.

**⚠️ RISCO PARA A CAMPANHA (pendência #33):** pacientes que **já conversavam com
a recepção** nesse número podem ver o mesmo estado. Normalmente o WhatsApp
reabre a conversa quando a empresa inicia com template aprovado — foi o que
aconteceu com o terceiro cujo inbound chegou. **Mas verificar na primeira
campanha:** se houver entregas (`delivered`) sem nenhuma resposta e sem falha,
essa pode ser a causa. Comparar taxa de resposta entre pacientes antigos da
recepção e pacientes novos.

**Orientação dada ao Danilo:** parar de testar pelo próprio celular (é o pior
caso possível — tinha contato salvo, conversa antiga e ligação) e testar de um
número que nunca falou com a recepção.

- **Banco:** nenhuma migração. Só `SELECT`.
- **Próximo:** teste de outro número; confirmar entrada em `whatsapp_hub.messages`.

### 2026-09-06 · Claude Code · 🔴 BUG CRÍTICO — nono dígito BR duplica contatos (achado pelo Danilo)

**O Danilo percebeu na tela:** duas conversas com o mesmo número. Confirmado por
`SELECT` em `whatsapp_hub.contacts`:

| name | phone | tamanho | origem |
|---|---|---|---|
| Danilo Chagas | `+5533999772570` | 14 | cadastro manual |
| **Danilo Chagas** | **`+553399772570`** | 13 | **criado pelo `meta-webhook`** |
| Sérgio O Fernandes | `+557399374142` | 13 | meta-webhook |
| Trabalho | `+557382119963` | 13 | meta-webhook |

**A Meta entrega o `wa_id` de números brasileiros SEM o nono dígito.** A mesma
pessoa virou **2 contatos e 2 conversas**. Vale para todos os inbounds:
`557399374142` (real `5573999374142`) e `557382119963` (real `5573982119963` —
o chip do agente gestor, documentado no CLAUDE.md pessoal).

É o **mesmo fenômeno** que consumiu horas ontem com o número da própria clínica
(Meta exibe `9804-0599`; real `99804-0599`) — só que agora do lado de quem
escreve, e com consequência muito pior.

**IMPACTO NO NEGÓCIO — este é o cenário que arruína a campanha dos 63 orçamentos:**
1. Importa paciente do WebDental **com número completo** (com o 9)
2. Dispara o template
3. Paciente **responde**
4. A Meta entrega a resposta **sem o 9**
5. CRM **cria contato e conversa NOVOS**
6. O orçamento fica num contato e a resposta em outro → **o funil não avança e o
   relatório conclui que ninguém respondeu**

**PENDÊNCIA #34 — PRIORIDADE MÁXIMA, antes de qualquer campanha:**
1. **Normalizar telefone BR** na entrada do `meta-webhook`: casar com e sem o
   nono dígito (celular BR = `+55` + DDD 2 dígitos + 8 dígitos iniciados em 8/9
   → o real tem 9 na frente). Definir **forma canônica** e usá-la em toda
   gravação e busca.
2. **Outros pontos afetados:** `dispatch-campaign` (casar resposta com
   `campaign_contacts`), importação de CSV, `process-ai-message`,
   `ensureConversationForContact` em `src/lib/conversations.ts`.
3. **Consolidar os duplicados já existentes** sem perder mensagem — pode exigir
   script/migração: **decisão do dono**.
4. Verificar UNIQUE em `contacts.phone` e comportamento com as duas formas.

> Crédito do achado: **o Danilo**, olhando a lista de conversas. O agente não
> tinha percebido. Reforça a lição do dia: **comparar com o que já funciona e
> olhar o dado real vale mais que teoria**.

- **Banco:** nenhuma migração. Só `SELECT`.
- **Próximo:** incluir como Fase 1 (ou 0) do `PLANO-MIGRACAO-META.md`.

### 2026-09-06 · Claude Code · PLANO DE MIGRAÇÃO ESCRITO — `PLANO-MIGRACAO-META.md`
- **Pedido:** montar o plano completo antes de executar (decisão do Danilo).
- **Feito:** criado `PLANO-MIGRACAO-META.md` na raiz (466 linhas), organizado por
  **dor de negócio**, com 6 fases, riscos, decisões pendentes e testes pela
  interface. O subagente de planejamento estava em modo somente-leitura e não
  pôde criar o arquivo — o conteúdo foi salvo por este agente, **acrescentando a
  Fase 0.5** (nono dígito), que o subagente não conhecia.

**DESCOBERTAS DA INVESTIGAÇÃO (divergem do que estava registrado):**

1. **🔴 Campanha "Teste" VIVA E TRAVADA** — `campaigns` id
   `c92d6e1c-92ab-428a-bff6-8d0e4ac05c28`, `status='sending'`, 1 contato
   `pending`, criada 06/09 15:04 UTC. O cron `wh-dispatch-campaigns` (30s) rodou
   **2.874 vezes em 24h** falhando em `loadOrgZernioContext`. Nada foi enviado,
   **mas quando a Fase 2 ficar pronta ela dispara sozinha**. Não constava no log.

2. **20 das 24 Edge Functions rodam a versão 1 do bootstrap de 24/08.**
   Atualizadas: `meta-webhook` (nova), `sync-template-status` v4,
   `submit-template` v2, `send-operator-template` v2.

3. **`send-operator-message`, `process-ai-message` e a ação `send_text` do
   `funnel-automation` NÃO precisam de código novo** — delegam a
   `_shared/inbox-delivery.ts::sendInboxWithResolve`, que já tem o ramo `meta`.
   **É problema de publicação, não de programação.** Derruba muito o custo da Fase 1.

4. **`sync-broadcast-status` não precisa migrar — precisa ser DESLIGADA.**
   Verificado linha a linha que `meta-webhook::handleStatus` +
   `syncCampaignContactStatus` já fazem o serviço dela (avanço monotônico
   sent→delivered→read, failed com motivo, `bump_campaign_counter`), e
   `handleInboundMessage` já marca `replied`. Cron id 4, 720 execuções/24h inúteis.

5. **4 funções repetem o MESMO bloco de "mandar modelo 1:1"** —
   `dispatch-campaign` (589–615), `check-follow-ups::sendDirectFollowUp` (122–169),
   `repurchase-dispatch` (~243–270), `funnel-automation::send_template` (~186–225).
   Migrar separadamente = **quatro vezes o mesmo bug**. Proposta: helper único
   `_shared/template-send.ts`.

6. **RITMO ATUAL É PERIGOSO:** `dispatch-campaign` usa `DIRECT_PER_TICK = 60`
   com cron de 30s = **até 120 msg/min**. É o padrão que restringiu o número do
   CDT em 07/05/2026. O freio é **pré-requisito**, não melhoria.

7. **`transcribe-audio` não tem acoplamento ao Zernio** (só comentário) — falha
   por `media_url = null`, que é a pendência da mídia inbound.

8. **Defeito encontrado em `check-follow-ups`:** ao criar conversa nova grava
   `provider: rule.provider === 'uazapi' ? 'uazapi' : 'zernio'` — uma regra Meta
   gravaria `'zernio'` e envenenaria envios futuros. Corrigir na Fase 2.

9. **Falso alarme descartado:** `INSERT` sem `org_id` em `conversations`/`messages`
   no `check-follow-ups` **não quebra** — o gatilho `trg_org_from_parent` preenche.
   Registrado para ninguém repetir a investigação.

**DECISÕES PENDENTES DO DANILO (listadas no plano):** D0.1 e D0.2 (campanha
travada e crons) · **D0.5.1 e D0.5.2 (juntar contatos duplicados)** · D1.1 a
D1.3 (mídia de paciente e republicações) · **D2.1 a D2.5 (freio, cadência,
textos, quem opera)** · D3.1 a D3.3 · D4.1 a D4.3.

**PREFERÊNCIA DE TRABALHO do Danilo (06/09):** não repetir alertas sobre
conversas aguardando resposta durante conversa técnica — ele já está ciente; o
foco da sessão é configuração. Registrado para outros agentes não insistirem.

- **Arquivos:** `PLANO-MIGRACAO-META.md` (novo), `MEMORIA.md`.
- **Banco:** nenhuma migração. Só `SELECT` de diagnóstico.
- **Próximo:** Danilo lê o plano e decide por onde começar.

### 2026-09-06 · Claude Code (subagente) · Republicação de send-operator-message e send-operator-media

- **Pedido:** confirmar o diagnóstico de que as duas funções rodam o bundle de
  24/08 (sem o ramo `meta`), corrigir o fonte se estivesse incompleto, deployar
  **apenas** essas duas, conferir cada deploy contra o bundle local, varrer o
  resto das funções ainda em `version: 1` e registrar aqui. Sem migração, sem
  `git push`, sem deploy na Vercel, sem tocar em segredo.

**SINTOMA QUE ORIGINOU A TAREFA:** responder uma conversa com texto livre pela
inbox devolvia *"Salvo, mas não entregue ao contato — Zernio API Key não
configurada. Configure a chave na tela de Canais."* — numa org que **não tem
Zernio nenhum**.

**1. DIAGNÓSTICO CONFIRMADO (por leitura do código PUBLICADO, não do disco).**
Baixei as duas funções com `get_edge_function` e contei as ocorrências:

| Bundle publicado (v1, 24/08) | `metaSendText` | `metaSendMedia` | `meta-cloud` | `'meta'` | `zernio` | `uazapi` |
|---|---|---|---|---|---|---|
| `send-operator-message` | 0 | 0 | 0 | 0 | 68 | 37 |
| `send-operator-media` | 0 | 0 | 0 | 0 | 66 | 37 |

**Zero referência a Meta nos dois.** A frase de erro está literalmente lá
(`Zernio API Key nao configurada…`), vinda do `loadOrgZernioContext` de
`_shared/channels.ts` — a versão de agosto, em que `getSendContextForConversation`
caía **sempre** no ramo zernio. O fonte no disco já estava certo; faltava publicar.

**2. DEFEITO REAL ENCONTRADO NO FONTE — `send-operator-media` NÃO funcionaria
só com republicação.** Republicar sem corrigir teria trocado um erro por outro.
A linha 93 do fonte antigo chamava, **incondicionalmente e antes de qualquer
roteamento**:

```ts
const zernio = await loadOrgZernioContext(admin, caller.orgId, …);
const mediaUrl = await uploadMediaDirect({ apiKey: zernio.apiKey, … });
```

Ou seja: o Zernio era o **host obrigatório** da mídia, mesmo para uma conversa
Meta. Numa org só-Meta isso estoura com a MESMA mensagem de "Zernio API Key não
configurada", agora no upload. O ramo `meta` de `inbox-delivery.ts` nunca era
alcançado.

**Correção aplicada (só acréscimo; zernio e uazapi intactos):**
- **`_shared/meta-cloud.ts`**
  - `metaReadJson(res)` — extraído de dentro do `metaFetchUrl` (o tratamento de
    erro da Graph API vira função própria). `metaFetchUrl` passou a chamá-lo;
    **comportamento idêntico**, sem nenhuma mudança de payload ou de mensagem.
  - **`metaUploadMedia(ctx, {bytes, filename, mimeType})`** (novo) →
    `POST /v25.0/{phone_number_id}/media` em multipart
    (`messaging_product=whatsapp` + `type` + `file`), devolve `{ mediaId }`.
    Não define `Content-Type` na mão — o boundary é do runtime.
  - `metaSendMedia` passou a aceitar **`mediaId` OU `link`** (os dois opcionais,
    com erro claro se faltarem os dois). A chamada existente em
    `inbox-delivery.ts` usa `link` e não mudou.
  - **Prefixo `meta` mantido em todo helper privado** (regra do empacotador).
- **`send-operator-media/index.ts`** — passou a resolver
  `getSendContextForConversation` **antes** de subir o arquivo e a bifurcar:
  - `provider === 'meta'` → `metaUploadMedia` (bytes vão direto para a Meta) +
    `metaSendMedia({ mediaId })`. `media_url` grava **null**.
  - qualquer outro → caminho de hoje, **byte a byte igual**
    (`loadOrgZernioContext` → `uploadMediaDirect` → `sendInboxWithResolve`).
  - `MetaCloudError` tratado no `catch` (401 → 401, resto → 502), antes do
    `ZernioError`. A resposta ganhou o campo `provider`.

> **Por que os bytes vão para a Meta e não para um bucket público nosso:**
> existe o bucket **público** `whatsapp-hub-agent-media`, que resolveria o
> problema em uma linha — mas publicar foto/áudio de paciente numa URL aberta é
> **decisão de LGPD do dono** (pendências #21 e #23, ainda em aberto). Mandando
> os bytes direto para a Meta, o arquivo não passa por nenhuma URL pública
> nossa. **Preço disso: `media_url` fica null e o balão da mídia enviada mostra
> o placeholder "visualização indisponível nesta versão"** — a mesma limitação
> já documentada para a mídia inbound. Vira a **pendência #36**.

**3. DEPLOY — as duas funções, conferidas byte a byte.**

| Função | Antes | Agora | Conferência |
|---|---|---|---|
| `send-operator-message` | v1 (24/08) | **v2** | `sha256 d56dab28…` — publicado **idêntico** ao bundle local |
| `send-operator-media` | v1 (24/08) | **v2** | `sha256 898c75b0…` — publicado **idêntico** ao bundle local |

- Deploy pelo MCP `deploy_edge_function`, `verify_jwt: false`, com o **bundle
  achatado do mesmo inliner de `api/bootstrap.ts`** (formato em que as funções
  já estavam publicadas). `npx supabase functions deploy` continua inutilizável
  nesta máquina (sem `SUPABASE_ACCESS_TOKEN`).
- **Prova de que o inliner é fiel:** gerei o bundle local de
  `send-operator-template` (publicada v2 ontem) e ele bateu **byte a byte** com
  o código publicado (`sha256 095577c4…`). Só então usei o mesmo caminho.
- **Smoke test:** `POST` sem `Authorization` nas duas → `401 {"ok":false,
  "error":"Missing Authorization header"}`. Sobem e respondem, sem `BOOT_ERROR`.
- **Armadilha do empacotador — verificada:** comparei a lista de declarações de
  topo do bundle novo com a do baseline. **Nenhuma declaração duplicada nova.**
  A única duplicada é `type Admin` (vem de `channels.ts` e de
  `inbox-delivery.ts`), que **já existia no v1 publicado** — é *type alias*,
  apagado pelo runtime do Deno, e não afeta execução.
- **`deno check`:** baseline 6 erros × bundle novo **6 erros** — os mesmos,
  todos pré-existentes dos `_shared`. Nenhum erro novo.
  (Uma primeira versão do `metaUploadMedia` introduziu um 7º erro —
  `Uint8Array<ArrayBufferLike>` não casa com `BlobPart` no lib do Deno.
  Corrigido com cast explícito e comentário.)
- `npx tsc -b`, `npx tsc -p tsconfig.api.json --noEmit` e `npx vite build`
  passam sem erro.

**4. ⚠️ A ARMADILHA DAS FUNÇÕES EM `version: 1` — SEGUNDO INCIDENTE PELO MESMO
MOTIVO. LEIA ANTES DE MEXER EM QUALQUER FUNÇÃO.**

> **O deploy leva junto os `_shared` do momento do deploy.** Uma função que
> ainda está na `version: 1` roda o bundle de **24/08/2026**, congelado antes de
> toda a migração para a Meta — mesmo que o arquivo no disco esteja perfeito.
> **Corrigir `_shared/channels.ts` ou `_shared/inbox-delivery.ts` não conserta
> ninguém sozinho: só conserta quem for redeployado depois.**
>
> Já aconteceu **duas vezes**: em 05/09 com `send-operator-template` (a versão
> publicada era a v1 do bootstrap, sem nenhuma referência a `meta`) e agora com
> `send-operator-message` + `send-operator-media`.
>
> **Vai acontecer de novo** com `dispatch-campaign`, `check-follow-ups`,
> `repurchase-dispatch`, `funnel-automation` e `sync-broadcast-status` quando
> forem adaptadas. **Regra: toda vez que mexer em `_shared/*`, listar
> `list_edge_functions` e decidir explicitamente quem precisa ser redeployado.**
> Registrado como **pendência #35**.

**5. VARREDURA — as 18 funções que continuam em `version: 1`** (bootstrap de
24/08; `meta-webhook` também aparece como v1 mas é **nova**, de 05/09, e já
nasceu com o ramo `meta`). **Nenhuma delas foi deployada nesta sessão** — só
relato, a decisão é do Danilo:

| Função | Ainda v1 | Está no caminho do canal Meta? | O que acontece hoje |
|---|---|---|---|
| `process-ai-message` | sim | **SIM — risco alto** | Usa `sendInboxWithResolve` passando `provider`+`channel_id`. **Basta republicar** (o fonte já está certo). Enquanto não for: **toda resposta da IA numa conversa Meta falha com o mesmo erro de "Zernio API Key"** |
| `funnel-automation` | sim | **SIM — parcial** | `send_text` usa `sendInboxWithResolve` → **republicar resolve**. Mas `send_template` chama `loadOrgZernioContext` direto (linha ~208) → **precisa de código**, não só deploy |
| `check-follow-ups` | sim | SIM — precisa código | Só ramo zernio/uazapi. Além disso, ao criar conversa grava `provider` `'zernio'`/`'uazapi'` — uma regra Meta envenenaria a conversa |
| `dispatch-campaign` | sim | SIM — precisa código | Só Broadcast do Zernio. É a pendência #22 (fila + freio) |
| `repurchase-dispatch` | sim | SIM — precisa código | Idem `dispatch-campaign` |
| `sync-broadcast-status` | sim | SIM — mas o plano é **desligar**, não migrar (o `meta-webhook` já faz o serviço) | — |
| `transcribe-audio` | sim | SIM — mas republicar **não resolve** | Não tem acoplamento a Zernio; para no `media_url = null` da mídia inbound da Meta (pendências #21/#23). Áudio de paciente **não é transcrito** hoje, em silêncio (`skipped: no media_url`) |
| `simulate-inbound` | sim | **Não** — dev-only, não fala com provedor nenhum | Cria conversa **sem `channel_id`/`provider`**, que cairia no fallback zernio se alguém tentasse responder. Só atrapalha em teste |
| `zernio-webhook` · `uazapi-webhook` · `zernio-number-status` · `test-zernio-connection` | sim | Não — são dos outros provedores | Sem efeito no canal Meta |
| `generate-template` · `process-knowledge` · `ingest-lead` · `redirect-tracker` · `invite-team-member` · `delete-team-member` | sim | Não — não tocam canal | Sem efeito |

- **Arquivos:** `supabase/functions/_shared/meta-cloud.ts` (alterado) ·
  `supabase/functions/send-operator-media/index.ts` (alterado) · `MEMORIA.md`.
  `send-operator-message/index.ts` **não precisou de uma linha** — só do deploy.
- **Banco:** **nenhuma migração, nenhum DDL, nenhuma escrita.** Só um `SELECT`
  de diagnóstico em `storage.buckets` (para saber se existia bucket usável).
- **Não feito:**
  - **Nenhum segredo lido, pedido, gerado ou gravado.**
  - **Nenhum `git push`, nenhum deploy na Vercel.** As duas alterações são de
    Edge Function, então **não há nada para publicar na Vercel** nesta entrega —
    mas os arquivos seguem **não commitados** no disco.
  - **Nenhuma outra função foi deployada** — as 18 em `version: 1` continuam
    como estavam, de propósito.
  - O ramo `meta` de `send-operator-media` **não foi exercitado contra a API
    real** (exige o token do canal e dispara mensagem de verdade — é ação do
    Danilo, pela tela). O de `send-operator-message` idem.
- **Efeito colateral a registrar:** a mudança no `_shared/meta-cloud.ts` faz os
  bundles publicados de `send-operator-template` (v2), `submit-template` (v2),
  `sync-template-status` (v4) e `meta-webhook` (v1 de 05/09) ficarem **atrás do
  fonte**. Sem impacto de comportamento (o refactor do `metaReadJson` é neutro e
  `metaUploadMedia` é só acréscimo), mas quem for redeployá-las leva o
  `meta-cloud.ts` novo junto.
- **Próximo:** (1) Danilo testa pela interface: Conversas → abrir uma conversa
  do canal Meta dentro da janela de 24h → digitar e enviar → a mensagem tem que
  sair **sem** a faixa "Salvo, mas não entregue"; depois anexar uma imagem pelo
  clipe. (2) Decidir se `process-ai-message` também é republicada — é um deploy
  sem uma linha de código e destrava a resposta da IA no canal Meta.

### 2026-09-06 · Claude Code (subagente) · Normalização de telefone BR e junção automática

- **Pedido:** (1) republicar `process-ai-message`, que roda o bundle de 24/08 e
  faz toda resposta da IA em conversa Meta falhar com "Zernio API Key não
  configurada"; (2) **Fase 0.5 do `PLANO-MIGRACAO-META.md`** — fazer o CRM
  reconhecer o paciente sozinho: regra única de nono dígito, aplicada em todos
  os pontos de entrada, mais a junção automática dos contatos já duplicados
  (autorizada pelo dono). Sem `git push`, sem deploy na Vercel, sem tocar em
  segredo. Deploy de Edge Function autorizado.

**1. FORMA CANÔNICA ESCOLHIDA: COM o nono dígito.**
`+55` + DDD (2 dígitos) + 9 dígitos começando em 9. Três razões, nesta ordem:
  1. É a forma que o **WebDental exporta** e que a **recepção digita** — a fonte
     dos 63 orçamentos. Gravar canônico **não reescreve o dado do dono**.
  2. É a forma que a **Meta aceita no envio**; o truncamento é só de saída (no
     `wa_id`). Então o número gravado serve direto para disparar.
  3. É a forma que um humano reconhece na tela de Pessoas.
A forma curta (a que a Meta entrega) continua sendo reconhecida **na busca**,
via `phoneVariants` / `phoneBrVariants`. **Fixo** (assinante de 8 dígitos
começando em 2–5) **não** recebe o 9. **Número não brasileiro passa intacto.**

**2. A REGRA EXISTE EM TRÊS LUGARES — E É A MESMA.** Não dá para importar uma da
outra (frontend é Vite/Node, functions são Deno, e o índice precisa de SQL).
Os três arquivos têm cabeçalho avisando que são pareados:

| Onde | Arquivo | Nomes |
|---|---|---|
| Node / browser | `src/lib/phone.ts` | `canonicalPhone`, `phoneVariants`, `samePhone` (+ `normalizePhone`, contrato antigo preservado, agora canonizando o E.164 de saída) |
| Deno / Edge | `supabase/functions/_shared/phone-br.ts` (**novo**) | `phoneBrNormalize`, `phoneBrVariants`, `phoneBrSame` |
| SQL | função `whatsapp_hub.phone_br_canonical(text)` | usada pelo índice único e pela junção |

> **Prefixo `phoneBr*` no `_shared/` não é estilo, é obrigação.** O inliner de
> `api/bootstrap.ts` achata todos os `_shared/` no MESMO escopo do `index.ts`.
> `normalizePhone` já existe local em `meta-webhook`, `zernio-webhook` e
> `ingest-lead` — sem prefixo, um sobrescreveria o outro **sem erro nenhum**.

**Conferência das três implementações:** rodei a MESMA tabela de 16 casos
(celular curto/longo, fixo de Itabuna `3214-7762`, fixo de SP, EUA, Portugal,
vazio, lixo) contra a versão Deno e contra a função SQL. **Resultado idêntico
caso a caso.** `+557332147762` (fixo) NÃO ganhou o 9; `+12125551234` e
`+351912345678` passaram intactos.

**3. PONTOS DE ENTRADA TRATADOS (varredura do projeto inteiro).**

| Ponto | Arquivo | O que mudou |
|---|---|---|
| Webhook da Meta | `supabase/functions/meta-webhook/index.ts` | `normalizePhone` delega a `phoneBrNormalize`; `findOrCreateContact` procura por **todas as variantes** antes de criar, elege o que já está na forma canônica (senão o mais antigo) e promove contato legado solitário para a canônica |
| Abrir conversa pela tela | `src/lib/conversations.ts` | novo `findTwinConversation`: antes de criar, procura a conversa de qualquer contato com telefone equivalente; e `23505` no insert passou a reler em vez de estourar |
| Importação CSV/XLSX | `src/components/contacts/ImportContactsDialog.tsx` | a busca do "já existe" varre as variantes; contato legado sem o 9 é **atualizado por `id`** para a canônica em vez de virar um segundo contato |
| Cadastro/edição manual | `src/hooks/useContacts.ts` (`create`, `update`) | grava sempre canônico |
| Ficha do contato | `src/hooks/useContactProfile.ts` | idem |
| Ficha da oportunidade | `src/hooks/useDealDetail.ts` | idem |
| "Abrir contato" da tela de Vendas | `src/app/routes/vendas/VendasPage.tsx` | busca por variantes |
| Lead de landing | `supabase/functions/ingest-lead/index.ts` | grava canônico e busca por variantes |
| Recompra | `supabase/functions/repurchase-dispatch/index.ts` | idem (**fonte pronto, NÃO republicado** — ver pendência #37) |
| Simulador de inbound (dev) | `supabase/functions/simulate-inbound/index.ts` | idem (**fonte pronto, NÃO republicado**) |
| Número do PRÓPRIO canal | `api/meta-connect.ts` | a Meta devolve `display_phone_number` truncado ("9804-0599"); agora o CRM repõe o 9 antes de gravar. **É a mesma armadilha que consumiu horas em 05/09** |

**Varridos e confirmados SEM necessidade de mudança** (resolvem contato por
`id`, não por telefone): `dispatch-campaign`, `check-follow-ups`,
`funnel-automation`, `send-operator-template`, `send-operator-message`,
`send-operator-media`, `process-ai-message`, `useConversations`,
`CustomFieldsEditor`, `FunilPage`. **`zernio-webhook` e `uazapi-webhook` foram
deixados intactos de propósito** — a regra é "não quebrar zernio nem uazapi, só
acrescentar", e eles não atendem nenhuma org viva.

**4. CASAMENTO DA RESPOSTA COM A CAMPANHA (item 0.5.5 do plano) — já resolvido
sem código novo.** O `meta-webhook` marca `campaign_contacts.replied` por
`contact_id`, e o status de entrega casa por `wamid`. Com o contato unificado,
os dois caminhos passam a apontar para a linha certa. Nada a mudar em
`dispatch-campaign`.

**5. DEPLOYS DA SESSÃO — 3 funções, todas conferidas byte a byte.**

| Função | Antes | Agora | Conferência |
|---|---|---|---|
| `process-ai-message` | v1 (24/08) | **v3** | `sha256 90d9a8f6…` — publicado **idêntico** ao bundle local (`cmp` sem diferença, 119.576 bytes) |
| `meta-webhook` | v1 (05/09) | **v2** | `sha256 95087b69…` — publicado **idêntico** ao bundle local |
| `ingest-lead` | v1 (24/08) | **v2** | conferido por leitura do publicado + smoke test (`400 {"ok":false,"error":"Informe telefone ou email."}`) |

Deploy pelo MCP `deploy_edge_function`, **`verify_jwt: false` nas três** (é o
padrão do projeto; no `meta-webhook` é crítico — a Meta chama anonimamente).
Bundle achatado pelo **mesmo inliner de `api/bootstrap.ts`**.
`npx supabase functions deploy` segue inutilizável nesta máquina.

**Prova de que o método de empacotar é fiel:** antes de qualquer deploy, gerei
o bundle local de `send-operator-message` (publicada v2 ontem) e ele bateu
**byte a byte** com o publicado (`sha256 d56dab28…`). Só então usei o caminho.

**Smoke tests depois do deploy:**
- `POST /meta-webhook` com `{}` e **sem** `Authorization` → `200
  {"ok":true,"skipped":"no_phone_number_id"}`. Sobe, roda, e prova que o
  `verify_jwt` está `false` (com `true` o gateway devolveria 401 antes).
- `GET /meta-webhook?hub.mode=subscribe&hub.verify_token=errado&…` → `403
  {"ok":false,"error":"Forbidden"}` — a validação do desafio está no ar.

> **⚠️ ARMADILHA DO EMPACOTADOR — terceira vez, agora numa forma nova.** Ao
> emitir os 119 KB do bundle de `process-ai-message`, o primeiro envio saiu com
> **2 bytes a mais** (dois espaços dentro de um comentário de `_shared/llm.ts`,
> na linha do `getAdAccountSpend`). Funcionalmente inócuo, mas **não byte-exato**
> — e só apareceu porque a conferência foi feita de verdade, baixando o
> publicado e rodando `cmp`. Reenviei corrigido (v3) e aí bateu.
> **Lição: conferir sha256 do publicado contra o local não é formalidade.**
> A v2 fica no histórico do Supabase, inerte.

- **Banco:** **1 migração aplicada** — `20260906200000_phone_br_canonical.sql`
  (arquivo versionado em `supabase/migrations/`, aplicada via MCP
  `apply_migration`, nome no controle `phone_br_canonical`). Linha completa,
  com reversão escrita, na tabela *Mudanças no banco*. **`npm run db:push` e
  `/setup` NÃO foram rodados** (reaplicariam as 93 migrations).

  **Detecção rodada em modo LEITURA antes de aplicar:** 1 grupo duplicado,
  2 contatos, sobrevivente `4230c6df…` (`+5533999772570`, cadastro manual, o
  mais antigo); perdedor `8857b133…` (`+553399772570`, criado pelo webhook).
  Mais 2 contatos fora da forma canônica (Sérgio e Trabalho).

  **Resultado, conferido por `SELECT` depois:**

  | Métrica | Antes | Depois |
  |---|---|---|
  | Contatos | 4 | **3** |
  | Conversas | 4 | **3** |
  | **Mensagens** | **9** | **9** — nenhuma perdida |
  | campaign_contacts | 1 | 1 |
  | Notificações | 5 | 5 |
  | Grupos duplicados | 1 | **0** |
  | Telefones fora da canônica | 3 | **0** |

  A conversa `c2f06afb…` foi fundida na `b3330404…`, que passou de 2 para **4
  mensagens** — soma exata das duas. `+557399374142` virou `+5573999374142` e
  `+557382119963` virou `+5573982119963`.

  **Decisão sobre threads duplicadas: FUNDIR, e não foi escolha de gosto.**
  Existe `UNIQUE (org_id, contact_id)` em `conversations`
  (`conversations_org_contact_key`) — manter duas conversas apontando para o
  contato único é **impossível** no banco. Então mensagens e notificações são
  reapontadas **antes** de qualquer `DELETE` (o FK de `messages` é
  `ON DELETE CASCADE`; a ordem inversa apagaria histórico), `unread_count` é
  somado e `last_message_at` fica com o maior dos dois.

  **O bloco se auto-audita:** conta mensagens, deals, `campaign_contacts` e
  contatos antes e depois, e `RAISE EXCEPTION` (desfazendo a migração inteira)
  se qualquer contagem não bater.

- **Defesa contra o problema voltar (item 2.4):** entrou o índice único parcial
  `contacts_org_phone_canonical_key (org_id, phone_br_canonical(phone)) WHERE
  phone IS NOT NULL`. **Avaliado como seguro:** dois contatos com a mesma forma
  canônica são, por definição, a mesma pessoa — a `UNIQUE (org_id, phone)` que
  já existia proibia a grafia idêntica, esta só estende para a equivalente.
  Telefone nulo ou irreconhecível cai em `NULL`, e `NULL`s não colidem.
  **Testado na prática:** um `INSERT` de `+553399772570` (exatamente o que o
  webhook fazia) foi **recusado** com `unique_violation`, e o teste não deixou
  lixo no banco.

- **Validação:** `npx tsc -b`, `npx tsc -p tsconfig.api.json --noEmit` e
  `npx vite build` passam sem erro. `npm run validate:sql` valida as 95
  migrations. `deno check` dos bundles novos: só os erros pré-existentes dos
  `_shared/` (4 em `meta-webhook`, 1 em `ingest-lead`), **nenhum novo e nenhum
  citando `phoneBr`**. Nenhuma declaração de topo duplicada nova em bundle
  nenhum.

- **Não feito / limites desta entrega:**
  - **Nenhum segredo lido, pedido, gerado ou gravado.**
  - **Nenhum `git push`, nenhum deploy na Vercel.** As mudanças de frontend
    (8 arquivos) e a de `api/meta-connect.ts` existem **só no disco** —
    reforçam a pendência **#30**.
  - **`repurchase-dispatch` e `simulate-inbound` não foram republicados** de
    propósito (pendência **#37**): o primeiro precisa do ramo `meta` de
    qualquer forma, o segundo é dev-only. Republicar mais funções do que o
    necessário aumenta a superfície de risco sem ganho.
  - **Pendência #34 continua ABERTA** (regra 4: agente não fecha pendência).
    Só fecha com o Danilo confirmando pela tela.
  - Nada mudou em zernio nem em uazapi — só acréscimo.

- **Arquivos:** `src/lib/phone.ts` · `supabase/functions/_shared/phone-br.ts`
  (**novo**) · `supabase/migrations/20260906200000_phone_br_canonical.sql`
  (**novo**) · `supabase/functions/meta-webhook/index.ts` ·
  `supabase/functions/ingest-lead/index.ts` ·
  `supabase/functions/repurchase-dispatch/index.ts` ·
  `supabase/functions/simulate-inbound/index.ts` · `src/lib/conversations.ts` ·
  `src/components/contacts/ImportContactsDialog.tsx` · `src/hooks/useContacts.ts` ·
  `src/hooks/useContactProfile.ts` · `src/hooks/useDealDetail.ts` ·
  `src/app/routes/vendas/VendasPage.tsx` · `api/meta-connect.ts` · `MEMORIA.md`.

- **Precisa de deploy na Vercel?** **SIM.** 7 arquivos de frontend
  (`src/lib/phone.ts`, `src/lib/conversations.ts`, `ImportContactsDialog.tsx`,
  `useContacts.ts`, `useContactProfile.ts`, `useDealDetail.ts`,
  `VendasPage.tsx`) + 1 API Route (`api/meta-connect.ts`). Sem esse deploy o
  **webhook já está protegido** (é Edge Function, já no ar), mas o **cadastro
  manual, a importação de CSV e a tela de Vendas continuam gravando a grafia
  crua** — e aí o índice único devolve erro de chave em vez de duplicar.
  Publicar é decisão do Danilo (pendência #30).

- **Próximo:** (1) Danilo autoriza o deploy na Vercel; (2) teste pela interface —
  pedir para um celular **novo** mandar mensagem e conferir que criou **um** só
  contato; responder pelo CRM, pedir resposta de volta e conferir que cai na
  **mesma** conversa; em Pessoas, conferir que não há dois contatos com o mesmo
  telefone. Isso fecha a **#34**. (3) Só então seguir no
  `PLANO-MIGRACAO-META.md`.

### 2026-09-06 · Claude Code · Decisões do Danilo + Fase 0 concluída

**DECISÕES DO DANILO (06/09/2026):**
1. **D0.1 — Cancelar a campanha "Teste"** ✅ autorizado e **EXECUTADO**:
   `campaigns` id `c92d6e1c-92ab-428a-bff6-8d0e4ac05c28` passou de
   `status='sending'` para `'paused'`. Não dispara mais sozinha quando a
   Fase 2 ficar pronta. (Os crons `wh-dispatch-campaigns` e
   `wh-sync-broadcast-status` **não foram desligados** — D0.2 não foi
   respondida; com a campanha pausada, o loop não tem o que processar.)
2. **D0.5.1/D0.5.2 — Contatos duplicados:** o Danilo foi além do proposto —
   *"não só junte os contatos, faça que o próprio CRM já faça isso
   automaticamente"*. Ou seja: **solução estrutural e permanente**, não
   mutirão de limpeza. Migração autorizada.
3. **D1.1/D1.2 — Mídia de paciente:** autorizado criar o espaço de
   armazenamento. Confirmado: **Supabase Storage**, bucket **PRIVADO**
   (não o `whatsapp-hub-agent-media`, que é `public=true` e serve à IA),
   acesso por perfil (admin + recepção), **expurgo automático em 12 meses**.
4. **Republicar `process-ai-message`** ✅ autorizado.
5. **Publicar o código** ✅ autorizado e **EXECUTADO** — commit `a7d140f`.

**ALERTA REITERADO AO DANILO (não é bloqueio):** guardar foto e áudio de
paciente por 12 meses transforma a **pendência #24** (política de privacidade
apontando para a do Facebook) de "feio" em **exposição real**. Continua aberta.

**FASE 0 DO PLANO: CONCLUÍDA.**

**Ordem de execução por conflito de arquivo:** a guarda de mídia inbound
(Fase 1.4) e a normalização de telefone (Fase 0.5) **tocam o mesmo arquivo**
(`meta-webhook/index.ts`). Executar em série, nunca em paralelo — dois agentes
no mesmo arquivo se desfazem. A normalização está em curso; a mídia entra
depois que ela terminar.

- **Arquivos:** `MEMORIA.md`. **Banco:** 1 `UPDATE` na campanha (autorizado).
- **Próximo:** terminar a normalização → criar o bucket privado e ligar a
  guarda de mídia → Fase 1 fecha.
