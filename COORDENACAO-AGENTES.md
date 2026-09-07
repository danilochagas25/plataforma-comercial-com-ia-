# Coordenação entre agentes — CRM Odonto

> **Cole este arquivo no início de CADA sessão de agente que trabalhar neste
> projeto.** São três frentes rodando ao mesmo tempo na mesma pasta e no mesmo
> banco. Sem estas regras, um desfaz o trabalho do outro — e já quase aconteceu
> em 07/09/2026.

---

## As três frentes

| Frente | Responsável por | NÃO mexe em |
|---|---|---|
| **DESIGN** | `src/styles/globals.css` · `src/components/ui/*` · `src/app/layout/*` · `design/` · identidade visual | banco · Edge Functions · importação · canal WhatsApp |
| **COMERCIAL** | textos de template · conteúdo de mensagem · copy da interface | código de infraestrutura · banco · deploy |
| **CONFIGURAÇÃO** | banco e migrations · Edge Functions · canal WhatsApp/Meta · importação do WebDental · `api/*` · `src/lib/*` | estilos · componentes visuais · layout |

**Se precisar tocar em território alheio: PARE e avise o Danilo.** Ele decide
quem faz.

---

## Regra 1 — Publicar (`git push`)

**Só publica quem avisou antes e teve o "pode".**

- **NUNCA use `git add -A` ou `git add .`** Isso pega o trabalho das outras
  frentes e leva pela metade para produção.
- Adicione **arquivo por arquivo**, só os seus:
  `git add caminho/do/arquivo1 caminho/do/arquivo2`
- Antes de publicar, **liste ao Danilo exatamente o que vai subir** e espere
  confirmação.
- Rode `npx tsc -b` e `npx vite build` antes. **Se o build falhar por causa de
  arquivo de OUTRA frente, não conserte — avise.** Pode ser trabalho em curso.

> **O que já quase aconteceu:** em 07/09 a frente de Configuração ia publicar e
> teria levado um redesign inteiro pela metade para o ar. Só não foi porque o
> build quebrou e a causa foi investigada.

---

## Regra 2 — Banco de dados

**Só a frente de CONFIGURAÇÃO aplica migração.** É o único ponto do projeto
sem desfazer fácil.

- Design e Comercial: se precisarem de mudança no banco, **peçam** — não apliquem.
- Toda migração é arquivo versionado em `supabase/migrations/`, aplicada por
  `apply_migration`, **com reversão escrita** e linha na tabela
  *Mudanças no banco* do `MEMORIA.md`.
- **NUNCA** `npm run db:push` nem `/setup` — reaplicaria as 93 migrations do
  zero e quebraria o banco.

---

## Regra 3 — Edge Functions

**Só a frente de CONFIGURAÇÃO publica Edge Function.**

- `npx supabase functions deploy` **não funciona** nesta máquina (sem
  `SUPABASE_ACCESS_TOKEN`). O deploy é pelo MCP, com o bundle achatado do
  inliner de `api/bootstrap.ts`.
- **Confira o sha256** do publicado contra o bundle local depois de cada deploy.
  Dois envios já saíram com 2 bytes a mais e só apareceram na conferência.

---

## Regra 4 — Arquivos compartilhados

Estes são de **uso comum**. Quem mexer, avisa:

| Arquivo | Dono natural | Observação |
|---|---|---|
| `MEMORIA.md` | todos | **Só ACRESCENTE ao final.** Nunca reescreva. Assine a frente na entrada |
| `src/config/vocab.ts` | Design | Comercial pode pedir mudança de termo |
| `src/types/*` | Configuração | Design avisa se precisar de campo novo |
| `package.json` | Configuração | dependência nova é decisão conjunta |

---

## Regra 5 — Registro obrigatório

Ao fim de **toda** sessão, acrescente ao `MEMORIA.md`:

```
### AAAA-MM-DD · [FRENTE: design|comercial|configuração] · <título curto>
- Pedido: o que foi solicitado
- Feito: o que mudou de fato
- Arquivos: caminhos tocados
- Banco: migração aplicada (ou "nenhuma")
- Publicado: sim/não — e o que exatamente
- Não feito: o que ficou de fora e por quê
- Próximo: qual a próxima demanda
```

**Sempre identifique a frente.** Sem isso, ninguém sabe quem fez o quê.

---

## Regra 6 — Antes de começar qualquer trabalho

1. `git status` — **veja o que as outras frentes deixaram em aberto**
2. Leia as últimas entradas do `MEMORIA.md`
3. Se houver arquivo alterado da sua frente que você não reconhece, **pergunte
   antes de mexer**

---

## Regra que vale para todos

> **"Antes de fazer alguma ação você deve me perguntar."**
> — regra dada pelo Danilo em 06/09/2026

Propor → esperar o "pode" → executar → mostrar o resultado.

---

## Estado do projeto (atualize a data quando mudar)

**07/09/2026** — Canal WhatsApp completo e funcionando (Meta Cloud API direto).
Funil odonto, campos, catálogo e relógio de estagnação criados. Importação do
WebDental em refação. Disparo em massa e régua **fora de escopo** por decisão
do dono. Contexto completo em `MEMORIA.md` e `PLANO-MIGRACAO-META.md`.
