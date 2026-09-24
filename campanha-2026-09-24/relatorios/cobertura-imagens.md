# Cobertura: IMAGENS (campanha de 2026-09-24)

Branch `hunt/cob-imagens` (a partir de `integracao_backend` c777d8c5), worktree `C:\Users\diniz\ebgeo_hunt\migracao`.

Três formas:
- **(A) feição de imagem** (ferramenta Imagem): blob em `ebgeo_images` sob o id da feição, fila durável de blob
  (`store/sync/blob-upload-queue.js`), rota bulk, `getImage` que cai no servidor. Porta re-encoda por canvas
  (máx. 800 px; GIF/BMP viram PNG; SVG recusado; teto 10 MB antes de ler).
- **(B) foto anexa** a qualquer feição: data URL em `properties.images` (`user_data_manager.addImage`). Em
  mudança pelo agente rede (`hunt/fotos`: compressão para 1600 px q0,8 já feita; desenho blob+id). Não edito
  `image_utils.js`, `user_data_manager.js`, `image-limit-phrases.js`.
- **(C) figura dentro de slide de briefing** (Quill, data URL no HTML do slide).

## Fatos do código

- **(A) portas**: ferramenta (seletor de arquivo) e arrastar e soltar aceitam jpeg/png/webp/gif/bmp; tudo passa por canvas até 800 px (JPEG q0,7 fica JPEG; GIF, BMP, PNG, WebP viram PNG; GIF animado vira o primeiro quadro). SVG recusado. Teto de 10 MB ANTES de ler (exatamente 10 MB passa), 8192 px por lado, 50 MP.
- **(A) caminho do byte**: id cunhado no cliente, `storeImage` local, fila durável de blob (`store/sync/blob-upload-queue.js`) pela rota bulk (a única que preserva o id), op da feição PREPARADA até o blob confirmar. `getImage` cai no servidor quando o cache local erra; `map.hasImage` é verdadeiro também com o placeholder de 404.
- **(A) exclusão**: o servidor NÃO apaga a linha de `images` quando a feição é excluída; o cliente guarda o blob até o passo sair do histórico de desfazer (`_purgeOrphanedImageBlobs`, `store-state-manager.js`). `deleteLayerFeatures` libera os blobs (exclusão de camada não é desfazível); o mover de camada entre mapas passa `releaseImages: false`.
- **(A) cópias**: colar, colar aqui, duplicar seleção e copiar camada para outro mapa cunham id novo no CLIENTE e sobem o blob por `uploadCopiedBlobsIfRemote`; duplicar mapa (atlas de servidor, desde 2026-09-23) e clonar atlas copiam no SERVIDOR (`withPreparedImageCopies`, `atlas.service.js`), com o id da feição igual ao id da cópia do blob.
- **(A) servidor**: só png/jpeg/webp, conferido pelos bytes; CHECK de MIME no banco; `MAX_IMAGE_SIZE_MB` 10.
- **(B) portas**: galeria de fotos da feição (`feature-photo-gallery.js` → `userDataManager.addImage`), jpeg/png/webp; data URL dentro de `properties.images`; viajam DENTRO da op da feição. Em mudança pelo agente rede (`hunt/fotos`).
- **(B) cópias no servidor**: duplicar mapa e clonar atlas copiam `properties` inteiras, então as fotos vão junto como texto.
- **(C) portas**: colagem no Quill (png/jpeg/webp/gif/bmp, teto 5 MB, re-encode JPEG até 800x600; SVG recusado nas duas grafias). Figura é data URL no HTML do slide, viaja na op do slide; `sanitizeQuillHtml` deixa passar `img`.
- **KMZ**: exporta a feição de imagem como GroundOverlay e as fotos numa pasta; a IMPORTAÇÃO (`import.control.js`, @tmcw/togeojson) põe `images: []` e não reconstrói GroundOverlay como feição de imagem.

## Matriz

Legenda: arquivo de spec (e2e-ui salvo indicação) = coberto; **LACUNA** = sem teste de navegador que meça BYTES; "presença" = teste existe mas mede só `hasImage`/contagem. Atualizado conforme a campanha anda.

