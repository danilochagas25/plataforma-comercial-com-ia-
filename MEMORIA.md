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

> **Correção 05/09/2026:** a frase "Nenhuma até agora" acima deixou de valer nesta
> data. O banco passou a ter 1 migração aplicada por este projeto (linha acima).

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
