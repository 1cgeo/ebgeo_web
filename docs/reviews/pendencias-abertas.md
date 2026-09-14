# Pendências abertas do lançamento

Base: `3492c3dd`, branch `plano/bd`. Posição de 13/09/2026.

**Este é o único documento de trabalho que sobrevive em `docs/reviews/`.** O que já foi feito não está aqui, e nem deve estar: quem quiser saber o que mudou lê `git log`, e quem quiser saber POR QUE o produto funciona assim lê a wiki, que absorveu os mecanismos deste lote ([[diario-write-ahead]], [[lote-logico-de-gesto]], [[camada-padrao-remota]], [[pendencias-de-sincronizacao]], [[inventario-de-vendors]], [[presenca-administrativa]], mais as seções novas de [[fila-operacoes-outbound]], [[modelo-conflito-lww]], [[imagens-atlas]], [[coordenacao-entre-abas]], [[namespace-por-atlas]] e [[observabilidade]]). As decisões datadas estão em [decisões de 2026](../decisions/decisions-2026.md).

**O candidato continua sem liberação.** Nenhum item abaixo está concluído por estar documentado.

## Estado por bloco

| bloco | assunto | estado em 13/09/2026 |
| --- | --- | --- |
| B0 | instruções e documentos que enganavam quem retoma | fundido |
| B1 | op que apagava o mapa, e ops com mapa errado | fundido |
| B2 | baseline consolidada, checksum do migrador | fundido |
| B3 | fila, quarentena e a janela do dispatcher | fundido |
| B4 | persistência write-ahead dos demais produtores | fundido (quatro ondas) |
| B5 | conflitos por entidade e painel de resolução | fundido; resta o conteúdo do recibo e a comparação de geometria |
| B6 | comandos compostos e as quatro exceções REST | fundido; marcadores pelo nome, contratos do lote e cenários com estado do servidor fechados em 13/09/2026; só o conjunto grande fica fora, por D4 |
| B7 | abas, logout, gerações e migração da main | fundido; quarentena da varredura de boot, reconciliação no boot do slot e faixa legada 1.3 a 1.7 fechadas em 13/09/2026 |
| B8 | uploads duráveis | fundido; D7 respondida e implementada, resta a prova em duas browsers |
| B9 | indicadores e administração | fundido; resta a validação com telemetria real |
| B10 | segurança e dependências | inventário reproduzível por script; autorização revisada (A1..A15); **fecho aguarda o dono** (V1..V8) e o SHA candidato |
| B11 | homologação final e migração da main | **aberto**; os dois cenários de config dedicada rodaram e ficaram verdes em 13/09/2026 |
| B12 | liberação interna e retorno | **aberto**, depende de B11 e de responsável na rede interna |

## Decisão do dono, respondida

**D7. Reuso de imagem por conteúdo, sem chave de tentativa: ESTREITAR.** Respondida em 13/09/2026 e já implementada, então esta seção deixou de ser pendência e fica como registro de onde a regra mora. A rota única de imagem reusa linha existente **apenas** sob chave de tentativa; sem chave, bytes iguais criam linha nova e arquivo novo. A rota de lote não mudou: mantém o reuso quando o id local coincide e o conteúdo é o mesmo, e recusa id local igual com conteúdo diferente. O que a escolha comprou foi a resposta honesta (os mesmos bytes sob nome novo voltavam com o nome antigo) e o fim da linha compartilhada por duas feições, que a exclusão física do módulo tornaria perda; o que ela custa é uma linha e um arquivo a mais por reenvio sem chave. Registro em [decisões de 2026](../decisions/decisions-2026.md); regra em [[imagens-atlas]].

## Pendências por bloco

### B5, conflitos

1. **Comparação visual de geometria.** Onde mora: `frontend/src/js/account/pendencias/pendencias-panel.js` e `frontend/src/js/account/pendencias/pendencias-rows.js`. O que falta: a linha de conflito de feição nomeia a unidade em disputa e mostra o motivo, e não há onde ver a diferença entre a geometria local e a do servidor. Ela DEPENDE do item 3 abaixo: o conflito de entidade que não é feição devolve `serverData` nulo, então metade do par a desenhar não chega ao cliente. Aceite: duas geometrias na tela, com a decisão explícita entre elas, e o caso de recusa repetido depois de F5.
2. **`map` e os cinco subtipos não declaram base.** Onde mora: `frontend/src/js/store/sync/mutation-contract.js` e os sítios de escrita de `frontend/src/js/store/map.operations.js`. O que falta: a declaração é lida de `previousData`, e aqueles sítios registram o campo mudado, nunca o documento; ler o documento ali custaria a leitura do mapa inteiro, feições incluídas, numa operação que hoje não lê nada. A saída barata é o recibo canônico do item 3. Aceite: uma edição de mapa contra base velha recusada nomeando a unidade, com o contraste de mapa do repro de revisão por entidade deixando de ser contraste.
3. **Conteúdo do recibo: operação canônica por entidade.** Onde mora: `backend/src/modules/sync/sync-receipts.js` e `backend/src/modules/sync/entity-conflicts.js`. O que falta: hoje o ack traz a revisão da entidade sem operação canônica, porque publicar um canônico sem serializador seria devolver o documento do remetente com aparência de aval do servidor. Aceite: o painel consegue mostrar o "estado atual permitido" sem inventá-lo, e os itens 1 e 2 destravam.
4. **O servidor deriva as unidades do PAYLOAD, não do `patch`.** Onde mora: `declaredUpdateColumns` (`backend/src/modules/sync/entity-conflicts.js`). O que falta: precisão de unidade também para as entidades cujo cliente envia documento inteiro. A alternativa, estreitar o payload no cliente, só é segura depois que cada entidade tiver canônico, senão o par que recebe a transmissão perde os campos ausentes na substituição em bloco. Aceite: dois clientes editando campos distintos de uma camada convergem sem recusa.
5. **A forma array de camada de catálogo não é verificável por base.** Onde mora: o ramo de conflito de `catalog_layer` em `backend/src/modules/sync/sync.service.js`. Ela escreve a linha VIVA com o que carrega e não endereça uma linha só. O replay literal é barrado pelo recibo; o fora de ordem, não. **Nenhum cliente vivo a emite**, e é por isso que ela é pendência e não defeito. Aceite: ou a forma sai do servidor, ou ela ganha endereçamento por linha.
6. **Linha que NÃO EXISTE continua sendo acked como aplicada** num update. Onde mora: o caso final de `backend/tests/integration/sync-service-coverage.test.js`, que mede o comportamento atual de propósito. O log de operações é expurgável, então ausência não prova exclusão, e recusar por ausência transformaria todo par create/update fora de ordem numa recusa permanente. Aceite: só muda junto com uma fronteira durável por entidade que distinga "nunca existiu" de "existiu e foi-se".

### B6, comandos compostos

