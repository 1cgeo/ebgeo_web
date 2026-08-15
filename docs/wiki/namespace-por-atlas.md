# Namespace de IndexedDB por atlas

Cada atlas, local ou de servidor, é dono do seu conjunto de bancos IndexedDB, com o namespace no NOME DO BANCO; o apagamento do dado remoto deixou de ser uma lista fixa de nomes e passou a ser derivado de um registro.

A fábrica é `frontend/src/js/store/atlas-namespace.js`, e as decisões estruturais estão numeradas no `@fileoverview` dela, com as medições. Esta página guarda o que atravessa arquivos: por que o namespace foi para o nome do banco, por que o expurgo é derivado e poupa, por que a adoção existe, e por que a fila de saída está do lado de dentro sem ser dado.

## O namespace vai no NOME DO BANCO, e isso foi medido

Criar um banco com nome novo enquanto outra aba mantém bancos irmãos abertos completou **21 de 21** vezes, com zero eventos `blocked` e cerca de 1 ms cada. Criar um object store NOVO dentro de um banco compartilhado é um upgrade de versão do IndexedDB: dispara `versionchange` em toda outra conexão e fica **pendente** enquanto qualquer detentor não fechar, com `blocked` como único sinal e ninguém escutando (medido: 21 de 21 pendentes até soltar). Além disso transformaria a versão do banco num contador monotônico dirigido por ação do usuário.

A conclusão que decorre e vale como regra: **"criar um atlas" nunca pode ser o upgrade de um banco existente.**

O mesmo fato tem um segundo efeito, agora do lado do apagamento. O delete de banco do IndexedDB também dispara `versionchange` e também fica pendente enquanto alguém segurar a conexão. **Ficar pendente não é propriedade da operação, é propriedade de quem não fecha**, e a re-medição de 2026-08-15 com o localforage real (preservada como teste, `frontend/tests/unit/idb-decisao4-medicao.test.js`) mostra a diferença: o localforage instala um `onversionchange` que FECHA e reconecta na transação seguinte, então um detentor que passou por ele solta e o mesmo delete completa 21 de 21. O que continua reproduzindo exatamente é o caso que motiva a decisão, um detentor que ignora `versionchange` (bloqueado 21 de 21, com `blocked` como único sinal). Ler a primeira frase como "delete nunca completa com outra aba aberta" é o erro que a medição existe para evitar.

Com um scratch único isso era impossível (duas abas remotas não existiam); com namespace por atlas, a aba A saindo enquanto a aba B segura um atlas é terça-feira comum. Daí a destruição do dado remoto ser **limpar, depois apagar**, nessa ordem e com papéis distintos:

1. `clearAtlasDatabases` ESVAZIA os bancos do escopo. Não precisa de acesso exclusivo, tem efeito imediato para toda aba, e é o passo que carrega o invariante: depois dele nenhum byte do atlas de servidor é legível em lugar nenhum.
2. `dropAtlasDatabases` apaga as cascas vazias. É higiene, não invariante, então um apagamento bloqueado é sobrevivível: ele espera com limite (`DROP_TIMEOUT_MS`), **relata `blocked` como dado** em vez de travar, e a entrada de registro é mantida para que o próximo boot sem sessão tente de novo.

A alternativa rejeitada era pedir permissão à outra aba pelo canal do tab lock antes de apagar. Ela põe o invariante mais forte do store nas mãos do ator menos confiável: uma aba congelada ou estrangulada em segundo plano ou trava o logout ou é presumida ausente, e as duas leituras são chute. Esvaziar não precisa de permissão de ninguém.

## O expurgo do remoto é DERIVADO de um registro, não de uma lista

O invariante não mudou: **nenhum dado de atlas de servidor sobrevive ao logout**. O que mudou foi que ele era garantido apagando um alvo único e conhecido, e nomes por atlas fazem o alvo deixar de ser enumerável. `indexedDB.databases()` não existe em todo motor que o app suporta, então o apagamento não pode descobrir o que existe perguntando ao navegador.

A resposta é a mesma que os atlas locais já usavam: perguntar a um registro, escrito ANTES de o namespace receber um byte. Três propriedades sustentam isso, em `frontend/src/js/store/remote-atlas.api.js`:

- **Registrar antes da primeira escrita.** `activateRemoteAtlas` persiste a entrada e só então ativa o escopo, e é por isso que nada mais deve chamar `activateScope(remoteScope(...))` direto. A ordem inversa falha em silêncio e para sempre.
- **Uma chave por atlas, nunca um array sob uma chave.** Duas abas registrando dois atlas leriam o array, somariam a própria entrada e gravariam de volta, e a entrada do perdedor sumiria, que é exatamente o resíduo inalcançável que o registro existe para impedir. Chaves separadas não competem.
- **A varredura lê do disco, sempre.** Não há espelho em memória de propósito: um espelho carregado no boot não sabe do atlas que outra aba abriu depois, e o logout aqui tem que apagar aquele também.

**O registro LOCAL usa a mesma forma, e chegou nela depois** (`LOCAL_ATLAS_PREFIX`, `frontend/src/js/store/atlas-namespace.js`, com a chave-array antiga migrada na leitura). Ele nasceu como array sob uma chave e ignorou a razão que o registro remoto já tinha escrito, até o caso concreto aparecer: duas abas cuja sessão morre junto rodam o resgate ao mesmo tempo, o read-modify-write da segunda apaga do registro o slot que a primeira acabara de salvar, e o trabalho resgatado some da lista que existia para salvá-lo, com os dez bancos intactos no disco e invisíveis para todo mundo.

**A identidade mora na CHAVE, não no valor guardado.** Um registro cujo valor não parseia ainda entrega o id do atlas pelo nome da chave, senão um dado corrompido esconderia um atlas de servidor da varredura. Mas a promessa não cobria a chave em si: um id que `remoteScope` recusa fazia o `throw` escapar da varredura INTEIRA, e uma única chave estragada deixava a máquina deslogada com todos os atlas de servidor no disco, que é o oposto exato do invariante. Por isso a entrada ilegível é PULADA com erro no console, nunca propagada: ela não nomeia namespace alcançável, e derrubar a varredura por causa dela custa todas as outras.

Corolário no boot: `enforceLocalStoreWhenLoggedOut` (`frontend/src/js/store/store.js`) roda a varredura **mesmo quando o marcador de origem diz LOCAL**, porque o marcador descreve o atlas que ESTA aba montou por último, enquanto o resíduo é o que qualquer aba abriu. É assim que o namespace de uma aba que caiu é recolhido.

**A varredura é chamada POR NOME, nunca como efeito colateral de um wipe.** Ela pendurava numa condicional `!isAuthenticated` dentro de `clearAllDataStore`, e isso fazia de todo apagamento anônimo um logout: o visitante de link público registrava o namespace e, três linhas abaixo, o próprio wipe o destruía, de modo que o snapshot público caía no slot local. Hoje quem esvazia recebe o alvo e quem varre é invocado nos dois pontos que significam "a sessão acabou", o guarda de boot e `AccountControl._handleLogout`. A regra que sobra vale para código novo: **wipe é destrutivo, então o que ele destrói é argumento, nunca inferência sobre o mundo.**

## O expurgo POUPA o que outra aba tem montado, e o perdão tem prazo

Com dois atlas de servidor abertos em duas abas, o logout de uma encontra o namespace VIVO da outra. Antes ele apagava e DESREGISTRAVA: a irmã seguia escrevendo em dez bancos que registro nenhum nomeava mais, ou seja, o expurgo produzia exatamente o resíduo inalcançável que ele existe para impedir.

A arbitragem é um Web Lock de MONTAGEM: ativar um escopo toma `atlasMountLockName(dbSuffix)` em modo compartilhado, e destruir exige o mesmo nome em exclusivo com `ifAvailable`. Recusa significa "um cliente vivo tem isto montado": o dado fica, a ENTRADA do registro fica (é o que torna a nova tentativa derivada em vez de lembrada) e o atlas sai em `spared` no relatório.

A alternativa rejeitada era o roster do tab lock, que já sabe quem segura o quê. Ele é relógio, e o próprio `frontend/src/js/utilities/tab-lock.js` documenta janelas em que mente por construção: a aba em bfcache posta uma retratação, o modo degradado deixa o roster permanentemente vazio, e o expurgo de boot roda antes de o lock sequer existir. O Web Lock é fato do navegador, liberado pela MORTE do cliente e não pelo silêncio dele, e a aba congelada o MANTÉM, que é o caso que todo esquema de batida erra.

