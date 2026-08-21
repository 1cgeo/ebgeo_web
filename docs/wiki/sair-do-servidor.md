# Sair do servidor

Quando um atlas deixa o alcance do predicado de acesso, ele perde todo recurso de catálogo restrito; quando ele apenas muda de dono dentro do servidor, perde só o que o novo dono não enxerga.

## Duas regras, e por que elas não podem ser uma

O sistema tem **duas fronteiras** por onde o conteúdo de um atlas é copiado, e elas exigem regras diferentes por uma razão só: onde o predicado de acesso continua sendo avaliado.

**Fora do servidor** (o arquivo `.ebgeo` e a ação "Salvar como local") **não existe ponto de imposição.** O arquivo circula por e-mail e pendrive; a cópia local mora no IndexedDB de uma máquina que ninguém controla. Ninguém vai perguntar ao servidor, na abertura, se aquela pessoa pode ver aquele modelo 3D. Logo a regra é **keep-list**: sobrevive só o que resolve para recurso comprovadamente **público**, e tudo o mais sai. Vale **incondicionalmente**, inclusive quando quem exporta é o dono do atlas, e inclusive no `.ebgeo` de um atlas **local**.

A alternativa recusada é a deny-list ("é privado? sai"), e ela é a tentação natural porque parece equivalente. Não é: `isPrivateResource` (`frontend/src/js/store/sync/resource-access.service.js`) só conhece o privado que **este** cliente enxerga. Uma referência escrita por um par que enxergava o recurso chega pelo sync e responde "não é privado" à pergunta errada. Com deny-list ela viajaria no arquivo, que é o vazamento inteiro.

**Dentro do servidor** (o clone e o import) **o predicado continua valendo a cada leitura.** A pergunta certa deixa de ser "isto é privado?" e passa a ser "o destinatário vê isto?". Aí a poda é **por destinatário**, decidida pelo SQL (`fn_can_see_resource`), e o resultado é assimétrico de propósito: o mesmo atlas de origem produz cópias diferentes para duas pessoas diferentes.

A consequência que mais surpreende, e que é a prova de que as duas regras não são a mesma: **um recurso privado a que o clonador tem concessão própria SOBREVIVE ao clone e não sobrevive ao `.ebgeo`.**

## O que a decisão de exportar custa ao dono

O dono de um atlas que exporta o próprio trabalho **perde** as referências restritas dele. Isso foi decidido de olhos abertos: um teste de origem ("é meu, então pode ir") criaria dois comportamentos onde um basta, e a origem do arquivo não muda nada sobre para onde ele vai depois. A compensação é o aviso: quem exporta vê a contagem por superfície antes de confirmar, e pode desistir.

O aviso **conta tudo e nomeia só o que o cliente já sabe nomear**. Um nome que o `config` já carrega não é informação nova para quem está exportando (o documento é dele), e um id cru, que no caso do 360 é o nome do arquivo da foto, não informa ninguém. Do lado do servidor a decisão é mais estreita: a trilha de auditoria e o corpo da resposta recebem **só contagem**, nunca id nem nome, porque o nome de um recurso privado é metadado do recurso e a trilha é lida por administrador do sistema.

## O 360 sai inteiro, e isso é decisão registrada

A referência que o atlas guarda para uma foto 360 é o **nome da foto**, não o id do projeto (`saveOrientation` e `addMarker360`, `frontend/src/js/store/streetview360.operations.js`). Classificar público contra privado exige o mapa foto para projeto, que o cliente não tem localmente.

Três saídas foram consideradas:

1. carregar o id do projeto junto da referência no momento em que ela é escrita. Recusada porque resolveria só o dado NOVO: todo documento já escrito continuaria sem classificação, e a condição da decisão era não exigir migração de dado.
2. resolver por rede no momento da exportação. Recusada explicitamente: ela degrada fechado, então uma falha de rede numa exportação grande apagaria 360 **público** por acidente, no caminho irreversível.
3. podar toda referência não classificável, com aviso nomeado.

Vale a 3. Consequência aceita: **todo o 360 sai de todo `.ebgeo` e de toda cópia local**, público inclusive, e o aviso diz isso. Do lado do servidor não há esse limite: o clone e o import resolvem nome de foto para projeto em SQL.

## A poda se recusa a rodar às cegas