1. **Conjunto grande continua fora, por decisão registrada (D4).** Preparação durável com ativação no fim é para importação grande. O que existe hoje é a recusa com motivo acima do teto, dos dois lados (o cliente nem viaja). Aceite: se voltar ao escopo, estado preparado no servidor com ciclo de vida próprio, cancelamento e identidade estável, sem apresentar parcial como concluído.
2. **Fechada em 13/09/2026: o tipo publicado dos três marcadores.** A restrição ("um commit dos dois pacotes só depois de o cliente atualizado estar em campo") caiu por D6: a linha nunca foi implantada. `recordStructuralMarker` publica cada exceção pelo nome dela, o cliente lê a lista na folha `frontend/src/js/store/sync/structural-markers.js`, e o espelho é preso por `frontend/tests/unit/marcador-estrutural-espelha-backend.test.js` e por `frontend/tests/e2e/marcador-estrutural.e2e.test.js`. Armadilha registrada: o marcador do MERGE não passa por `recordStructuralMarker`.
3. **Fechada em 13/09/2026: os contratos de ponta a ponta do lote lógico.** Falha injetada no primeiro, no intermediário e no último membro em `frontend/tests/e2e/lote-logico.e2e.test.js`, e a metade da fila em `frontend/tests/e2e/lote-recusado-fila.e2e.test.js` (nada desenfileirado, problema durável com `batchId` e `batchFailedOperationId`, a rodada seguinte não reenvia).
4. **Fechada em 13/09/2026: os cenários com estado do SERVIDOR**, em `frontend/tests/e2e/lote-estado-do-servidor.e2e.test.js`. Quatro medições que contrariam o enunciado anterior: só `maps.locked` é gate (camada travada é escrita normal); "destino excluído" tem duas portas com frases diferentes; permissão alterada responde 403 da ROTA, que não é recusa permanente, então o flush lança e o gesto sai inteiro quando a permissão volta; "bloqueia as seguintes da mesma entidade" é literal por `entityId` mais o `mapId` quando o bloqueado é o mapa.

### B7, abas e recuperação

1. **Fechada em 13/09/2026: a fila órfã da varredura de boot ganha cópia de quarentena.** `preserveSweepQuarantine` (`frontend/src/js/store/remote-atlas.api.js`) roda a mesma cópia conferida por releitura antes de `purgeAllRemoteAtlases` destruir; recusa é por entrada, sem prazo, e a entrada recusada sai da lista do aviso de desmontagem. Guarda em `frontend/tests/unit/remote-atlas-api.test.js`.
2. **Corridas de duas browsers REAIS não foram medidas.** Onde mora: `frontend/tests/integration/barreira-de-logout-entre-abas.test.js` usa um lock de verdade tomado fora do módulo sob teste, no mesmo processo, e a fiação do envio no laço de flush é asserida por leitura de fonte. Aceite: duas abas editando durante o diálogo de logout, em série, com a taxa relatada, e `retries: 0` no caso que mede corrida.
3. **Fechada em 13/09/2026: a reconciliação de ponteiros roda também no boot do slot.** `mountSlotScope` (`frontend/src/js/store/local-atlas.api.js`) reconcilia antes de ativar, cobrindo boot, troca e a queda para outro slot; custo medido de UMA leitura a mais no `ebgeo_global` para slot sem geração. Guarda em `frontend/tests/integration/reconciliacao-no-boot-do-slot.test.js`.
4. **A remoção da chave de época não fecha TODO escritor.** Onde mora: `frontend/src/js/store/remote-write-fence.js`. Ela fecha quem capturou um registro existente; quem nasceu antes de qualquer registro lê o mesmo valor nos dois estados, e quem o impede de recriar os bancos é o freio de desmontagem. Duas tentativas de fechar isso dentro do fence foram revertidas, e uma delas fazia o controle negativo DO FREIO parar de reproduzir. Aceite: qualquer conserto novo mantém aquele controle negativo reproduzindo.
5. **Houve uma falha transitória no ensaio BroadcastChannel entre a aba do mapa e uma aba nova**, e passar no rerun não encerrou essa matriz. Aceite: a matriz repetida em série, com taxa.
6. **O caminho de poda entrou (D8) e a tela nova foi capturada e lida; o ESPAÇO das duas cópias continua sem medida.** Onde mora: `pruneAbandonedCopies` e `dropLegacySource` (`frontend/src/js/store/migration/legacy-cleanup.js`), mais o comando na tela de recuperação. A decisão de 13/09/2026 poda as cópias abandonadas com uma reserva, recolhe a restauração morta por prazo e tira a origem só por decisão explícita, com a contagem de registros na confirmação. As três imagens do comando (desenhado, confirmação nomeando 6 registros, recusa por estado com o botão ainda desenhado) foram lidas em 13/09/2026 e o spec temporário saiu no mesmo commit. O que segue aberto: o espaço em disco das duas cópias medido sobre um acervo real (a única medição existente é a de tempo, de 41 registros com um blob de 8 MiB). Aceite: o espaço das duas cópias nomeado em número.
7. **Não há limite máximo seguro de acervo medido para a transição.** Onde mora: `frontend/src/js/store/migration/legacy-transition.js` (cópia por unidades limitadas) e `frontend/src/js/store/migration/recovery-archive.js` (arquivo em memória). A única medição existente é de 41 registros com um blob de 8 MiB: 5,68 s para copiar, migrar e verificar. Aceite: memória, tempo e espaço medidos com acervo de centenas de MiB, e um comportamento definido acima do limite (progresso, recusa ou fluxo em partes).
8. **Fechada em 13/09/2026: a faixa legada 1.3 a 1.7 tem um caso por FORMA.** As versões se distinguem pelas lacunas cumulativas que `legacy-backfills.js` preenche, não pelo carimbo, e a cobertura anterior era vazia (mesmo acervo com números trocados). Cinco casos em `frontend/tests/integration/degrau-3.0-entradas-da-transicao.test.js`, cada um bootando duas vezes; versão sem suporte abre recuperação e exportação, medido.

### B8, uploads

1. **A chave de tentativa da rota única não tem chamador no cliente.** Onde mora: `backend/src/modules/images/images.service.js` (que já a lê do cabeçalho de idempotência) e `frontend/src/js/store/sync/api-client.js` (que não a envia). O cliente usa a rota bulk, cuja identidade de tentativa é o próprio id local, então isto não é defeito alcançável: é uma porta do servidor sem usuário. Aceite: se a rota única voltar a ser usada, a chave viaja.
2. **A prova em duas browsers de que o par abre a imagem depois da retomada.** Onde mora: `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js`. Aceite: o par lê o BLOB pelo servidor, e não `map.hasImage`, que responde verdadeiro também quando o 404 instalou o marcador de erro.
3. **Validação de acesso do colaborador ao recurso é do SERVIDOR**, e não deste bloco: quem responde é o gate da rota de imagem. Fica registrado para que ninguém a procure no cliente.

### B9, indicadores

