# Plano de migração para a Meta Cloud API — CRM Odonto
### Clínica Amor Saúde Itabuna · escrito em 06/09/2026

> **Para o Danilo.** Este documento é o mapa do que falta para o CRM da
> odontologia funcionar 100% na Meta, sem o Zernio. Cada fase começa com o que
> muda para o negócio e o que quebra se não for feito. O bloco técnico fica no
> fim de cada fase — se não for ler, pule.
>
> **Missão que este plano serve:** transformar os **63 orçamentos não aprovados
> (R$ 67.525,88)** em tratamento aprovado.
>
> Este documento **não altera nada**. É plano.

---

## 1. Onde estamos hoje (verificado no banco e no código em 06/09/2026)

| Item | Situação |
|---|---|
| Número na Meta | `+55 73 99804-0599` registrado na Cloud API |
| Receber mensagem de paciente | ✅ funciona (cria contato e conversa sozinho) |
| Responder pela tela de Conversas | ✅ código pronto — **falta publicar** (Fase 1) |
| Enviar modelo aprovado | ✅ funciona ponta a ponta |
| Ver e criar modelos no CRM | ✅ funciona |
| Status de entrega | ✅ chega e é gravado |

**Banco hoje:** 1 número · 4 contatos · 4 conversas · 9 mensagens (3 recebidas
de paciente) · 1 modelo aprovado · **1 campanha travada** · 0 regras de
follow-up · 0 automações de funil · 0 orçamentos importados.

---

## 2. As quatro descobertas que mudam o tamanho da obra

### 2.1. Tem uma campanha girando em falso

Campanha **"Teste"**, criada 06/09 às 15h04, com 1 paciente na fila, parada em
"enviando". O robô de campanhas roda **a cada 30 segundos** e tentou **2.874
vezes nas últimas 24 horas** — sempre falhando, porque fala com o Zernio.

Nada foi enviado, mas a campanha **nunca sai de "enviando"** sozinha — e quando
a Fase 2 ficar pronta, **ela dispara sozinha**.

### 2.2. Metade do "quebrado" só precisa ser republicada

**Responder por texto**, a **atendente de IA** e a ação "enviar texto" das
automações **já têm o código certo no disco**. O que está no ar é o programa de
24/08, empacotado antes da Meta existir. **É publicação, não programação.**

Das 24 funções, **20 rodam a versão 1 de 24/08**.

### 2.3. Uma função não precisa migrar — precisa ser desligada

`sync-broadcast-status` existia porque o Zernio não avisava o resultado dos
disparos. **A Meta avisa sozinha**, e o webhook que já está no ar já grava.

### 2.4. 🔴 A Meta entrega telefone brasileiro SEM o nono dígito

**Descoberto pelo Danilo em 06/09, olhando a lista de conversas.** O mesmo
paciente vira **dois contatos**. É o problema mais grave do plano — detalhado
na Fase 0.5.

---

## 3. O risco número 1: o freio de ritmo

**O que aconteceu antes.** Em 07/05/2026 o número do Cartão de TODOS foi
**restringido pela Meta** depois de 1.343 mensagens em 2 dias.

**Por que pode se repetir.** O Zernio tinha *Broadcast*: dividia em lotes,
esperava entre envios, repetia quem falhou e parava quando havia reclamação.
**A Meta não tem nada equivalente.** Tudo isso vira código nosso.

**E hoje o sistema está no ritmo errado:** o disparador processa até 60
destinatários por rodada, a cada 30 segundos — **até 120 mensagens por minuto**.
É exatamente o padrão que restringiu o número do CDT.

| Trava | Sugestão inicial | Por quê |
|---|---|---|
| Ritmo | 1 mensagem a cada 20–40 segundos, com intervalo variável | parece gente, não robô |
| Teto por dia | 25 no dia 1, subindo 25 a cada dia sem problema | os 63 saem em 3 dias |
| Horário | 8h–18h, dias úteis | ninguém recebe cobrança às 23h |
| Parada automática | 3 falhas seguidas de bloqueio → pausa e avisa | evita repetir o CDT |
| Botão Pausar | sempre visível na tela de Disparos | você para na hora |