**Poupar tem prazo (`SPARE_GRACE_MS`), e o prazo é o que separa adiar de nunca.** O único coletor de resíduo remoto é gateado em não haver sessão, e a restauração de sessão re-autentica em todo boot enquanto o refresh token durar; sem prazo, o namespace poupado não fica para depois, fica para sempre. O relógio começa na PRIMEIRA recusa e nunca é reiniciado por uma ativação posterior, senão uma aba que reconecta de tempos em tempos segura o resíduo indefinidamente.

**O lock não é fencing, então ele sozinho protege o dado sem informar o dono dele.** Ele afirma que alguém vivo tem aquilo montado e não impede esse alguém de seguir escrevendo, e a escrita que chega depois do esvaziamento RECRIA os dez bancos fora do registro, que é o resíduo inalcançável de sempre. A metade que falta é um aviso, e no logout ela existe: `announceRemoteTeardown` (`frontend/src/js/account/account.control.js`) anuncia os endereços condenados ANTES do esvaziamento, a irmã congela e SOLTA o lock de montagem, e o que seria "poupado" vira destruição no mesmo gesto. Ver [[coordenacao-entre-abas]].

Duas assimetrias sobram, e as duas são do desenho: o guarda de boot varre sem anunciar (ele roda antes de o tab lock existir), e a aba que não responde, por deploy antigo ou canal degradado, continua montada e é poupada até o prazo vencer. Em contexto não seguro (HTTP puro) `navigator.locks` não existe e a destruição segue incondicional, porque o invariante duro vence a conveniência.

**O guarda de boot depende deste relatório, e o predicado é mais largo do que parece.** `purgeReachedAtlas` conta como alcançado o namespace POUPADO e também o registrado-e-vazio, não só o que tinha dado. As duas inclusões custaram perda de dado quando faltaram: um namespace que não aparece em nenhuma lista faz o guarda responder "não alcancei" e mandar o segundo wipe sobre a ponte legada, que é o slot local #1 do usuário, no boot e sem erro. A pergunta que aquele guarda realmente faz é **"este atlas possuía namespace"**, e quem responde é o registro, não a quantidade de bytes encontrada.

## A adoção existe porque o logout preserva trabalho

`AccountControl._handleLogout` preserva o trabalho não sincronizado quando o encerramento foi involuntário (ver `shouldPreserveLocalWork`). Enquanto local e remoto dividiam bancos, preservar era só virar o marcador de origem. Com namespace por atlas, o trabalho preservado fica num namespace que a própria varredura do próximo boot apaga, com o aviso ao usuário ainda prometendo que ficou guardado.

`adoptRemoteAtlasAsLocal` fecha isso movendo a REIVINDICAÇÃO do registro remoto para o local e zero bytes entre bancos: o slot local resgatado **mantém o sufixo `remote-<atlasId>`**. Três consequências que só se veem cruzando arquivos:

- `localScope` **aceita** um sufixo `remote-<id>` de propósito, e recusa só o sufixo `remote` puro (o scratch antigo). Recusar o primeiro forçaria a cópia de dez bancos, um deles cheio de blobs de imagem, no único caminho que existe para resgatar dado.
- A ordem é reivindicação local primeiro, remoção da chave remota depois. Uma queda no meio deixa o namespace reivindicado pelos DOIS registros, o que é inofensivo porque `purgeAllRemoteAtlases` pula um namespace que um atlas local reivindica (e recolhe a chave remota obsoleta). A ordem inversa tem uma janela em que o namespace não é reivindicado por NINGUÉM, e dado de servidor sem dono é o único desfecho que este desenho não pode produzir.
- **O teto de 10 atlas locais não se aplica ao resgate.** Recusar ali seria apagar trabalho irrecuperável para defender um limite de bancos. Uma instalação pode ficar com 11; o usuário exclui um e o próximo `createLocalAtlas` volta a recusar como sempre.

O mesmo par de suffixes é o que obriga o tab lock a carregar `adoptedFrom` na chave local: o slot resgatado e o atlas de servidor são literalmente os mesmos dez bancos. Ver [[coordenacao-entre-abas]].

