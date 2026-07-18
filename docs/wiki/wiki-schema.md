# Schema da wiki

As regras perenes de **como** a wiki é mantida, separadas do diretório de páginas (que fica em [index.md](index.md)). Apontado pela constituição ([`CLAUDE.md`](../../CLAUDE.md)).

## Camadas

- **Fontes**: os guias em [`../guias/`](../guias/) e os documentos de arquitetura em [`../`](../). São o material bruto; a wiki é o curado.
- **Wiki**: estas páginas. O agente é dono e mantém.
- **Schema**: as regras abaixo.

## O que entra

- **Uma página por entidade ou conceito.** Não uma página por documento, nem por arquivo de código.
- A wiki é sobre o **domínio e a arquitetura do sistema** (o que é sync-CRDT aqui, como a permissão resolve, por que o atlas é JSONB). O método do assistente (doutrina, guardrails) vive na constituição e nas skills, nunca aqui.
- **Não duplique o que o código diz sozinho.** Lista de diretórios, assinatura de função e nome de dependência o agente deriva lendo o repositório. O que a wiki guarda é o que o código **não** conta: o porquê, a alternativa rejeitada, a armadilha, o contrato que não pode mudar.

## Tipos de página

- **conceito** — um mecanismo ou ideia (`sync-crdt`, `permissoes-atlas`).
- **entidade** — uma coisa concreta do sistema (`atlas`, `streetview-360`, `operacao-de-sync`).
- **síntese** (prefixo `sintese-` no slug) — conhecimento de segunda ordem que **cruza** páginas existentes: comparações, quadros de decisão, análises transversais. Crie quando uma comparação recorrente hoje vive espalhada. Seções: Comparação, Análise, Recomendações e Páginas comparadas (esta fechando o cross-link de volta).

## Forma

- Slug em **ASCII kebab-case, sem acento** (o slug é nome de arquivo; há teste que falha se houver acento dentro de um wikilink).
- No topo de cada página, **uma linha de resumo** de uma frase.
- Interligue as páginas com wikilink (colchete duplo em volta do slug). Todo wikilink precisa resolver para uma página existente — [`tests/unit/docs-integridade.test.js`](../../tests/unit/docs-integridade.test.js) falha se não resolver. O Claude Code não tem resolvedor nativo de wikilink (ele o resolve por grep), e é esse teste que devolve ao formato a verificabilidade que ele não tem sozinho.
- Ao afirmar algo sobre o código, **cite `arquivo:linha`**. Esses caminhos também são verificados pelo teste: renomeou o arquivo, o teste acusa.
- Teto prático: acima de ~300 linhas, divida. Página que ninguém relê inteira apodrece por partes.
- Sem em-dash na prosa; use vírgula, parênteses ou frases separadas.

## Contradição e verdito temporal

Quando uma informação nova conflita com a wiki, **classifique antes de sobrescrever**:

- `> [!CONTRADICAO AAAA-MM-DD] a página diz A, <arquivo:linha> faz B` — conflito **real**, pendente. A resolução exige a fonte primária, que em software é o **código**, nunca o eco de sessão. Ao resolver, apague o marcador.
- **Supersessão temporal** — o estado avançou (a versão mudou, o endpoint foi absorvido). **Não é contradição**: atualize o conteúdo e registre no `## Histórico` da página. Sem marcador.
- `> [!DEBATE AAAA-MM-DD] ...` — divergência **intencional** mantida (duas abordagens defensáveis). As duas ficam, com uma linha de racional. Não é pendência.

Só a `CONTRADICAO` pendente é erro que acorda o gate.

## Manutenção

- Antes de criar página, **procure parecida e funda** em vez de duplicar.
- **Órfã** (nenhuma página aponta para ela) e **duplicata** são os dois indicadores de higiene. A skill `lint-wiki` os detecta; a `retrospectiva` a chama na fase de poda.
- **Podar é parte da manutenção** (doutrina, princípio 6). Página que descreve o que não existe mais sai. Documentação desatualizada é pior que ausente, porque engana ativamente — e engana em dobro um agente, que a trata como verdade.
- O agente é bom **auditor** da wiki (achar órfã, contradição, duplicata) e arriscado como **autor** solto: página gerada sem ancoragem no código produz volume plausível e não verificado. Toda afirmação sobre comportamento deve apontar para o arquivo que a sustenta.