A soma de recursos privados (`refreshVisibleResources`) é **best-effort por desenho**: ela engole o próprio erro, porque uma falha ali não pode derrubar o login. Combinada com uma poda keep-list, uma soma que falhou classificaria todo privado **legítimo** como desconhecido, e a cópia sairia sem o acervo a que o usuário tem direito, num caminho irreversível.

Por isso `construirResolverDeSaida` (`frontend/src/js/catalog/resource-reference.resolver.js`) **lança** quando há sessão viva e a soma nunca aconteceu, e o chamador não cria slot nenhum. Sem sessão não há o que somar, e a ausência é o estado correto: o visitante anônimo exporta normalmente, com o catálogo público que é tudo o que ele alcança.

Antes de desistir, ela tenta **uma vez** refazer a soma (`retryVisibleResources`), e essa tentativa não é robustez decorativa. `disconnect` apaga a soma e dispara a substituta sem esperar por ela, descartando o erro; quem saísse de um atlas de servidor e clicasse em "Exportar" no instante seguinte, ou depois de uma re-soma que falhou por rede, recebia "Reconecte ao servidor" estando conectado. Uma tentativa, nunca um laço: a recusa continua existindo, e continua sendo a decisão certa quando de fato não há soma.

## O inventário é a peça reusável

Onde um id de recurso mora dentro de um atlas está declarado em **um lugar só**, espelhado nos dois pacotes (`frontend/src/js/catalog/resource-reference.registry.js` e `backend/src/modules/atlas/resource-reference.registry.js`), com um censo estrutural que reprova campo novo até ele ser classificado (`frontend/tests/unit/referencias-de-recurso-censo.test.js`).

O inventário existe porque a lista já cresceu sem ninguém perceber: `tilesetId`, `photoName`, `modelId` e `photoId` nasceram todos DEPOIS da poda de definição de camada de catálogo, e nenhum deles foi coberto por ela. Não havia lista contra a qual comparar.

Duas entradas do registro merecem leitura antes de qualquer mudança. A camada de base **volta ao padrão** em vez de sair, porque a coluna é `NOT NULL` com padrão e um mapa sem camada de base não desenha. E o slide é **rebaixado**, nunca apagado: título e prosa são escritos à mão e não existem em lugar nenhum além dali, então o que sai é a referência mais o modo que a exige.

### A família que o inventário por nome de campo não enxergava

A primeira versão do registro tinha onze superfícies e se declarava a única lista. Faltava uma família inteira: `atlas.settings` carrega **seis** referências de catálogo (`basemaps`, `default_basemap` e as quatro `available_*`), o clone as copiava verbatim e o import as fundia, de modo que um destinatário sem concessão nenhuma recebia a **identidade** de tileset, projeto 360 e camada privados no mesmo objeto em que o relatório de poda dizia que nada tinha sido podado.

O motivo de ela ter escapado é o que vale guardar: o censo varre por **nome de campo do cliente** (`tilesetId`, `photoName`, `modelId`, `photoId`, `baseLayer`, `catalogLayers`), e nenhum desses nomes aparece em `available_3d_models`. Um inventário cobrado por um varredor cego a uma família inteira é a forma nova do defeito que ele existe para fechar. A pergunta que a teria achado, e que agora está escrita no cabeçalho do registro, é a segunda: *que colunas de banco, além destas, aceitam um id de catálogo?*

As seis são **só do servidor** (`soServidor`), e a marca é declarada nas duas cópias: `atlas.settings` chega no snapshot, é aplicada sobre o `config` em memória e não é persistida em store nenhum nem escrita no `.ebgeo`, então quem as poda é sempre o clone ou o import.

**A armadilha delas é o sentido da poda.** Lista vazia significa **sem restrição** (`intersectAvailability`, `frontend/src/js/store/sync/atlas-settings.service.js`), então podar uma allowlist de dois ids até zero e escrever `[]` **alargaria** a cópia em vez de estreitá-la. Quando a poda leva a lista a zero, o que se desliga é a **categoria** (`features.map_3d`, `features.panoramic_images`, `features.data_layers`, `features.analysis_layers`). `basemaps` é a exceção declarada, pelo mesmo motivo de `mapa.baseLayer` voltar ao padrão: não há categoria para desligar, e um mapa sem camada de base não desenha.

## Entrar também é fronteira