## O que NÃO recebe namespace, e a fila, que recebe sem ser dado do atlas

A lista do que é global à instalação está em código (`GlobalKey`, mais `perAtlas: false` nos descritores), porque errar isso faz trocar de atlas apagar a identidade do usuário. Sobra um caso que merece o porquê: **`__store_origin__` tem que ser global** por circularidade, já que ele é lido antes de qualquer coisa ser escopada e é ele que decide qual escopo usar. Escopá-lo seria escolher um namespace para descobrir qual namespace escolher. O mesmo vale para o ponteiro do atlas local corrente.

**A fila de saída É por atlas** (`perAtlas: true`), e o argumento que a mantinha global era "o envelope de operação não carrega id de atlas". Ele carrega: `createOperation` carimba `scopeSuffix` (o endereço do banco em que a op nasceu) e `atlasId` (ver [[envelope-operacao]]). Gasto o argumento, o que restava era uma tabela mutável compartilhada que toda aba lia, com o isolamento dependendo de um filtro aplicado em cada leitura. **Filtro é regra que alguém esquece; banco separado é fato do navegador.** O carimbo continua e trocou de papel: a separação virou estrutura, e ele virou asserção sobre ela (mais a identidade que o backend lê).

**A fila é o único banco por atlas que NÃO é dado do atlas** (`atlasData: false`), e essa distinção decide duas listas que parecem uma só:

- o **wipe de entrada** (`clearAllAtlasStores`, derivado de `listAtlasStores`) **não** a alcança. `openRemoteAtlas` ativa o namespace do atlas que está abrindo e esvazia três linhas depois: uma fila dentro daquela lista seria o trabalho pendente DO ATLAS QUE ABRE, destruído segundos antes do `connect` que o drenaria;
- a **destruição de namespace** (`clearAtlasDatabases` e `dropAtlasDatabases`, tudo que é `perAtlas`) a alcança, e precisa: uma op carrega o payload da entidade, então fila de pé depois do logout é dado de servidor legível, que é o invariante desta página.

Esvaziar a fila num wipe virou decisão do chamador (`clearQueue`, em `clearAllDataStore`), com default acoplado a `markLocal` porque as duas perguntas são a mesma: quem termina num store local em branco está abandonando o dado que aquelas ops descrevem, e quem monta um atlas remoto logo depois já está com a fila DELE ao alcance. Antes disso `unmountCurrentAtlas` apagava a fila inteira, de todos os atlas, no gesto mais comum do produto: a aba A trocava de projeto e destruía a feição que a aba B tinha desenhado e ainda não subira.

Um ganho que a fila global não podia dar: `adoptRemoteAtlasAsLocal` move a reivindicação e ZERO bytes, então o resgate leva a fila junto com o dado. Antes o usuário recuperava as feições e perdia o registro do que não tinha subido.

O preço, e ele não se lê em lugar nenhum: o coletor de ops velhas (`purgeOldOperations`, 7 dias) só alcança a fila do atlas MONTADO. Enumerar as outras exigiria perguntar ao navegador quais bancos existem, que é justamente o que este desenho não pode fazer. Op velha de atlas desmontado espera a próxima montagem daquele atlas ou morre junto com o `dropAtlasDatabases` dele; em nenhum dos dois casos ela volta a ser empurrável, que é a propriedade que importava. Ver [[fila-operacoes-outbound]].

`schemaVersion` é por atlas de propósito: ele descreve a FORMA do dado de um slot. Um marcador global deixaria um slot com dado antigo ser comparado contra uma versão já corrente e pular a migração em silêncio. Pela mesma razão a migração recebe o escopo como ARGUMENTO (`detectMigrationNeeded`, `frontend/src/js/store/migration/migration.service.js`): "atualizar a INSTALAÇÃO" (os bancos pré-namespace, `legacyScope`) e "atualizar um SLOT" são trabalhos diferentes, e inferir o alvo do escopo ativo confunde os dois.

## O resgate falha ALTO, e é por isso que ele não marca sozinho

Duas ordens carregam o resgate, e as duas foram, em algum momento, o inverso:

