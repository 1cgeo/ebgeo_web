# Acesso: superfícies, dado morto e rotas públicas

Documento de trabalho aberto em 2026-08-17, durante a fase de permissões de recurso. Ele
registra problemas **encontrados por medição**, não por leitura de plano, e a análise de como
proteger de fato as rotas que são públicas por decisão.

Convenção deste arquivo: cada item diz se foi **verificado** (li o código e cito arquivo e
símbolo) ou **relatado** (veio de um agente e ainda não confirmei). A distinção existe porque
este documento nasceu de duas afirmações minhas que não sobreviveram à leitura do código, e
ambas vinham de um plano escrito meses antes.

---

## 1. O problema de fundo: um recurso, muitas superfícies

A fase de permissões colocou o predicado de acesso no SQL, que é o lugar certo. O que ela
não fez foi perguntar **por quantas portas o mesmo recurso sai**. Um predicado correto numa
consulta não protege nada se outra consulta, outra rota ou outro cache entregam o mesmo dado.

Este já é o pior defeito que a fase encontrou em si mesma: reverter o predicado de privacidade
do MVT passava verde, porque a suíte media privacidade na listagem e nunca no tile.

Censo medido das superfícies por tipo:

| tipo | tabela | superfícies onde o recurso aparece |
|---|---|---|
| basemap | `basemaps` | seletor de basemap |
| camada de dados | `data_layers` | catálogo |
| camada de análise | `analysis_layers` | catálogo |
| modelo 3D | `tilesets` | catálogo, marcador/visualizador, e os bytes em `/api/v1/assets3d` |
| panorama 360 | `sv360.projects` | catálogo, marcador 2D, tiles MVT (pontos e linhas), busca, briefing, aba de feições, modal do atlas, calibração, fotos e miniaturas |

O 360 é lido por doze módulos do frontend. É onde o risco se concentra, e é o único tipo cuja
superfície não cabe na cabeça de quem está editando uma consulta.

**O invariante que falta, e que nenhuma das duas fases anteriores enunciou:**

> Uma decisão de acesso por recurso, e **toda** superfície deriva dela. Nenhuma superfície
> calcula a própria, e nenhum cache atravessa escopo.

---

## 2. Problemas encontrados

### P1. `streetview_markers` é uma via paralela morta, com nome que engana (verificado)

São duas coisas diferentes com o mesmo nome:

- `frontend/src/js/street_view_tool/streetview_markers.js` é a camada **viva** de marcadores do
  360 no mapa 2D. O `loadMarkers()` dela importa `fetchProjects` de `streetview-api.service.js`,
  ou seja, lê de `sv360.projects`. É 360 de verdade.
- A tabela `streetview_markers` é uma das tabelas de catálogo nascidas de
  `LIKE basemaps INCLUDING ALL` (`003_sync.sql`), servida em `/api/v1/streetview-markers`
  (`backend/src/app.js`). Ela **não alimenta** o `GET /api/config` e nenhum código do frontend a
  consome: a única ocorrência é uma linha de mapeamento tipo→caminho em
  `frontend/src/js/store/sync/api-client.js`, a serviço do CRUD do admin. Nenhum seed a popula.

Decisão tomada: **remover**, sem depreciação. Dar a ela marca de privacidade, concessão e
empréstimo seria construir permissão sobre dado que ninguém lê.

**Armadilha de execução, e ela é séria:** o arquivo de frontend homônimo **não pode ser
tocado**. Uma varredura por nome apaga a camada de marcadores do 360 no mapa, e a suíte pode
nem ficar vermelha, porque é UI. Quem executar a remoção precisa distinguir os dois por
caminho, nunca por nome.

### P2. O cache do cliente atravessa escopo (verificado)

`frontend/src/js/search/search-bar.search-providers.js` faz
`getCachedProjects() || await fetchProjects()`. A lista de projetos é decidida uma vez e
reusada por outras superfícies.

Consequência: se a lista for aquecida com um atlas em foco (que empresta um projeto privado), a
busca e as demais superfícies passam a enxergar o emprestado **fora daquele atlas**. O
invariante "o usuário só acessa aquele recurso naquele atlas" é garantido no servidor, pelo
braço de empréstimo de `fn_granted_resource_ids`, que exige o atlas em foco. No cliente, não é.

