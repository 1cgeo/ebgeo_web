# Acesso a recurso privado (marca, concessão e empréstimo)

O eixo que decide quem enxerga um recurso do catálogo ou um projeto 360 marcado como privado: quatro papéis globais que não são escada, concessão em árvore com prazo, e o empréstimo que um atlas faz dos recursos que anexou.

Vale para os **cinco** tipos de `RESOURCE_TYPES` (`backend/src/modules/resource-access/resource-access.types.js`). Ele é ortogonal ao eixo por atlas de [[permissoes-atlas]] e ao eixo de ocultação do 360 ([[streetview-360]]), e cruzá-los é a fonte de erro desta página inteira.

## O que esta fase fechou, e por que quase toda página vizinha estava errada

`users.organization_id` era **auto-declarado** no auto-cadastro e **autorizava**: escolher a OM certa num formulário anônimo comprava a leitura dos projetos 360 ocultos e privados dela, e o `org_role` que vinha junto comprava a escrita. Hoje `organization_id` é **lotação e exibição, sem poder nenhum**, e `org_role` não decide nada em lugar nenhum do backend. Quem autoriza produção é `users.producer_org_id`, que só um administrador escreve.

Toda afirmação de wiki no formato "o `org_role` decide X" ou "mover de OM dá acesso a Y" descreve o mundo anterior a 2026-08-17. Ver [[organizacoes-om]] e [[sintese-eixos-de-permissao]].

## Os quatro papéis globais NÃO são uma escada

`user`, `producer`, `credenciado` e `admin` (`CHECK` de `users.role`, `backend/src/database/migrations/001_identidade.sql`) não se contêm: nenhum é "o de cima" de outro. **Ler todo privado** e **manter um acervo** são capacidades independentes, resolvidas por duas funções SQL distintas (`fn_has_global_data_access` e `fn_can_produce_resource`), nunca por comparação de ordem. O eixo POR ATLAS (`read < comment < write < manage < owner`) é escada, é gateado por hierarquia, e não compartilha uma palavra com este.

**A armadilha aqui é o INVERSO da que a constituição descreve.** Lá o perigo é a lista fechada que exclui o nível de cima (`perm === 'write' || 'owner'`); aqui é `if (role !== 'user')` num gate de PODER, que promove credenciado e produtor em silêncio. `backend/tests/unit/papel-global-censo.test.js` classifica cada sítio de papel global e reprova o não classificado.

O crachá e o escopo são bicondicionais no schema (`(role='producer') = (producer_org_id IS NOT NULL)`): crachá sem escopo e escopo sem crachá são estados impossíveis, e um `CHECK` unidirecional pegaria só um deles. O escopo é **uma OM só**, por decisão de produto: o gate de escrita precisa de resposta única para "quem produz isto?".

## O predicado mora no SQL, e a razão não é elegância

Quatro funções SQL são a **única** definição do que cada principal enxerga e do que ele mantém (nascidas em `backend/src/database/migrations/008_acesso_a_recurso.sql` e `backend/src/database/migrations/008_acesso_a_recurso.sql`; migração é forward-only, então elas são **redefinidas** por `CREATE OR REPLACE` a cada degrau, e a versão vigente é sempre a da migração mais alta que as toca). O papel é resolvido a partir do UUID, nunca lido de `req.user.role`. O motivo é `flexibleAuth`: ele é global, não-bloqueante, **não reconcilia**, e é justamente ele que serve `/api/config` e as leituras do 360. Decidir no JavaScript daria a um credenciado rebaixado até 15 minutos de sobrevida, e criaria uma segunda definição da regra, que é a dívida que o schema `ng` ainda paga.