- **persiste primeiro, espelha depois.** `adoptRemoteAtlasAsLocal` grava a entrada e só então empurra o espelho em memória. Com a ordem invertida, um disco que recusa a escrita (cota) deixava `listLocalAtlases()` afirmando um slot que nenhum boot ia encontrar, apontando para bancos que a varredura seguinte esvazia: a lista mostrava o resgate e o dado já estava condenado. É a mesma regra da transação do store, efeito colateral só depois que a persistência confirma;
- **sucesso só por READ-BACK do disco.** `preserveUnsyncedWorkAsLocal` (`frontend/src/js/account/account.control.js`) relê o registro antes de marcar a origem LOCAL, porque "a função não lançou" não é "a entrada ficou gravada". Falhando, ela NÃO marca LOCAL e devolve falso: o namespace continua reivindicado pelo registro remoto e o próximo boot ainda pode tentar. Perder trabalho é irreversível; deixar dado remoto um boot a mais no disco não é.

O aviso ao usuário segue o retorno em vez de ser incondicional. Um toast que dizia "suas alterações foram mantidas neste computador" depois de um resgate falho é a pior combinação possível: o usuário fecha a aba tranquilo e o dado vai embora no boot seguinte.

## O que existe hoje, e o que ainda não

**A persistência suporta N atlas locais nomeados; a interface expõe um caminho só.** O único chamador de produção de `createLocalAtlas` é `switchToNewLocalAtlas` (`frontend/src/js/account/open-atlas.service.js`), usado ao importar um `.ebgeo` com um atlas de servidor aberto: ali substituir no lugar não é opção, porque o wipe cairia em `ebgeo_*__remote-<id>` e o projeto importado nasceria dentro do namespace que o próximo logout destrói. Então o import SAI para um atlas local novo. `setCurrentLocalAtlas` e `deleteLocalAtlas` continuam sem chamador: não existe seletor de atlas local.

`mountLocalAtlas` é export separado de `setCurrentLocalAtlas` de propósito, e a separação é a armadilha: mover o ponteiro é inofensivo, montar POR CIMA de um namespace remoto vivo redireciona escritas que a sessão conectada ainda acredita irem para o servidor. Sair de um atlas de servidor é decisão, e decisão precisa de um chamador que a escreva.

Consequência que ninguém pediu: resgate e import apontam o ponteiro de atlas corrente para o slot novo, então o "Meu Atlas" anterior do usuário continua no disco e **não tem caminho de UI de volta** enquanto aquele seletor não existir. O dado não se perde; fica inalcançável.

## Ver também

[[dominio-local-vs-remoto]] para o marcador de origem, que continua sendo quem responde "este dado tem direito de existir aqui"; [[atlas-modelo-de-dados]] para o atlas como entidade; [[sessao-boot-e-ciclo-de-vida]] para a ordem em que o boot ativa um escopo; [[formato-ebgeo-roundtrip]] para o import que sai do atlas de servidor.

## Histórico

- **2026-08-15, mais tarde no mesmo dia.** A seção do Web Lock dizia "o protocolo do tab lock não tem mensagem de desmontagem", e o aviso entrou horas depois, o que fez a frase envelhecer entre uma revisão da wiki e a seguinte. Fica a lição de ritmo, que a de forma não cobre: numa fase em curso, a doc de uma peça em construção vence rápido, então a conferência é contra o código no dia em que se escreve, não contra a nota de pendência da fase, que descreve o mundo do dia em que FOI escrita.
- **2026-08-15.** Esta página listava seis furos abertos de fiação e uma fila de saída global, e os dois blocos deixaram de valer no mesmo dia em que foram escritos. Fecharam-se, e cada um está dito acima onde pertence: `saveLocalToServer` ativa o namespace antes do wipe; o expurgo poupa o namespace montado em vez de desregistrá-lo; a varredura saiu de dentro do wipe anônimo e passou a ser chamada por nome; o resgate falha alto; a contagem de ops pendentes que dispara o resgate lê a fila do atlas montado, não a de todos; e o import de `.ebgeo` cria um atlas local novo. Não é contradição, é supersessão. A lição que sobra é de forma, não de conteúdo: uma lista de furos escrita no presente vira, sem aviso, uma lista de mentiras, e nenhum teste da casa distingue as duas (o `docs-integridade` valida caminho e símbolo, nunca a afirmação).

