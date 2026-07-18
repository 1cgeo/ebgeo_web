# Doutrina das skills

Referência curta que toda skill aponta. Os seis princípios completos estão em [`docs/doutrina.md`](../../docs/doutrina.md); a constituição ([`CLAUDE.md`](../../CLAUDE.md)) carrega a versão condensada. Aqui eles descem em gesto de skill.

Isto **guia, não tranca**: você é o agente que raciocina com estes princípios ao executar, não um script que os obedece cego. Mecanismo só na fatia irreversível; guia para todo o resto. Onde a regra operacional conflitar com um princípio, prevalece o princípio.

## Ao executar uma skill

**Ancore na realidade, não no eco** (princípio 2). Em software o mundo tem três vozes, e nenhuma é a prosa:

- **o código real** — não a documentação que o descreve, nem o comentário acima da função, nem o rascunho do próprio time. Prosa sobre código é hipótese; o arquivo é a fonte. Isso inclui a documentação deste repositório.
- **o teste** — não a intenção de quem escreveu. Um teste que passa com e sem o fix não prende nada.
- **o comportamento observado** — não o `exit 0`. Comando que "deu certo" não é o mesmo que efeito acontecido: confira a porta, a linha no banco, a resposta HTTP.

Não chancele a própria saída. Rodar o teste não é a mudança funcionar; escrever a doc não é a doc estar certa.

**Menor privilégio** (princípio 4). Dry-run antes de mutar, declare o raio de explosão, pare para confirmar o irreversível (apagar branch, dropar banco, publicar, push em repositório compartilhado). E não presuma aprovação: esclarecimento de escopo não é autorização para uma ação específica que você mesmo classificou como arriscada.

**Reflita contra o princípio.** Não é um portão a passar, é uma conferida: a saída honra a doutrina? Se desviei, por quê?

## O controle negativo

O gesto que operacionaliza o princípio 5 em software. Ao escrever um teste de regressão, **reverta o fix e confirme que o teste falha**. Sem isso não se sabe se o teste prende a correção ou se passa por acaso.

Já pegou teste inútil nesta base: um caso do gate de autenticação usava uma rota que relê o usuário por conta própria, e teria passado verde mesmo sem o middleware corrigido.

Se o controle negativo for caro ou impossível, **diga isso** em vez de omitir — um teste cuja força você não verificou é uma garantia que você não tem.

## Ao aprender com a execução

**Capture a correção** (princípios 1 e 6). O que você aprendeu, e sobretudo onde foi corrigido, vira learnings da skill **na hora**. O que não foi externalizado, considera-se perdido. Capture o conserto (o comando, a config, o gesto), nunca "a ferramenta Y não funciona" — isso fossiliza numa recusa.

**A forma mais forte de codificar é o teste.** Prosa descreve, teste impõe. Antes de escrever um learning, pergunte se cabe um teste de regressão; se couber, o teste é o learning e o texto só aponta para ele.

**Registre o evento no livro-razão** ([`livro-razao.md`](../../livro-razao.md)), uma linha. É o que torna a recorrência visível — o que o learnings, curado e podado, descarta. Correção que recorre significa que a guia não pegou: mude a abordagem, não só re-anote. Espelho, não placar.

## Estrutura de uma skill

```
.claude/skills/<nome>/
├── SKILL.md        # frontmatter (name, description) + o método
├── learnings.md    # o que funcionou, o que falhou, edge cases (LEIA antes, ATUALIZE depois)
│                   # Nasce no PRIMEIRO aprendizado real, não junto com a skill:
│                   # hoje só lint-wiki e retrospectiva têm um, e está certo assim.
│                   # Arquivo vazio criado por simetria vira ruído que se lê e
│                   # não ensina nada. Ausência aqui significa "ainda não houve",
│                   # não "esqueceram".
├── references/     # opcional: material de apoio carregado sob demanda
└── scripts/        # opcional: automação determinística
```

A skill encoda um **método**, não um catálogo de fatos, e é **nível-classe** (uma classe de tarefa), nunca um evento único: `depurar-sync`, não `consertar-bug-do-manage`.

## Quando criar ou atualizar

Percebeu processo repetitivo (em geral na 3ª vez, ou após resolver um erro difícil)? Proponha criar ou atualizar uma skill. Revisão de skill é **ativa**: a maioria das sessões com trabalho real rende ao menos um ajuste.

- Correção de estilo, tom, método ou verbosidade (inclusive frustração: "para de fazer X") é sinal de **primeira classe** e vai para a skill da tarefa, não só para a memória.
- Ordem de atualização: skill usada → skill guarda-chuva → arquivo de apoio → só então skill nova.
