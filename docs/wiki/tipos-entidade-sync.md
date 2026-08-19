# EntityTypes Sincronizáveis e seu Mapeamento

O que o enum de `EntityType` não conta: quais tipos mentem sobre os próprios campos, quais são descartados em silêncio antes do flush, e a pergunta que ele não responde (este controle da UI é preferência de quem clicou ou é estado do mapa que todos veem?).

A lista canônica está em `frontend/src/js/store/sync/operation-types.js`; o roteamento inbound, em `frontend/src/js/store/sync/remote-operation-handler.js`.

## O enum mente em dois pontos

- **`atlas` não é usado em lugar nenhum.** Nenhum `EntityType.ATLAS` aparece no código. Configuração de atlas viaja como `setting`.
- **`group_feature` não existe no frontend.** O backend tem a tabela e o `TARGET_TABLE_MAP` a suporta, mas o cliente nunca emite esse tipo: associação feição/grupo vai embutida na própria feição ou no grupo. Aparece só no snapshot.

Adicionar um tipo exige três lugares no cliente: o enum, um logger no dispatcher e um `case` no handler remoto. **Faltar o `case` não quebra nada visivelmente**: a op sai, chega e morre com um `console.warn`.

Isso deixou de ser disciplina e virou guarda executável em `frontend/tests/unit/entitytype-com-case-inbound.test.js`, que compara o conjunto emitido (as duas fábricas do dispatcher mais toda chamada direta de `logOperation`) com o conjunto roteado, e fecha o universo do enum contra os dois. Três coisas que vale saber antes de mexer nele:

- ele **fatia** o switch de `applyRemoteOperation` até o primeiro ramo padrão, porque o segundo switch, o de `applyRemoteMapSettingOp`, tem rótulos que são subconjunto do primeiro e mascararia a remoção de um `case` do principal;
- ele lê a fonte **sem comentários**, porque um `case` comentado casava com a regex e deixava o controle negativo passar verde;
- `atlas` entra como marcador de lacuna que **quebra nos dois sentidos**, ao ganhar `case`, ao ganhar emissor ou ao sair do enum, e não como allowlist que fica verde para sempre.

E exige um quarto, do outro lado: o backend precisa conhecer o alvo (`APPLIABLE_TARGETS`, derivado de `TARGET_TABLE_MAP` + `ENTITY_TYPE_MAP` em `backend/src/modules/sync/sync.service.js`). Desde 2026-07-25 uma op cujo `entityType` o servidor não sabe aplicar volta com `rejected: true` + `reason` em vez de ser gravada no log e **acked como sucesso**, que era o pior caso: o cliente desenfileirava confiante e a entidade nunca existia para ninguém. Estrear um tipo no frontend antes de o backend aprendê-lo é skew de deploy normal, e agora ele é visível em vez de silencioso. Ver [[ack-idempotencia]].

## Os slots do envelope não significam o mesmo em todo tipo

`logOperation(entityType, opType, entityId, mapId, data, prev)` tem três famílias de wrapper (`frontend/src/js/store/sync/operation-dispatcher.js`), e duas delas subvertem o significado dos campos:

- **Sub-entidades de mapa** (`mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal`): `createMapSettingLogger` recebe **um único id** e o usa como `entityId` **e** como `mapId`. Não têm tabela própria: o backend as converte em `UPDATE` na linha de `maps`, e o handler inbound **ignora `operationType`**, porque sub-entidade de mapa só faz sentido como update.
- **`slide`**: `frontend/src/js/store/briefing.operations.js` passa o `briefingId` no slot `mapId`. Passa o guard só porque briefingId também é UUID. **Nunca trate `op.mapId` de um `slide` como mapa.**

Formato do envelope em [[envelope-operacao]]; fila e compactação em [[fila-operacoes-outbound]].

## Dois guards descartam ops em silêncio, e existem por um bug real

