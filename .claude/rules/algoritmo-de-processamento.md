---
paths:
  - "frontend/src/js/processing/**"
---

# Adicionar um algoritmo de processamento

1. Criar `src/js/processing/algorithms/<name>.algorithm.js`.
2. Campos da definição: `id`, `name`, `description`, `icon`, `category`,
   `supportedGeometryTypes` (array), `createPanel(deps)`, `execute(features, params)`.
   Typedef completo em `frontend/src/js/processing/algorithms/algorithm.interface.js`, exemplo em
   `frontend/src/js/processing/algorithms/buffer.algorithm.js`.
   **Nenhum deles é imposto, salvo o `id`, e um não é lido por ninguém.**
   `registerAlgorithm` (`frontend/src/js/processing/processing.constants.js`) valida
   presença e unicidade do `id` e nada mais: os demais faltam em silêncio, e o sintoma
   aparece só na tela que consome o campo (o cartão da aba lê `name`, `description` e
   `icon`; o executor lê `supportedGeometryTypes` e `execute`; o painel lê `createPanel`).
   `category` é o que não tem leitor: nada em `frontend/src/js/processing/` o lê. Preencha
   por convenção, e não gaste tempo procurando o agrupamento que ele deveria dirigir.
3. Chamar `registerAlgorithm({...})` no load do módulo **e** adicionar o import de
   efeito colateral `import './<name>.algorithm.js';` em `frontend/src/js/processing/algorithms/index.js`.
   Sem o segundo passo o módulo nunca é carregado e o registro nunca roda: não há
   erro, o algoritmo apenas não aparece.
4. Nada mais muda em lugar nenhum.
