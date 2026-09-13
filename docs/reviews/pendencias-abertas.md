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
| B6 | comandos compostos e as quatro exceções REST | fundido; resta o conjunto grande e a prova de fronteira |
| B7 | abas, logout, gerações e migração da main | fundido |
| B8 | uploads duráveis | fundido; resta D7 e a prova em duas browsers |
| B9 | indicadores e administração | fundido; resta a validação com telemetria real |
| B10 | segurança e dependências | inventário fundido; **fecho aberto**, só sobre o SHA candidato |
| B11 | homologação final e migração da main | **aberto** |
| B12 | liberação interna e retorno | **aberto**, depende de B11 e de responsável na rede interna |

## Decisão pendente do dono

**D7. Reuso de imagem por conteúdo, sem chave de tentativa.** A rota única de imagem reusa, na falta de chave de idempotência, a linha de mesmo hash de conteúdo no mesmo atlas. Reenviar os mesmos bytes com outro nome devolve a linha antiga, com o nome antigo, e duas feições passam a compartilhar uma linha de imagem. Nenhum caminho do cliente chama a exclusão de imagem no servidor hoje, então não há perda alcançável pelo produto, e é por isso que isto é pendência e não defeito. A alternativa é estreitar o reuso, casando só por chave de tentativa e aceitando que um reenvio sem chave grave uma segunda linha e um segundo arquivo em disco para os mesmos bytes. Registro em [decisões de 2026](../decisions/decisions-2026.md); efeito nomeado em [[imagens-atlas]].

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
2. **O tipo publicado dos três marcadores novos.** Onde mora: `recordStructuralMarker` (`backend/src/modules/sync/structural-marker.js`) e o roteador de entrada do cliente. O servidor publica duplicação, clone e importação sob o tipo do merge; o cliente já reconhece os quatro nomes. O que falta: um commit dos DOIS pacotes, que não pode ser feito antes de o cliente atualizado estar em campo. Aceite: o par offline recebe o ato pelo nome dele, e o cliente anterior não vê tipo desconhecido.
3. **Os contratos de ponta a ponta do lote lógico.** Onde mora: `frontend/tests/e2e/`. O lote atravessa os dois pacotes, e a prova dessa fronteira é a camada que sobe o backend real. Aceite: falha injetada no primeiro, no intermediário e no último membro, com nenhuma aplicação parcial acked como sucesso.
4. **Os cenários de aceite que dependem de estado do SERVIDOR** (mapa e camada bloqueados, destino excluído, permissão alterada, edição concorrente antes do desfazer) continuam sem prova do lado do cliente, porque quem decide os quatro é o gate do servidor e o cliente só observa o recibo. Aceite: cada um com o estado montado no servidor real.

### B7, abas e recuperação

