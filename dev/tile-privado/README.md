# Ambiente de testes do tile privado

Levanta o EBGeo inteiro em Docker, atrás de um nginx, com uma cópia do banco de
configuração `ebgeo_zero`, para medir a cláusula 10.7 (a chave de API validada no
nginx antes do servidor de tiles). Apurado e rodado em 2026-08-29.

A pendência que ele serve é [`PENDENCIA-TILE-PRIVADO.md`](../../PENDENCIA-TILE-PRIVADO.md).

## Subir

```bash
npm run build --prefix frontend          # na raiz: o nginx serve frontend/dist
dev/tile-privado/scripts/preparar.sh     # dump do ebgeo_zero do cluster nativo
cd dev/tile-privado && docker compose up -d --build
```

O app abre em `http://localhost`. Contas do banco copiado, todas com senha
`tassofragoso`: `admin` (administrador), `diniz` (credenciado), `marcel` (produtor),
`pedro` (comum).

Derrubar: `docker compose down`. Derrubar e apagar a cópia do banco:
`docker compose down -v`.

## O desenho

| serviço | papel | porta |
|---|---|---|
| `nginx` | serve `frontend/dist`, faz proxy de `/api/`, e **gateia `/tiles/`** | 80 |
| `backend` | Express, contra a cópia de `ebgeo_zero` | interna |
| `martin` | servidor de tiles, sobre o banco `ebgeo_dados` | interna, NÃO publicada |
| `db` | PostGIS 16-3.4: `ebgeo_zero` (configuração) + `ebgeo_dados` (vetores) | 5442 |

A porta do Martin não é publicada de propósito: um atalho até ele seria um contorno
do gate dentro do ambiente que existe para medir o gate.

**São dois bancos porque o produto tem dois.** `ebgeo_zero` é CONFIGURAÇÃO (catálogo,
contas, atlas). Os vetores que viram tile moram noutro lugar, e aqui são sintéticos:
`rodovias` e `municipios`, com esses nomes exatos, porque é assim que as duas linhas
de `data_layers` do `ebgeo_zero` os endereçam. O catálogo real funciona sem uma
linha editada.

**A decisão em vigor é "um prefixo só":** todo o `/tiles/` exige chave, público e
privado igualmente. O preço é medível aqui: o visitante anônimo, que é o produto,
não desenha camada de dados nenhuma. Separar os prefixos é o item 3 da pendência.

## As duas sondas

Elas não são teste do repositório e não pretendem ser: a validação no nginx não tem
teste em nenhum dos dois pacotes. São a sonda com data, rodada à mão, e as duas
saem com código diferente de zero quando qualquer caso falha.

```bash
scripts/sonda.sh          # o gate do nginx: 18 casos
scripts/sonda-360-3d.sh   # o gate por recurso no serviço: 12 casos
```

**`sonda.sh` mede o gate de CREDENCIAL.** Chave viva abre nos dois escopos do
vocabulário; sem chave, chave mal formada, UUID inexistente, vencida, revogada, de
conta desativada e de sessão cortada recusam, cada uma nomeando o motivo pelo
cabeçalho `X-EBGeo-Tile-Denial`. O bloco 5 é o **controle negativo**: a MESMA linha
é revogada, medida, e restaurada; depois vencida, medida, e restaurada. Sem ele,
todos os 401 poderiam vir de "não achou a linha" e a sonda diria verde.

**`sonda-360-3d.sh` mede o gate por RECURSO**, que é outra natureza e por isso mora
noutro arquivo. Ela MUTA o banco (torna privados o tileset `PCL` e o projeto 360),
mede, e devolve os dois a público.

## O que este ambiente provou, e o que ele não prova

**Provou** (2026-08-29, as duas sondas verdes):

- O `location` do `auth_request` **funciona**, com as três amarras da chave chegando
  intactas pelo predicado de `FIND_USER_BY_API_KEY`.
- O gate vale sobre o prefixo de tile e mais nada: `GET /api/config` e o app
  continuam abrindo anônimos.
- O gate por recurso do **3D fecha**: anônimo e usuário comum levam 404 no
  `tileset.json` e no filho `.b3dm`; administrador lê.
- O gate por recurso do **360 fecha**, e a recusa dele é **subconjunto vazio, nunca
  401**: anônimo e usuário comum recebem 200 com zero byte, administrador recebe
  68 kB do mesmo tile. Quem ler status para decidir se deu certo lê 200 nos dois.

**Não prova** nada sobre o nginx de produção. Ninguém aqui viu aquele arquivo. É a
mesma distinção que `assets3d-regime.js` faz sobre o prefixo `/3d/`.

## Achados que CORRIGEM a pendência