1. **A validação com telemetria real na rede interna continua pendente.** Onde mora: `frontend/src/js/account/sync-status.control.js`, `frontend/src/js/session/pendencias-monitoramento.js` e o painel de presença do administrador. Aceite: duas abas do mesmo usuário, visitante anônimo, logout, expiração e perda da telemetria produzindo contagens coerentes, com captura do Playwright inspecionada.
2. **A sonda de disponibilidade ainda não foi INSTALADA na rede interna.** O script, o roteiro e o leitor existem (`backend/scripts/sonda-disponibilidade.js`, script npm `diag:sonda`, e o sub-bloco do resumo). Aceite: a sonda rodando em host separado dentro da rede, com o diretório de saída alcançável pelo backend, e o bloco de indisponibilidade publicando medições ao lado de indisponíveis.

### B10, segurança e dependências: o FECHO

O inventário está feito e mora em [`docs/seguranca/dependencias-lancamento-inventario.json`](../seguranca/dependencias-lancamento-inventario.json); o método e as armadilhas estão em [[inventario-de-vendors]]. O que falta é tudo o que só se faz sobre o SHA candidato:

1. **Fixar o SHA candidato e refazer o inventário sobre ele** (agora por `node scripts/inventario-de-vendors.mjs --check`, preso por `frontend/tests/unit/inventario-de-vendors.test.js`; as propostas V1..V8 para os itens 2, 3, 4 e 6 estão em [`docs/seguranca/b10-fecho-proposta-2026-09-13.md`](../seguranca/b10-fecho-proposta-2026-09-13.md) e aguardam o dono). O manifesto existe para que essa conferência seja um diff, e não uma busca. Compare o hash NORMALIZADO para LF, nunca o bruto.
2. **Consultar avisos oficiais datados sobre esse SHA** e classificar por versão afetada, exposição real, runtime contra build contra teste, correção disponível e impacto. Registrar data e fonte. Não repetir como atuais contagens históricas de alertas.
3. **Resolver os cinco itens sem versão determinável, ou registrar decisão e responsável para cada um:** o three de `frontend/src/vendor/three/` (revisão 164dev, sem par publicado); `frontend/public/vendors/cesium/cesium-measure.js` e `frontend/public/vendors/cesium/cesium-viewshed.js` (sem upstream conhecido, carregados em runtime pelo visualizador 3D); as bibliotecas nativas dentro do WebAssembly do GDAL além das três legíveis; a imagem Docker efetivamente em execução no servidor interno; e o sistema operacional dessa imagem.
4. **Levar a fixação do digest ao dono**, com construção de prova, e registrar o digest da imagem que de fato roda. Fixa-se o digest do ÍNDICE, não o de uma plataforma.
5. **Feita em 13/09/2026, a revisão de autorização depois de B6** (achados A1..A15: a trava do mapa não alcançava a membresia de grupo, corrigido; teto de sockets por principal, `WS_MAX_SOCKETS_PER_PRINCIPAL`; ordem do gate de upload presa por teste). Ficam para o dono: recibos de sync nunca purgados, socket aberto que não cai na expiração do JWT, nenhuma cota de atlas por conta. O enunciado original era: as quatro exceções REST criam entidade fora do log; mais acesso a uploads, recibos e sockets após revogação, expiração e limites de recursos.
6. **Decidir sobre os vendors sem consumidor** (dois arquivos grandes do Cesium, dois builds auxiliares do GDAL, quatro dos cinco arquivos do three). Podar encolhe a superfície a auditar sem tocar em comportamento, e é decisão do dono, porque `frontend/public/vendors/` é caminho frágil.

Aceite do bloco: nenhuma vulnerabilidade crítica ou alta aplicável e explorável sem correção ou mitigação demonstrada; instalação limpa reproduzível; decisão e responsável para cada risco restante. Zero alerta de `npm audit` sozinho não encerra a tarefa, e o inventário completo também não: ele descreve o que existe, não o que é seguro.

## B11, homologação final e migração da main

### O que rodar antes da matriz

1. **Feito em 13/09/2026: os dois cenários de config dedicada têm script** (`test:e2e:atlas` e `test:e2e:migracao`, na raiz e no frontend) **e rodaram**: migração externa 11 de 11 verdes sobre CÓPIA dos cinco arquivos de `_ebgeo_dados_teste`; atlas-safety 3 de 3 verdes depois de um defeito de produto que só ele media (a troca ao vivo de atlas de servidor para slot local deixava o mapa em modo de visualização, valendo desde 25/08/2026; corrigido em `frontend/src/js/ui/view-mode.controller.js`). Ler `test:e2e:ui` verde como cobertura da migração continua leitura errada: esses dois não rodam ali.
2. **As capturas e specs escritos em 13/09**, rodando de dentro de `frontend/`:
   - as DUAS capturas temporárias (a luz de sync com os estados novos, e o painel de pendências) foram executadas em 13/09, as sete imagens foram LIDAS e os dois specs foram apagados no mesmo commit, que é o contrato deles. O que a leitura mostrou está no corpo daquele commit, e o que ela achou de aberto está adiante nesta seção;
   - o caso novo de `frontend/tests/e2e-ui/browser-collab-lock.spec.js`, que trava PELO CONTROLADOR e espera o Editor ler o mapa travado (os specs anteriores travavam pela op crua e por isso travavam só o próprio cliente): EXECUTADO em 13/09, verde em 4 de 4 rodadas em série;
   - `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js`: EXECUTADO na terceira passada, verde em 13,3 s.
   Ler a contagem de `flaky` ANTES de declarar verde: com `retries: 1`, um caso que flakeia é um caso não verificado.
3. **Lembrar que `browser-collab-mega.spec.js` não roda na rodada normal** (tem script próprio), então "`test:e2e:ui` verde" não é "a pasta inteira passou".

### A segunda passada (13/09): a classificação caso a caso

O que esta subseção acrescenta, e que a lista de vermelhos sozinha não dá: **de quem é cada vermelho**. Uma rodada de Playwright com 25 falhas parece um produto quebrado; classificada contra a base, ela vira quatro coisas diferentes, e só uma delas é trabalho de produto. A comparação foi feita entre o candidato da fase (worktree `plano/p3`) e a base `8309b289`, o HEAD do handoff da véspera, nas duas com `--retries=0` onde a série exigia.

**Os logs íntegros ficam FORA do repositório**, no scratchpad desta sessão (playwright-p3.log para o candidato e playwright-base.log para a base, mais bisect-atlas-url.log, bisect-desempenho.log e run6-correcoes.log), sob `C:\Users\diniz\AppData\Local\Temp\claude\C--Users-diniz-OneDrive-Desktop-Desenvolvimento-ebgeo-web\4e3dcad5-ce1e-4f23-8f1d-31b26fe68867\scratchpad`. Eles somem com a sessão: o que sobrevive é esta tabela, e é por isso que cada linha carrega a evidência em vez de apontar para o log.

**As quatro classes**, porque a mesma cor de vermelho pede quatro trabalhos diferentes:

