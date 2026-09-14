# `cesium-viewshed.js`: a declaração e o aceite da reescrita

Aberto em 2026-09-14 pela decisão D9, item V3 (`docs/decisions/decisions-2026.md`), a partir de [`b10-fecho-proposta-2026-09-13.md`](b10-fecho-proposta-2026-09-13.md). O método do inventário e as armadilhas de medição estão em [`../wiki/inventario-de-vendors.md`](../wiki/inventario-de-vendors.md).

**A decisão foi: manter e DECLARAR enquanto isso, com a reescrita sobre a API pública como alvo, e com prazo a fixar pelo dono.** Não desofuscar, não reescrever por arrumação. Este documento é a metade declaratória, e o aceite escrito para quando o alvo for atacado.

## A declaração

`frontend/public/vendors/cesium/cesium-viewshed.js` são **154.710 bytes em 1.933 linhas**, carregados por injeção de `<script>` em `frontend/src/js/3d_models_viewer_tool/map_3d.js` e rodando **com os privilégios da página do produto**, ou seja, com a mesma origem, o mesmo `localStorage`, o mesmo cookie de sessão e o mesmo acesso ao DOM que todo o resto do EBGeo.

- **Sem autor, sem licença, sem URL, sem ano e sem versão.** Nada. As pistas de origem que sobrevivem apontam para uma coleção de plugins Cesium chinesa (o global UMD é `space`, os nomes de uniform estão em pinyin) e metade do arquivo é um sensor retangular conhecido da comunidade, aqui sem nenhuma atribuição. Num repositório PÚBLICO por decisão, código de terceiro sem licença explícita é, por padrão, todos os direitos reservados: essa metade é exposição jurídica e nenhuma revisão de código a resolve.
- **É OFUSCADO, e embelezado não é desofuscado.** Não há um único nome com significado no arquivo: 3.474 ocorrências de identificadores hexadecimais (849 distintos), um dicionário de proxy que transforma até o operador `==` em chamada de função, e vinte blocos de fluxo achatado. Ele entrou minificado numa linha só e uma semana depois alguém rodou um embelezador em cima; é daí que vem a indentação. A linha 1 sozinha tem 9.213 caracteres, porque é o shader GLSL inteiro em escapes. **Revisão humana linha a linha não é viável sem desofuscar antes, e ninguém neste projeto jamais leu este arquivo.**
- **É fork local**, com quatro commits nossos editados DENTRO do código ofuscado, um deles em cima da string do shader escapado. Não há upstream a que voltar nem versão a que comparar aviso.
- **Ele lê ONZE campos privados de `ShadowMap` do Cesium** para alimentar o shader à mão. Relidos em 2026-09-14 por caminho independente da medição anterior (busca por nome no arquivo, em vez da leitura do fluxo): `_shadowMap`, `_shadowMapTexture`, `_shadowMapMatrix`, `_lightPositionEC`, `_lightDirectionEC`, `_lightCamera`, `_isPointLight`, `_pointBias`, `_primitiveBias`, `_terrainBias` e `_textureSize`. Nada no Cesium promete nenhum deles. (Um décimo segundo, `_distance`, aparece 4 vezes e é ambíguo, porque o próprio viewshed tem um campo com esse nome; ele fica FORA da contagem de propósito, para que o número não cresça por leitura otimista.)
- **Os três remendos de `frontend/src/js/3d_models_viewer_tool/services/cesium-compat.js` existem só por causa dele**: o polyfill de `defaultValue` (removido do Cesium na 1.134, e o token aparece 11 vezes no arquivo ofuscado), a reescrita automática de GLSL ES 1.0 para 3.0 (o Cesium 1.138 usa WebGL2) e o `isDestroyed`/`destroy` injetados em `ViewShed3D` e `RectangularSensorPrimitive`. Desde 2026-09-14 essa é a única razão daquele arquivo: o irmão `cesium-measure.js` virou código da casa e não precisava de nenhum dos três.
- **O único atenuante que se pôde medir**: o arquivo não contém `eval`, `new Function`, `atob`, `String.fromCharCode`, `fetch` nem `XMLHttpRequest`. Isso limita o pior cenário e **não prova ausência de comportamento indevido**, porque um ofuscador reconstrói nomes por concatenação.
- **Ele já quebrou uma vez numa atualização do Cesium** e foi remendado de fora. O próximo bump repete o episódio, e a dívida tem juros: cada remendo novo aumenta a superfície que a reescrita terá de reproduzir.

## O que hoje é medido, e o que não é

Esta separação é o ponto, porque ela é o que impede um verde vazio no dia da reescrita.

