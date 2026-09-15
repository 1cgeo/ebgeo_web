# O gate do tile privado (o que o nginx serve, e por quem ele pergunta)

Os bytes do tile de uma camada de dados, de análise ou de basemap **não passam pelo Node**: eles saem do servidor de tiles atrás do nginx. Esta página existe porque essa é a única superfície de recurso privado em que o predicado de acesso não pode ser embutido na consulta que serve o dado, e a saída escolhida tem um vocabulário próprio.

Ela é irmã de [[acesso-a-recurso-privado]], que decide **quem** enxerga o quê, e de [[assets3d-distribuicao]], que é a superfície equivalente do 3D, servida pelo próprio backend. A diferença entre as duas explica quase tudo o que segue.

## Por que este caso é diferente dos outros três

O produto protege o acervo privado por quatro caminhos, e três deles põem o Node no caminho dos bytes: o 3D e o 360 são servidos por rota própria, com o predicado dentro da consulta ou num gate montado na rota. O quarto não: o endereço do tile é **texto livre digitado pelo administrador** e gravado em `config` JSONB, e o caminho é MapLibre, nginx, servidor de tiles.

A consequência prática é que aqui **o catálogo esconde a URL e não move byte nenhum**. Marcar a camada como privada tira o endereço do payload; quem já o tivesse visto continuava baixando. Era segurança por obscuridade, e a cláusula 10.1 da [`CONSTITUICAO.md`](../../CONSTITUICAO.md) a registra como defeito desde 2026-08-20.

## Como ele funciona hoje

O nginx pergunta ao backend, antes de fazer o proxy, por `auth_request` contra `GET /api/v1/auth/tile-access`. O gate (`requireTileAccess`, `backend/src/modules/auth/tile-access.js`) resolve o caminho pedido contra um índice em memória de catálogo (`backend/src/modules/nomes/tile-regime.js`) e responde um de quatro desfechos (mais dois que esta página não contava: um **503** quando o índice nunca chegou a ser construído, que até 2026-09-01 esta página prometia e o código não entregava (ele fazia `next` com o erro cru do driver, que não é `AppError` e não está no mapa do `errorHandler`, então o desfecho real era 500); e os mesmos quatro desfechos decididos a partir de um índice VENCIDO, quando a reconstrução falhou e o gate caiu para o último índice bom. Esse segundo caso era MUDO, hoje deixa uma linha de transição com a idade do índice, e tem TETO: passado `REGIME_STALE_MAX_MS`, a resposta que entrega bytes vira 503 também. Ver [[observabilidade]]):

| caminho | resposta |
|---|---|
| nenhuma linha de catálogo o reivindica | **401** |
| linha pública | **200, sem credencial nenhuma** |
| linha privada, sem principal | 401 |
| linha privada, com principal | `fn_can_see_resource`, memoizado |

### As três coisas que não se deduzem lendo o código

**O caminho não reivindicado é RECUSADO, e isso inverte a regra do irmão.** Em `assets3d-regime.js` um caminho que nenhuma linha descreve é **público**, e lá isso é seguro: o Node serve o acervo inteiro e há arquivos legítimos fora do catálogo. Aqui o endereço é digitado à mão e serão centenas de camadas, então um erro de digitação numa linha privada a publicaria em silêncio. O preço da inversão é que uma fonte publicada sem cadastro deixa de desenhar, e esse defeito é **visível** ("cadastrei e não aparece"), enquanto o outro é mudo.

**Na colisão, a linha privada vence.** Duas linhas reivindicando a mesma fonte é erro de cadastro, e a leitura segura de um erro é a restritiva. Sem esse desempate, bastaria cadastrar uma linha pública homônima para abrir qualquer fonte, o que faria do cadastro de catálogo um caminho de escalação de acesso.

**A subrequisição do `auth_request` não leva a query.** O backend recebe `GET /tile-access?` vazio, e nem `?api_key=$arg_api_key` nem `?$args` no `proxy_pass` mudam isso: dentro daquele `location`, `$arg_api_key` e `$args` são a string vazia. O que o nginx copia da requisição principal é o `unparsed_uri`, ou seja `$request_uri`. **Sem saber disso o gate falha fechado e parece certo:** recusa todo tile, inclusive o de quem porta credencial válida, com resposta idêntica à de quem não porta nenhuma.

## Como a credencial chega ao tile

São três transportes, e a diferença entre eles decide o que cada um alcança.

- **O cookie de sessão** é o transporte do navegador, emitido no login desde 2026-08-29. O MapLibre monta o pedido sem `credentials`, o Fetch aplica o default `same-origin`, e o cookie viaja sozinho. É o único que alcança `img.src` e `<video src>`, que não aceitam cabeçalho e não têm API que os carimbe. Ver [[auth-flexivel]] para a precedência entre cookie, cabeçalho e chave.
- **O cabeçalho**, por `credencialDeTile` (`frontend/src/js/map/credencial-de-tile.js`), cobre o visitante de link público (cujo token é efêmero e não vira cookie) e o deploy cross-origin, em que `SameSite=Strict` retém o cookie.
- **A chave de API na URL** fica para integração **fora** do navegador. Ela é portadora, aparece no log de acesso do nginx e no `Referer`, e é o caminho mais caro: medida em +480 µs por tile, contra zero do cookie, porque `FIND_USER_BY_API_KEY` é uma consulta ao banco por requisição. Ver [[api-keys]].