O repositório já tem a peça certa para isso: `revertGrantedResources` no `disconnect`. O cache
de projetos precisa entrar no mesmo ciclo de vida, ou ser chaveado por escopo.

### P3. A busca nunca pergunta (verificado)

A busca não tem predicado de acesso próprio: ela lê a lista acima. Hoje isso é correto por
acidente (a lista já vem filtrada), e passa a ser incorreto no instante em que a lista carrega
empréstimo por atlas. É uma superfície que o plano original nunca mencionou.

### P4. O empréstimo por atlas não alcança o 360 sobre HTTP (relatado)

Nenhuma rota de leitura do 360 recebe `atlasId`, então aquele braço da resolução está morto
sobre HTTP. Não foi esquecimento: foi recusa deliberada, porque honrar o `atlasId` sem tratar
o cache entregaria panorama emprestado a quem soubesse o UUID do atlas.

Isso agora é escopo confirmado pelo dono: o empréstimo deve alcançar os cinco tipos. Ver §3.

### P5. Privado esconde o metadado, não os bytes (verificado)

`/api/v1/assets3d/*` é público por decisão pinada em teste, e a wiki já diz a verdade sem
rodeio (`docs/wiki/assets3d-distribuicao.md`): "a proteção é 'quem não conhece a URL não
baixa'. Isso não é controle de acesso ao binário. Se um modelo for sigiloso, a URL dele é o
segredo, e URL não é segredo bom."

Marcar um modelo 3D como privado esconde o card do catálogo e mantém o `tileset.json`
baixável. Análise das saídas em §3.

### P6. O `visible` do MVT não filtra bbox e é materializado (verificado)

Em `backend/src/modules/streetview360/sv360.tiles.queries.js`, a CTE `visible` seleciona as
fotos de todos os projetos visíveis, com o predicado de acesso, **sem** filtro espacial. O
`&&` contra o envelope do tile é aplicado depois, nos consumidores. Como `visible` é
referenciada quatro vezes, o Postgres a materializa.

Consequência: a latência do tile cresce com o acervo inteiro, não com o que cabe no tile. O
custo já existe hoje e piora quando o semi-join de empréstimo entrar. Puxar o bbox para dentro
da CTE é a correção óbvia, e ninguém registrou por que não foi feita.

### P7. O credenciado revoga concessão que não é dele (verificado)

`backend/src/middleware/resource-access.js`, em `requireGrantRevoker`: o papel global é
consultado **antes** de olhar quem concedeu, então o credenciado revoga qualquer linha. A
regra decidida pelo dono é que ele concede e revoga **o que ele deu**; administrador é que
revoga qualquer uma. Correção enfileirada.

### P8. O que NÃO é problema, e eu quase registrei que era (verificado)

O regime de cache HTTP do 360 **já deriva da decisão de acesso**, e é pré-existente:
`sv360.controller.js` tem `IMMUTABLE_PUBLIC` e `IMMUTABLE_PRIVATE`, marca `private` no
GeoJSON e no MVT quando a resposta contém dado que o chamador só vê por permissão, e carrega
`Vary` para o proxy que ignora `private`.

Registro isto como item porque a versão anterior deste diagnóstico afirmava o contrário,
copiada de um plano escrito antes do código existir. O código é a realidade; o plano é a
intenção de quem o escreveu.

---

## 3. Como proteger de fato as rotas públicas

### A restrição que decide tudo

**Cache compartilhado e autorização por chamador são mutuamente exclusivos.** Uma resposta
cacheada é, por definição, uma decisão tomada uma vez e reusada por muitos. Não existe
configuração que preserve as duas propriedades ao mesmo tempo.

Daí o princípio, e ele é por RECURSO, não por rota:

> O regime de cache é função do nível de acesso. Recurso público continua no caminho rápido
> compartilhado. Recurso privado sai do cache compartilhado, por construção, e paga latência.

O 360 já implementa exatamente isso (P8). O que falta é aplicá-lo onde ainda não está.