- **a, defeito de produto do candidato.** Vermelho no candidato, verde na base, com o commit culpado achado por bissecção. É o único que impede liberar.
- **b, pré-existente.** Vermelho nas DUAS bases. Não é regressão desta fase, e é exatamente o que a homologação B11 ainda precisa fechar antes da matriz.
- **c, desatualizado por contrato.** O spec mede o produto de ANTES de uma mudança deliberada desta fase. O conserto é no spec, e afrouxar a asserção seria trocar a verificação pelo verde.
- **d, ambiente ou instrumento.** O vermelho é do aparelho de medir (asset que o git não versiona, recurso compartilhado, corrida do harness), não do produto nem do contrato.

#### Classe a: os dois defeitos de produto de hoje

Os dois estão **em conserto por outro agente**; nenhum dos dois foi consertado nesta linha.

| caso | candidato | base `8309b289` | evidência |
|---|---|---|---|
| `frontend/tests/e2e-ui/desempenho-do-boot-do-mapa.spec.js`, "transicoes" | vermelho 3 de 3 | verde 3 de 3 | `[local-para-remoto-1] o mapa do atlas nao ficou ativo (mapa local e chaveado pelo nome, mapa de atlas por UUID)`, em `frontend/tests/e2e-ui/helpers/peso-de-boot.js`. Bissecção: `9ebc3352` verde 3 de 3, `15527549` vermelho 3 de 3, logo o primeiro ruim é **`15527549`** (mapa-base e posição registrando a intenção antes de gravar). |
| `frontend/tests/e2e-ui/browser-atlas-url.spec.js`, "logged out: prompts login, then resumes straight to the atlas" | vermelho 3 de 3 | vermelho 1 de 3, MESMO sintoma | `Expected: "Mapa Único" / Received: "Mapa 1"`: depois do login o mapa do atlas do deep link não vira o ativo. Bissecção por TAXA: `490345de` 0 de 3, **`bc797944`** 2 de 3, `b502dc98` 2 de 3. |

**A segunda linha não é regressão limpa, e a ressalva é a metade que importa.** A base já falhava 1 em 3 com o mesmo sintoma, então `bc797944` (época e geração espelhadas no IndexedDB global) **agravou** uma corrida que já existia, em vez de criá-la. Tratá-la como regressão nova manda o conserto para o lugar errado; tratá-la como pré-existente deixa passar uma piora medida. Quem for fechá-la precisa de série, nunca de rodada única: uma medição de algo probabilístico não é medição.

#### Classe b: os pré-existentes, que são o que B11 ainda tem de fechar

Vermelhos nas duas bases. Nenhum deles é desta fase, e nenhum foi tocado por esta linha.

