---
name: coordenacao-multiagente
description: Protocolo para quando MAIS DE UM agente trabalha ao mesmo tempo no mesmo repositório, na mesma pasta ou no mesmo banco de dados. Use SEMPRE que o usuário mencionar que tem outra sessão aberta, outro agente trabalhando, "estou com dois agentes", "outro Claude está mexendo", trabalho em paralelo, frentes simultâneas — e também quando você encontrar arquivos alterados que não reconhece, commits que não são seus, ou build quebrado em arquivo fora do seu escopo. Define território, ritual de início e fim, regras de publicação e de banco, e um quadro de avisos em disco. Sem isso, um agente desfaz o trabalho do outro sem perceber.
---

# Coordenação entre múltiplos agentes

## O problema que isto resolve

Quando duas ou mais sessões de agente trabalham na mesma pasta, elas não se
enxergam. Não há canal entre elas: você não vê o que a outra faz, não é avisado
quando ela muda um arquivo, e não pode impedir uma ação dela.

Isso significa que **nenhum agente "gerencia" os outros**. O que existe é
previsibilidade — e ela vem de todos seguirem o mesmo protocolo, lido do disco.

O acidente típico não é dramático. É silencioso: um agente roda `git add -A`,
leva o trabalho pela metade de outra frente para produção, e ninguém percebe
até o site quebrar. Já aconteceu.

## Ritual de início — antes de qualquer coisa

Três comandos, sempre, antes de tocar em código:

```bash
git status          # o que as outras frentes deixaram em aberto
git log --oneline -8   # quem publicou o quê recentemente
cat AGENTES-ATIVOS.md 2>/dev/null   # quem está mexendo em quê agora
```

Se encontrar arquivo alterado que você não reconhece, **não conserte, não
reverta, não commite**. Pode ser trabalho em curso de outra frente. Pergunte ao
usuário.

Depois, **declare o que você vai fazer** no quadro de avisos (veja abaixo).

## O quadro de avisos: `AGENTES-ATIVOS.md`

Um arquivo na raiz do projeto onde cada agente anuncia o que está fazendo antes
de começar. É o mecanismo mais simples que funciona, porque todos compartilham
o disco.

```markdown
# Agentes ativos

| Frente | Desde | Mexendo em | Status |
|---|---|---|---|
| configuração | 07/09 14:20 | src/lib/import*.ts, banco | em curso |
| design | 07/09 13:30 | globals.css, components/ui/* | em curso |
```

Acrescente sua linha ao começar; remova ou marque "concluído" ao terminar. Se
outra frente já declarou o arquivo que você precisa, **pare e pergunte ao
usuário** — dois agentes no mesmo arquivo é a receita conhecida do desastre.

Se o arquivo não existir, crie.

## Território

Divida por **arquivo e responsabilidade**, não por assunto vago. Territórios que
funcionam na prática:

| Frente | Costuma ser dona de |
|---|---|
| **Design / interface** | estilos globais, componentes visuais, layout, ícones, temas |
| **Conteúdo / comercial** | textos, cópia da interface, templates de mensagem |
| **Configuração / infra** | banco e migrations, funções de servidor, integrações, APIs |
| **Produto / features** | telas e regras de negócio novas |

Quando um arquivo fica na fronteira — uma tela que tem lógica e visual — o dono
é quem **está mexendo na parte que importa** para a tarefa. Faça a alteração
mínima e avise no relatório: *"toquei em X, que é território da frente Y, e
alterei só a lógica; nenhuma cor ou estilo foi mudado"*.

## Publicar: a regra que mais evita estrago

**Nunca use `git add -A` ou `git add .`** quando há outras frentes ativas. Esses
comandos pegam tudo o que está na pasta, incluindo trabalho alheio pela metade.

Em vez disso:

```bash
git add caminho/arquivo1 caminho/arquivo2
git diff --cached --name-only    # confira o que vai
```

E antes de publicar, **liste ao usuário exatamente o que vai subir** e espere o
"pode". Ele é o único que enxerga as três frentes ao mesmo tempo — só ele sabe
se é hora.

Rode a verificação de build antes. **Se quebrar em arquivo que não é seu, não
conserte — relate.** Consertar código de outra frente costuma desfazer o
trabalho dela.

## Banco de dados: o ponto sem volta

Código se reverte com um comando. Banco não.

**Só uma frente aplica migração** — normalmente a de infraestrutura. As outras
**pedem**, não aplicam. Isso não é hierarquia: é porque duas migrações
concorrentes podem deixar o schema num estado que ninguém sabe desfazer.

Toda migração: arquivo versionado, aplicada uma a uma, **com a reversão escrita
antes de aplicar**, e registrada no arquivo de memória do projeto.

## Registro: como as frentes conversam através do tempo

Nenhum agente lembra da sessão anterior, e nenhum vê a sessão paralela. O
arquivo de memória do projeto é o único ponto de encontro.

Ao fim de toda sessão, **acrescente** (nunca reescreva):

```
### AAAA-MM-DD · [FRENTE: nome] · <título curto>
- Pedido: o que foi solicitado
- Feito: o que mudou de fato
- Arquivos: caminhos tocados
- Banco: migração aplicada (ou "nenhuma")
- Publicado: sim/não — e o que exatamente
- Não feito: o que ficou de fora e por quê
- Próximo: qual a próxima demanda
```

**Identificar a frente é o que torna o registro útil.** Sem isso, ninguém sabe
quem fez o quê, e a próxima sessão perde tempo investigando o próprio passado.

## Quando as frentes se chocam

**Descobriu que outra frente mexeu no seu arquivo?** Não desfaça. Veja o que
mudou (`git diff`), entenda se convive com o seu trabalho, e relate ao usuário.
Reverter trabalho alheio é o erro mais caro possível — apaga horas que você não
viu acontecer.

**Precisa de algo que é território de outra frente?** Peça ao usuário que
repasse. Ele tem contexto das duas.

**O usuário pediu algo que atravessa territórios?** Faça a sua parte, e liste
claramente o que falta e de quem é.

## Sinais de que o protocolo não está sendo seguido

Vale checar de vez em quando — e avisar o usuário se encontrar:

- Commits com dezenas de arquivos de assuntos diferentes → alguém usou `add -A`
- Arquivo seu commitado por outra frente → mesma causa
- Build quebrado em arquivo que ninguém assume
- Migração no banco que não está no arquivo de memória

Encontrar isso não é motivo para bronca — é motivo para lembrar o usuário de
colar o protocolo nas outras sessões. **Elas provavelmente nem sabem que existem
outras frentes.**

## O que dizer ao usuário logo no começo

Se ele mencionar que tem outros agentes rodando e o protocolo ainda não está no
projeto, seja claro sobre o limite e sobre a saída:

> "Eu não consigo comandar as outras sessões — elas são separadas e não me
> escutam. O que dá para fazer é os três seguirem o mesmo protocolo, lido do
> disco. Vou criar o quadro de avisos e o documento de território; cole nas
> outras sessões, porque hoje elas não sabem que você tem outras frentes
> abertas."

Prometer controle que não existe é pior que não ter controle nenhum: o usuário
relaxa a vigilância achando que alguém está cuidando.