**É medido**, e por transporte real contra o backend real: a ENTIDADE `viewshed3d`, criada, atualizada (altura, raio, ângulo horizontal e vertical) e apagada, com cada passo conferido no snapshot de `pullSync`. Isso vive em `frontend/tests/e2e-ui/browser-cesium3d-crud.spec.js` e em `frontend/tests/e2e-ui/browser-cesium3d.spec.js`, com o gêmeo sem browser em `frontend/tests/e2e/cesium3d.e2e.test.js`.

**Não é medido: nem um pixel.** Os três specs acima dizem, cada um em comentário, que o alvo é `viewer-only` e que o visualizador Cesium se auto-pula sem WebGL, então eles nunca constroem um `Cesium.ViewShed3D`. Não existe, neste repositório, um único teste que exercite o shader, a projeção ou a cor de área visível contra oculta. Quem trocar o motor e vir a suíte verde não terá medido o motor.

(`frontend/tests/unit/visibility-viewshed-custo.test.js` NÃO é sobre este arquivo, apesar do nome: ele mede a análise de visibilidade 2D sobre o DEM, em `analysis_tools/visibility_tool/`. Confundir os dois é o erro barato de cometer aqui.)

## O aceite escrito da reescrita

Uma reescrita sobre a API pública de `ShadowMap` só é aceita quando reproduzir, item por item:

**1. O contrato de construção, que hoje é o do vendor e não nosso.** `frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js` constrói `new Cesium.ViewShed3D(viewer, { cameraPosition, viewPosition, horizontalAngle, verticalAngle, distance })` para desenhar um viewshed guardado, e `new Cesium.ViewShed3D(viewer, { horizontalAngle, verticalAngle, distance, calback })` para o modo interativo. **A opção de callback se escreve `calback`, com um L, e o erro de digitação é do vendor**: quem reescrever e corrigir a grafia sem tocar no chamador entrega um modo interativo que nunca completa, em silêncio.

**2. Os campos que o chamador LÊ de volta do objeto**, depois do clique interativo: `cameraPosition`, `viewPosition`, `heading`, `pitch`, `horizontalAngle`, `verticalAngle` e `distance`. Os três últimos são lidos com `|| DEFAULT_VIEWSHED_PARAMS.x`, então devolver `0` num deles cai no padrão em vez de no valor pedido.

**3. O ciclo de vida.** `destroy()` chamável mais de uma vez sem derrubar a tela (o chamador já envolve em `try`), e `isDestroyed()`. Se a reescrita os implementar de verdade, os dois remendos de `patchPrimitiveLifecycle` em `cesium-compat.js` saem junto, e é essa saída que mede o ganho. O chamador também carimba `_wasSaved` no objeto: ou a reescrita aceita uma propriedade arbitrária, ou o chamador muda no mesmo commit.

**4. A regra do ângulo, que é a parte que parece cosmética e não é.** Um `ViewShed3D` só cobre 150 graus horizontais, e o chamador divide em dois ou três sub-viewsheds acima disso. **O shader do vendor compara com `>` estrito, então o pixel exatamente na costura passa nos dois sub-viewsheds e recebe `mix()` duas vezes**, o que aparece como uma faixa saturada. O chamador compensa reduzindo o ângulo de render em 1,5 grau por sub-viewshed. Se a reescrita usar `>=`, a compensação vira uma FRESTA visível; se usar `>`, ela continua necessária. Qualquer dos dois serve, desde que o valor de `renderAngle` mude no mesmo commit e a escolha fique escrita.

**5. A prova visual, porque nenhuma suíte a dá.** Uma captura do Playwright do visualizador 3D com um viewshed de mais de 150 graus sobre um tileset real, ANTES e DEPOIS, lida como imagem. Três coisas têm de bater: a área visível e a oculta nas mesmas cores, a costura entre sub-viewsheds sem faixa saturada e sem fresta, e a origem no mesmo ponto (o chamador recria o viewshed com 1,5 m de offset de altura depois do primeiro clique). Sem essa leitura, "a suíte passou" prova apenas que a entidade continua viajando pelo sync.

**6. O que NÃO precisa ser reproduzido**, declarado para que a reescrita não cresça sozinha: o sensor retangular (`RectangularSensorPrimitive`) que ocupa metade do arquivo não tem chamador em `frontend/src/`; só o remendo de ciclo de vida em `cesium-compat.js` o menciona. Confira antes de portar, e se a ausência de chamador se confirmar na data, ele não entra.

## O que decide o prazo

O gatilho natural é o **próximo bump do Cesium**: é ele que quebra o arquivo, e é nessa hora que o custo de remendar de fora e o de reescrever ficam comparáveis pela primeira vez. Até lá a dívida é declarada e não urgente. O prazo é do dono.
