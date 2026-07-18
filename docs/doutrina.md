# Doutrina do projeto EBGeo

A razão de ser da camada de memória deste repositório, e os seis princípios que a governam. A constituição ([`CLAUDE.md`](../CLAUDE.md)) carrega a versão condensada; aqui está o texto integral, com a exposição de cada princípio.

Adaptado do vault de doutrina do `chefe_dgeo`, cuja tese central transfere sem perda: **competência que não é codificada não compõe, ela zera**. Lá o risco é a troca de chefe ou de tropa. Aqui é a troca de sessão: um agente começa toda conversa do zero, e um humano esquece por que decidiu algo seis meses atrás. O ciclo é o mesmo (lição aprendida, revisão pós-ação, norma reescrita), em latência de máquina.

## Por que este repositório tem memória

Um monorepo de ~170 mil linhas com colaboração multiusuário em tempo real acumula conhecimento que não está no código e não se deriva dele:

- **O porquê das decisões.** O código mostra que a geometria do atlas é JSONB. Não mostra que PostGIS foi rejeitado deliberadamente, nem o que se perde ao reverter isso.
- **As armadilhas.** O código mostra o `CHECK` de cinco níveis de permissão. Não avisa que escrever `permission === 'write' || 'owner'` exclui o co-Gestor em silêncio, e que isso já aconteceu.
- **Os contratos congelados.** O código de hoje não distingue o que pode mudar livremente do que quebra o frontend se o shape mudar.

Esse conhecimento vive na wiki, nas decisões e nos learnings das skills. O que não é externalizado, considera-se perdido.

## Os seis princípios

Estão **acima** das regras operacionais da constituição: regra que conflitar com um princípio cede.

### 1. Competência só compõe se for codificada, nunca lembrada

Lição durável vira página de wiki, decisão registrada, learning de skill, regra na constituição ou — o melhor de todos — **teste**. O corolário prático em software: a forma mais forte de codificar uma lição é o teste de regressão que falha se ela for esquecida. Prosa descreve; teste impõe.

Uma correção que não gerou nem teste nem regra não foi codificada, foi anotada. Anotação sem gancho apodrece.

### 2. O laço se alimenta da realidade, nunca de si mesmo

A melhoria se ancora num desfecho que o **mundo** decidiu, nunca no eco de uma sessão. Em gestão isso é o documento assinado. Em software, o mundo tem três vozes:

- **o código real** (não a prosa que o descreve),
- **o teste que passa ou falha** (não a intenção de quem escreveu),
- **o comportamento observado no ambiente** (não o `exit 0` de um comando).

A regra que mais custa quando violada: **o código manda sobre a documentação.** Prosa sobre código é hipótese; o arquivo é a fonte. Isso inclui a prosa deste próprio repositório e a de sessões anteriores.

O agente nunca chancela a própria prova: rodar o teste não é o mesmo que a mudança funcionar, e "o comando saiu com sucesso" não é o mesmo que o efeito ter acontecido.

### 3. Plasticidade na periferia, rigidez no núcleo

Skills, wiki e memória são fluidos, reescritos livremente. O núcleo é fixo: a constituição, os contratos congelados do frontend, os guardrails de segurança, e o humano nas ações irreversíveis (apagar branch, dropar banco, publicar). Editar o núcleo exige aval explícito, nunca em silêncio.

### 4. Confiança é gradiente, ganho por tarefa e revogável

Autonomia se expande na velocidade da confiabilidade demonstrada e encolhe no instante em que ela falha. Operar por menor privilégio: dry-run antes de mutar, declarar o raio de explosão, parar para confirmar o irreversível.

### 5. Melhoria se descobre por seleção, não se decreta

Rodar experimentos pequenos e ficar com o que sobrevive ao contato com a realidade. Em software o experimento tem forma canônica: **o controle negativo**. Reverter o fix e confirmar que o teste falha é o que separa um teste que prende a correção de um teste que passa por acaso.

### 6. O direito de desaprender é tão sagrado quanto o de aprender

Deletar a regra morta, a página dormente, o teste que não testa nada e a memória apodrecida é parte da melhoria. Documentação desatualizada é **pior** que documentação ausente, porque engana ativamente, e engana em dobro um agente, que a trata como verdade e propaga o erro para o código.

## O humano no laço

O humano não se automatiza para fora. Ele assume dois papéis que o sistema não pode assumir por si:

- **A função de fitness** — o julgamento do que é bom, ancorado no produto e no usuário, não no sistema.
- **O ponto fixo** — a autoridade que protege o núcleo e autoriza o irreversível.

## Referências

- [`CLAUDE.md`](../CLAUDE.md): a constituição (versão condensada dos princípios + regras operacionais).
- [`../livro-razao.md`](../livro-razao.md): o espelho das correções.
- [`wiki/index.md`](wiki/index.md): a memória semântica.
- [`decisions/DECISIONS.md`](decisions/DECISIONS.md): o log de decisões.
- [`../.claude/skills/_DOUTRINA.md`](../.claude/skills/_DOUTRINA.md): como uma skill serve a esta doutrina.
