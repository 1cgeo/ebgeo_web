# Cobertura: IMPORTAR E EXPORTAR

Branch `hunt/cob-importexport` (worktree `C:\Users\diniz\ebgeo_hunt\peso`), a partir de `integracao_backend` em `c777d8c5`.
Atualizado em 2026-09-24, ~09:40 (segunda rodada, integrada antes em 1db55b2e).

## Commits desta campanha

| commit | tipo | o quê |
|---|---|---|
| `23cddef1` | test(import) | todo tipo de geometria de GeoJSON e GPX chega ao store e ao colega; `.7z`/`.rar` recusados sem camada fantasma |
| `c4ce94ca` | **fix**(attribute-table) | o CSV da tabela de atributos perdia a coluna **Descrição** que a tabela mostra (repro + controle negativo) |
| `ae666283` | **fix**(export) | o mapa fora da tela das exportações (PDF folha, PDF mosaico, Garmin) era ESMAGADO pelo flex do `body` quando o CSS do MapLibre vinha depois do nosso: PDF 1:25000 saía com meia folha (841x304 pt) e metade da escala declarada; ladrilhos do mosaico 1754x590 esticados para A4; ladrilho Garmin cortado de um canvas 1024x423. Controle negativo feito (as três falham com a regra antiga). **No bundle de produção de hoje a ordem dos CSS é a inversa e o defeito NÃO aparece** (conferido no `dist/`); aparece no servidor de dev, onde roda todo e2e e onde o dono trabalha. A correção independe da ordem. |
| `c9349f8a` | test(export) | "Exportar Imagem" lida pelos pixels (tamanho do canvas, >90% opaco, feição magenta no centro) |
| `fa6f4530` | **fix**(kmz) | o KMZ exportava o LEQUE de visibilidade (`processed_visibility`) e os dentes de um símbolo linear de coordenação (`coordination_line` MultiPolygon, ex. fosso anticarro 290202) SEM PolyStyle, e KML sem PolyStyle é preenchido de BRANCO opaco: no Google Earth o leque cobria o terreno de branco. Repro node + spec e2e dos 14 mapas; controle negativo feito. O censo de tipos dizia que as saídas de análise eram "puladas", o que nunca foi verdade (corrigido). |
| `05af618a` | test(export) | mosaico PDF 1x2: a feição sai no ladrilho que a pré-visualização mostra (esquerda 0 pixel magenta, direita 21106 com centróide em 0,499/0,499); prende também a ORDEM das folhas |
| `596a94dc` | **fix**(ebgeo) | UM mapa ilegível abortava a exportação inteira ("Não foi possível exportar o arquivo .ebgeo") em vez de oferecer a cópia parcial dos outros; o ramo "mapa e feições" do aviso era código morto (o repositório fabrica documento vazio e a falha chega como exceção). Repro por injeção de IndexedDB numa chave; controle negativo feito. |
| `edb5c770` | test(import) | CSV num atlas de servidor: o colega recebe campo a campo e os dois mantêm depois do F5 |
| `1d752f93` | test(export) | QAN lido linha a linha (linha e polígono importados: pernas, azimute, observação e nome escapados) |
| `b0284ce3` | **fix**(notes) | "Baixar" das notas do mapa escrevia a descrição Quill CRUA e o título SEM escape num HTML que a pessoa abre no navegador: nota de colega (ou de um `.ebgeo`) com `<img onerror>` ou `</title><script>` executava ao abrir o arquivo. Agora `escapeHtml` + `sanitizeQuillHtml`, como o painel. Spec lê o arquivo e o ABRE numa página; vermelho antes, verde depois. |
| `b46205ea` | **fix**(csv) | CSV em "Lat/Long (GMS)", o formato que o painel oferece, importava ZERO pontos: o parser abria aspas em QUALQUER `"` e a marca de segundos (`22°57'6.898"S`) engolia o separador seguinte. Repro node + spec e2e (GMS, UTM 23S, MGRS pela aba, posição conferida contra proj4/mgrs); controle negativo feito. **Deixa vermelho o `teto-de-peso` (grafo completo 11931 kB contra 11930)** pela regra do coordenador: ~0,6 kB deste fix mais ~1,3 kB do `fa6f4530`, quase tudo comentário de causa. |
| `4a151722` | test(import) | KML e KMZ soltos: ponto com altitude, linha, polígono com innerBoundaryIs, MultiGeometry de polígonos e mista, gx:Track (vira ponto móvel com 3 pontos-chave e início); atributo acentuado em toda parte; atlas de servidor com o colega recebendo igual |
| `8c3eacfe` | test(export) | símbolo de engenharia desenhado pela ferramenta sai inteiro no `.ebgeo` (campo a campo, volta com raster regenerado) e no KMZ (Placemark com PNG) |
| `f46277b9` | test(ebgeo) | `.ebgeo` ida e volta CAMPO A CAMPO sobre `03-completo-2.4.ebgeo` (805 feições, 19 tipos): zero diferença no arquivo e na reimportação |