> **Com 63 orçamentos, não existe pressa que justifique risco.** Três dias em
> ritmo humano valem mais que um número restringido.

---

## FASE 0 — Parar o sangramento (hoje, sem escrever código)

### O que muda para o negócio
O sistema para de tentar, 2.880 vezes por dia, algo que não pode dar certo. E a
campanha "Teste" sai do limbo.

### O que quebra se não fizer
Campanha eternamente "enviando · 0 de 1". Pior: quando a Fase 2 ficar pronta,
**ela dispara sozinha**, sem você mandar.

### Passos

| # | O que fazer | Onde | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 0.1 | Cancelar/arquivar a campanha "Teste" | Tela de Disparos | Baixo | Não | Não |
| 0.2 | Desligar temporariamente os robôs de campanha (30s) e de status (2min) | Decisão sua | Baixo | Não | Não |

### Como você testa
1. CRM → **Disparos** → achar a campanha **"Teste"** → pausar/cancelar
2. Voltar em 5 minutos: não pode ter voltado para "enviando"

### Esforço
**Pequeno.**

### Decisões suas
- **D0.1** — Pode cancelar a campanha "Teste"?
- **D0.2** — Desligar os dois robôs até a Fase 2? *(Recomendo desligar.)*

---

## FASE 0.5 — 🔴 Identificar o paciente corretamente (ANTES de qualquer campanha)

> **Esta fase não estava no plano original.** Foi acrescentada depois que o
> Danilo percebeu, na tela de Conversas, **duas conversas com o mesmo número**.

### O que muda para o negócio
O CRM passa a entender que `+55 33 99977-2570` e `+55 33 9977-2570` são **a mesma
pessoa**. Sem isso, cada paciente que responder vira um contato novo.

### O que quebra se não fizer — o sintoma concreto

É o cenário que **arruína a campanha dos 63 orçamentos**:

1. Você importa o paciente do WebDental, **com o número completo**
2. A clínica dispara o modelo
3. O paciente **responde**
4. A Meta entrega a resposta **sem o nono dígito**
5. O CRM **cria contato e conversa novos**
6. O orçamento fica num contato e a resposta em outro

**Resultado:** o funil não avança, o histórico se parte, e o relatório diz que
**ninguém respondeu** — quando na verdade responderam. Você tomaria a decisão
errada sobre a campanha inteira, com base em dado sujo.

### Evidência real (banco, 06/09/2026)

| Nome | Telefone gravado | Origem |
|---|---|---|
| Danilo Chagas | `+5533999772570` (14) | cadastro manual |
| **Danilo Chagas** | `+553399772570` (13) | **criado pelo webhook** |
| Sérgio O Fernandes | `+557399374142` (13) | webhook — real tem 9 |
| Trabalho | `+557382119963` (13) | webhook — real tem 9 |

### Passos

| # | Peça | O que muda | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 0.5.1 | Regra de normalização de telefone BR | Peça única que reconhece as duas formas | Médio | Não | Não |
| 0.5.2 | `meta-webhook` | Ao receber, procura o contato nas duas formas antes de criar | Médio | Não | Não |
| 0.5.3 | `src/lib/conversations.ts` | Mesma regra ao abrir conversa | Baixo | Não | **Sim** |
| 0.5.4 | Importação de contatos / CSV | Grava sempre na forma canônica | Baixo | Não | **Sim** |
| 0.5.5 | `dispatch-campaign` | Casa a resposta com a fila da campanha nas duas formas | Médio | Não | Não |
| 0.5.6 | Contatos já duplicados | Juntar sem perder mensagem | **Alto** | **Talvez** | Não |

### Como você testa
1. Pedir para um celular **novo** mandar mensagem → confere que criou **um**
   contato
2. Responder pelo CRM e pedir para a pessoa responder de volta → tem que cair
   **na mesma conversa**, não numa nova
3. Em **Pessoas**, conferir que não há dois contatos com o mesmo telefone