| Etapa | (A) feição de imagem | (B) foto anexa | (C) figura de slide |
|---|---|---|---|
| PNG | figura-aparece-na-hora-em-link-lento; colaboracao-mista-chromium-firefox (colega só tamanho > 0) | browser-collab-conversao-linear; lacunas-de-fixture-round-trip | quill-html-colado-com-imagem |
| JPG / WebP | coberto por imagem-formatos-pela-ferramenta (0c7c11e2): JPEG fica JPEG, WebP vira PNG, colega com o mesmo SHA | coberto por foto-anexa-formatos-offline-e-desfazer (e6845726): JPEG, PNG, WebP pela galeria, colega com o mesmo SHA | coberto por briefing-figura-formatos-e-sem-rede (6052587c): todos viram JPEG, colega com o mesmo SHA |
| GIF / BMP | imagem-reencodada-gif-bmp (pixel do 1º quadro, linha PNG no banco, colega) | GIF recusado pela galeria com a frase (e6845726) | coberto por 6052587c (GIF e BMP colados viram JPEG) |
| SVG | coberto por imagem-formatos-pela-ferramenta (0c7c11e2): recusa pelo seletor, nada nasce; também HEIC e lado > 8192 px | recusa só unitária | quill-html-colado-com-imagem (duas grafias) |
| Foto de celular grande | coberto por imagem-formatos-pela-ferramenta (0c7c11e2): 4032x3024 (3,9 MB) vira 800x600; EXIF 6 nasce em pé | **LACUNA** | coberto por 6052587c (4032x3024, 3,9 MB, reduzida a 800) |
| Perto / acima de 10 MB | coberto pelo seletor em imagem-formatos-pela-ferramenta (0c7c11e2): 10 MB exatos entram, +1 byte recusado com a frase; solta de 11 MB em imagem-reencodada-gif-bmp | envio-com-fotos-anexas.repro (5 x 2,4 MB; frase do 413) | teto de 5 MB coberto por 6052587c (5 MB + 1 recusado com a frase; dois portões em série) |
| Substituir | não existe no produto | não existe | n/a |
| Redimensionar / rotacionar | coberto por imagem-redimensionar-e-rotacionar (a2ac55bd): painel real, colega e F5, bytes inalterados | n/a | n/a |
| Excluir e desfazer (bytes voltam?) | coberto por imagem-copias-leva-bytes (0c7c11e2): autor, colega e F5 dos dois | coberto por e6845726: feição excluída e desfeita volta com as fotos; remover UMA foto e desfazer a devolve, nos dois lados | n/a: excluir slide é destrutivo confirmado e briefing não tem desfazer |
| Copiar / colar | browser-collab-colar-imagem (colega getImage, controles) | via Duplicar Seleção em foto-anexa-nas-copias (8bbe5ceb) | n/a: slide e briefing não têm copiar nem duplicar; a figura colada no editor é a porta de criação |
| Colar aqui | coberto por imagem-colar-aqui-e-duplicar (16521c76), menu de contexto real, SHA no colega | mesmo caminho do Duplicar Seleção (8bbe5ceb) | n/a |
| Duplicar seleção | coberto por imagem-colar-aqui-e-duplicar (16521c76) | coberto por foto-anexa-nas-copias (8bbe5ceb) | n/a |
| Mover para outra camada | coberto por imagem-copias-leva-bytes (0c7c11e2) | coberto por foto-anexa-nas-copias (8bbe5ceb) | n/a |
| Mover / copiar camada para outro mapa | coberto por imagem-copias-leva-bytes (0c7c11e2): cópia com id novo e bytes no colega; mover mantém o blob local | copiar: foto-anexa-nas-copias (8bbe5ceb) | n/a |
| Duplicar mapa (rota do servidor) | coberto por imagem-copias-leva-bytes (0c7c11e2): autor, colega, F5, controles; figura recém-posta: defeito 71fa8585 (espera a subida) | coberto por foto-anexa-nas-copias (8bbe5ceb) | n/a |
| Clonar atlas | coberto por imagem-copias-leva-bytes (0c7c11e2); figura recém-posta: defeito 71fa8585 (aviso antes de copiar) | coberto por foto-anexa-nas-copias (8bbe5ceb) | coberto por briefing-figura-leva-bytes (fb450938) |
| .ebgeo exportar e reimportar | atomic-import (bytes e decodificação); ebgeo-round-trip-arquivo (presença); SHA pela tela: 2453be9f | lacunas-de-fixture-round-trip (igualdade profunda com data) | ebgeo-round-trip-arquivo (conta slides); servidor, colega, F5 e clone com SHA: briefing-figura-leva-bytes (fb450938) |
| KMZ exportar e reimportar | ida coberta por imagem-nas-saidas-do-mapa (fb450938, SHA da figura no KMZ); VOLTA: limitação medida (figura volta como polígono sem imagem) | ida coberta (fb450938, foto decodificada no KMZ); VOLTA: limitação medida (0 fotos) | n/a (KMZ não leva briefing) |
| PDF | coberto por imagem-nas-saidas-do-mapa (fb450938): pixels da figura no raster da folha única; captura "Exportar Imagem" também | o PDF não lê fotos (produto) | n/a |
| Enviar ao servidor (atlas local) | coberto por envio-leva-figura (fb450938): linha de bytes, desenho no autor, SHA em outra sessão | envio-com-fotos-anexas.repro; SHA em outra sessão: envio-leva-foto-e-figura-de-slide (734f1227) | coberto por 734f1227 (SHA no Postgres e em outra sessão) |
| Resgate de sessão | coberto por imagem-resgate-de-sessao (f6d8a530): figura com subida segurada, sessão cai, atlas resgatado desenha com o mesmo SHA, Enviar ao servidor leva a figura, outra sessão lê o SHA; nome do slot: defeito 02fe5350 | genérico | genérico |
| Atlas local sem servidor | imagem-reencodada-gif-bmp (casos locais); F5 e .ebgeo com SHA: imagens-no-atlas-local-e-ebgeo (2453be9f) | idem 2453be9f | coberto por 2453be9f (F5 e .ebgeo com SHA) |
| Offline e volta | browser-collab-imagem-retomada caso 1 | coberto por e6845726 (foto posta com a conexão caída chega ao colega na volta) | coberto por 6052587c (figura colada sem rede chega ao colega) |
| Link de 40 kbps | figura-aparece-na-hora-em-link-lento | **LACUNA** (agente rede na frente de fotos) | **LACUNA** |
| F5 no meio da subida | imagem-retomada caso 2; figura-aparece-na-hora caso 2; subida-de-imagem-pendurada.repro | n/a (vai inline) | n/a |
| Colega vê os bytes | colar-imagem, imagem-retomada, imagem-reencodada-gif-bmp | conversao-linear (igualdade com data) | briefing-editor-figura-do-colega.repro (só conta `<img>`) |

