# ODONTO.md — CRM de Odontologia · Clínica Amor Saúde Itabuna

> **Precedência.** Este arquivo é a regra do projeto. Onde ele divergir do
> `CLAUDE.md` (que veio do curso e está defasado), **vale o ODONTO.md**.
> O `CLAUDE.md` continua valendo para stack, convenções de código, RLS,
> design system e Edge Functions.
> `AGENTS.md` está desatualizado (descreve Meta Cloud API direto, não Zernio)
> e não deve ser usado como fonte. Decisão sobre apagá-lo: adiada.
>
> **Registro obrigatório.** Todo agente lê o `MEMORIA.md` antes de começar e
> escreve nele antes de terminar. Decisão, migração ou entrega que não estiver
> no `MEMORIA.md` não existe. Ordem de leitura:
> `MEMORIA.md` → `ODONTO.md` → `CLAUDE.md` → migrations.

---

## 1. Objetivo

CRM exclusivo da **odontologia** da Clínica Amor Saúde Itabuna, para
**converter orçamento apresentado e não aprovado em tratamento aprovado**.

Não é um CRM de captação de lead novo. O lead já existe: é o paciente que
sentou na cadeira, recebeu o orçamento e foi embora sem fechar.

O CRM de **conversão de exames** (medicina) é um sistema separado. Unificação
futura é intenção, não escopo desta fase.

---

## 2. Fonte de dados: de onde vem o orçamento pendente

Origem: **WebDental / Dental Vidas**, relatório *Controle de Efetivação*
(`relatorios.webdentalsolucoes.io`), filtro **"APENAS NÃO APROVADOS"**,
unidade *AmorSaúde Itabuna Centro*. Exportável em XLS.

Colunas do relatório: `Paciente · Tel · Endereço · DtOrçamento · DtAprovação ·
DtFinalização · Tratamento · ValorTotal · TotalParticipaçãoConvenio ·
Tabela do Orçamento · Prestador · DtAgenda · DtRetorno · DtObs · Obs · Resp ·
Observação · Questionário`.

Referência de volume (competência **set/2026**, leitura em 05/09/2026):
64 pacientes únicos não aprovados · 80 tratamentos · R$ 68.436,03 ·
ticket médio R$ 1.069,31. Concentração em **Clínica Geral**, seguida de
**Prótese**; Orto e Implante com volume baixo.

Metas da franqueadora presentes no mesmo relatório (não são metas internas):
tratamentos aprovados 75% · valor aprovado 75% · orto 35% · implante 10% ·
prótese 10% · clínica geral 85% · plano Dental Vidas 50%.

**Regra:** todo número que entrar no CRM carimba a competência e a data de
cobertura do export. Realizado e projetado nunca na mesma linha.

---

## 3. Funil odonto

Pipeline `kind = 'comercial'`, nome **"Odonto — Orçamentos"**.

| # | Etapa | is_won | is_lost | probability |
|---|---|---|---|---|
| 1 | Orçamento apresentado | false | false | 20 |
| 2 | Em negociação | false | false | 45 |
| 3 | Aguardando decisão | false | false | 70 |
| 4 | Aprovado | **true** | false | 100 |
| 5 | Não aprovado | false | **true** | 0 |

`probability` alimenta o forecast (`Σ valor × probability`). Os valores acima
são ponto de partida e devem ser recalibrados com 60 dias de histórico real.

---

## 4. Mapeamento: relatório → banco (`schema whatsapp_hub`)

| Campo do relatório | Onde grava |
|---|---|
| Paciente | `contacts.name` |
| Tel | `contacts.phone` (normalizar E.164, +55) |
| Endereço | `contacts.custom_fields.endereco` |
| DtOrçamento | `custom_fields.dt_orcamento` (do deal) |
| Tratamento | `products` + `deal_products` |
| ValorTotal | `deals.value` e `deal_products.value` |
| TotalParticipaçãoConvenio | `custom_fields.participacao_convenio` |
| Tabela do Orçamento | `custom_fields.tabela_preco` |
| Prestador | `custom_fields.dentista` |
| DtRetorno | `crm_activities.due_at` (type `followup`) |
| Observação / Obs / Resp | `crm_activities` (type `note`) |
| — | `deals.owner_id` = quem faz a recuperação |

`deals.title` = `"Orçamento <Paciente> — <Tratamento> — <DtOrçamento>"`.

`deals.temperature` (`Frio·Morno·Quente`) e `deals.lead_type`
(`Lead·Cliente`) já existem — usar `lead_type = 'Cliente'` sempre, porque o
paciente já é cliente da clínica.

### Nomenclatura obrigatória

O paciente que paga preço com desconto é **FILIADO** do Cartão de TODOS —
nunca "sócio". Vale em campo, label de UI, relatório e script.
A "Tabela - Itabuna Centro - Cartão de Todos" identifica orçamento de filiado.

---

## 5. Catálogo de procedimentos — CONFLITO ABERTO

`products` existe e `deal_products` já tem `value` e `quantity`, então
orçamento por itens funciona. **Mas** `products.product_type` tem CHECK
constraint travado em:

```
('curso','mentoria','consultoria','ebook','app','ia','fisico')
```

Taxonomia de infoproduto. Não existe tipo para procedimento odontológico.

Opções (decidir antes de qualquer seed):
- **A.** Migração que troca o CHECK por
  `('clinica_geral','protese','implante','orto','endo','perio','cirurgia','odontopediatria','estetica')`.
- **B.** Não usar `product_type` e classificar por `tags` / `deal_tags`.

Recomendação: **A**. Relatório por especialidade é a leitura que a
franqueadora cobra, e tag não sustenta constraint.