**E viaja uma QUARTA coisa, que não é credencial nenhuma:** o `?atlasId=` do atlas em foco, desde 2026-09-15. Ele diz QUAL empréstimo o pedido quer usar, e quem decide se o chamador pode usá-lo é `requireAtlasPermission('read')`, dentro do predicado. Confundi-lo com credencial é o erro que o cabeçalho de `assets3d-acesso.js` já nomeia: o UUID do atlas viaja em toda URL de compartilhamento. Ele é a única autorização do visitante de link público, e vale mesmo SEM token, porque um atlas `is_public` dá leitura a chamador anônimo.

## O custo, medido

Cinco rodadas de 200 pedidos com conexão reusada, em 2026-08-29:

| cenário | µs por pedido | acima do piso |
|---|---|---|
| piso (rota sem gate de tile) | 1130 | (referência) |
| tile público | 1135 | +5 |
| tile privado por cookie | 1130 | 0 |
| tile privado por chave de API | 1610 | +480 |

**O gate custa zero mensurável**: o índice em memória responde o caminho público sem tocar no banco, e a decisão do privado é memoizada por (chamador, empréstimo, recurso). Um `proxy_cache` na subrequisição do nginx foi considerado e **recusado**: ele compraria atraso de revogação em troca de um ganho que a medição não acha. Se o volume um dia apertar, o alvo que a tabela indica é outro: memoizar a resolução da **chave**, não a subrequisição.

*(A primeira medição foi jogada fora: ela lançava um processo por pedido, e o piso saiu em 35 ms, que é o custo de criar processo no Windows. Nela o tile público chegou a medir menos que o piso, que é o sinal de que o instrumento dominava o sujeito.)*

## O empréstimo por atlas, que chegou ao tile em 2026-09-15 (D17)

O ramo de empréstimo de `fn_granted_resource_ids` depende do atlas em foco. Ele é o único braço do predicado que alcança o visitante de link público, e desde 2026-09-15 ele vale aqui como vale na listagem, no catálogo somado, no briefing, na busca e nos ativos 3D e 360.

Três coisas que não se leem no código, e a primeira é a que custou dezessete dias.

**A QUERY SEMPRE ATRAVESSOU, e a cláusula 6.7 dizia o contrário.** A subrequisição do `auth_request` chega ao backend sem query própria, e daí esta página concluiu que o atlas não podia atravessar e que o conserto exigiria um cabeçalho NOVO no nginx. A primeira metade é verdadeira; a conclusão não é. O que o nginx copia da requisição principal é o `unparsed_uri` INTEIRO, que ele já manda em `X-Original-URI` para que o gate resolva o CAMINHO, e o `?atlasId=` sempre esteve lá dentro, do mesmo jeito que o `map` do topo daquele arquivo já tira a chave de API do mesmo texto. Quem extrai é `atlasDoTile`; o `location` do host não mudou uma linha por causa do empréstimo. **Uma observação verdadeira virou uma conclusão falsa, e a conclusão foi carregada como escopo de trabalho.**

**A PENEIRA DE UUID É OBRIGATÓRIA AQUI, e não nas outras superfícies.** Lá o `?atlasId=` passa por `validate` e um valor torto morre como 422 na borda; aqui ele vem de um cabeçalho que nenhum schema olha. Sem a peneira, um `atlasId=x` desceria para um cast `::uuid` e viraria um 500 por TILE.

**O DEFEITO NÃO FOI ACHADO PELAS CONFERÊNCIAS**, e a razão continua valendo para quem escrever a próxima: elas mediam `?atlasId=` inventado, que tem de dar 401, e nunca mediram um empréstimo REAL passando. Um par negativo sem o positivo do mesmo eixo passa verde sobre um ramo que não funciona, que é a cobertura vazia da constituição na forma mais discreta. Os três guardas de hoje levam o positivo junto: `frontend/tests/unit/tile-carimba-atlas-emprestado.test.js`, `backend/tests/integration/tile-emprestimo-por-atlas.test.js` e `frontend/tests/e2e/tile-emprestimo-contrato.e2e.test.js`.

### O carimbo do lado do cliente, e por que ele mora no `transformRequest`

