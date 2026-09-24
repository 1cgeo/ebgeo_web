# Relatório da frente `producao` (bundle de produção servido em HTTPS)

Worktree `C:\Users\diniz\ebgeo_hunt\producao`.

## 2º ciclo: o estado INTEGRADO no bundle HTTPS (branch `hunt/producao2`)

Base: `hunt/integra` rebaseado às 02:20 (HEAD da integração `86fde147`), bundle reconstruído em `ec104e63`. Primeira passada sobre `8b761329` (00:10 a 00:40), segunda sobre o HEAD rebaseado (02:30 em diante).

### Commits do 2º ciclo (em cima de `hunt/integra`)

1. `ba59171d` test(release): o `release-production.scenario.js` esperava 805 feições no servidor e o estado integrado dá 793. Diff por id no navegador: as 12 que faltam são exatamente as metades `processed_los`/`processed_visibility` (6 + 6), que desde `5378da27` são DERIVADAS em cada cliente e nunca sobem. O produto está certo e a expectativa era o contrato velho. O cenário conta os baldes derivados no disco local (assere > 0) e espera `805 - derivadas` e `806 - derivadas` no servidor; a asserção de 806 no disco depois do F5 continua e passa, o que prova que o autor rederiva as 12. Antes 2/3, depois 3/3.
2. `12111bce` fix(export): os dois mapas temporários de `screenshot.control.js` ("Exportar Imagem" por preserveDrawingBuffer e o fallback da captura de slide) copiam o estilo do mapa vivo e não tinham `transformRequest: credencialDeTile` (mesma classe da revisão do `c14fa9d1`). Guarda nova: bloco (d) de `tests/unit/maplibre-construtores-regua.test.js`, que exige o `transformRequest` em todo construtor cujo estilo é CÓPIA do mapa vivo, com o inventário nomeado. Antes: os 3 exportadores verdes, as 2 capturas vermelhas; depois 23/23.
3. `ec104e63` fix(admin): a aba Sistema recusa `http://` na fonte meteorológica e no servidor de tiles quando a página é https (conteúdo misto: o navegador bloqueia o `fetch` antes de sair, e o painel lia "sem conexão"). `bloqueadaPorConteudoMisto` (`frontend/src/js/admin/conteudo-misto.js`, zero imports) poupa localhost, 127.0.0.1, [::1], *.localhost e endereço relativo; só o valor ALTERADO é checado, como as checagens vizinhas. Prova: `tests/unit/config-conteudo-misto.test.js` (casos de borda; os 3 estruturais vermelhos antes da fiação) e no bundle HTTPS: antes o PUT saía com o `http://` e dizia "Configurações salvas"; depois nenhum PUT e a recusa na tela (captura lida).

4. `e5d923ca` test(release): o servidor HTTPS de ensaio (`tests/helpers/release-https-server.mjs`) perdia uma folha de estilo por `net::ERR_TOO_MANY_RETRIES` em cerca de 1 boot em 24 (corrida de reúso de socket keep-alive do servidor Node com o Chromium). Sem CSS, o `#first-person-container` (HTML estático escondido só pelo CSS principal) cobre o mapa e o spec reprova longe do assunto: foi a causa das 2 reprovações novas da segunda passada (`admin-botao-de-criar`, `coordinate-display`), cada uma verde sozinha. Medido em série: keep-alive como estava 4/96; `keepAliveTimeout` 65 s 3/48; `Connection: close` nos estáticos 0/120. Defeito do instrumento, não do produto (produção é NGINX). Depois: os 3 specs mais sensíveis 42/42 em série (`--repeat-each=3`), release 3/3.

### Segunda passada, HEAD rebaseado (`ec104e63`)

- 29 specs de UI pura: 98/101 antes do commit 4 (1 é o limite do instrumento no caso de credencial; 2 eram o CSS perdido do servidor de ensaio); depois do commit 4, os afetados 42/42.
- `release-production.scenario.js`: 3/3.
- Chromium e Firefox: PDF, 3D Cesium, primeira pessoa, admin (10 abas) e calibração, briefing Quill + `.ebgeo`, páginas anônimas: ok. Ferramentas 24/26 nos dois (LOS e visibilidade sem terreno, por desenho).
- `wss` com backend em NODE_ENV=production: ok.
- 413 em HTML atrás do limite tipo NGINX: 3/3 em série; o selo passa de "Enviando" a "Recusas: 1" em 1 s, e o ponto seguinte chega ao servidor.
- Aba Sistema com `http://`: recusada (commit 3), sem PUT.
- Firefox, specs de UI pura contra o bundle (smoke, barra de desenho, tabela de atributos, exportação, modais, deep link, processamento, aba Mapas, catálogo, busca, controles, saída de visualizador, Minha conta): 46/46.