| caso | sintoma (candidato) | sintoma (base) |
|---|---|---|
| `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, A0b | `a aba ativou o mapa do atlas` (a segunda aba não ativa o mapa do atlas dela) | idem |
| `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, A2 | `o ponto está no namespace de X` (o controle negativo do bloqueio não fecha) | idem |
| `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, A3b | `a aba ativou o mapa do atlas` | `antes do logout, o ponto está no namespace do atlas` (cai uma etapa antes) |
| `frontend/tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js`, B1 e B2 | `a aba ativou o mapa do atlas` | idem |
| `frontend/tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js`, B3 | `a aba ativou o mapa do atlas` | `antes do logout, o ponto está no namespace de X` |
| `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js`, grupo de TRÊS | o par ainda enxerga a feição apagada depois de 10 s | idem |
| `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js`, grupo de DUAS | `expect(received).toBeNull()` (o grupo não se dissolve no par) | idem |
| `frontend/tests/e2e-ui/browser-two-client-broadcast.spec.js` | A vê o próprio eco (`sawOwnFeature` verdadeiro) | idem |
| `frontend/tests/e2e-ui/envio-do-acervo-herdado.spec.js`, os TRÊS casos | `expect(locator).toBeVisible() failed` | idem |
| `frontend/tests/e2e-ui/troca-viva-de-atlas-medida.spec.js` | `page.waitForFunction` estoura em 60 s | idem |
| `frontend/tests/e2e-ui/aparencia-atravessa-trocas-de-atlas.spec.js` | igualdade de aparência falha na volta | `page.waitForFunction` estoura em 30 s (cai antes) |
| `frontend/tests/e2e-ui/browser-logout-clears-map.repro.spec.js` | `nenhum traço da feição do servidor nas sources vivas após o logout` | `AbortError: As pendências desta sessão foram descartadas` (cai antes) |

**Quatro linhas caem em pontos DIFERENTES nas duas bases**, e isso não é detalhe de relatório: quando o candidato falha mais tarde que a base, parte do caminho foi consertada e o vermelho que sobra é outro defeito. Quem for fechá-las tem de reproduzir na base antes de atribuir a causa ao código de hoje.

**Dois casos de grupo desta classe JÁ FECHARAM**, e ficam registrados porque o padrão é o que vale: `frontend/tests/e2e-ui/browser-group-lifecycle.spec.js` e `frontend/tests/e2e-ui/browser-group-ops.spec.js` estavam vermelhos nas duas bases (o 426 de `assertSyncProtocol` por envelope cru sem `protocolVersion`, e o link fantasma que deixou de ser engolido em silêncio), foram corrigidos em `13025f4a` e a re-execução deu verde 3 de 3 (run6-correcoes.log).

**E CINCO casos que a base reprovava passaram no candidato**, o que só se vê comparando: os três primeiros de `frontend/tests/e2e-ui/browser-collab-crdt-conflict.spec.js` (recolor concorrente, sobrevivência ao F5 e move concorrente), `frontend/tests/e2e-ui/browser-f5-reconnect-map.repro.spec.js` e dois casos de `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js` (A0c e A1). Ler a contagem de falhas sem comparar contra a base conta o candidato como pior do que ele é.

#### O ataque à classe b (13/09, quarta frente): o que fechou e o que sobrou

Toda linha desta subseção foi medida NESTA worktree, com `--retries=0`, contra o HEAD do dia (que já
carrega P6, P9 e P10). A primeira coisa que a remedição mostrou vale mais que a tabela: **metade dos
vermelhos da classe b já não existia**, porque as correções do próprio dia moveram os casos para
mais adiante, e o que restou ali era outro defeito. Reproduzir na base antes de atribuir causa, que
era a instrução, era mesmo a instrução certa.

**Duas famílias inteiras eram INSTRUMENTO, não produto**, e as duas eram cobertura vazia na direção
perigosa:

| caso | causa MEDIDA | classe | prova |
|---|---|---|---|
| `browser-multi-tab-namespace.spec.js`, A0b, A1, A2 e A3b | o arquivo lia o banco pelo nome SEM geração (`mapsDbOf`), e o retrato escreve em `ebgeo_maps__<sufixo>__generation-<uuid>`. As quatro leituras positivas reprovavam com lista vazia; as de AUSÊNCIA passavam de graça contra um banco que ninguém escreve | c | os NOVE casos do arquivo verdes |
| `browser-multi-tab-teardown-queue.spec.js`, B1, B2 e B3 | a semeadura empurrava um `map create` ao lado do mapa que `createAtlas` semeia, e a abertura aterrissa no primeiro da ordem do ATLAS. Sintoma: `Received: "Mapa 1"`, o nome que o SERVIDOR dá | c | B1 e B2 verdes; B3 passou a morrer bem adiante (ver abaixo) |
| `troca-viva-de-atlas-tela.spec.js` e `painel-de-feicao-na-troca-viva.spec.js` | a mesma semeadura, e por isso a espera por `?map=` estourava em 60 s | c | os dois verdes |
| `browser-two-client-broadcast.spec.js` | media o contrato anterior a `f8e109ea` (o autor NÃO vê o próprio eco). Hoje o eco chega marcado com `localRepair`, e a asserção foi INVERTIDA, com o par exigido SEM a marca | c | verde |

**Três eram produto, e os três tinham repro de integração com controle negativo:**

| caso | causa MEDIDA | conserto | prova |
|---|---|---|---|
| `browser-collab-grupo-perde-membro.spec.js`, os dois casos | `applyRemoteGroupFeatureOp` devolvia `false` para a membresia JÁ convergida, e `_queueApply` lê `false` como escrita local quebrada e fecha o socket com 4000. Como `createGroup` publica o documento com os membros dentro E uma op `group_feature` por membro, agrupar derrubava o par na hora, sempre. O vermelho aparecia no DELETE, que é a op seguinte, a que nunca chegava | o alvo de membresia deixou de reportar falha ao transporte, na mesma forma do tipo de entidade desconhecido | repro com 6 casos (3 de 6 reprovam sem a linha); os dois casos de navegador verdes |
| `browser-logout-clears-map.repro.spec.js` | a confirmação de saída fecha a cerca de escrita do namespace MONTADO, e o `clearAllDataStore` seguinte morria de `AbortError` no `operationQueue.clear()`, antes da última linha dele, que é o `emit(ALL_DATA_CLEARED)`, único sinal que esvazia as sources vivas. O disco já tinha sido limpo pelos handles crus, então a metade de store ficava certa e só a de tela errada | um namespace condenado não se reconstrói: as três escritas de reconstrução são puladas e o anúncio acontece | repro com 3 casos (2 de 3 reprovam sem o conserto, com a pilha exata); os dois casos de navegador verdes |
| `envio-do-acervo-herdado.spec.js`, o caso do diálogo | `legacySlot` perguntava só por `dbSuffix === ''`, e depois da travessia o acervo mora num slot `upgrade-<uuid>` carimbado `adoptedLegacy`. O diálogo de exclusão voltava à frase curta, e o cartão do acervo ficava indistinguível de um "Meu Atlas" em branco | a pergunta passou a ser o carimbo, com o sufixo vazio como o regime de ANTES da travessia | ver a linha do acervo abaixo |

**E a fixture do acervo herdado estava medindo outro cenário.** Ela semeava os bancos legados DEPOIS
do primeiro boot, e o portão de migração respondia com a tela "Recuperar seus dados", corretamente,
porque escrever no disco legado depois da travessia é a versão antiga tendo gravado alterações. Quem
chega da versão anterior tem o disco herdado ANTES do primeiro boot, e é assim que ela semeia agora,
numa página estática da mesma origem. Dois dos três casos passaram na primeira remedição.

**O que SOBROU aberto, e os dois são achados novos que base nenhuma alcançava:**

1. **`browser-multi-tab-teardown-queue.spec.js`, B3.** Com a semeadura corrigida ele chega ao ato e
   falha adiante: o controle positivo encontra o ponto no namespace de X, a aba vizinha congela com o
   texto de desmontagem, e então a amostragem vê o namespace POUPADO **vazio em 46 de 46 leituras**
   (`ausente=0 vazio=46 comChaves=0`). Ou seja, a aba que segura a montagem teve o dado esvaziado. Isso
   nunca foi medido antes porque todas as bases morriam no `waitAtlasTabReady`. Falta decidir se o
   furo é do arbítrio (`destroyRemoteAtlasIfUnmounted`) ou do instrumento.
2. **`browser-default-layer.spec.js`.** A opacidade não converge no par (`Expected: 0.55 / Received: 1`),
   enquanto o nome, escrito na op ANTERIOR, converge. O relatório do SyncLedger da rodada traz
   `acked-but-no-effect: 1`, que no vocabulário daquele arquivo é um `server.applied` com
   `rowsAffected` zero: uma das duas atualizações de camada não escreveu linha nenhuma no servidor, e
   por isso nunca foi difundida. A remedição isolada não pôde ser concluída (o backend do arnês morreu
   no meio, por colisão de porta com outra sessão, e a própria saída do arnês acusa isso), então a
   causa fica NOMEADA e não fechada.

Também ficam pendentes de remedição, por não terem entrado nesta frente:
`aparencia-atravessa-trocas-de-atlas.spec.js`, `troca-viva-de-atlas-medida.spec.js` (cuja semeadura já
adota o mapa do servidor, então ele pode já estar verde) e `browser-collab-three-client-flow.spec.js`,
que morre no ajudante de desenho por interface (`drawViaToolUI`, com `isActive:false`,
`drawPoints:0`) antes de qualquer asserção de colaboração.

#### Classe c: os desatualizados por contrato, reescritos em 13/09

Os quatro foram reescritos nesta worktree, com asserção INVERTIDA e nunca afrouxada, e **NENHUM DELES FOI EXECUTADO**: o Playwright estava fora do laço da sessão que os escreveu (porta 3912 ocupada por outro agente). A execução é do coordenador.

| caso | candidato | base `8309b289` | o que passou a medir |
|---|---|---|---|
| `frontend/tests/e2e-ui/browser-collab-crdt-conflict.spec.js`, três clientes | `as três atualizações chegaram ao log` com `updates.length` igual a 1 | vermelho ANTES da asserção, em `o recolor virou operação na fila` | exatamente UMA aplicada, DUAS de volta como `conflict` nomeando a unidade em disputa, e a cor convergida é a de quem teve a op aplicada. Contrato de `0fa61c5f` (servidor) e `5f91f2e9` (cliente). |
| `frontend/tests/e2e-ui/browser-collab-three-client-flow.spec.js`, fase 3 | `as três atualizações concorrentes chegaram ao log do servidor` | vermelho ANTES, em `a edição de A virou operação na fila` | o mesmo, por recibo (`sync_receipts`) e por autor. |
| `frontend/tests/e2e-ui/browser-collab-lock.spec.js`, primeiro caso | `Test timeout of 60000ms exceeded` 4 de 4, em `drawLineUI(B)` esperando um botão invisível | VERDE 4 de 4 | a trava alcança o Editor, o posto de desenho some dos DOIS lados, e o comando que o menu ainda desenha recusa o clique com `aria-disabled` nomeando o estado. Contrato de `957a9567`. |
| `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js`, portão de namespace | `Expected to fail, but passed`, com o portão caindo no CONTROLE POSITIVO | idem, mesma frase | a leitura resolve a GERAÇÃO ativa (`activeMapsDbOf`), o controle positivo vem primeiro, e o `test.fail` saiu porque o que sobra é o comportamento correto. Instrumento envelhecido por `bc797944`. |

**A terceira linha é a única em que a base é verde**, e é o formato mais fácil de ler errado da tabela inteira: verde na base mais vermelho no candidato é a assinatura da classe a, e aqui não é, porque a mudança de comportamento é DELIBERADA e está registrada. A distinção não sai do log, sai de ler o commit; foi por isso que a classificação exigiu bissecção nos dois casos da classe a e leitura de contrato nestes quatro.

**A quarta é meio c e meio d**, e vale dizê-lo em voz alta: o produto está certo, o SPEC estava certo, e o que envelheceu foi o endereço que ele lia. Um instrumento defasado que erra para o lado do verde (a asserção de ausência contra um banco que ninguém escreve passa de graça) é a cobertura vazia da constituição, com a agravante de vir embrulhada numa falha esperada.

#### Classe d: ambiente e instrumento

| caso | candidato | base `8309b289` | evidência |
|---|---|---|---|
| `frontend/tests/e2e-ui/vazamento-viewers.spec.js`, §30.2 | REPROVOU numa rodada (`o ciclo medido 4 falhou em abrir o visualizador`, com 404 em `/api/v1/assets3d/m/serra_dourada/tileset.json`) e PULOU em duas | PULOU | o modelo é `backend/data/models3d/serra_dourada.3dtiles`, que `backend/.gitignore` exclui (`data/models3d/`), então nenhuma worktree o tem. |

**Mesmo ambiente, mesmo 404, dois veredictos**, e a causa é do spec: o pulo estava pendurado no aquecimento, e o viewer do Cesium SOBE com o tileset em 404 (a cena fica vazia e nada reclama), então "o ciclo abriu" nunca respondeu "o modelo existe". A reescrita de 13/09 pergunta a pré-condição diretamente, uma vez, antes dos ciclos, e estende o diagnóstico e o pulo aos ciclos medidos.

**O asset NÃO foi semeado, e a decisão está registrada aqui porque pulo é cobertura vazia.** Não há fixture: o `.3dtiles` é um artefato binário de 8,4 MB produzido pela ingestão, e um substituto sintético devolveria a cena vazia que o próprio spec avisa não medir nada. O caminho de volta é barato e a frase do pulo o nomeia: apontar `MODELS_3D_DIR` para um diretório que contenha o arquivo antes de rodar o Playwright, porque `frontend/tests/e2e-ui/backend.js` espalha o ambiente do processo no `spawn` do backend e não sobrescreve essa variável. **Enquanto o coordenador não fizer isso, §30.2 é cobertura ZERO sobre o vazamento de listener do visualizador 3D, e a matriz B11 não pode contá-la como célula aprovada.**

### A terceira passada (13/09): a rodada inteira, e o que ela desfaz da segunda

`npm run test:e2e:ui` de dentro de `frontend/`, sobre `40c8f2cb`: **código de saída 1, 19 reprovados, 2 flaky, 1 pulado, 345 aprovados, 1,0 h**, 367 casos em 156 arquivos (a mega continua fora, por script próprio). O log íntegro fica no scratchpad da sessão (playwright-p8.log), que some com ela: o que sobrevive é esta seção.

**O achado que mais muda a leitura da segunda passada: NENHUM dos quatro vermelhos novos é regressão de P4 a P7.** Os quatro foram remedidos em série, isolados e com `--retries=0`, no candidato de hoje e no candidato da segunda passada (`13025f4a`), e os quatro já reprovavam lá. Três deles reprovavam por SORTEIO, e é isso que os fez passar por verdes: um caso que ganha 1 em 3 dá verde numa rodada única, e a segunda passada tinha uma rodada por caso.

| caso | hoje (`40c8f2cb`) | segunda passada (`13025f4a`) | classe |
|---|---|---|---|
| `frontend/tests/e2e-ui/browser-default-layer.spec.js` | vermelho 3 de 3 | vermelho 3 de 3, MESMA mensagem | b, pré-existente |
| `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, A1 | vermelho 3 de 3 | vermelho 2 de 3 | b, pré-existente, hoje determinístico |
| `frontend/tests/e2e-ui/troca-viva-de-atlas-tela.spec.js` | vermelho 3 de 3 | vermelho 2 de 3 | c, instrumento |
| `frontend/tests/e2e-ui/painel-de-feicao-na-troca-viva.spec.js` | vermelho 3 de 3 | vermelho 1 de 3 | c, instrumento |