## Achados

1. **[CONSERTADO em 71fa8585]** **Clonar atlas logo depois de pôr uma figura sai SEM ela, calado** (medido 1 em 3 no primeiro rodar do spec de cópias, antes de o caso esperar a feição no servidor). A op da feição de imagem fica PREPARADA até o blob confirmar e sai no disparo seguinte de 1,5 s; o clone (`POST /atlas/:id/clone`) copia o que o SERVIDOR tem. Duplicar mapa se protege com `syncEngine.flush()` antes da rota (`_duplicateOnServer`); o "Fazer uma cópia" de `atlas.html` (`AtlasDrive._duplicate`) não tem sync nenhum e `openProjectPicker` navega sem esvaziar a fila. Em link lento (a figura leva dezenas de segundos para subir) a janela é real: pôr a foto, ir a "Meus Atlas", fazer uma cópia. O original recebe a figura quando for reaberto; a cópia nunca. O coordenador decidiu pelo aviso no clone e pela espera no duplicar; ver Defeitos.
2. **KMZ não devolve figura nem foto anexa** (medido em imagem-nas-saidas-do-mapa, fb450938, anotado e não afirmado): a exportação leva os bytes da figura (GroundOverlay) e a foto (files/fotos), mas a importação do mesmo KMZ traz a figura como um POLÍGONO chamado "Imagem #1" sem imagem e o ponto sem fotos. Limitação declarada (o main também perdia): ver Decisões para o dono.
3. **Instrumento, não produto** (registrado para não repetir): trocar de mapa só por `setCurrentMap` não redesenha as feições no MapLibre (use o cartão da aba Mapas); `moveFeaturesToLayer` da fachada devolve void; um clique no canvas em (5,5) fica pendurado por elemento por cima; `(linha)?.deleted_at ?? x` confunde linha viva com ausência.