### Esforço
**Médio.** A regra é pequena; juntar os duplicados exige cuidado.

### Decisões suas
- **D0.5.1** — Autoriza juntar os contatos já duplicados? *(Hoje são poucos.
  Depois da campanha seriam dezenas.)*
- **D0.5.2** — Se a junção exigir script no banco, autoriza? *Nenhuma mensagem
  se perde; é só reapontar para um contato só.*

---

## FASE 1 — O que já pode quebrar hoje

### O que muda para o negócio
O número da odonto **era da recepção**. Pacientes continuam mandando mensagem e
agora ela cai no CRM. Hoje, se o paciente manda **áudio ou foto**, ninguém
consegue ver nem ouvir — e a IA ignora.

### O que quebra se não fizer — o sintoma concreto
- Paciente manda **áudio** perguntando preço → bolha vazia. **A IA não responde.**
- Paciente manda **foto do dente ou do orçamento** → quadradinho cinza.
- Recepção tenta **responder por texto** → pode não sair.
- Recepção tenta **mandar foto** → não sai.
- Aviso vermelho de "credenciais faltando" que nunca some.

### Passos

| # | Peça | O que muda | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 1.1 | Enviar texto | **Nada no código.** Republicar | Baixo | Não | Não |
| 1.2 | Enviar mídia | Código pronto. Republicar | Baixo | Não | Não |
| 1.3 | Atendente IA | **Nada no código.** Republicar | Médio | Não | Não |
| 1.4 | `meta-webhook` | Baixa a mídia da Meta e guarda na nossa base (12 meses) | Médio | **Sim — espaço de mídia** | Não |
| 1.5 | Transcrever áudio | **Nada.** Passa a funcionar com o 1.4 | Baixo | Não | Não |
| 1.6 | Aviso de credenciais | Tira a exigência da chave do Zernio | Baixo | Não | **Sim** |
| 1.7 | Tela da conversa | Mostra imagem/áudio da nossa base | Baixo | Não | **Sim** |

### Como você testa
1. Publicar e esperar terminar
2. Pedir para **outro celular** (não o seu) mandar mensagem
3. **Conversas** → a mensagem tem que estar lá
4. **Responder por texto** → tem que chegar no celular
5. Pedir um **áudio** → a bolha tem que virar **texto transcrito** e a IA responder
6. Pedir uma **foto** → tem que aparecer
7. **Anexar foto** pelo CRM → tem que chegar
8. **Painel** → o aviso vermelho tem que sumir

### Esforço
**Médio.** O grosso é a guarda de mídia.

### Decisões suas
- **D1.1** — Autoriza criar o espaço de armazenamento de mídia de paciente?
  *Recomendação: espaço **fechado** (não abre sem estar logado), não o público
  que já existe. É dado de paciente.*
- **D1.2** — Expurgo aos 12 meses automático ou manual? *(Recomendo automático.)*
- **D1.3** — Autoriza republicar as funções?

---

## FASE 2 — O motivo do CRM existir: disparo + régua, com freio

### O que muda para o negócio
É aqui que os **63 orçamentos parados (R$ 67.525,88)** viram mensagem. Você
seleciona os pacientes, escolhe o modelo, define o ritmo, e o sistema manda —
devagar, no horário certo, parando sozinho se a Meta reclamar. E a **régua**
passa a cobrar quem não respondeu, sem ninguém lembrar.

### O que quebra se não fizer — o sintoma concreto
- Você monta a campanha, clica em **Disparar**, e **nada acontece**. Fica
  "enviando · 0 de 63" para sempre (é o que a campanha "Teste" faz hoje).
- Você cria uma régua e ela **nunca dispara**.
- A recuperação dos R$ 67.525,88 depende de alguém abrir 63 conversas na mão.

### Passos