`products` tem UNIQUE `(org_id, name)` desde a migração multi-tenant.

---

## 6. Régua de follow-up — LACUNA TÉCNICA CONFIRMADA

O caso de uso central é *"orçamento parado na etapa há N dias"*.
**Isso não é nativo.**

O que existe hoje:
- `follow_up_rules` v2 — gatilhos `no_reply`, `inactivity` (horas sem inbound),
  `no_purchase` (dias sem compra). Nenhum olha etapa de funil.
- `funnel_automations` — dispara quando o deal **ENTRA** numa etapa, não
  quando **fica parado** nela.
- `crm_activities` tem o tipo `stage_change` no enum, mas **nenhum trigger
  grava** essa linha automaticamente.
- `deals` **não tem** `stage_entered_at`. `updated_at` muda a cada edição,
  então não serve como relógio de estagnação.

Consequência: sem intervenção, não há como medir nem disparar em cima de
"orçamento parado há 3 dias".

Correção mínima proposta (a aprovar):
1. `ALTER TABLE deals ADD COLUMN stage_entered_at TIMESTAMPTZ DEFAULT now();`
2. Trigger em `deals` que atualiza `stage_entered_at` quando `stage_id` muda
   e grava `crm_activities(type='stage_change')`.
3. Novo gatilho `stage_stalled` em `follow_up_rules`, com
   `params = {stage_id, days}`, consumido pelo cron `check-follow-ups`.

Cadência sugerida (D = data do orçamento) — **PENDENTE de aprovação**:
D+1 · D+3 · D+7 · D+15 · D+30, depois encerra em "Não aprovado".

---

## 7. Canal de WhatsApp

**Somente `zernio`** (API oficial da Meta). `uazapi` está **proibido** neste
projeto — clínica não corre risco de banimento de número em canal não oficial.

Hoje o banco permite os dois:

```sql
-- whatsapp_hub.channels (migração 20260810120000_mt_schema)
provider TEXT NOT NULL CHECK (provider IN ('zernio', 'uazapi'))
-- whatsapp_hub.follow_up_rules (migração 20260802150200_followup_rules_v2)
provider TEXT NOT NULL DEFAULT 'zernio'   -- sem CHECK
```

Regra escrita não basta. Travar em dois lugares:

- **Banco:** trocar o CHECK de `channels.provider` para `IN ('zernio')` e
  criar CHECK equivalente em `follow_up_rules.provider`.
- **UI:** remover `uazapi` do seletor de canal e do formulário de regra
  (rota `/automations`).

Toda mensagem fora da janela de 24h exige **template aprovado**.

---

## 8. Compliance — parar e perguntar antes

Três pontos que **não** podem ser decididos por agente:

1. **Publicidade odontológica.** Todo texto de template/script enviado a
   paciente entra em regra de publicidade odontológica (CFO / Dental Vidas).
   Nenhum script comercial vai para produção sem aprovação do Danilo.
2. **Dado de paciente.** O CRM guarda nome, telefone, endereço e tratamento —
   dado pessoal sensível. Retenção, acesso por perfil e base legal são tema
   jurídico: escalar, não decidir.
3. **Regra de franqueadora.** Qualquer coisa que toque contrato ou métrica
   oficial da Dental Vidas / AmorSaúde é decisão do Danilo.

Demais gatilhos de escalação do grupo continuam valendo: decisão acima de
R$ 15.000, tema fiscal/trabalhista/jurídico, número que vá para banco,
investidor ou contador.

---

## 9. O que o CLAUDE.md diz de errado (não seguir)

| CLAUDE.md afirma | Realidade no código |
|---|---|
| "Uma instância = uma organização" | `20260810_mt_schema` reintroduziu `organizations`, `channels` por org, `public.org_settings`, `org_id` em ~45 tabelas |
| Credenciais em `public.app_settings` | Por org em `public.org_settings` |
| Não menciona CRM | Existem `deals`, `pipelines`, `stages`, `products`, `deal_products`, `crm_activities`, rotas `/funil`, `/vendas`, `/automations` |
| `follow_up_rules` só `no_reply` | v2 com `inactivity`, `no_purchase`, provider por regra, `follow_up_log` |
| Nada sobre automação de funil | `funnel_automations` + Edge Function `funnel-automation` |

**Antes de propor qualquer migração, ler as migrations em
`supabase/migrations/`, não o CLAUDE.md.**

---

## 10. Decisões pendentes

| # | Decisão | Quem |
|---|---|---|
| 1 | `product_type`: opção A (migração) ou B (tags) | Danilo |
| 2 | Aprovar `stage_entered_at` + gatilho `stage_stalled` | Danilo |
| 3 | Cadência da régua (D+1/3/7/15/30?) | Danilo |
| 4 | Quem opera: recepção odonto, coordenador, ou pessoa dedicada | Danilo |
| 5 | Carga inicial: importar os 64 pacientes de set/2026 ou começar do zero | Danilo |
| 6 | Número de WhatsApp do canal odonto | Danilo |
| 7 | Textos de template (trava de publicidade odontológica) | Danilo |
| 8 | Apagar ou neutralizar o `AGENTS.md` | Danilo (adiado) |

---

## 11. Ambiente

- Supabase project_id: `feptvmsjzreovfynrlql`
- Schema de aplicação: `whatsapp_hub` (48 tabelas, RLS em todas)
- `public` só para extensions, cofre de credenciais e bootstrap
- Frontend sempre com `.schema('whatsapp_hub')`
- Design system dark glassmorphism obrigatório (ver `CLAUDE.md`)