## Matriz de ENTRADAS

Formatos enumerados do código: `drag-drop` (`FILE_TYPES`: `.ebgeo`; `.geojson .json .zip .kml .kmz .gpx .csv .tsv .rar .7z`; imagens `.jpg .jpeg .png .gif .webp .bmp`; CSV/TSV solto avisa para usar a aba Importar) e aba Importar (`geojson`, `shapefile .zip`, `kml/kmz`, `gpx`, `csv/.txt/.tsv`, "Pontos por Coordenadas", ponteiro para "Importar .ebgeo").

| entrada | geometrias | atributos e acentos | estilo | atlas local | atlas de servidor (colega recebe) | ida e volta |
|---|---|---|---|---|---|---|
| GeoJSON / JSON | ponto Z, linha, polígono com buraco, multi*, coleção, geometria nula: `cobertura-importar-geometrias` | `cobertura-importar-geometrias`, `importar-nome-e-chaves-reservadas` (KML/SHP) | n/a (GeoJSON sem estilo) | sim | `cobertura-importar-geometrias` (11 feições, mesmos ids/coords/atributos) | via `.ebgeo` (abaixo) |
| Shapefile (.zip) | polígono com furo `shapefile-sem-toreversed.repro`; dois SHP no ZIP `importar-arquivo-codificacao-e-camadas` | DBF Windows-1252 sem .cpg (mesmo spec); NOME/ID/TYPE `importar-nome-e-chaves-reservadas` | n/a | sim | `importar-em-atlas-remoto-par-recebe` | LACUNA (não há saída SHP) |
| KML | todas: `cobertura-importar-kml-geometrias` | ISO-8859-1 `importar-arquivo-codificacao-e-camadas`; name/descrição `importar-nome-e-chaves-reservadas` | `kmz-ida-e-volta-campo-a-campo` (Google Earth sem lixo) | sim | `importar-em-atlas-remoto-par-recebe` | `kmz-ida-e-volta-campo-a-campo` (ponto/linha/polígono) |
| KMZ | todas, com ícone em files/: `cobertura-importar-kml-geometrias` | idem | `kmz-ida-e-volta-campo-a-campo` | sim | `cobertura-importar-kml-geometrias` | ponto/linha/polígono só |
| GPX | waypoint, rota, trilha sem tempo, trilha com tempo (ponto móvel, trajetória): `cobertura-importar-geometrias` | desc/ele do waypoint: LACUNA | n/a | sim | `cobertura-importar-geometrias` | n/a (saída Garmin é raster) |
| CSV/TSV | ponto por coluna lat/lon | Windows-1252 e UTF-8 BOM `importar-arquivo-codificacao-e-camadas` | n/a | sim | `cobertura-importar-csv-servidor` (colega ao vivo e F5 nos dois) | LACUNA: a saída CSV (tabela) não leva coordenada; ida e volta impossível por desenho (decisão de produto, não defeito) |
| CSV coordenadas GMS/UTM/MGRS | pela TELA com posição: `cobertura-importar-csv-coordenadas` (achou o defeito do `b46205ea`) | acento em atributo | n/a | sim | LACUNA | |
| Pontos por Coordenadas | `browser-import-batch` §5.8 (N pontos, um push) | | | | sim | |
| .7z / .rar | recusa com frase e sem camada: `cobertura-importar-geometrias` | | | | | |
| Imagem solta | `imagem-reencodada-gif-bmp` (GIF, BMP, recusa tiff/MIME/10 MB, par recebe blob) | | | sim | sim | |
| .ebgeo | versões v1..2.4 `browser-import-ebgeo-versions`, `atlas-local-ebgeo-e-teardown`, `import-aditivo-pela-tela`, `atomic-import` | campo a campo: `cobertura-ebgeo-campo-a-campo` | idem | sim | `browser-p11-roundtrip` | `ebgeo-round-trip-arquivo` (contagens) + `cobertura-ebgeo-campo-a-campo` (campos) |

## Matriz de SAÍDAS (conferida por CONTEÚDO?)