1. **A fila órfã que a varredura de boot deslogado destrói continua sem cópia de quarentena.** Onde mora: `purgeAllRemoteAtlases` (`frontend/src/js/store/remote-atlas.api.js`), contra `preserveQuarantine` (`frontend/src/js/store/sync/quarantine-registry.js`), que só roda no descarte CONFIRMADO. Aceite: uma op em quarentena num namespace órfão continua legível depois de um boot deslogado.
2. **Corridas de duas browsers REAIS não foram medidas.** Onde mora: `frontend/tests/integration/barreira-de-logout-entre-abas.test.js` usa um lock de verdade tomado fora do módulo sob teste, no mesmo processo, e a fiação do envio no laço de flush é asserida por leitura de fonte. Aceite: duas abas editando durante o diálogo de logout, em série, com a taxa relatada, e `retries: 0` no caso que mede corrida.
3. **A reconciliação de ponteiros tem UM ponto de entrada, o `connect` remoto.** Onde mora: `reconcileDurablePointers` (`frontend/src/js/store/atlas-namespace.js`). Um slot LOCAL que carregue geração (o resgate adota um namespace remoto com as gerações dele) nunca conecta, então nada reconcilia o ponteiro dele. Fechar isso exige um `await` no boot da store, que é outro arquivo. Aceite: perder o `localStorage` de um slot resgatado não deixa o acervo inalcançável.
4. **A remoção da chave de época não fecha TODO escritor.** Onde mora: `frontend/src/js/store/remote-write-fence.js`. Ela fecha quem capturou um registro existente; quem nasceu antes de qualquer registro lê o mesmo valor nos dois estados, e quem o impede de recriar os bancos é o freio de desmontagem. Duas tentativas de fechar isso dentro do fence foram revertidas, e uma delas fazia o controle negativo DO FREIO parar de reproduzir. Aceite: qualquer conserto novo mantém aquele controle negativo reproduzindo.
5. **Houve uma falha transitória no ensaio BroadcastChannel entre a aba do mapa e uma aba nova**, e passar no rerun não encerrou essa matriz. Aceite: a matriz repetida em série, com taxa.
6. **A origem legada preservada fica duplicada em disco sem caminho de poda.** Onde mora: `frontend/src/js/store/migration/legacy-transition.js` e `frontend/src/js/store/atlas-namespace.js`. Preservar a origem até validar o destino foi decisão deliberada; a limpeza ficou declarada como fluxo separado e não entrou em bloco nenhum. Aceite: o espaço das duas cópias medido, mais um caminho explícito de poda condicionado a recuperação verificada, ou decisão registrada de manter a origem com o custo de disco nomeado.
7. **Não há limite máximo seguro de acervo medido para a transição.** Onde mora: `frontend/src/js/store/migration/legacy-transition.js` (cópia por unidades limitadas) e `frontend/src/js/store/migration/recovery-archive.js` (arquivo em memória). A única medição existente é de 41 registros com um blob de 8 MiB: 5,68 s para copiar, migrar e verificar. Aceite: memória, tempo e espaço medidos com acervo de centenas de MiB, e um comportamento definido acima do limite (progresso, recusa ou fluxo em partes).
8. **As versões de entrada 1.3 a 1.6 não têm certificação de ponta a ponta.** Onde mora: a cadeia de `safelyMigrate` (`frontend/src/js/store/migration/migration.service.js`) e `frontend/tests/integration/degrau-3.0-entradas-da-transicao.test.js`. Aceite: um caso por versão de entrada, cada um bootando DUAS vezes e convergindo, pela régua de convergência que já existe; e a versão sem suporte abrindo recuperação ou exportação, nunca migração fictícia.

### B8, uploads

1. **A chave de tentativa da rota única não tem chamador no cliente.** Onde mora: `backend/src/modules/images/images.service.js` (que já a lê do cabeçalho de idempotência) e `frontend/src/js/store/sync/api-client.js` (que não a envia). O cliente usa a rota bulk, cuja identidade de tentativa é o próprio id local, então isto não é defeito alcançável: é uma porta do servidor sem usuário. Aceite: se a rota única voltar a ser usada, a chave viaja.
2. **A prova em duas browsers de que o par abre a imagem depois da retomada.** Onde mora: `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js`. Aceite: o par lê o BLOB pelo servidor, e não `map.hasImage`, que responde verdadeiro também quando o 404 instalou o marcador de erro.
3. **Validação de acesso do colaborador ao recurso é do SERVIDOR**, e não deste bloco: quem responde é o gate da rota de imagem. Fica registrado para que ninguém a procure no cliente.

### B9, indicadores

1. **A validação com telemetria real na rede interna continua pendente.** Onde mora: `frontend/src/js/account/sync-status.control.js`, `frontend/src/js/session/pendencias-monitoramento.js` e o painel de presença do administrador. Aceite: duas abas do mesmo usuário, visitante anônimo, logout, expiração e perda da telemetria produzindo contagens coerentes, com captura do Playwright inspecionada.
2. **A sonda de disponibilidade ainda não foi INSTALADA na rede interna.** O script, o roteiro e o leitor existem (`backend/scripts/sonda-disponibilidade.js`, script npm `diag:sonda`, e o sub-bloco do resumo). Aceite: a sonda rodando em host separado dentro da rede, com o diretório de saída alcançável pelo backend, e o bloco de indisponibilidade publicando medições ao lado de indisponíveis.