| # | Peça | O que muda | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 2.1 | **nova** peça de envio de modelo | Peça única usada por 4 rotinas | Médio | Não | Não |
| 2.2 | **novo** freio de ritmo | Conta o que saiu, respeita horário, manda parar | **Alto** | Não* | Não |
| 2.3 | Disparo de campanha | Passa a mandar 1 a 1 pela Meta, com freio | **Alto** | Não | Não |
| 2.4 | Régua de follow-up | Reconhece o canal Meta | Médio | Não | Não |
| 2.5 | Tela de follow-ups | Grava "Meta"; opção UAZAPI sai | Baixo | Não | **Sim** |
| 2.6 | Assistente de campanha | Enxerga o canal da Meta | Baixo | Não | **Sim** |
| 2.7 | Tela de Disparos | Botão **Pausar** + linha "ritmo / teto do dia" | Baixo | Não | **Sim** |
| 2.8 | Tipos | Aceita "meta" | Baixo | Não | **Sim** |

\* Sem migração **se** o freio for por constante no código. Se quiser regular
pela tela, entra uma tabela nova — decisão D2.2.

### Como você testa

**Ensaio — obrigatório antes do disparo real:**
1. **Templates** → conferir que o modelo está **Aprovado**
2. **Contatos** → criar 2–3 contatos de teste (celulares que **nunca** falaram
   com a recepção)
3. **Disparos** → Nova campanha → modelo → só esses contatos → **Disparar**
4. **Cronometrar:** as mensagens têm que sair **espaçadas**, não todas juntas
5. Conferir contadores: enviado → entregue → lido
6. Clicar em **Pausar** no meio → tem que parar na hora
7. Agendar para 22h → **nada pode sair**

**Disparo real — só depois do ensaio:**
8. Dia 1: **25 pacientes**. Conferir no dia seguinte quantos responderam
9. Sem problema? Dia 2: mais 25. Dia 3: o resto

**Régua:**
10. Criar a regra → esperar o prazo → a segunda mensagem tem que sair sozinha

### Esforço
**Grande.** É a maior parte do plano. O freio e o disparador valem mais que
todo o resto somado.

### Decisões suas
- **D2.1** — Os números do freio: 1 msg a cada 20–40s, teto 25 no dia 1,
  8h–18h em dias úteis? Ou outros?
- **D2.2** — Freio no código (rápido, sem banco) ou na tela (você regula sozinho,
  exige tabela nova)?
- **D2.3** — Cadência da régua: D+1 / D+3 / D+7 / D+15 / D+30?
- **D2.4** — **Os textos dos modelos.** Nenhuma palavra vai para paciente sem
  sua aprovação — é publicidade odontológica. **Bloqueia o disparo real, não a
  construção.**
- **D2.5** — **Quem opera o CRM.** Campanha manda mensagem; alguém precisa
  responder quem responder.

---

## FASE 3 — Complementares

### O que muda para o negócio
Mover um orçamento de etapa **dispara mensagem sozinha**; a fila de recompra
volta a andar; e o quadro de saúde do número passa a mostrar dado real.

### O que quebra se não fizer
- Você arrasta o orçamento para "Aguardando decisão" e a mensagem automática
  **não sai** — erro em silêncio
- Continua um robô rodando a cada 2 minutos sem função

### Passos

| # | Peça | O que muda | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 3.1 | Automação de funil | Usa a peça única da Fase 2 | Médio | Não | Não |
| 3.2 | Recompra | Mesma troca | Baixo | Não | Não |
| 3.3 | Status de disparo | **Não migra — desliga** | Baixo | Não | Não |
| 3.4 | Saúde do número | Lê da Meta em vez do Zernio | Baixo | Não | **Sim** |
| 3.5 | Simulador de mensagem | Ajuste de texto | Baixo | Não | Não |
| 3.6 | Modelo "Pausado" | Hoje aparece como "Rejeitado", o que engana | Baixo | **Sim** | Não |

### Como você testa
1. **Funil** → criar automação numa etapa → arrastar um orçamento de teste →
   a mensagem tem que sair
2. **Disparos** → o quadro de saúde tem que mostrar o número e a qualidade
3. **Templates** → modelo pausado tem que aparecer como "Pausado"

### Esforço
**Médio** — baixa se a peça única da Fase 2 já existir.