### As três rotas públicas, e o que cada uma precisa

**`GET /api/config`** está resolvido e a solução deve ser preservada. Ele é memoizado como
**um** documento e é a rota cujo fracasso impede o app de subir. Filtrar por chamador
destruiria o memo no pior lugar possível. A saída adotada foi mantê-lo público com o acervo
público, e entregar o privado por um segundo endpoint autenticado, somado ao mesmo singleton no
cliente. Isso precisa virar asserção, não convenção: um teste que reprove se `/api/config`
passar a variar por chamador.

**As rotas de leitura do 360** já têm o regime certo. O trabalho é honrar o `atlasId` sem
quebrá-lo, e há duas condições:

1. **O UUID do atlas não pode virar senha.** Receber `?atlasId=` não é autorização: o servidor
   precisa confirmar que aquele chamador alcança aquele atlas (membro, ou portador de token de
   link público válido). Sem isso, "quem souber o UUID vê" passa a ser o modelo de segurança.
2. **O ETag precisa incorporar o conjunto de visibilidade**, senão um 304 confirma conteúdo
   através de escopos diferentes, que é o mesmo vazamento pela porta dos fundos.

**`/api/v1/assets3d/*`** é o caso não resolvido, e o único onde há escolha real. Quatro saídas:

| saída | como funciona | custo |
|---|---|---|
| **A. URL assinada** | um endpoint autenticado emite token curto ligado a (recurso, escopo, validade); a URL carrega o token | preserva CDN (a chave inclui o token), mas a URL deixa de ser estável, o que briga com `immutable`; exige ciclo de renovação no cliente; e a capacidade é repassável enquanto vale |
| **B. Separar por regime** | bytes públicos no caminho rápido; bytes privados atrás do gate, com `private` | sem cripto, sem token, sem mudança de cliente além da origem da URL; o 3D privado perde cache compartilhado; exige invariante testado de que byte privado nunca repousa na raiz pública |
| **C. Autorizar toda requisição** | gate por request | correto e caro: o Cesium faz muitas requisições por LOD, e cada uma vira consulta |
| **D. Não proteger, e dizer** | posição atual, documentada | honesta e barata; inaceitável para dado sigiloso |

**Recomendação: B**, seguindo o que o 360 já provou neste repositório (gate mais `private`).
Não introduz criptografia nem ciclo de vida de token, e o padrão já existe aqui, o que vale
mais que elegância. **A** é a resposta certa apenas se a latência medida do 3D privado se
mostrar inaceitável, e a decisão entre as duas deve ser tomada com número, não com intuição.

Nenhuma das duas entrega confidencialidade real contra quem já teve acesso legítimo: em A a
URL é repassável enquanto vale, em B o byte é baixável por quem passou pelo gate. Confidencialidade
de verdade é criptografia em repouso com chave por destinatário, que é outro projeto e muda o
formato de distribuição.

---

## 4. O que fica decidido

- `streetview_markers`: removida por inteiro, tabela e rota. Sem depreciação.
- Quatro tabelas de catálogo, cinco tipos de recurso (basemap, dados, análise, 3D, 360).
- O empréstimo por atlas alcança os cinco tipos.
- O censo de superfícies vira **teste estrutural**, no molde do censo de papel: cada superfície
  declarada com o predicado que a cobre, e superfície nova reprova até ser classificada. Sem
  isso, a próxima tela que ler `fetchProjects` reabre o buraco em silêncio.
- O controle negativo da fase é contagem, não binário: reverter o predicado em uma superfície e
  conferir que o **número certo** de casos fica vermelho. Foi assim que os quatro guardas ocos
  da fase anterior apareceram, e é a única forma de saber que o censo não está medindo o mesmo
  caminho várias vezes.

## 5. O que continua aberto

- `/api/v1/assets3d`: escolher entre A e B, com medição.
- O bbox dentro do `visible` do MVT (P6): correção conhecida, sem dono.
- Convergência dos dois sistemas de permissão de modelo 3D (`ng.catalogo_3d` com
  `ng.model_permissions`, e o desta fase). Decisão de produto.