Em `logOperation` (`frontend/src/js/store/sync/operation-dispatcher.js`), replicados em `logBatchOperations` e em `createMapSettingLogger`. O motivo não é higiene: **uma única op inválida faz o Postgres rejeitar (22P02) e derruba o batch inteiro do flush, travando todo o sync.** São veneno na fila, não sujeira.

1. `setting` com id não-UUID e diferente do sentinela `'atlas'` → `DropReason.NON_UUID_SETTING_ID`. Chaves locais como `lastActiveMap` são estado por cliente.
2. Qualquer op com `mapId` presente e não-UUID → `DropReason.NON_UUID_MAPID`. É o anti-vazamento do mapa local `Principal`, chaveado por nome ([[dominio-local-vs-remoto]]). Ops de nível-atlas passam `mapId = null` e escapam.

Os descartes viram spans `preflush.drop` no [[syncledger]]. Se algo "não sincronizou e não deu erro", olhe aqui primeiro.

> **Nota histórica (contradição resolvida).** O guia *05-sync-crdt* dizia que `mapTemporal` era "gated" e que o frontend não emitia a op, deixando `temporal_config` no default `{}`. Falso: `frontend/src/js/store/temporal.operations.js` chama `logMapTemporalOperation` a cada `setMapTemporalConfig`, com o UUID resolvido justamente para passar o guard acima (logar o nome dropava todo sync temporal em silêncio). Dados temporais **por feição** nunca dependeram disso: viajam verbatim em `data.properties` de uma op `feature` normal. A op existir não significa que ela converge: ver o limite aberto em [[sintese-limites-collab]] e [[modulo-temporal]].

## Traduções que o cliente não vê

**3D/360:** o frontend usa seis tipos específicos (`marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`); o backend guarda tudo em `cesium3d_data` / `streetview360_data` discriminando por `data_type`, e traduz nos dois sentidos. Consequência: **o cliente nunca vê `cesium3d` nem `streetview360` como `entityType`**; por isso o handler tem um `case` por alias, não um genérico. No snapshot, ao contrário, o formato é hierárquico e reagrupado por `data_type`. Ver [[snapshot-e-pull-incremental]], [[catalogo-3d]], [[streetview-360]].

**Shape tolerado sem conversão no cliente:** o backend aceita o que o store real emite, não o shape canônico das colunas. Feature vai como GeoJSON cru (`{ type, geometry, properties }`, tipo em `properties.source`, camada em `properties.layerId`) e o backend deriva `feature_type`/`layer_id`; 3D/360 vão no plano camelCase e são reagrupados. Não "conserte" o cliente para emitir snake_case.

**`catalogLayer` teve DUAS casas e hoje tem uma.** Até a migração 022 a mesma camada podia morar na tabela dedicada `catalog_layers` e numa coluna homônima de `maps`, e o backend decidia pelo shape do payload. O modo dual custou caro em silêncio: o merge de mapas movia a tabela e não a coluna, então quem usasse a forma de array perdia as camadas ao mesclar; e a coluna saía crua por rotas que não passam pela reidratação do snapshot, servindo `config.source.url` de recurso privado a quem só tem `read`. A coluna foi apagada, e o ramo de array do handler passou a materializar cada item como linha da tabela (upsert, nunca remoção). Ver [[api-rest-atlas]].

**`setting` é sempre atlas-scoped:** `logAtlasSetting` cai no sentinela `'atlas'` quando não resolve o id, e isso é seguro porque o handler do backend escopa pela rota `:atlasId` e **ignora o `entityId`**. O merge em `atlas.settings` é whitelisted: chaves de disponibilidade de recurso nunca entram por aqui; essa é a fronteira entre [[atlas-settings]] e edição colaborativa comum.

## Nem todo tipo converge igual

`CONVERGENCE_GUARDED` (`frontend/src/js/store/sync/remote-operation-handler.js`) reúne os tipos cujo `update` substitui o objeto inteiro e que por isso precisam de LWW por `serverVersion`. **Ficam de fora:** `map`, `slide`, `comment`, `setting`, `catalogLayer` e as cinco sub-entidades de mapa; para elas vale só o último a chegar, sem defesa contra reordenação.