### Decisões suas
- **D3.1** — Desligar o robô de status de disparo?
- **D3.2** — Migração que acrescenta o status "Pausado"?
- **D3.3** — Recompra faz sentido na odonto ou desliga? *Foi feita para
  infoproduto; aqui seria retorno/manutenção.*

---

## FASE 4 — Limpeza: tirar o Zernio e o UAZAPI

### O que muda para o negócio
A tela de Canais para de oferecer **três** provedores quando só um existe. Some
o botão de ligar um serviço **proibido neste projeto**.

### O que quebra se não fizer
- Três blocos na tela de Canais e só um serve — quem for mexer erra
- O **UAZAPI**, que você proibiu por risco de banimento, continua a **um clique
  de ser ligado**
- Endereços de webhook antigos seguem abertos na internet, sem uso

### Passos

| # | Peça | O que fazer | Risco | Migração? | Deploy? |
|---|---|---|---|---|---|
| 4.1 | Tela de Canais | Tirar as seções Zernio e UAZAPI | Médio | Não | **Sim** |
| 4.2 | Arquivos do UAZAPI | Remover | Baixo | Não | **Sim** |
| 4.3 | Arquivos do Zernio | Remover | Baixo | Não | **Sim** |
| 4.4 | 4 funções sem uso | **Desativar** (não apagar de cara) | Médio | Não | Não |
| 4.5 | Peças compartilhadas antigas | Remover depois que estabilizar | Médio | Não | Não |
| 4.6 | Chaves antigas na configuração | Tirar | Baixo | Não | **Sim** |
| 4.7 | Textos que chamam Zernio de "API Oficial" | Corrigir (~8 lugares) | Baixo | Não | **Sim** |
| 4.8 | Banco: travar o canal em "meta" | Trava definitiva contra o UAZAPI | Baixo | **Sim** | Não |
| 4.9 | `ODONTO.md` §7 | Reescrever: o canal é a Meta direto | Baixo | Não | Não |

### Como você testa
1. **Canais** → tem que sobrar **um único bloco**, o da Meta, com o número
   **ATIVO** e o selo verde
2. **Não pode existir** botão de conectar UAZAPI
3. **Follow-ups** → o formulário não pode mais oferecer UAZAPI
4. Mandar mensagem de teste e responder → tudo tem que continuar funcionando

### Esforço
**Médio.** Muito arquivo, quase tudo remoção.

### Decisões suas
- **D4.1** — Remover Zernio/UAZAPI do código ou só esconder da tela?
  *(Recomendo remover: regra escrita não impede um agente futuro de religar;
  código ausente sim.)*
- **D4.2** — Migração que trava o canal em "meta"?
- **D4.3** — Desativar e apagar depois, ou apagar direto? *(Recomendo desativar,
  esperar uma semana, apagar.)*

---

## 4. Tabela-resumo

| Fase | O que entrega | Esforço | Banco? | Publica? | Risco |
|---|---|---|---|---|---|
| **0 — Parar o sangramento** | Campanha travada some; robô para de girar | Pequeno | Não | Não | Baixo |
| **0.5 — 🔴 Identificar o paciente** | Um paciente = um contato | Médio | Talvez | Sim | Médio |
| **1 — Paciente escrevendo agora** | Responder, áudio transcrito, foto visível, IA | Médio | **Sim** | Sim | Médio |
| **2 — Motivo do CRM existir** | Disparo dos 63 **com freio** + régua | **Grande** | Talvez | Sim | **Alto** |
| **3 — Complementares** | Funil dispara, recompra, saúde do número | Médio | Talvez | Sim | Médio |
| **4 — Limpeza** | Uma tela só; UAZAPI eliminado | Médio | Talvez | Sim | Médio |

---

## 5. Riscos e como reduzir