Fechado às 03:05: worktree limpa (kit temporário em `scratchpad/producao-parked3/`), portas padrão livres. Branch `hunt/producao2` = `hunt/integra` + 4 commits (`ba59171d`, `12111bce`, `ec104e63`, `e5d923ca`).

### O que o bundle integrado mostrou (primeira passada, `8b761329`)

- 29 specs de UI pura contra o bundle: 100/101 (o 1 é o caso de credencial do `exportacao-com-fonte-que-falha`, que usa `sessaoDoApp` e importa `/src/js/...`, inexistente no bundle: limite do instrumento, não do produto).
- `release-production.scenario.js`: 2/3 antes do commit 1 acima, 3/3 depois.
- Ferramentas: 24/26 ativam nos dois navegadores (LOS e visibilidade recusam sem terreno, por desenho). PDF, 3D Cesium (230 pedidos, todos 200), primeira pessoa, admin (10 abas) e calibração: ok em Chromium e Firefox. Briefing Quill + apresentar + `.ebgeo`: ok nos dois.
- Colaboração por `wss` com backend em NODE_ENV=production: ok (ponto chega ao servidor e ao par, recarga reconecta, cookie `Secure`/`SameSite=Strict`/`HttpOnly`).
- **413 em HTML atrás de limite tipo NGINX** (servidor HTTPS com `HUNT_MAX_BODY=100000`): a versão INTEGRADA trata: dois 413 (604 KB e 602 KB, o recorte encolhe), um 200, selo "Tudo enviado", o ponto seguinte chega, e a frase pt-BR aparece. Nenhuma regressão.
- Deploy com a aba aberta: aviso "Uma versão nova foi publicada" e o botão sai do estado de carga.

### Vermelhos na suíte vitest que NÃO são meus (para o coordenador)

- `tests/unit/login-programatico-so-pelo-helper.test.js`: o censo acusa `tests/e2e-ui/offline-longo-e-reabertura.spec.js` (do `35d25528`, integrado), que escreve `ebgeo_auth` no `localStorage` direto.
- `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`, sobre o `dist/` de `ec104e63`: grafo completo 801 contra teto 797; `import_export` 18 módulos ansiosos contra 16; `index.html` 4184 kB contra 4170; `admin.html` 842 kB contra 830. Números intocados. Meus commits não acrescentam módulo ao grafo do mapa e acrescentam uma folha de ~1 kB ao `admin.html`.
- `fila-contagem-por-estado` e `tab-lock-refutacao`: reprovaram só com o build rodando em paralelo; verdes sozinhos.

## 1º ciclo (branch `hunt/producao`, integrado)

- `c4ce15b5` / `c14fa9d1`: exportação PDF (folha e mosaico) e Garmin travavam para sempre quando uma fonte do estilo falhava tarde (`repaintOnSourceError`).
- `2d1e6838` / `8b761329`: credencial do mapa vivo nos três exportadores, espera limitada com saída por "Cancelar", aviso nomeando a camada que ficou de fora.
- `df07a7d5`: 413 (duplicata, não integrado).

## Confirmados e não corrigidos

- **Sourcemaps públicos** (`sourcemap: 'hidden'` não esconde; `deploy.sh` publica os `.map`). Com o dono.
- **Catálogo semeado** com 4 fontes `http://localhost/tiles/...`: checklist de implantação.

## Suspeitas não confirmadas

- `_captureWithHiddenMap` (`screenshot.control.js`) desiste em QUALQUER `error` do mapa temporário, inclusive fonte de catálogo que falha; é fallback da captura direta, não medido.
- 404 cosmético `/images/layers/imagens-thumb.webp`.

## Linhas propostas para o livro-razão / docs

- 2026-09-23 `teste-que-nao-prende` [producao] Exportação PDF/Garmin travava sem prazo e pedia fonte privada sem credencial; nenhum spec gerava PDF. Codificado em `exportacao-com-fonte-que-falha.spec.js`, `repaintOnSourceError`, `waitForExportMap`.
- 2026-09-24 `premissa-inventada` [producao] Um mapa fora da tela que copia o estilo do mapa vivo sem copiar o `transformRequest` perde toda camada privada; a regra agora é mecânica, bloco (d) de `tests/unit/maplibre-construtores-regua.test.js`.
- 2026-09-24 `teste-que-nao-prende` [producao] O cenário de release HTTPS esperava as metades de análise no servidor depois de `5378da27` torná-las derivadas; ficou vermelho só na passada do bundle, que roda fora do `npm test`. Codificado em `release-production.scenario.js`.
- 2026-09-24 `premissa-inventada` [producao] `sourcemap: 'hidden'` "sem expor publicamente", com o `deploy.sh` publicando os `.map`. Pendente em `deploy/`.
