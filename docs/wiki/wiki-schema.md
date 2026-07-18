# Schema da wiki

As regras perenes de **como** a wiki é mantida, separadas do diretório de páginas (que fica em [index.md](index.md)). Apontado pela constituição ([`CLAUDE.md`](../../CLAUDE.md)).

## Camadas

- **Fonte**: o **código**. Os 17 guias de integração e o antigo guia de deploy eram material bruto e foram absorvidos e removidos em 2026-07-18; não existe mais camada de documento intermediário, e nenhuma página deve citar uma.
- **Wiki**: estas páginas. O agente é dono e mantém.
- **Schema**: as regras abaixo.

Cuidado com o vão de verificação aqui: o teste de integridade só valida link para **arquivo** com extensão conhecida (`frontend/tests/unit/docs-integridade.test.js`), então link para diretório (como o `../guias/` que esta seção manteve por horas depois da pasta sumir) apodrece sem quebrar nada.

## O critério: o código já é a evidência

Esta é a regra que decide tudo o mais, e é o que distingue esta wiki de um vault de conhecimento comum. **O repositório está aqui do lado.** Qualquer leitor, humano ou agente, pode abrir o arquivo. Então uma página só se justifica onde a leitura do código **não** resolve.

**Teste antes de escrever qualquer parágrafo:** *um engenheiro competente, lendo o código, chegaria nisso sozinho em poucos minutos?* Se sim, não escreva, ou escreva uma linha apontando o arquivo. Prosa que reconta o código é pior que ausência: custa manutenção, apodrece a cada refatoração, e compete com o código pela autoridade (e perde, porque só o código executa).

**NÃO entra** (o código conta melhor):

- o que uma função faz, sua assinatura, seus parâmetros;
- lista de rotas, campos, colunas, tipos, eventos, dependências, estrutura de diretório;
- narrativa passo a passo de um fluxo que se lê seguindo as chamadas;
- shape de payload que o schema Joi ou a migração já declara.

**ENTRA** (o código não conta, ou conta caro demais):

- **por que** foi decidido assim, e **qual alternativa foi rejeitada**, a informação que o código apaga por construção;
- **a armadilha**: o que parece certo e está errado, especialmente onde o código convida ao erro (`permission === 'write' || 'owner'` parece completo e exclui o co-Gestor);
- **o contrato congelado**: o que não pode mudar, e o que quebra se mudar;
- **o não-óbvio que atravessa arquivos**: comportamento que emerge de 3 módulos e não está visível em nenhum deles isoladamente;
- **a divergência doc↔código já observada**, marcada com `[!CONTRADICAO]`;
- **o custo escondido**: por que a coisa é lenta, cara, ou tem limite que ninguém espera.

Regra prática de proporção: se uma página é majoritariamente descrição do que existe, ela está errada. Se é majoritariamente *porquê*, *cuidado* e *não faça X*, está certa.

- **Uma página por entidade ou conceito.** Não uma página por documento, nem por arquivo de código.
- O método do assistente (doutrina, guardrails) vive na constituição e nas skills, nunca aqui.

## Tipos de página

- **conceito**: um mecanismo ou ideia (`sync-crdt`, `permissoes-atlas`).
- **entidade**: uma coisa concreta do sistema (`atlas`, `streetview-360`, `operacao-de-sync`).
- **síntese** (prefixo `sintese-` no slug): conhecimento de segunda ordem que **cruza** páginas existentes: comparações, quadros de decisão, análises transversais. Crie quando uma comparação recorrente hoje vive espalhada. Seções: Comparação, Análise, Recomendações e Páginas comparadas (esta fechando o cross-link de volta).

## Forma

- Slug em **ASCII kebab-case, sem acento** (o slug é nome de arquivo; há teste que falha se houver acento dentro de um wikilink).
- No topo de cada página, **uma linha de resumo** de uma frase.
- Interligue as páginas com wikilink (colchete duplo em volta do slug). Todo wikilink precisa resolver para uma página existente; [`frontend/tests/unit/docs-integridade.test.js`](../../frontend/tests/unit/docs-integridade.test.js) falha se não resolver. O Claude Code não tem resolvedor nativo de wikilink (ele o resolve por grep), e é esse teste que devolve ao formato a verificabilidade que ele não tem sozinho.
- Ao afirmar algo sobre o código, **cite `arquivo:linha`**. Esses caminhos também são verificados pelo teste: renomeou o arquivo, o teste acusa.
- Teto prático: acima de ~300 linhas, divida. Página que ninguém relê inteira apodrece por partes.
- Sem em-dash na prosa; use vírgula, parênteses ou frases separadas.

## Contradição e verdito temporal

Quando uma informação nova conflita com a wiki, **classifique antes de sobrescrever**:

- `> [!CONTRADICAO AAAA-MM-DD] a página diz A, <arquivo:linha> faz B`: conflito **real**, pendente. A resolução exige a fonte primária, que em software é o **código**, nunca o eco de sessão. Ao resolver, apague o marcador.
- **Supersessão temporal**: o estado avançou (a versão mudou, o endpoint foi absorvido). **Não é contradição**: atualize o conteúdo e registre no `## Histórico` da página. Sem marcador.
- `> [!DEBATE AAAA-MM-DD] ...`: divergência **intencional** mantida (duas abordagens defensáveis). As duas ficam, com uma linha de racional. Não é pendência.

Só a `CONTRADICAO` pendente é erro que acorda o gate.

## Manutenção

- Antes de criar página, **procure parecida e funda** em vez de duplicar.
- **Órfã** (nenhuma página aponta para ela) e **duplicata** são os dois indicadores de higiene. A skill `lint-wiki` os detecta; a `retrospectiva` a chama na fase de poda.
- **Podar é parte da manutenção** (doutrina, princípio 6). Página que descreve o que não existe mais sai. Documentação desatualizada é pior que ausente, porque engana ativamente, e engana em dobro um agente, que a trata como verdade.
- O agente é bom **auditor** da wiki (achar órfã, contradição, duplicata) e arriscado como **autor** solto: página gerada sem ancoragem no código produz volume plausível e não verificado. Toda afirmação sobre comportamento deve apontar para o arquivo que a sustenta.
