# Learnings — retrospectiva

O que funcionou, o que falhou, edge cases. Leia antes de executar; atualize depois.

## Funciona

- Ler o `livro-razao.md` **antes** de propor deltas: a recorrência muda o que vale gravar. Uma classe que aparece pela 2ª vez pede mudança de abordagem, não mais uma anotação.
- Priorizar contradição sobre novidade. Memória errada custa mais que memória incompleta, porque o agente age sobre ela com confiança total.

## Edge cases

- **Sessão longa com muitas correções minhas**: o impulso é gravar tudo. Não. O que entra na memória durável é o que vale para a *próxima* sessão; o resto é ruído que consome contexto para sempre.
- **Fato que só vale no branch atual**: não é fato durável. Ou vira decisão registrada (se for de rumo) ou não entra.

## A evitar

- Reescrever `MEMORY.md` inteiro (context collapse; ver a skill).
- Gravar estado ("fase X concluída"). O git sabe melhor e isso envenena decisões futuras.
- Gravar "a ferramenta Y não funciona" — fossiliza numa recusa. Grave o conserto.

## Rodada 2026-07-18 (revisão da wiki)

- **Fatiar geração por tema duplica conceito.** Seis fatias temáticas escreveram o mesmo conceito com slugs diferentes; dedupe por slug não vê duplicata semântica. Quem fatia precisa passar a lista de páginas já existentes para cada fatia, ou aceitar uma fase de fusão depois — e o detector Jaccard do `lint-wiki` é o que fecha a brecha.
- **Reescrita em massa por subagente regride o que não está no prompt.** A revisão melhorou muito a prosa e, sem que ninguém pedisse, encurtou as citações para o basename, quebrando a verificabilidade. Ao fanout de reescrita, declare explicitamente os invariantes de forma que não podem mudar.
- **Recorrência entre classes é sinal de constituição, não de skill.** `verificacao-fantasma` (3) e `teste-que-nao-prende` (2) tinham a mesma raiz — checagem que não checa. Anotar em learnings de skill não pegaria; virou seção própria no `CLAUDE.md`.