| saída | onde | conteúdo aberto e lido | tipos de feição |
|---|---|---|---|
| Exportar atlas `.ebgeo` | `export-import.service.js` | SIM: `ebgeo-round-trip-arquivo` (contagens, imagens), `cobertura-ebgeo-campo-a-campo` (805 feições campo a campo), `analise-processada-round-trip`, `lacunas-de-fixture-round-trip` | 19 tipos pela fixture + `engineering_symbol` (`cobertura-simbolo-engenharia-arquivos`); coordenada da geometria sai arredondada a 6 casas por decisão declarada (`roundCoordinates`) |
| Cópia parcial `.ebgeo` | idem | SIM: `cobertura-copia-parcial-ebgeo` (grupos ilegíveis: todas as feições campo a campo, notas, reabre; um mapa ilegível: o outro sai inteiro) | ponto, linha |
| Exportar KMZ | `kmz/kmz-export.service.js` | SIM: `cobertura-exportar-kmz-tipos` (14 mapas de `03-completo-2.4`: uma entrada por feição contra o store, toast, href resolve, todo polígono com PolyStyle); campo a campo ponto/linha/polígono: `kmz-ida-e-volta-campo-a-campo` | 19 tipos (los/visibility pulados por declaração) + `engineering_symbol` (`cobertura-simbolo-engenharia-arquivos`) |
| Exportar para Garmin | `garmin-kmz-export.js` | SIM: `cobertura-exportar-garmin` (doc.kml, JPEG por sobreposição, união cobre a seleção, feição no ladrilho) | polígono |
| Exportar PDF folha (GDAL) | `pdf-export.tab.js` | SIM: `cobertura-exportar-pdf` (A4, raster 1695x1181 a 150 dpi, `/GPTS` georreferenciado, feição no pixel que a georreferência aponta) | polígono |
| Exportar PDF mosaico (jsPDF) | `pdf-mosaic-export.js` | SIM: `cobertura-exportar-pdf` (6 páginas A4, ladrilhos em proporção A4, feição no ladrilho certo pelos pixels) | polígono |
| Exportar Imagem (PNG) | `screenshot.control.js` | SIM: `cobertura-exportar-imagem` | polígono |
| CSV da tabela de atributos | `attribute-table.control.js` | SIM: `cobertura-exportar-tabela-csv` (BOM, cabeçalho, RFC 4180) | ponto |
| QAN (HTML) | `qan/qan-export.js` | SIM: `cobertura-exportar-qan` | linha, polígono |
| Notas do mapa (HTML) | `notes-panel.js` | SIM: `cobertura-exportar-notas` (texto e arquivo aberto) | n/a |
| Capturas 3D/360, perfil PNG, "Baixar meus dados" | vários | LACUNA (fora do núcleo desta área) | |

## Observações (não defeitos, ou menores)

- A saída CSV da tabela não tem coordenadas, então CSV não faz ida e volta. Decisão de produto.
- Garmin: após a recusa "Área muito grande", o botão continua dizendo "Cancelar Selecao". Cosmético.
- Duas falhas de vitest por tempo sob carga (`docs-integridade`, `tela-de-recuperacao-duas-saidas`), cada uma verde sozinha; nada a ver com esta área.

## PRÓXIMO PASSO (exato, para retomada)

Estado: worktree limpa depois de `05af618a`; `teto-de-peso` VERMELHO por 1 kB (declarado no commit); nada não verificado pendente. Portas/env: `EBGEO_UI_E2E_APP_PORT=4341 EBGEO_UI_E2E_BACKEND_PORT=3941`, Playwright de dentro de `frontend/` com `--retries=0 --workers=1`.

1. FEITO (`fa6f4530`). Observação menor não corrigida: a linha de visada processada sai com largura 2 (o KML lê `lineWidth`, a feição carrega `width: 5`).
2. FEITO (`8c3eacfe`).
3. FEITO (`4a151722`). Não conferido: se o ícone embutido do KMZ vira o ícone do ponto.
4. FEITO (`b46205ea`). Observação: a zona UTM "23S" é lida como hemisfério Sul por decisão escrita no código (banda S seria Norte).
5. FEITO (`b0284ce3`, `1d752f93`).
6. Segunda rodada (pedido do coordenador): (1) CSV em servidor FEITO `edb5c770`; (2) cópia parcial FEITO `596a94dc` (defeito); (3) feição no ladrilho do mosaico FEITO `05af618a`; (4) ícone embutido de KMZ: MEDIDO, não vira o ícone do ponto (o ponto nasce com o marcador padrão, círculo `#3f4fb5`, e nenhum rastro do ícone). O main faz o MESMO (`readKMZ` lê só o KML; o `git show main:src/js/import_export/import.control.js` confirma, e lá o resultado do togeojson passa sem a limpeza de estilo, então o caminho do ícone no máximo vira propriedade, não medido no navegador). Não é regressão: é lacuna de produto, decisão do dono (o produto tem ícone personalizado, `customIcons`, então há para onde levar). Não há `../ebgeo_web_main_worktree` nesta máquina; a comparação foi por `git show main:`, só leitura.
7. Fora de escopo por ordem do coordenador: capturas 3D/360 e PNG de perfil.