**As duas últimas são a QUINTA e a SEXTA da família que `fe8a6039` consertou, e o suspeito sai da leitura, não de bissecção.** Aquele commit descobriu que o mapa em que a aba aterrissava ao abrir um atlas era sorteado, consertou o produto (a ordem passou a ser a do atlas) e corrigiu QUATRO specs que semeavam o atlas supondo que ele nasce vazio, empurrando um `map create` por cima do mapa que o servidor semeia. Estas duas fazem exatamente isso (`api.createAtlas` seguido de um envelope `map create` com UUID novo) e depois esperam o endereço trazer aquele mapa, cada uma com a sua cópia privada de `esperarAtlasPronto`. Enquanto o mapa era sorteado elas ganhavam às vezes; com o sorteio removido, o mapa é sempre o primeiro do atlas e elas perdem sempre. O conserto é no spec, e é o mesmo que `fe8a6039` fez nos outros quatro: adotar o mapa semeado por uma renomeação. Não afrouxar a espera.

**A1 aponta para o instrumento, e para o mesmo instrumento que P7 já consertou uma vez.** Ela lê a feição desenhada em `mapsDbOf(remoteSuffix(X.id))`, que é o nome de banco SEM geração, e desde 13/09 o retrato pousa numa geração (`ebgeo_maps__<sufixo>__generation-<uuid>`) com o ponteiro virado só no fim. Foi essa mesma defasagem que fez o portão de `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js` cair no controle positivo, e a saída já existe, escrita naquele lote: `activeMapsDbOf` (`frontend/tests/e2e-ui/helpers/two-tabs.js`), que resolve a geração ativa da aba. A hipótese vale para a família inteira de `browser-multi-tab-namespace.spec.js` e de `browser-multi-tab-teardown-queue.spec.js`, e precisa ser conferida caso a caso antes de virar conserto: só a linha de A1 foi lida.

**`browser-default-layer.spec.js` é o único dos quatro que é vermelho determinístico nas duas bases**, e ele escapou do inventário da segunda passada. O sintoma: A fica offline, renomeia a camada E muda a opacidade dela, volta a ficar online; em B o nome chega ("Configuração preservada") e a opacidade não (esperado 0,55, recebido 1). O relatório do SyncLedger anexo traz `conflicts: 2` e `acked-but-no-effect: 1`. A coluna existe do lado do servidor (`opacity` está em `UPDATE_FIELDS` de `backend/src/modules/sync/sync.service.js`) e o cliente registra a operação (`setLayerOpacity` cai em `_updateLayerProperty`, que empilha um UPDATE com o documento), então a leitura que sobra é a da base declarada: as duas edições offline da MESMA camada declaram a mesma base observada, a primeira aplica e a segunda volta recusada. Isso é hipótese de leitura, não medição, e quem for fechá-la começa pelo recibo da segunda operação.