Com a poda na saída, o `.ebgeo` que este app produz já vem limpo. Mas `.ebgeo` é **arquivo**: pode vir de uma versão anterior, e pode ser escrito à mão. `POST /atlas/import` grava as referências verbatim e deliberadamente não tem gate de atlas (ela CRIA um), e o que ela grava volta a sair no snapshot, servido a `read`, nível que um portador de [[link-publico]] segura.

O que a referência importada **não** entrega é byte: cada tipo tem gate próprio nos bytes. O que ela entrega é a **identidade** de um recurso privado, que é a mesma classe do vazamento que a poda de definição fechou, um degrau abaixo. Por isso a entrada também poda, e por isso ela **não** responde 4xx: recusar o arquivo inteiro por uma referência morta tornaria todo `.ebgeo` antigo inimportável.

## Entrar pelo sync: a porta que ficou aberta mais tempo

O caminho de **sync** ficou sem essa guarda para 3D, 360, slide e camada de base até 2026-08-21, e o gate de escrita por conteúdo (`unseenResourceDenialReason`, `backend/src/modules/sync/sync.service.js`) cobria só referência de camada de catálogo: qualquer membro com `write` empurrava uma operação de câmera 3D com um `tilesetId` privado e ela entrava. Hoje o gate é uma **tabela de extratores por `op.target`** (`RESOURCE_REF_EXTRACTORS`, `backend/src/modules/sync/resource-ref.extractors.js`), uma entrada por superfície, e o censo `backend/tests/unit/sync-referencia-de-recurso-censo.test.js` reprova superfície nova não classificada nos dois sentidos.

Duas escolhas dele não se adivinham. A primeira: ele **não** reusa a classificação em lote do clone. `CLASSIFY_RESOURCE_REFS` passa `NULL::uuid` como atlas em foco de propósito, porque na cópia o recurso SAI do atlas; no sync o dado FICA, então o **empréstimo por atlas conta** e o parâmetro certo é o `atlasId` da rota. Reusar a consulta do clone recusaria escrita legítima sobre recurso que o próprio atlas empresta. A segunda: a referência 360 é um **nome de foto**, não um id de projeto, então o gate compõe `RESOLVE_SV360_REFS` (`CAN_SEE_SV360_REF`, `backend/src/modules/sync/sync.queries.js`) em vez de perguntar direto: é a mesma tradução que a poda usa, e não uma segunda cópia do desempate.

Três coisas **não** mudaram, e são as que se quebram sem perceber. O `delete` continua passando, sempre: quem perdeu acesso precisa poder tirar a referência morta do mapa. A recusa é **por operação** (`rejected` + `reason`), nunca 4xx do lote, porque o cliente não faz dequeue de resposta não-2xx e um lote recusado volta a cada 1,5 s para sempre. E o gate espelha o **caminho de escrita**, não a intenção declarada no payload: um `mapTemporal` que traga um `base_layer` de carona não é recusado, porque `MAP_SUBTYPE_FIELDS` já descarta a coluna irmã, e recusar por um campo que a escrita joga fora custaria a operação inteira.

## O teto conhecido

`GET /atlas/public/:link` devolve a linha inteira do atlas, `settings` inclusive, para chamador **anônimo**. A poda desta página alcança a **cópia**, não a resposta do próprio atlas: quem publica um link decide publicar o overlay que escreveu. É uma superfície diferente e uma decisão diferente, anotada aqui para que a próxima leitura não a confunda com um buraco desta.

`CLASSIFY_RESOURCE_REFS` não filtra `sv360.projects` por `status = 'enabled'`, então a referência a um projeto público **desabilitado** sobrevive à cópia. O resíduo é pequeno (id de projeto público não é segredo) e ficou aberto.

`slideSchema` valida `model_id` e `photo_id` como **UUID** enquanto as colunas são `VARCHAR(100)` e um id de catálogo é slug: um `.ebgeo` com slide 3D apontando para um tileset por slug leva 422 na borda. É anterior a esta poda e foi achado ao escrever a fixture hostil.

## Onde isso encaixa

- [[formato-ebgeo-roundtrip]] - o contêiner e as invariantes de round-trip que a poda agora atravessa.
- [[clone-atlas]] - a rota, os gates e o que ela já descartava antes desta poda.
- [[atlas-import-offline]] - a outra porta de entidade inteira.
- [[acesso-a-recurso-privado]] - o predicado, os eixos e quem pode conceder.
- [[namespace-por-atlas]] - a cópia banco a banco em que "Salvar como local" se apoia.