Corolário para quem escreve rota nova: a garantia é do `WHERE`, então uma consulta que devolva linha de recurso sem carregar o predicado vaza sem nada ficar vermelho. Foi exatamente esse o pior defeito que este branch encontrou em si mesmo, duas vezes. É por isso que existe o **censo de superfícies** (`backend/tests/unit/superficies-de-recurso-censo.test.js` e o irmão de cliente `frontend/tests/unit/superficies-de-recurso-censo.test.js`): ele varre o versionamento e exige classe e predicado de cada consulta, gate de cada rota de leitura e escopo de cache de cada cabeçalho. Consulta nova nasce **classificada** ou reprova por nome.

## Concessão: dois níveis, árvore, e um prazo que vive no predicado

`view` vê; `view_share` vê e repassa. Essa é a única diferença, e ela é fácil de perder: `fn_can_see_resource` **não** distingue nível, então todo gate de repasse tem de perguntar o nível por fora (`requireResourceShare`, `requireResourceRelay`, `backend/src/middleware/resource-access.js`).

- **Revogar é poda de subárvore com `revoked_at`**, nunca `ON DELETE CASCADE`: a casa não faz hard-delete de entidade principal, então o CASCADE seria um mecanismo que parece existir e nunca roda, e apagar linha apaga a resposta de "quem perdeu acesso quando".
- **Várias concessões vivas por pessoa são legítimas (DAG).** Revogar derruba a subárvore daquela concessão; o que outro concedente deu continua de pé. O único 409 é a segunda concessão do **mesmo** concedente para o mesmo par, que não carregaria informação e só criaria uma irmã que a revogação da primeira não alcança.
- **O prazo é obrigatório, com teto de um ano, e morre no PREDICADO** (`expires_at > NOW()` dentro das funções), sem varredura. Um sweeper de expiração seria mais um verificador quebrando calado. Filho nunca sobrevive ao pai: o `INSERT` faz clamp por `LEAST` de três tetos.
- **Quem revoga:** administrador derruba qualquer linha; qualquer outro ator derruba só o que ele mesmo concedeu (`granted_by`). O credenciado saiu do ramo curinga porque o papel definido como "lê todo privado e não escreve nada" estava podando concessão de terceiros. Repare que o ramo estreito não pergunta por papel nenhum, e é isso que impede a lista fechada: papel novo entra por autoria, sem editar `requireGrantRevoker`.

## Empréstimo por atlas: o UUID não é senha

Um atlas anexa recursos e os empresta a quem o abre. Duas propriedades que atravessam arquivos e não aparecem em nenhum deles isoladamente:

- **O empréstimo vive enquanto o DONO do atlas vir o recurso** (D4). A condição é estável (o dono é uma coluna, não uma cadeia), então a revogação propaga sozinha, sem varredura periódica.
- **Receber `?atlasId=` diz qual empréstimo o chamador quer usar, nunca que ele pode usá-lo.** `fn_granted_resource_ids` casa `ar.atlas_id` e não pergunta se o chamador participa do atlas, e o UUID viaja em toda URL de compartilhamento. Quem autoriza é `requireAtlasScopeWhenPresent`, que compõe `requireAtlasPermission('read')` quando há atlas em foco. A ordem por rota é contrato: `validate` (não-UUID vira 422 na borda) → `liftOptionalAtlasId` (os gates de atlas leem `req.params`) → gate.
- **Atlas inalcançável PROPAGA 404.** Degradar para escopo vazio e responder o conteúdo público foi recusado: tornaria falha de autorização indistinguível de "este atlas não empresta nada", que é a classe de falha silenciosa que este eixo existe para consertar.
- **Anexar exige autoridade de REPASSE, não só de ver.** O gate era `manage` no atlas mais "vê o recurso", e quem tinha `view` (o nível cuja definição é "não repassa") emprestava assim mesmo. Somado ao `read` que um atlas `is_public` dá a chamador **anônimo**, isso entregava recurso privado sem credencial nenhuma. A correção é na porta de entrada (`requireResourceRelay`); a de saída continua `read`, porque o visitante de link público herdar o empréstimo é decisão registrada (R4), e o que a torna defensável é a cadeia começar em alguém com autoridade para repassar.

## Cache: resposta que dependeu de empréstimo nunca é publicamente cacheável