1. **A chave de API já é credencial aceita no 360 e no 3D, sem nginx nenhum no
   caminho.** `flexibleAuth` roda globalmente e lê `?api_key=`, então
   `.../assets3d/PCL/tileset.json?api_key=<chave de um credenciado>` devolve 200
   sobre um tileset privado, e o MVT do 360 devolve o subconjunto do credenciado.
   Medido nos dois casos.
2. **A subrequisição do `auth_request` NÃO leva a query.** O backend recebe
   `GET /tile-access?` vazio, e nem `?api_key=$arg_api_key` nem `?$args` no
   `proxy_pass` mudam isso: dentro daquele `location`, `$arg_api_key` e `$args` são
   a string vazia. O que o nginx copia da requisição principal é o `unparsed_uri`,
   ou seja `$request_uri`, e é de lá que o `map` do topo de `nginx/ebgeo.conf`
   extrai a chave, entregue depois por cabeçalho `x-api-key` (que `flexibleAuth` lê
   ANTES da query). **Sem isso o gate falha fechado e parece certo:** recusa todo
   tile, inclusive o de quem porta chave viva, com resposta byte a byte igual à de
   quem não porta nenhuma.
3. **`backend/Dockerfile` não construía, e foi CONSERTADO na raiz** (a imagem passou
   de `node:20-bookworm-slim` para `node:22-bookworm-slim`). A causa é upstream:
   `better-sqlite3` 12.10.0 **removeu os prebuilds para o Node 20**, que está em fim
   de vida, e o backend está em 12.11.1. Em Node 20 não há binário para baixar, o
   `npm ci` cai no `node-gyp rebuild` e morre com `gyp ERR! find Python`, porque a
   imagem slim não traz Python nem toolchain. Em Node 22 o prebuild existe e o
   `npm ci --omit=dev` termina em cerca de 3 segundos sem toolchain nenhum, medido
   nos dois sentidos. As duas alternativas foram pesadas e recusadas: instalar
   `python3 make g++` paga uma compilação a cada build por um binário que já existe
   publicado, e pinar `better-sqlite3` em 12.9.0 congela uma dependência para
   sustentar um runtime já EOL. O `ebgeo_360`, que sobe por Docker no mesmo
   servidor, já está em `node:22` pela mesma dependência. Este ambiente constrói
   pelo Dockerfile DE PRODUÇÃO: o `backend.Dockerfile` que ele teve por algumas
   horas foi apagado, porque ambiente que constrói por outro caminho mede outro
   artefato.
4. **O índice de `assets3d-regime.js` é memoizado com TTL de 60 s e reconstruído na
   escrita de catálogo PELA ROTA.** Uma escrita direta no banco não o invalida, e
   medir logo depois mostra o tileset privado ainda aberto. Isso levaria a concluir
   que o gate do 3D falha aberto, o que é falso. `sonda-360-3d.sh` reinicia o
   backend no meio por essa razão.
5. **Todos os 7 tilesets do `ebgeo_zero` endereçam `/api/v1/assets3d/...`**, o
   indoor (`museu-1cgeo`, cena de primeira pessoa) e o único privado
   (`serra_dourada`) inclusive. Nenhuma linha usa `/3d/` nem
   `/catalogo/modelos_catalogo/`, que são os dois prefixos que contornam o Node
   segundo `assets3d-regime.js:17`. **Neste dado, o indoor não passa pelo nginx.**
6. **O acervo desta máquina não tem os bytes de `serra_dourada`**: o SQLite tem 1677
   assets, todos sob `PCL/`, `videos/` e `models/`. O 404 daquela linha é ausência de
   bytes, não recusa do gate, e os dois se parecem.

## As chaves da sonda

Semeadas por `seed/chaves-de-sonda.sql` na subida, com UUID fixo para o roteiro ser
copiável. Elas **só existem neste ambiente**.

| chave | dono | estado esperado |
|---|---|---|
| `aaaaaaaa-0000-4000-8000-000000000001` | pedro | viva, escopo `tiles` |
| `aaaaaaaa-0000-4000-8000-000000000002` | diniz | viva, escopo `full` |
| `aaaaaaaa-0000-4000-8000-000000000003` | pedro | vencida |
| `aaaaaaaa-0000-4000-8000-000000000004` | pedro | revogada |
| `aaaaaaaa-0000-4000-8000-000000000005` | sonda_inativa | conta desativada |
| `aaaaaaaa-0000-4000-8000-000000000006` | sonda_cortada | sessão cortada em massa |

## A cópia do banco não entra no git

`seed/ebgeo_zero.sql` carrega conta, e-mail e hash de senha reais. Ele está no
`.gitignore` da raiz e se regenera por `scripts/preparar.sh`.