## Decisões para o dono

- **Digitar num slide que já tem uma figura, no link de 40 kbps, reenvia a figura inteira a cada salvamento automático** (medido em 2026-09-24, spec `briefing-figura-em-link-lento.spec.js`, ainda sem commit). A figura (foto 800x600 com textura colada no slide) subiu num POST de 413 KB; três palavras digitadas com pausa de 2,5 s viraram 8 ops na fila, cada uma com o HTML inteiro do slide (a fila não funde desde 2026-09-12), e o segundo POST levou 2462 KB, o que a 5 KB/s são cerca de 8 minutos; em 300 s o colega ainda não tinha o texto (6 ops pendentes). Não há perda: é custo. As saídas de desenho são do dono: a figura do slide virar blob por id (como a foto anexa na fase 2 do agente rede), ou o salvamento automático do slide deixar de enfileirar uma op por pausa quando a anterior ainda não saiu. Não consertado.

- **A volta do KMZ perde a figura e as fotos anexas, e o main (8b611113) também perdia: limitação declarada, não regressão** (conferido em 2026-09-24 no checkout do main, só leitura, `.claude/worktrees/migration-main-8b611113`). O main já exportava a feição de imagem como GroundOverlay e as fotos em `files/fotos` (`kmz/kmz-feature-mapper.js`, `kmz/kmz-assets.js`), e a importação dele é a mesma de hoje: `@tmcw/togeojson` transforma o GroundOverlay num polígono (o contorno da figura, sem imagem), e `import.control.js` põe `images: []` em TODA feição importada. Hoje, medido em `imagem-nas-saidas-do-mapa.spec.js` (fb450938): a figura volta como polígono "Imagem #1" sem imagem e o ponto volta com 0 fotos. A volta sem perda é o `.ebgeo`. Decisão do coordenador: fica como limitação declarada, o spec continua ANOTANDO a volta sem afirmá-la, e importar GroundOverlay como feição de imagem não se implementa agora.

## Defeitos

- **02fe5350** fix(session): o trabalho resgatado do atlas montado nascia "Trabalho recuperado em <data>" quando o menu da conta não tinha sido aberto (o nome vinha só de `_atlasCache`, preenchido ao abrir o menu); agora lê do disco como os outros atlas da mesma saída. Repro `resgate-nomeia-o-atlas-montado.repro.spec.js`, 3/3 depois, controle negativo vermelho.
- **0af643e4** fix(sync): o aviso de cópia separa trabalho a caminho (esperar / abrir o atlas) de trabalho recusado (botão Pendências), achado do code-reviewer do 71fa8585. Preso em `copia-no-servidor-espera.test.js`.

- **71fa8585** fix(sync): cópia feita pelo servidor logo depois de pôr uma figura saía sem ela, calada. "Copiar no servidor" (atlas.html) conta a dívida deste computador para aquele atlas (ops, retidas inclusive, e subidas de figura pendentes, por getStoreFor sem montar, só para atlas registrado aqui) e pergunta antes; "Duplicar" do mapa espera até 8 s a dívida do mapa zerar (flush a cada passo, toast dizendo o porquê) e pergunta se não zerar ou se só sobrar trabalho recusado. Repro determinístico `copia-sem-figura-recem-posta.repro.spec.js` (rota bulk segurada pelo teste): 3/3 vermelho antes, 3 rodadas 3/3 verde depois; controle negativo no código final vermelho; diálogos capturados e lidos. Teto de peso do mapa ficou vermelho de propósito (803 contra 801, dois módulos novos).

## Balanços

- 11:35: a2ac55bd (redimensionar e rotacionar pelo painel) e 734f1227 (Enviar ao servidor leva foto e figura de slide). Restam LACUNAs só onde o agente rede está trabalhando (foto grande pela galeria, link lento de foto e de slide).

- 11:05: 6052587c (figura de slide: cinco formatos, teto de 5 MB em dois portões, foto grande, colada sem rede).