Cache compartilhado e autorização por chamador são mutuamente exclusivos, porque resposta cacheada é uma decisão tomada uma vez e reusada por muitos. A escolha é por **recurso**, não por rota, e mora num lugar só (`respostaEscopada` / `marcarEscopoJson`, `backend/src/utils/cache-scope.js`).

Dois termos, e o segundo não se adivinha: `req.user` sempre valeu, e `req.atlasId` alcança o caso que ele não alcança, porque um atlas `is_public` dá `read` a chamador anônimo. O teste é **conservador** de propósito (todo atlas em foco fecha o cache, mesmo quando o empréstimo não somou nada): o alternativo exigiria o SQL declarar "esta linha veio do braço de empréstimo", uma segunda definição do predicado dentro dele mesmo. Ver [[sintese-cache-http-imutavel]].

Ausência de `Cache-Control` **não** é neutra: o RFC 9111 autoriza cache heurístico, e a isenção para `Authorization` não segura nada aqui, porque `flexibleAuth` lê também o cookie `token` e a requisição autenticada por cookie chega sem aquele cabeçalho.

## O que o desenho não entrega, e é permanente

- **Privado esconde o metadado, não os bytes.** A rota de asset 3D é pública por decisão pinada em teste, então quem souber a URL baixa o `tileset.json` de um modelo marcado privado. Confidencialidade real de asset conflita com o regime `immutable` de que o streaming por LOD depende ([[assets3d-distribuicao]]). O 360 não tem esse problema.
- **Revogação vale no próximo pedido do payload aditivo** (troca de atlas ou F5). Não há push em socket vivo.
- **Existiram DOIS sistemas de permissão para "modelo 3D", e o outro saiu em 2026-08-19.** O do schema `ng` era completo no schema e não tinha uma única API que escrevesse nele, então o filtro existia e era inalcançável; o sintoma enquanto os dois conviveram era um administrador conceder acesso na tela errada. Hoje este eixo é o único. Ver [[catalogo-3d]].

## No cliente: soma primeiro, intersecta depois

`GET /api/config` **não** varia por chamador, e essa é a premissa que dá forma a tudo: memoizá-lo por conjunto de visibilidade seria memoizar um conjunto ilimitado no único endpoint cuja falha impede o produto de subir ([[config-dinamico]]). O que a pessoa ganha chega por um endpoint autenticado e é somado **aditivamente** no mesmo singleton (`mergeGrantedIntoBaseline`, desfeito por `revertGrantedResources`).

A ordem é D1 e é contrato: público ∪ concedido ∪ emprestado primeiro, e só então `applyAtlasSettings` intersecta as allowlists por atlas ([[atlas-settings]]). Invertida, o recurso emprestado escaparia da restrição que o Gestor configurou no mesmo atlas. O preço, que precisa aparecer na interface: um atlas que restringe a lista de modelos 3D tem de incluir ali os modelos que ele mesmo empresta, senão eles somem.

**Quem guarda uma cópia do singleton fica com o recurso depois do logout**, e por isso a guarda dos caches do cliente é **chave de escopo comparada na leitura** (`frontend/src/js/store/sync/resource-scope.js`), não uma limpeza pendurada no disconnect: limpeza só alcança o cache que alguém lembrou de registrar, enquanto o carimbo falha fechado para o próximo cache de módulo que alguém escrever.

## Relacionados

- [[resources-catalogo]]: o catálogo onde a marca de acesso mora, e o gate duplo de escrita.
- [[streetview-360]]: o quinto tipo, com um segundo eixo próprio (ocultação por `status`).
- [[sintese-eixos-de-permissao]]: como este eixo cruza com o papel global e com o eixo por atlas.
- [[auditoria]]: `PERMISSION_GRANT`, `PERMISSION_REVOKE` e `PERMISSION_PURGE`.
- [[organizacoes-om]], [[gestao-usuarios]]: lotação, escopo de produção e quem os escreve.