Quem escreve o `?atlasId=` na URL do tile é `credencialDeTile`, pela mesma função de carimbo que o 360 usa (`stampAtlasOnUrl`). O `fileoverview` de `frontend/src/js/street_view_tool/tile-scope.js` ELIMINA o `transformRequest` como lugar de carimbo, com medição, e a conclusão dele não se transporta para cá porque o sujeito é outro: lá o carimbo escolhe CONTEÚDO (o mesmo z/x/y do MVT devolve feições diferentes por atlas, e o `TileManager` chaveia o cache por z/x/y, então um tile carregado sob um atlas seria reentregue dentro de outro sem pedido nenhum); aqui ele só autoriza a BUSCA, porque o tile de uma camada de dados tem o mesmo corpo para todo mundo. O que a reutilização por z/x/y produz no tile é um tile já baixado continuar na tela depois de trocar de atlas, que é a mesma parcialidade já declarada em [[acesso-a-recurso-privado]] para a camada viva depois de uma revogação.

O preço fica dito: com um atlas aberto, TODO tile das duas bases credenciadas sai com `?atlasId=`, o da camada pública inclusive, porque o cliente não sabe quais endereços pertencem a linha privada. Saber exigiria uma segunda cópia do índice de regime dentro do navegador.

**E uma armadilha de configuração que só apareceu ao medir:** `TILE_SERVER_URL` é uma BASE (`/tiles`, `http://host/tiles`), nunca um template com `{z}`. Escrita como template, a comparação por fronteira de caminho do cliente não casa endereço nenhum, o carimbo fica inerte e a camada emprestada volta a não desenhar, sem erro em lugar nenhum. O mesmo valor é lido pelos dois lados: o cliente decide por ele quais URLs recebem carimbo, e o índice do servidor indexa o catálogo por ele.

### O regime de cache, e por que ele é escrito numa resposta sem bytes

A decisão do desfecho privado passou a depender de QUEM pede e de QUAL atlas está em foco, então a resposta não pode ser guardada por um cache compartilhado: o `?atlasId=` separa URLs e **não separa pessoas**, e dois chamadores pedem a mesma URL com só um alcançando o atlas. Quem marca é `marcarEscopoDeTile` (`backend/src/utils/cache-scope.js`), sobre o mesmo predicado das rotas JSON e com o mesmo valor, `private, no-cache`.

A torção é do desenho e não do arquivo: os bytes do tile nunca passam por este processo, então o `Cache-Control` escrito na resposta VAZIA do `auth_request` é uma INSTRUÇÃO ao host, que o copia para o tile por `auth_request_set` mais `add_header`, pelo mesmo caminho por onde o motivo da recusa já viaja. O tile PÚBLICO continua sem cabeçalho nosso, e por isso o `add_header` do host, cujo valor vem vazio nesse caso, não acrescenta nada.

`no-store` foi considerado e recusado: ele mataria também o cache do navegador, e um deslocamento de mapa rebaixaria a camada privada inteira à rede outra vez.

**O que fica como sonda com data no deploy:** que o host copie esses dois cabeçalhos, e que ele esconda o `Cache-Control` do servidor de tiles caso este emita um próprio na linha privada (duas diretivas coexistindo combinam, e `private` continua proibindo a guarda compartilhada, mas um `public` vindo de trás é o tipo de contradição que não vale deixar em pé). O `location` de `dev/tile-privado/nginx/ebgeo.conf` está na forma que a sonda deve conferir.

## O que fica de fora, e é decisão, não pendência

- **URL de terceiro só pode ser pública** (decisão do dono, 2026-08-29). Não há gate possível sobre servidor alheio. Hoje o efeito já é seguro pelo índice, que não cria entrada para endereço de outra origem, e o gate portanto recusa; o que falta é o **422 na escrita**, para que o cadastro avise em vez de deixar a pessoa descobrir no primeiro tile.
- **O visitante de link público alcança o recurso privado emprestado**, mesmo deslogado. A cláusula 6.3 foi reexaminada e **mantida**: restringi-la a quem tem conta não protegeria nada, porque o auto-cadastro é aberto. O eixo que separa de verdade é a **nomeação**, e o dono decidiu que ela continua não sendo exigida ali; o que mudou é que a tela passou a nomear, ao publicar o link, os recursos privados que o atlas empresta (cláusula 6.6).
- **A foto de item de uma cena indoor emprestada não desenha para o visitante.** Ela vira `img.src`, que só o cookie alcança, e o visitante não tem cookie.
- **Nada neste repositório prova o que o nginx do host faz.** Isso é sonda com data, rodada à mão no deploy, pela mesma razão que a 10.1 registra sobre o prefixo `/3d/`.

## Onde isto é medido

O ambiente de `dev/tile-privado/` sobe o produto inteiro em Docker (nginx, backend, Martin, cópia do banco de configuração) com um acervo que tem a forma do real: 53 camadas, 26 privadas, cobrindo as sete situações que o gate precisa distinguir. Seis conferências, com controle negativo em cada bloco. O README de lá diz o que elas provam e o que não provam.

Uma delas, `confere-gate-por-recurso.sh`, foi escrita **antes** do código, como enunciado executável: ela saiu de 12 casos pendentes para 24 de 24, e o dia em que ficou verde foi a medição de que o gate existe.