- 10:40: 2453be9f (as três formas no atlas local, F5 e .ebgeo pela tela, com SHA). Forma C: excluir/desfazer e copiar/colar marcados n/a (não existem no produto).

- 10:15: e6845726 (galeria real: três formatos, GIF recusado, foto sem rede, excluir e desfazer a feição e a foto). Matriz com 9 LACUNAs, quase todas da forma C e da forma B que depende da compressão do agente rede.

- 09:40: 16521c76 (Colar Aqui e Duplicar Seleção pelo menu real) e 8bbe5ceb (foto anexa em toda cópia, leitura agnóstica de formato, guarda da fase 2b do agente rede).

- 09:10: 0af643e4 (achado do review: aviso separa pendente de recusado, com Pendências); f6d8a530 (resgate de sessão com figura pendente coberto); 02fe5350 (o slot resgatado do atlas montado nascia "Trabalho recuperado em <data>" quando o menu da conta nunca tinha sido aberto). KMZ: o main também perdia, limitação declarada.

- 08:20: fb450938 fecha KMZ (ida), captura, PDF, Enviar ao servidor e a figura de slide (servidor, colega, F5, clone). Matriz: restam LACUNAs de forma B e C e as etapas 1 a 4 do PRÓXIMO PASSO.

- 07:50: conserto 71fa8585 (a cópia feita pelo servidor não sai mais calada sem a figura recém-posta); KMZ e PDF com a figura medidos verdes uma vez; limitação da volta do KMZ registrada.

- 06:58: 20 linhas LACUNA na matriz inicial; 9 fechadas com dois specs (0c7c11e2), 3 specs escritos à espera de rodada, 1 achado de produto à espera de decisão (clone sem a figura recém-posta).

## PRÓXIMO PASSO (exato, para retomar)

PAUSADO pelo coordenador em 2026-09-24 ~12:05 (limite de 3 agentes). Worktree `C:/Users/diniz/ebgeo_hunt/migracao`, branch `hunt/cob-imagens`, HEAD 734f1227. Commits deste ciclo: 0c7c11e2, 71fa8585 (integrado como 7dd27b89), fb450938, 0af643e4, f6d8a530, 02fe5350, 16521c76, 8bbe5ceb, e6845726, 2453be9f, 6052587c, a2ac55bd, 734f1227. Ambiente: `EBGEO_UI_E2E_APP_PORT=4331 EBGEO_UI_E2E_BACKEND_PORT=3921`, Playwright de dentro de `frontend/`, `--retries=0 --workers=1`. Teto de peso do mapa: 803 no branch, re-medido na integração (805, 57a4aaef); não mexer.

**Arquivo NÃO commitado (não verificado):** `frontend/tests/e2e-ui/briefing-figura-em-link-lento.spec.js`. Estado: a parte 1 (a figura do slide chega ao colega com o mesmo SHA no link de 40 kbps) PASSA; a parte 2 (digitar três palavras depois da figura) reprova porque o texto não chega ao colega em 300 s, e isso é o ACHADO da seção "Decisões para o dono" (2,4 MB para três palavras), não defeito do teste. Há duas linhas marcadas `// SONDA` (a função `diag` e o `.catch` que a imprime) que saem antes do commit. Falta decidir com o coordenador: (a) o spec afirma só a parte 1 e ANOTA a parte 2 (medida), e vira commit `test(...)`; ou (b) a parte 2 vira repro de um conserto, se o dono escolher mexer no salvamento automático ou na forma da figura. Próximo comando para reproduzir a medida: `cd frontend && npx playwright test briefing-figura-em-link-lento --retries=0 --workers=1 --reporter=line` (com as duas variáveis de porta acima).

Depois:
1. Forma B restante: foto de celular grande e perto do limite pela galeria (o agente rede está mexendo na compressão: coordenar), e rodar foto-anexa-nas-copias e foto-anexa-formatos-offline-e-desfazer de novo quando a fase 2b dele entrar.
2. Forma B no link lento (o agente rede mede o envio em link lento; coordenar).
3. Conferir, quando o B6.1 entrar, que `lerDivida` (espera-do-envio-do-mapa.js) conta certo um gesto partido entre recusa e retenção.
