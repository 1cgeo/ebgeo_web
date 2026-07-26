# dev/

Ferramentas de operação que não são nem do `frontend/` nem do `backend/`: rodam à mão,
contra um banco, e não fazem parte de nenhum build. Não têm `package.json` próprio, elas
resolvem as dependências a partir de `backend/node_modules`.

## `import-gazetteer.mjs`

Absorve o gazetteer do banco antigo (`servico_nomes_geograficos`, schema `ng`) para o
schema `ng` deste backend: `nomes_geograficos`, `edificacoes` e `catalogo_3d`.

```bash
# dry-run: conta o que faria, não escreve (default)
node dev/import-gazetteer.mjs --source=postgresql://user:senha@host:5432/nomes_geograficos

# escreve
node dev/import-gazetteer.mjs --source=... --dedup --apply
```

| Flag | Efeito |
|---|---|
| `--apply` | Executa a escrita. Sem ela é dry-run. |
| `--dedup` | Descarta linhas idênticas em `(nome, tipo, município, estado, geom)`. No backup de 2026-07-23 são 29.544 de 81.964 (36%). |
| `--truncate` | `TRUNCATE` no destino antes de inserir. **Sem ela a carga é aditiva**, e rodar duas vezes duplica tudo. |
| `--access-level=public\|private` | A origem não tem a coluna; o destino exige. Default `public`. |
| `--skip=nomes,edificacoes,catalogo3d` | Pula tabelas. |
| `--batch=2000` | Linhas por `INSERT`. |

`DATABASE_URL` (o **destino**) sai do ambiente ou de `backend/.env`.

### Por que não é um `pg_restore` do dump

O dump do serviço antigo traz o **DDL dele**, que não é o da migração 004: recriaria as
tabelas sem `access_level`, sem as tabelas de zona/permissão, e com a função de
`tipo_peso` antiga. Aqui viaja só o dado; schema e regras são as do backend novo.

Três colunas **não** viajam, todas por serem derivadas no destino: `tipo_peso` (trigger),
`cluster_id` (só `ng.refresh_busca()`, que o script roda ao final) e o `search_vector` do
catálogo 3D (trigger). A geometria viaja como EWKB, não WKT, para não arredondar
coordenada. O `id` também não viaja: nada tem FK para o gazetteer, então o destino gera o
seu e não precisamos da extensão `uuid-ossp`.

### A dedup não mexe no cluster, e isso foi medido

A chave da dedup inclui `geom`, então só colapsa linhas na **mesma coordenada** — duas
ocorrências distintas do mesmo nome no mesmo município continuam duas linhas. Comparando
a carga completa com a deduplicada, ambas com `refresh_busca()` rodado: 0 localidades
perdidas e 0 inventadas; 44.815 grupos de `(nome, tipo, cluster_id)` nos dois; e a
estrutura de clusters (o conjunto de grupos `{nome, tipo, pontos}`) idêntica.

O que muda é a **numeração**: `ST_ClusterDBSCAN` numera por ordem de linha, então mudar o
conjunto de linhas renumera dentro da partição `(nome, tipo)`. Não é efeito da dedup — com
a tabela intacta, `refresh_busca()` rodado duas vezes não altera um único `cluster_id`.
`cluster_id` é rótulo, não identidade: nada fora do schema `ng` o persiste.

### Armadilha do `--truncate`

`ng.catalogo_3d` é referenciada por `ng.model_permissions` e `ng.model_group_permissions`.
Com linhas de permissão gravadas, o `TRUNCATE` **falha** (o Postgres exige `CASCADE`), e
isso é o comportamento desejado: apagar o catálogo em cascata levaria junto as permissões.
Limpe as permissões deliberadamente antes, ou use `--skip=catalogo3d`.

## `import-config-catalog.mjs`

Importa o `config.js` do deploy legado (o arquivo estático do branch `main`, de antes do
backend) para as tabelas de catálogo: `basemaps`, `analysis_layers`, `data_layers`,
`tilesets`, e o documento de override em `config_settings.app_config`.

```bash
# dry-run: não escreve nada, só mostra o que faria (default)
node dev/import-config-catalog.mjs caminho/para/config.js

# escreve
node dev/import-config-catalog.mjs caminho/para/config.js --apply
```

Opções:

| Flag | Efeito |
|---|---|
| `--apply` | Executa a escrita. Sem ela é dry-run. |
| `--assets3d-base=/api/v1/assets3d` | Reescreve o `url` de cada modelo 3D para o prefixo dado. Sem ela o `url` vai verbatim (caso do deploy que serve `/catalogo/...` pelo nginx). |
| `--strip-prefix=...` | O que remover do `url` antes de aplicar o de cima. Default `/catalogo/modelos_catalogo/3d`. |
| `--no-overrides` | Não escreve `config_settings.app_config`. |
| `--deactivate-missing` | `active = false` nas linhas que existem no banco e não no config de origem (soft-delete, o mesmo do DELETE no painel admin). |

`DATABASE_URL` sai do ambiente; se ausente, é lido de `backend/.env`.

### O que ele NÃO escreve, e por quê

`services.tileServerUrl`, `map2d.terrainSource`/`hillshadeSource` e `map3d.providers` são
URLs de deploy e o backend as resolve por env (`TILE_SERVER_URL`, `TERRAIN_URL`,
`HILLSHADE_URL`, `MAP3D_IMAGERY_URL`, `MAP3D_TERRAIN_URL`). Gravá-las no banco congelaria
lá um endereço que o env existe justamente para trocar por ambiente.

Também fica de fora `search.apiUrl` (o gazetteer é o próprio backend, `GET /nomes/busca`) e
`streetView360` (o shape mudou de propósito: MVT servido por este backend).

Miniatura e vídeo não viajam pelo banco: o `config` guarda só o caminho. Caminho relativo
(`./images/...`) precisa existir em `frontend/public/`; caminho absoluto (`/catalogo/...`) é
servido pelo host do deploy. O dry-run confere os relativos e conta os absolutos. A
alternativa é subir a miniatura pelo painel admin, que a embute como data URL no `config`.

### Cache

A escrita é direta no banco, então ela **não** passa pelo invalidador do memo do
`/api/config` (`config.cache.js`). É exatamente o caso que o TTL de segurança cobre: a
mudança aparece em até `CONFIG_CACHE_TTL_MS` (default 30 s), ou na hora se o backend for
reiniciado.

### Windows

Use o PowerShell para as flags com caminho POSIX. No Git Bash, o MSYS converte
`--assets3d-base=/api/v1/assets3d` em `C:/Program Files/Git/api/v1/assets3d` antes do node
ver o argumento; o script detecta e aborta em vez de gravar 98 urls quebradas.