O critério é "substitui em bloco", e ele é o teste a aplicar em tipo novo. `briefing` entrou em 2026-07-25 justamente por falhar nesse teste enquanto estava de fora: `applyRemoteBriefingOp` grava o briefing INTEIRO, array de slides incluído, então dois usuários editando slides do mesmo briefing não tinham proteção nenhuma e o último a chegar apagava o trabalho do outro, sem erro. Um Set único governa as duas metades do guarda: o dispatcher também gateia por ele para marcar a edição local pendente, então defer e checagem de versão ligam juntos. Mecanismo em [[idempotencia-e-convergence-guard]], o porquê de não ser CRDT em [[modelo-conflito-lww]].

Desde 2026-08-16 cada um dos tipos do enum tem **decisão escrita**, cobrada por `frontend/tests/unit/convergence-guarded-decisao-por-tipo.test.js`. O teste não adjudica a decisão, e o cabeçalho dele diz isso: ele só torna impossível um tipo novo aparecer sem que alguém tenha escrito de que lado está e por quê. Três resultados dele que mudam o que se lê acima:

- **A razão de as cinco sub-entidades de mapa ficarem de fora é estrutural, não de conveniência.** Elas compartilham `entityId === mapId`, e o contador de versão do guarda é chaveado por `entityId`. Pô-las no Set faria os cinco fluxos disputarem um contador só, e uma nota nova passaria a descartar uma posição nova: o guarda pioraria a convergência.
- **Três tipos satisfazem o critério declarado e estão fora**, e ficaram registrados como lacunas que reprovam ao serem fechadas: `map` (o inbound grava o documento de mapa inteiro, a mesma forma que custou o briefing), `catalogLayer` (`applyRemoteCatalogLayerOp` substitui o item por id, exatamente como `marker3d` e `marker360`, que estão dentro) e `comment` (substitui o comentário inteiro por id; a exposição é menor porque root e reply têm ids próprios, mas "exposição menor" não é o critério escrito). Nenhuma das três está decidida, e a assimetria do `catalogLayer` não tinha motivo registrado em lugar nenhum.
- **O Set não é reexportado pelo barrel** `frontend/src/js/store/sync/index.js`. Importá-lo de lá devolve indefinido, e um teste escrito assim passaria inteiro em vazio.

**`slide` é emitido mas é no-op inbound:** slides convergem pela op do `briefing` pai, porque `updateBriefing` registra o array completo. O `case` existe só para não cair no `warn`. Se você mexer em slides fora de `updateBriefing`, **o peer não vê**.

**`comment` é o único tipo com degrau de permissão próprio:** `frontend/src/js/store/sync/permission-guard.js` mapeia create/update/delete para `PermissionAction.COMMENT` (Comentarista pra cima), enquanto o resto exige `write`; o backend repete a checagem por operação. Ver [[comentario-espacial]], [[permissoes-atlas]].

## Compartilhado ou local? A pergunta que o enum não responde

Errar o lado é o bug mais comum de feature nova: ou o usuário sobrescreve a visão dos pares sem querer, ou uma configuração que deveria ser do mapa morre no cliente.

**Regra:** se o controle responde "o que **eu** estou olhando", é local e não deve chamar nenhum `logXxxOperation`. Se responde "como o mapa **é**", precisa de um `EntityType` e de um `case` inbound. Estado local que escapa para `logSettingOperation` é descartado no pré-flush, silenciosamente.

Os casos em que a intuição erra:

- **Exagero de terreno é atlas-wide**, não por mapa (`frontend/src/js/store/atlas-appearance.service.js` → `atlas.settings.terrainExaggeration`). Mudá-lo em um mapa muda em todos. Desde 2026-08-16 ele tem uma irmã na mesma chave de grupo, `globeProjection`, e as duas são gravadas JUNTAS num patch só — a compactação da fila colapsa patches parciais do mesmo grupo para o último, então escrevê-las em duas ops perderia uma.
- **Visibilidade e bloqueio de feição, camada e grupo não são preferência de visualização**: são propriedade persistida. Esconder uma camada esconde para todo mundo no atlas.
- **Ordem dos mapas, cores de badge e ícones customizados** são `setting` de **atlas**, não de mapa.
- **Seleção de feições parece local mas é espelhada** como awareness, não como dado ([[presenca-colaborativa]]).
- **Medições efêmeras (J/H/X) são locais** até "Salvar como feição"; a geometria em construção também só vira `feature` ao concluir.
- **Camada ativa é local**: cada usuário recebe suas feições novas na própria camada ativa.
- **Apresentar briefing não trava o mapa dos outros** (`setBriefingLockOverride` é local).
- **O conteúdo 3D/360 sincroniza, a exibição não**: abrir o visualizador é local.

O resto do que é local segue a intuição (pan/zoom, ferramenta ativa, snap, formato de coordenadas, árvore expandida, filtros da tabela de atributos, configuração de exportação e deep-links).

## A colisão que a compactação esconde

A fila compacta agrupando por `scopeSuffix`, `entityType` e `entityId` (`frontend/src/js/store/sync/operation-queue.js`), e mantém uma operação por grupo. Esta página dizia que a chave era só o par tipo mais id; o `scopeSuffix` entrou com o namespace por atlas em 2026-08-15. As cinco sub-entidades de mapa compartilham `entityId === mapId` e **só não colidem porque o `entityType` difere**. Um tipo novo que reuse o id do mapa passa a competir por esse grupo, e o sintoma é ops que somem na compactação, não erro.

**Sobre a separação por atlas, que é a pergunta natural depois do namespace:** duas operações de atlas diferentes não se compactam uma na outra, e quem garante isso é o `scopeSuffix` na chave, além da fila já ser física por atlas. O `atlasId` do envelope **não** está na chave e não precisa estar, porque ele é derivado do `scopeSuffix` nos dois ramos de `readScopeStamp` (`frontend/src/js/store/sync/operation-factory.js`): no remoto o sufixo contém o id literalmente, no local ele é extraído por `remoteAtlasIdFromDbSuffix`. Se essa derivação deixar de valer, o `scopeSuffix` sozinho passa a separar menos do que se pensa.

**A instância viva da colisão é o `setting`, e ela nunca esteve escrita.** `logAtlasSetting` usa o id do atlas (ou o sentinela) como `entityId` para todas as preferências, e cada op carrega um patch de uma chave só. Cinco chaves compartilham esse grupo hoje (`mapOrder`, `mapBadgeColors`, `colorUsage`, `customIcons` e `terrainExaggeration`, esta última chegando por `logSettingOperation` direto, não por `logAtlasSetting`), e a compactação **substitui o payload, nunca o funde**: enfileirados juntos, um sobrevive e os demais somem sem erro. O dano é latente porque `_compact` só roda acima de `MAX_QUEUE_SIZE`, alcançável numa rajada offline e não no uso normal.

A saída certa **não** é alargar a chave de grupo: mais grupos significa menos compactação e fila maior, o que muda a semântica do flush inteiro. As saídas sem perda são dar ao tipo um id próprio, ou ensinar a compactação a fundir o payload. Guarda em `frontend/tests/unit/compactacao-id-nao-unico.test.js`, que deriva os tipos de id não único da fonte do dispatcher e cobra a tabela nos dois sentidos.

Regras do backend que dependem do tipo (lock gate só para alvos filhos com `mapId`; soft-delete em tudo exceto `group_feature`; delete de `layer` cascateia às feições; create com guarda anti-IDOR cross-atlas): [[aplicacao-operacoes-remotas]] e [[tabela-operations]].

Identidade do emissor em [[client-id-estavel]]; ack e dedupe em [[ack-idempotencia]]; transporte em [[canal-collab-websocket]]; contratos imutáveis em [[sintese-contratos-congelados]]; modelo de dados em [[atlas-modelo-de-dados]].
