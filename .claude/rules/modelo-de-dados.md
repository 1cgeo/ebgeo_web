---
paths:
  - "frontend/src/js/store/*.js"
  - "frontend/src/js/layers/**"
  - "frontend/src/js/features_tab/**"
  - "frontend/src/js/import_export/**"
  - "frontend/src/js/comment_tool/**"
---

# Modelo de dados: o que não coube no núcleo

A hierarquia, o metadado de sync, o getter síncrono e a trava de outro mapa ficam em [architecture.md](architecture.md) §Data Model, porque carregam em toda sessão. Aqui fica o resto.

- A camada ativa recebe feições novas; camadas emitem `LAYERS_CHANGED`.

- Projetos salvam como `.ebgeo`.

- Slide de briefing referencia modelo 3D por `modelId` (não `tilesetId`).

- **Comentário espacial** (colaboração): threads root/reply/resolve em `store/comment.operations.js`; `Shift+C` alterna a colocação.

- **A contagem de cores NÃO é sincronizada, desde 2026-09-21.** Ela é derivada das feições (`updateColorUsage` soma e subtrai, `performInitialColorAnalysis` recalcula do zero) e cada cliente a mantém sozinho, sob `color_usage_<id>`. Enquanto viajou, viajou com o NOME do mapa como chave, o retrato a regravava por nome e o leitor a migrava de volta para o id, num vaivém em que a atualização do colega nunca chegava. O servidor descarta a chave em silêncio se um cliente antigo a mandar. O irmão `mapBadgeColors` é escolha do usuário e continua viajando.

- **Dado temporal** (opcional, por feição): `temporalInicio`/`temporalFim` (janela de validade em epoch ms; ausente = permanente) e `trajetoria` (keypoints `{t, lng, lat}`; point/military_symbol/coordination_measure). A config temporal por mapa é persistida à parte.

**`transferLayerToMap` é COMPOSTA e fica FORA de `withMapDocument`.** Ela move ou copia uma camada inteira (registro mais feições) para outro mapa do atlas, e por isso awaita duas folhas que tomam a trava do documento cada uma na sua chave (`addFeatures` no destino, `deleteLayerFeatures` na origem). A fila de `frontend/src/js/store/document-lock.js` é FIFO e sem reentrância, então envolvê-la na chave da ORIGEM travaria a interface no passo de remoção, que é o último: o congelamento chegaria depois de o destino já ter o dado. Ela está na lista de compostos do cabeçalho daquele arquivo, e as camadas do destino são lidas e escritas pelo REPOSITÓRIO pela razão do getter síncrono ([architecture.md](architecture.md) §Data Model). **O lado da ORIGEM de um mover tem TRÊS desfechos, e o resultado nomeia cada um desde 2026-09-21** (`sourceEmptied`, `sourceMissing`, `sourceRefusal`): esvaziada; mapa de origem excluído por um par no meio do gesto, que não deixa duplicado nenhum; e esvaziamento RECUSADO com a origem viva (um par trava o mapa entre a escrita do destino e o esvaziamento), que deixa as mesmas feições nos dois mapas daquele cliente enquanto o servidor, que aplica o id conhecido como upsert que troca o mapa da linha, as tem só no destino. O esvaziamento é RELIDO, porque o retorno de `deleteLayerFeatures` é falso tanto na recusa quanto em "nada a remover". A frase mora em `transferOutcomeNotice` (`frontend/src/js/features_tab/layer-transfer-phrases.js`), e o que ela promete foi medido TRÊS vezes em 2026-09-21, cada medição desmentindo a anterior. Na primeira a divergência foi reconstruída à mão, depois de os recibos do mover assentarem, e a frase mandava recarregar. Na segunda a recusa foi injetada no instante certo e dirigida pela tela, e a origem se esvaziou SOZINHA em 0,5 a 2 s, porque o recibo de um `feature create` com intenção de mover traz a operação canônica com `previousMapId` e o autor a reaplica pelo caminho de entrada (`resolveLocalEdit`); mas a trava injetada existia só na memória do cliente, e o servidor, destravado, aceitou o mover. Na terceira o servidor estava travado DE VERDADE, que é o que a trava de um colega é, e ele RECUSOU: o gate dele confere também o mapa de ORIGEM de um mover (`pushOperations`, logo depois de `prepareFeatureMutation`, em `backend/src/modules/sync/sync.service.js`), o lote inteiro volta recusado em cerca de um segundo, a cópia no destino é desfeita, a camada continua cheia na origem e os problemas ficam na fila. O duplicado some sozinho nos DOIS desfechos, para lados opostos, e a frase diz os dois sem prometer qual. Duas lições de método que envelhecem devagar: uma reconstrução à mão mede o estado que ela monta, não o caminho que leva até ele; e uma trava injetada só no cliente mede o cliente, não o par cliente e servidor.