| # | Risco | Gravidade | Como reduzir |
|---|---|---|---|
| **R1** | **Número restringido por volume** — aconteceu no CDT em 07/05/2026 | **Crítico** | Freio é pré-requisito, não melhoria. Ensaio com 3 contatos antes. Dia 1 limitado a 25. Botão Pausar sempre à mão |
| **R2** | **Publicar e não conferir** — já causou **dois incidentes**. 20 das 24 funções rodam o programa de 24/08 | **Alto** | Depois de cada publicação, comparar o código publicado com o local. Registrar a versão de cada função |
| **R3** | **🔴 Telefone sem o nono dígito duplica paciente** | **Crítico** | Fase 0.5, antes de qualquer campanha |
| **R4** | **Pacientes antigos da recepção podem não receber** | Alto | Na 1ª campanha, separar resultado entre pacientes antigos e novos |
| **R5** | **Ninguém olhando a caixa de entrada** | Alto | Definir a pessoa **antes** da Fase 2. Campanha sem atendente gera frustração pior que silêncio |
| **R6** | **Rodar `db:push` ou `/setup`** — reaplicaria as 93 migrations e quebraria o banco | **Crítico** | **Nunca rodar.** Migração vai uma a uma, com aprovação e reversão |
| **R7** | **Colisão de nomes no empacotador** | Médio | Todo apoio novo com prefixo |
| **R8** | **Texto sem aprovação** — publicidade odontológica é regulada | Alto | Nenhum modelo vai para paciente sem sua aprovação |
| **R9** | **Dado de paciente exposto** — foto/áudio por 12 meses | Alto | Espaço fechado, acesso por perfil, expurgo automático. Política de privacidade própria segue pendente |

---

## 6. O que NÃO está neste plano

- **Importar os 63 orçamentos** do WebDental
- **O relógio de "orçamento parado há N dias"** — é o motor da régua, mas é obra
  de **CRM**, não de canal de WhatsApp
- **Catálogo de procedimentos odontológicos**
- **Política de privacidade própria da clínica**
- **Unificação com o CRM de exames**
- **Instagram**
- **Renomear as colunas históricas com "zernio" no nome**

> ⚠️ **Leia com atenção:** este plano cobre o **canal de WhatsApp**. O **CRM de
> Odontologia em si** — funil, orçamentos, campos, relógio de estagnação,
> importação dos 63 — **ainda não foi construído**. São obras diferentes.

---

## 7. Ordem recomendada e por quê

**0 → 0.5 → 1 → 2 → 3 → 4.**

1. **Fase 0** é grátis e tira do ar um erro que roda 2.880 vezes por dia — e
   evita um disparo-fantasma quando a Fase 2 ficar pronta.
2. **Fase 0.5 antes de tudo que envolve campanha.** Sem ela, a campanha produz
   **dado sujo e conclusão errada**. É mais barato corrigir agora do que limpar
   63 contatos duplicados depois.
3. **Fase 1 antes da 2** porque já tem paciente escrevendo. Ligar o disparo em
   massa antes de conseguir ouvir um áudio é mandar 63 pessoas falarem com uma
   caixa surda.
4. **Fase 2 antes da 3** porque é o motivo do CRM existir. Automação de funil e
   recompra são conforto; recuperar R$ 67.525,88 é a razão do projeto.
5. **Fase 4 por último** porque limpeza antes de a coisa funcionar remove o
   caminho de volta.

**Portão entre as fases:** nenhuma fase começa antes de a anterior ser
**testada pelo Danilo, pela interface**, e registrada no `MEMORIA.md`.

---

## 8. Divergências encontradas em relação ao `MEMORIA.md`

1. **Campanha "Teste" ativa e travada** desde 06/09 15:04 — não constava no log.
2. **Enviar texto e enviar mídia ainda em versão 1** no momento da investigação.
3. **Status de disparo não precisa migrar** — precisa ser desligado.
4. **Enviar texto, atendente IA e "enviar texto" do funil não precisam de código
   novo** — só de republicação.
5. **Transcrever áudio não tem acoplamento ao Zernio** — falha por falta da
   mídia guardada.
6. **Falso alarme descartado:** suspeita de que gravações sem `org_id`
   quebrariam. Não quebram — há gatilho que preenche.

---

*Documento de planejamento. Nenhum código alterado, nenhuma função publicada,
nenhuma migração aplicada e nenhum segredo lido durante a elaboração.*