### B10, segurança e dependências: o FECHO

O inventário está feito e mora em [`docs/seguranca/dependencias-lancamento-inventario.json`](../seguranca/dependencias-lancamento-inventario.json); o método e as armadilhas estão em [[inventario-de-vendors]]. O que falta é tudo o que só se faz sobre o SHA candidato:

1. **Fixar o SHA candidato e refazer o inventário sobre ele.** O manifesto existe para que essa conferência seja um diff, e não uma busca. Compare o hash NORMALIZADO para LF, nunca o bruto.
2. **Consultar avisos oficiais datados sobre esse SHA** e classificar por versão afetada, exposição real, runtime contra build contra teste, correção disponível e impacto. Registrar data e fonte. Não repetir como atuais contagens históricas de alertas.
3. **Resolver os cinco itens sem versão determinável, ou registrar decisão e responsável para cada um:** o three de `frontend/src/vendor/three/` (revisão 164dev, sem par publicado); `frontend/public/vendors/cesium/cesium-measure.js` e `frontend/public/vendors/cesium/cesium-viewshed.js` (sem upstream conhecido, carregados em runtime pelo visualizador 3D); as bibliotecas nativas dentro do WebAssembly do GDAL além das três legíveis; a imagem Docker efetivamente em execução no servidor interno; e o sistema operacional dessa imagem.
4. **Levar a fixação do digest ao dono**, com construção de prova, e registrar o digest da imagem que de fato roda. Fixa-se o digest do ÍNDICE, não o de uma plataforma.
5. **Revisar autorização depois de B6:** as quatro exceções REST criam entidade fora do log; mais acesso a uploads, recibos e sockets após revogação, expiração e limites de recursos.
6. **Decidir sobre os vendors sem consumidor** (dois arquivos grandes do Cesium, dois builds auxiliares do GDAL, quatro dos cinco arquivos do three). Podar encolhe a superfície a auditar sem tocar em comportamento, e é decisão do dono, porque `frontend/public/vendors/` é caminho frágil.

Aceite do bloco: nenhuma vulnerabilidade crítica ou alta aplicável e explorável sem correção ou mitigação demonstrada; instalação limpa reproduzível; decisão e responsável para cada risco restante. Zero alerta de `npm audit` sozinho não encerra a tarefa, e o inventário completo também não: ele descreve o que existe, não o que é seguro.

## B11, homologação final e migração da main

### O que rodar antes da matriz

1. **Scripts npm para os dois cenários que só rodam por config dedicada**, `frontend/playwright.migration-data.config.js` e `frontend/playwright.atlas-safety.config.js`, com a variável de diretório de dados apontando para CÓPIA. Ler `test:e2e:ui` verde como cobertura da migração é leitura errada: esses dois não rodam ali.
2. **As capturas e specs escritos em 13/09**, rodando de dentro de `frontend/`:
   - as DUAS capturas temporárias (a luz de sync com os estados novos, e o painel de pendências) foram executadas em 13/09, as sete imagens foram LIDAS e os dois specs foram apagados no mesmo commit, que é o contrato deles. O que a leitura mostrou está no corpo daquele commit, e o que ela achou de aberto está adiante nesta seção;
   - o caso novo de `frontend/tests/e2e-ui/browser-collab-lock.spec.js`, que trava PELO CONTROLADOR e espera o Editor ler o mapa travado (os specs anteriores travavam pela op crua e por isso travavam só o próprio cliente): EXECUTADO em 13/09, verde em 4 de 4 rodadas em série;
   - `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js`, ainda não executado.
   Ler a contagem de `flaky` ANTES de declarar verde: com `retries: 1`, um caso que flakeia é um caso não verificado.
3. **Lembrar que `browser-collab-mega.spec.js` não roda na rodada normal** (tem script próprio), então "`test:e2e:ui` verde" não é "a pasta inteira passou".

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