#### O que a terceira passada aprovou

- **Os DOIS casos da classe a estão verdes**, e é a primeira vez que se medem depois do conserto: `frontend/tests/e2e-ui/desempenho-do-boot-do-mapa.spec.js`, "transicoes" (2,3 min), e `frontend/tests/e2e-ui/browser-atlas-url.spec.js`, "logged out" (4,2 s).
- **Os specs que P7 reescreveu rodaram pela primeira vez, e três dos quatro passaram**: `frontend/tests/e2e-ui/browser-collab-crdt-conflict.spec.js` (cinco casos verdes, o de TRÊS clientes inclusive), `frontend/tests/e2e-ui/browser-collab-lock.spec.js` (os dois casos) e `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js` (os dois, com o portão de namespace agora medindo a geração ativa).
- **UM caso da classe b fechou de passagem**: `frontend/tests/e2e-ui/troca-viva-de-atlas-medida.spec.js`, verde em 18,8 s. Ele era um dos quatro specs que `fe8a6039` adotou ao mapa semeado, ou seja, fechou pelo mesmo commit que abriu os dois irmãos da tabela acima.
- `frontend/tests/e2e-ui/vazamento-viewers.spec.js`: §30.1 verde e §30.2 PULADO, que é o desenho novo funcionando e continua sendo cobertura ZERO sobre o vazamento do visualizador 3D.

#### O que B11 ainda tem de fechar: os pré-existentes que continuam vermelhos

Catorze casos, todos vermelhos também em `13025f4a`. Os sintomas são os de hoje, medidos na rodada inteira.

