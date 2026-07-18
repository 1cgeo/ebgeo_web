# Learnings — lint-wiki

## Funciona

- **Jaccard >= 0.45 como limiar de duplicata.** Calibrado nas 7 fusões reais da consolidação de 2026-07-18. Abaixo de 0.35 é vizinhança legítima; entre 0.35 e 0.45 exige julgamento.
- **Separar contradição histórica de contradição viva.** A primeira leva de auditoria acusou 125 erros, dos quais 117 eram contradições contra guias que tinham acabado de ser apagados. Ruído desse tamanho faz o relatório inteiro ser ignorado. O discriminante é a menção ao documento absorvido.
- **O aviso "não cita nenhum arquivo de código" é o detector de cobertura vazia**, não uma checagem de estilo. Ele pegou o caso em que a reescrita encurtou 1.054 citações para o basename (`sync.service.js:755`): o teste de integridade só casa caminho com prefixo conhecido, então passava **verde sem verificar nada** naquelas páginas. Aviso caindo de 34 para 14 foi a medida da reancoragem.

## Achados que o lint devolveu

- A auditoria de 2026-07-18 encontrou, entre as contradições sobre código vivo, um **bug real de permissão no frontend**: `project-picker.modal.js:370` fazia `perm === 'owner' || perm === 'write'`, escondendo "Renomear" do co-Gestor (`manage` está acima de `write`). Mesma armadilha que já tinha silenciado a presença de seleção no backend. **A revisão multi-agente de código não pegou; a wiki pegou.**

## Edge cases

- Página `index` e `wiki-schema` são estruturais e ficam fora das checagens de conteúdo (senão a `index`, que linka tudo, aparece como duplicata de todo mundo).
- Página de síntese naturalmente repete vocabulário das páginas que compara. Sobreposição alta entre duas sínteses do mesmo par é esperada.

## A evitar

- Tratar contagem de erro como métrica a zerar. Contradição pendente vale mais aberta e visível que fechada às pressas com a prosa em vez do código.
