# O gate do tile privado (o que o nginx serve, e por quem ele pergunta)

Os bytes do tile de uma camada de dados, de análise ou de basemap **não passam pelo Node**: eles saem do servidor de tiles atrás do nginx. Esta página existe porque essa é a única superfície de recurso privado em que o predicado de acesso não pode ser embutido na consulta que serve o dado, e a saída escolhida tem um vocabulário próprio.

Ela é irmã de [[acesso-a-recurso-privado]], que decide **quem** enxerga o quê, e de [[assets3d-distribuicao]], que é a superfície equivalente do 3D, servida pelo próprio backend. A diferença entre as duas explica quase tudo o que segue.

## Por que este caso é diferente dos outros três

O produto protege o acervo privado por quatro caminhos, e três deles põem o Node no caminho dos bytes: o 3D e o 360 são servidos por rota própria, com o predicado dentro da consulta ou num gate montado na rota. O quarto não: o endereço do tile é **texto livre digitado pelo administrador** e gravado em `config` JSONB, e o caminho é MapLibre, nginx, servidor de tiles.

A consequência prática é que aqui **o catálogo esconde a URL e não move byte nenhum**. Marcar a camada como privada tira o endereço do payload; quem já o tivesse visto continuava baixando. Era segurança por obscuridade, e a cláusula 10.1 da [`CONSTITUICAO.md`](../../CONSTITUICAO.md) a registra como defeito desde 2026-08-20.

## Como ele funciona hoje

O nginx pergunta ao backend, antes de fazer o proxy, por `auth_request` contra `GET /api/v1/auth/tile-access`. O gate (`requireTileAccess`, `backend/src/modules/auth/tile-access.js`) resolve o caminho pedido contra um índice em memória de catálogo (`backend/src/modules/nomes/tile-regime.js`) e responde um de quatro desfechos:

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

## O que fica de fora, e é decisão, não pendência

- **URL de terceiro só pode ser pública** (decisão do dono, 2026-08-29). Não há gate possível sobre servidor alheio. Hoje o efeito já é seguro pelo índice, que não cria entrada para endereço de outra origem, e o gate portanto recusa; o que falta é o **422 na escrita**, para que o cadastro avise em vez de deixar a pessoa descobrir no primeiro tile.
- **O visitante de link público alcança o recurso privado emprestado**, mesmo deslogado. A cláusula 6.3 foi reexaminada e **mantida**: restringi-la a quem tem conta não protegeria nada, porque o auto-cadastro é aberto. O eixo que separa de verdade é a **nomeação**, e o dono decidiu que ela continua não sendo exigida ali; o que mudou é que a tela passou a nomear, ao publicar o link, os recursos privados que o atlas empresta (cláusula 6.6).
- **A foto de item de uma cena indoor emprestada não desenha para o visitante.** Ela vira `img.src`, que só o cookie alcança, e o visitante não tem cookie.
- **Nada neste repositório prova o que o nginx do host faz.** Isso é sonda com data, rodada à mão no deploy, pela mesma razão que a 10.1 registra sobre o prefixo `/3d/`.

## Onde isto é medido

O ambiente de `dev/tile-privado/` sobe o produto inteiro em Docker (nginx, backend, Martin, cópia do banco de configuração) com um acervo que tem a forma do real: 53 camadas, 26 privadas, cobrindo as sete situações que o gate precisa distinguir. Seis conferências, com controle negativo em cada bloco. O README de lá diz o que elas provam e o que não provam.

Uma delas, `confere-gate-por-recurso.sh`, foi escrita **antes** do código, como enunciado executável: ela saiu de 12 casos pendentes para 24 de 24, e o dia em que ficou verde foi a medição de que o gate existe.