| caso | sintoma hoje |
|---|---|
| `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, A0b, A1, A2, A3b | a feição não aparece no banco do atlas lido (`Received array: []`); ver a suspeita de geração acima |
| `frontend/tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js`, B1, B2, B3 | `a aba ativou o mapa do atlas` |
| `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js`, os DOIS casos | o par não converge reduzido: a feição apagada sobrevive no par, e o grupo de duas não se dissolve |
| `frontend/tests/e2e-ui/browser-two-client-broadcast.spec.js` | A vê o próprio eco |
| `frontend/tests/e2e-ui/envio-do-acervo-herdado.spec.js`, os TRÊS casos | `expect(locator).toBeVisible() failed` |
| `frontend/tests/e2e-ui/aparencia-atravessa-trocas-de-atlas.spec.js` | o mapa não fica vivo em 30 s no passo de SAIR da conta a partir de `atlas.html` |
| `frontend/tests/e2e-ui/browser-logout-clears-map.repro.spec.js`, primeiro caso | `nenhum traço da feição do servidor nas sources vivas após o logout` |
| `frontend/tests/e2e-ui/browser-default-layer.spec.js` | a opacidade não chega ao par (ver acima) |

**Um vermelho da classe c continua de pé e NÃO é sobre o que ele reescreveu:** `frontend/tests/e2e-ui/browser-collab-three-client-flow.spec.js` reprova nas duas tentativas ANTES da asserção reescrita, em `drawViaToolUI`, com `a ferramenta "line" nao criou feicao em "lines" depois dos cliques` e o diagnóstico do tool em `isActive:false, toolAtivo:null`. É a mesma assinatura do flaky de `browser-collab-ledger.spec.js`, isto é, a janela em que a ferramenta cai junto com a troca de mapa, já descrita em `frontend/tests/e2e-ui/helpers/collab-helpers.js`. A fase 3 daquele spec segue SEM medição.

#### Os dois flaky, com taxa

`retries: 1` fecha a rodada em verde para eles, e por isso a contagem se lê antes do veredicto. Os dois foram remedidos isolados, em série, com `--retries=0`:

| caso | na rodada inteira | isolado |
|---|---|---|
| `frontend/tests/e2e-ui/browser-collab-ledger.spec.js` | reprovou na 1ª tentativa, passou na retry | verde 3 de 3 |
| `frontend/tests/e2e-ui/mobile-layout.spec.js`, §28.8/§28.11 | reprovou na 1ª tentativa, passou na retry | verde 3 de 3 |

O do ledger reprova pela assinatura de `drawViaToolUI` acima, ou seja, ele e o `three-client-flow` são o MESMO defeito de instrumento visto em dois pontos da distribuição: um perde sempre sob carga, o outro perde uma vez em três. Fechar aquela janela fecha os dois, e é o candidato de maior rendimento da lista.

### A matriz (documento 09, íntegra)

1. Criar cópias verificadas dos dados de teste. Usar bancos e perfis descartáveis. Não alterar os originais nem misturar o banco de testes com desenvolvimento ou produção.
2. Subir a main, criar e editar dados e preferências pela interface, fechar ou suspender clientes. Substituir o servidor pelo candidato e reabrir o MESMO perfil na MESMA origem completa, porta inclusive.
3. Simular meses sem acesso, aba antiga aberta, cache e service worker quando existirem, interrupção entre etapas e várias reaberturas. Conferir conteúdo, referências, imagens e exportação com reimportação; preservar a origem até validar o destino.
4. Executar dois e três clientes com disputa de entidade e de campo, exclusão, bloqueio, movimento, importação e desfazer com refazer em todas as famílias. Incluir 429 e 503, resposta perdida após commit, reconexão durante snapshot, suspensão, relógio alterado, fila acima de 10.000 e pouco espaço.
5. Comparar PostgreSQL, IndexedDB, memória, renderização e exportação por conteúdo e por relações. **Fila vazia e contagens iguais não provam convergência.** Usar barreiras determinísticas e controles negativos restaurados; repetir corridas em série, sem retries ocultos.

Evidência e aceite: registrar cada célula com SHAs, entrada, falha injetada, estado esperado e observado, log e captura. Depois da última mudança de lógica, rodar lint e teste completos da raiz em comandos separados, build, e Playwright real. Build não pode concorrer com testes que inspecionam `dist`; suítes com banco são sequenciais. Toda célula obrigatória precisa de aprovação, e limitação não resolvida impede liberação. **O ensaio local não substitui a conferência na origem interna real.**

### As premissas medidas que a matriz herda

O ensaio de troca de builds já foi feito uma vez, em 12/09, e o que ele fixou vale como premissa:

- **A referência de produção é a main remota**, `8b611113aa73c3faedc967ccf77132604255ea8d`, conferida com `git fetch`. A main LOCAL estava nove commits atrasada naquele dia: a referência local não vale, e o dono precisa reconfirmar o SHA de produção antes do ensaio final.
- **O ensaio anterior não foi sobre um SHA publicado.** A integração medida carregava correções locais de migração, então B11 tem de repeti-lo sobre o SHA candidato.
- **A prova de que os builds trocaram é o hash do `dist/index.html` dos dois lados**, e a origem tem de ser idêntica nas duas metades (mesmo protocolo, host e porta).
- **A população preservada, para comparação:** 14 mapas, 806 feições, 149 imagens e 32 operações na fila antiga, com três boots do candidato sem diferença de origem nem de destino; a edição feita depois levou a 807 feições sem alterar as anteriores nem os bytes das imagens.
- **O critério de preservação admite exatamente três diferenças**, e uma comparação estrita sem elas acusa regressão onde não há: os dois marcadores de versão subindo para 3.0, e, **só no mapa ativo**, a revisão de sync avançando uma unidade e a data de atualização adiantando, porque abrir o mapa o salva uma vez. Os outros mapas não têm essa exceção, e a fila antiga fica intacta. O critério está codificado em `frontend/tests/helpers/main-profile-upgrade.mjs`.
- **Construir a main exige `npm ci --legacy-peer-deps`**, porque a instalação padrão recusa o lockfile dela por uma transitiva ausente. Não edite o lockfile dela.
- **O corpus externo tem hash por arquivo**, e é ele que faz uma repetição futura provar que o acervo não mudou. Os recursos 3D e 360 são arquivos para o BACKEND servir, nunca IndexedDB. Armadilha medida: importar dois dos arquivos com o editor aberto regenera um PNG de símbolo antigo cada, o que é atualização esperada de cache e **não** é corrupção, mas uma comparação byte a byte acusa.
- **Quota de armazenamento não se simula pelo Chrome DevTools Protocol**: ele informa o limite e continua aceitando gravações. Injete a falha na fronteira de escrita nativa do IndexedDB, como faz o caso de quota de `frontend/tests/e2e-ui/browser-migracao-2.2.spec.js`.
- **A estimativa de armazenamento do navegador não serve para dimensionar a cópia:** medida uma vez, ela reportou cerca de 6,1 MB adicionais para um blob que ocupa 8,4 MB.

### O que o ensaio anterior NÃO cobriu, e continua premissa aberta

- **Só Chromium foi exercitado.** Onde mora: os projetos de `frontend/playwright.config.js`. Aceite: a matriz mínima de migração e de colaboração num segundo motor, ou decisão registrada de que a rede usa só Chromium, escrita no README do e2e.
- **`localhost` é origem confiável mesmo em HTTP**, então o ensaio local não prova Web Locks na rede. Por D1 a produção é HTTPS; o que falta é medir, na origem interna REAL, que `isSecureContext` é verdadeiro e que `navigator.locks` existe, porque certificado interno aceito à força pode negar o contexto seguro em algum navegador. Sem essa medição a barreira de logout é uma afirmação sobre a bancada.
- **Nenhum perfil foi envelhecido** nem se reproduziu descarte de armazenamento pelo navegador.
- **Os headers efetivos do NGINX não foram conferidos na origem interna.** Duas perguntas: nenhuma resposta pode emitir `Clear-Site-Data`, e a release corrente tem de continuar servindo os assets das releases retidas, senão uma aba aberta antes do deploy quebra ao carregar um chunk tardio. Guardar três diretórios de release não prova isso. Aceite: cabeçalho conferido na resposta real e um chunk tardio carregado por aba pré-deploy.
- **Registrar número de suíte no CORPO do commit**, não só na prosa.

## B12, liberação interna e retorno (documento 10, íntegra)

Depende de B11 e de responsável com acesso à rede interna. O servidor interno não é alcançável por esta linha de trabalho.

### Preparação

1. Fixar versões compatíveis de frontend, backend, schema e runtime; registrar SHAs, artefatos, ordem de instalação, pré-condições, responsável e duração medida em ensaio. Distinguir instalação nova, banco de desenvolvimento antigo e atualização de banco válido. `deploy/deploy.sh` cobre só o symlink do web e continua fora de qualquer edição sem confirmação.
2. **Não há transição de banco a aplicar.** Por D6, a linha de integração nunca foi implantada: a primeira implantação é instalação nova a partir das bases de `backend/src/database/migrations/README.md`, a baseline permanece editável até o SHA candidato, e banco de desenvolvimento anterior a uma edição se recria. O congelamento passa a valer no SHA implantado, e daí em diante toda mudança de schema entra por arquivo numerado novo, recusada em disco pelo guarda de checksum se alguém editar uma baseline já aplicada.
3. Ensaiar backup e restauração de PostgreSQL e dos arquivos referenciados, imagens e recursos 3D e 360 inclusive. Restaurar em ambiente SEPARADO e comprovar acesso e conteúdo, não apenas sucesso do comando. **Backup do servidor não protege dados que só existem no navegador.**
4. Verificar proxy, WebSocket, cache, TLS, limites e prazos, espaço, permissões de volumes e serviços necessários. Testar contas com papéis reais e acesso aos diagnósticos. Conservar a origem usada pelos clientes.

### Piloto e retorno

Definir o retorno ANTES de abrir escrita. Preferir versão anterior compatível ou correção progressiva. Se depender de restaurar backup, suspender escritas e tratar explicitamente as alterações feitas depois dele: **restauração não é retorno sem perda por padrão.** Não voltar apenas o frontend para a main se ela não entender o estado local novo.

O piloto cobre usuários locais antigos, autenticados e anônimos, além de colaboração remota. Definir amostra e duração pelo volume e pela matriz, e registrar quem acompanha erros, filas, latência, armazenamento e presença. Expandir somente após conferir integridade e estabilidade.

### Interrupção e aceite

Suspender a expansão diante de perda, duplicação, divergência, acesso indevido entre atlas, migração incompleta, upload inacessível ou indicação falsa de sincronização. Registrar diagnóstico e responsável pela decisão.

Encerrar somente com restauração comprovada, verificação da infraestrutura real, piloto observado e aprovação do conjunto compatível pelo responsável interno. Preencher evidências reais; não marcar esta tarefa como concluída porque o roteiro está pronto. **Esta documentação não executa implantação nem aprova a liberação.**

## Regras de verificação

Valem para todo item acima, e estão na constituição:

1. `npm run lint` e `npm test` na RAIZ, em comandos separados, rodados DEPOIS da última escrita. A raiz encadeia frontend, backend sob cobertura e contratos, e exige PostgreSQL; ela não pode concorrer com outra rodada de backend nem com medição de cobertura alheia (isole por `TEST_DB_NAME` e por diretório de cobertura próprio).
2. Controle negativo para cada guarda novo: reverter o fix, ver o vermelho, restaurar a fonte byte a byte.
3. Mudança que cruza os dois pacotes vai nos dois lados no mesmo commit, com caso de contrato em `frontend/tests/e2e`.
4. Interface só se valida por captura do Playwright dirigindo app e backend reais, LIDA como imagem, com o spec temporário apagado; rodando de dentro de `frontend/`; e com a contagem de `flaky` lida antes de declarar verde.
5. Corrida se mede em série, com a taxa relatada, e o caso que mede corrida desliga o retry em si mesmo.
6. Número de suíte vai no corpo do commit.
