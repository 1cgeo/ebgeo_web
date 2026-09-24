# Relatório da frente migracao (caça noturna 2026-09-23/24)

Worktree `C:\Users\diniz\ebgeo_hunt\migracao`, branch `hunt/migracao`. Fechado 00:25.

Commits (em ordem): `1d51b92f`, `7db1e904`, `ba178130`, `f80401a4`, `4f1ff6c1` (harnesses), `b99b1ccb` (harness),
`974865f4`.

## Bugs corrigidos

1. **Atlas enviado ao servidor não aparecia na lista para onde o aviso manda** — quebra funcional (leva a cópia
   duplicada no servidor). `1d51b92f`. Causa: `sendLocalAtlasToServerFromPage` (`projects/projects-page.js`) não
   tinha o AtlasDrive montado e deixava o lado do servidor "para o próximo boot"; a frase dizia "na lista acima"
   (ela fica abaixo). Conserto: `AtlasDrive.refresh()` no ramo de aviso e na falha pós-criação; frase "na lista No
   servidor desta página". Guarda: caso de aviso em `envio-do-acervo-herdado.spec.js`. Vermelho antes, verde
   depois, controle negativo vermelho.
2. **"Salvar no servidor" do MAPA dizia sucesso em verde sobre o que o servidor descartou** — perda silenciosa no
   atlas de servidor que a pessoa passa a usar. `7db1e904`. Causa: `account/account.control.js` jogava fora
   `summary.prunedResourceRefs` e a contagem gravada (a porta de atlas.html lia desde 09-07). Conserto: folha
   `projects/server-send-phrases.js` (zero imports) com `avisosDoServidor`, usada pelas duas portas; tom de aviso.
   Guarda: "a poda do servidor chega à frase" em `browser-save-local-to-server.spec.js` +
   `tests/unit/avisos-do-servidor-duas-portas.test.js`. Vermelho antes (toast--success), verde, controle negativo.
3. **Aba da versão antiga aberta durante a virada: a tela só oferecia baixar ou APAGAR os dados** — armadilha de
   perda no caso mais comum da virada. `ba178130`. Agora é ESPERA sem comando, que segue sozinha quando a aba antiga
   fecha. Guardas: `tests/integration/versao-antiga-aberta-e-espera.test.js` (código REAL do tab-lock da main num
   BroadcastChannel real), `tests/unit/espera-versao-antiga.test.js`, navegador `main-aba-aberta.mjs`
   (Chromium 2/2, Firefox 1/1, aba travada 1/1). Controle negativo vermelho.
4. **Acervo herdado com FOTOS ANEXAS não subia ao servidor (413 sempre, frase mandando tentar de novo)** — quebra
   funcional. `f80401a4`. Causa: a foto anexa é data URL em `properties.images` (nas duas linhas do produto) e o
   envio manda o documento inteiro em `POST /atlas/imports`, preso ao parser JSON global de 10 MB
   (`backend/src/app.js`). Conserto (opção (b) do coordenador): POST autenticado ancorado a `^/api/v1/atlas/imports/?$`
   usa o parser grande (MAX_BULK_UPLOAD_MB, 50); o 413 no envio (as duas portas) diz o tamanho e o que fazer.
   Guardas: `backend/tests/integration/bulk-parser-scope.repro.test.js`, `frontend/tests/e2e-ui/envio-com-fotos-anexas.repro.spec.js`
   (5 fotos de 2,4 MB sobem e um par limpo lê as 5; 413 forjado mostra a frase), unit. Controle negativo vermelho.
5. **Rollback: só ABRIR a main criava e ABRIA um "Recuperado" com a cópia velha** — quebra funcional (trabalho
   parece perdido; fica em "Meu Atlas"). `974865f4`. Causa: abrir a main grava só o `sync` do mapa ativo e
   `mapBadgeColors`, e `planLateLegacyChanges` lia isso como alteração da antiga no mesmo mapa. Conserto: prova de
   contenção simétrica (`inertLegacyMapChanges`, `legacy-transition.js`) com as travas de exclusão; crachá em
   PREFERENCE_KEYS; `LATE_RULE_VERSION` 4. Guardas: `alteracoes-tardias-legado.test.js` (25/25, com controles que
   seguem conflito), `late-legacy-plan.test.js`, navegador `main-rollback-novo.mjs` (existente e só-integração:
   volta ao "Meu Atlas" com a nota, nenhum Recuperado). `main-round-trip.mjs` segue 31/31 e 38/38. Controle negativo
   vermelho.

## Decisões propostas (o coordenador registra em decisions-2026)

### D-a (ba178130): a janela da versão antiga aberta é ESPERA, não falha
- Contexto: com uma aba da main aberta durante a troca (o caso mais comum), o portão desenhava a tela de duas saídas
  (baixar ou APAGAR); a saída certa (fechar a janela velha e recarregar) não tinha botão e o texto se contradizia.
- Decisão (noite de 2026-09-23, diretriz de resiliência, para o dono confirmar): o portão, ao detectar a aba antiga
  ativa (PONG sem versão do protocolo da main, sonda de 100 ms), desenha "Há uma janela antiga do EBGeo aberta / Feche
  a outra janela do EBGeo neste computador. Esta página continua sozinha quando ela fechar." sem comando, sonda de novo
  a cada 1 s (janela de 600 ms) e segue sozinho após duas sondas seguidas sem resposta. A tela de duas saídas fica para
  as falhas reais; a frase de `legacy_tab` nela deixou de se contradizer.
- O que conta como sumiu: a main só responde enquanto está ATIVA; aba bloqueada pela própria main e aba TRAVADA
  (thread ocupada) contam como ausentes. Medido: aba CONGELADA por CDP ainda responde BroadcastChannel no Chromium
  headless, então segura a espera até ser fechada, que é o que a tela pede.
- Recusadas: terceiro botão "Recarregar" (regra do dono de 2026-09-22); detecção por `versionchange`/`blocked`
  (a transição só LÊ a origem, nada dispara).

### D-b (974865f4): o que a versão antiga grava só ao ABRIR não é alteração dela
- Contexto: medido com a main real; ver bug 5.
- Decisão (aprovada pelo coordenador, direção segura): mapa da origem que mudou é inerte quando o conteúdo dele (sem
  `sync`) está contido no do destino, ou é mapa que a origem CRIOU sem feição sobre mapa de mesma chave no destino; E a
  fila da main (`ebgeo` sem sufixo) não tem DELETE de entidade daquele mapa desde o início da transição; E o destino
  não tem feição anterior à transição (`createdAt`) que falte na origem. Sem marco ou com fila ilegível, nada é
  absolvido. `mapBadgeColors` é ponteiro (fica o da nova quando os dois mudaram).
- Recusada: "feição presente no destino e ausente na origem = exclusão" sem olhar a data de criação (tornaria conflito
  todo desenho feito na versão nova); a data separa as duas coisas.

## Bugs confirmados e não corrigidos

- **processed_los/processed_visibility nunca chegam ao servidor** (repassado; está com collab-ferramentas). Sonda de
  contrato: create com id `<losId>-visible` → rejected 22P02; no envio/import atômico `makeIdMapper` re-cunha em UUID e o
  vínculo por prefixo (`findRelatedProcessedFeatures`) se perde (medido no acervo 03).
- **Limite que fica do bug 4**: feição com >10 MB de fotos já no servidor não sincroniza edição (push de 10 MB);
  o nginx de produção tem `client_max_body_size` desconhecido (fora do repo) — se menor que o documento, o 413 vem
  dele (a frase agora o diz sem mandar repetir). Risco para o dono conferir antes da virada.
- **Teto de peso da página do mapa estoura com dist fresco**: 4191 kB no HEAD 5379fc3e (antes dos meus commits),
  4195 depois, teto 4170 (`teto-de-peso-da-pagina-do-mapa.test.js` (b), só roda com `dist/`). Deixado para a
  re-medição do coordenador.
- **A origem legada (bancos sem sufixo) fica para sempre no disco**: `dropLegacySource` sem chamador desde 66a0f53f
  (declarado em decisions-2026, "Aberto, declarado"): todo usuário migrado carrega o acervo duas vezes. A wiki
  `namespace-por-atlas.md` ainda cita o botão que não existe.
- Menores: `mapBadgeColors` não sobe no envio (cor automática, cosmético); bloqueio de mapa (`mapLocked_`) não sobe
  (`locked: false` fixo no payload; o `.ebgeo` também não carrega); aba antiga aberta durante o deploy que abra o
  tutorial pede `./docs/doc.html` (404 na integração).

## Suspeitas não confirmadas / fluxos que pioram por instabilidade

- `tab-lock-refutacao.test.js` 3.5, `docs-integridade.test.js` e `espera-do-playwright-nao-aguarda-promessa.test.js`
  reprovaram só na suíte cheia sob carga da máquina (verdes isolados, 3/3): tempo, não código.

## Hipóteses do brief, medidas sem defeito além dos acima

- H1 perfil rico main → integração (Chromium e Firefox, `main-profile-envio.mjs`): main→migrado idêntico campo a
  campo; migrado→servidor: 14 mapas, 805 feições, 21 camadas (oculta/bloqueada/semitransparente), grupos com membros,
  notas, temporal, briefings 2/7 slides, e (variante) imagem Quill num slide idêntica nas três pontas.
- H2 aba aberta: ver bug 3. H3 migração interrompida: 6 mortes do navegador (cópia em 36..209 de 209) em 2 perfis,
  retomou sem perder nem duplicar; sessão restaurada com duas abas novas: 3/3, uma cópia, um atlas.
- H4 localStorage/sessionStorage: sem colisão (mesmas chaves; main não usa sessionStorage). A fila que a main enche
  sem servidor (20 ops no acervo 03) fica no `ebgeo` sem sufixo, nunca é enviada nem contada como pendência.
- H5 `.ebgeo` da main importa (coberto pelo cenário externo existente); rollback: a main reabre a origem intacta, o
  trabalho da integração fica invisível para ela e volta ao reavançar; `.ebgeo` 3.0 é RECUSADO pela main (sem
  corromper). Ida e volta do dono 31/31 e 38/38.
- H6 envio: ver bugs 1, 2, 4. H7 cota e navegador sem `navigator.locks`: cobertos por testes existentes, não
  re-medidos.

## Linhas propostas para o livro-razão

- `2026-09-23 [codigo] "Enviar ao servidor" com aviso deixava a lista "No servidor" sem o atlas criado e a frase o mandava procurar "acima"; a lista passa a ser relida. -> caso de aviso de envio-do-acervo-herdado.spec.js.`
- `2026-09-23 [codigo] a segunda porta do mesmo envio (menu da conta do mapa) nunca leu o summary que a primeira lia desde 09-07: correção numa porta não alcança a gêmea. -> as frases de perda moram numa folha só (projects/server-send-phrases.js); preso por browser-save-local-to-server.spec.js e avisos-do-servidor-duas-portas.test.js.`
- `2026-09-23 [produto] a aba antiga aberta na virada caía numa tela cujos únicos comandos eram baixar ou apagar tudo. -> espera sem comando (utilities/espera-versao-antiga.js); preso por versao-antiga-aberta-e-espera.test.js com o tab-lock REAL da main.`
- `2026-09-23 [codigo] a foto anexa mora dentro do documento e o envio o manda num POST só, preso a 10 MB: 413 eterno com frase de "tente de novo". -> parser grande no início do import + frase do 413; bulk-parser-scope.repro.test.js e envio-com-fotos-anexas.repro.spec.js.`
- `2026-09-23 [codigo] a prova de contenção da junção tardia existia só do lado destino; abrir a main num rollback recarimbava o mapa ativo e abria um Recuperado velho. -> inertLegacyMapChanges com travas de exclusão; alteracoes-tardias-legado.test.js e main-rollback-novo.mjs.`

## Docs propostos

- `docs/wiki/namespace-por-atlas.md`, "A ORIGEM É A EXCEÇÃO": trocar "Ela sai pelo botão 'Apagar a cópia antiga da
  versão anterior' (`dropLegacySource`)" por "Ela não tem saída pela interface desde 2026-09-22: a origem fica no disco,
  e todo usuário migrado carrega o acervo duas vezes (ver decisions-2026, 'Aberto, declarado')".
- Mesma página, seção "O que a versão anterior grava depois da transição": acrescentar que a prova de contenção vale
  nos DOIS sentidos desde 2026-09-23 (o lado antigo recarimbado ao abrir, com as travas de exclusão), e que
  `mapBadgeColors` é ponteiro.
- Mesma página ou `sessao-boot-e-ciclo-de-vida.md`: a aba da versão antiga aberta é espera, não falha (D-a).

---

# 2º ciclo (02:30 a 03:10): ciclo de vida do atlas de servidor com colega DENTRO

Começou com o merge de `hunt/integra` no meu branch (árvore = integra). Commits novos: `a3ad72de`, `67aad842`,
`90b70a6c`, `74c47aa6`.

## Bugs corrigidos

6. **`a3ad72de`: trabalho não enviado do colega sumia quando o atlas ia embora debaixo dele** (perda de dado).
   - Lixeira: B recebia `atlas_deleted` e `_handleRemoteAtlasDeleted` (`account/account.control.js`) fazia
     `clearAllDataStore()`, que esvazia dados E fila: o ponto não enviado de B não ficava em atlas nenhum (medido).
   - Revogação: o socket fechado com 4003 "access revoked" era lido como queda de rede; "N pendentes /
     reconectando" para sempre, edições novas entrando na fila, nenhuma frase; F5 → "Atlas não encontrado ou sem
     acesso" e a fila num namespace invisível.
   - Conserto: `ws-client` emite `accessRevoked` no 4003; o engine confirma por `getAtlas` (só 403/404 age) e dispara
     `ATLAS_DELETED_REMOTE {motivo:'sem-acesso'}`; o teardown de colega conta a fila e, com trabalho, usa
     `preserveUnsyncedWorkAsLocal` em vez do wipe; avisos novos na lista. O delete do próprio dono mantém o wipe.
   - Guarda: `frontend/tests/e2e-ui/atlas-some-com-trabalho-pendente.repro.spec.js` (vermelho antes 3/3, verde,
     controle negativo vermelho) + casos em `sync-engine.test.js`.
7. **`67aad842`: o atlas resgatado se chamava "Trabalho recuperado em <data>", e a pergunta ao reabrir dizia
   "Quando sua sessão caiu"** (tela mentindo). Nome vem do registro do atlas montado; frase sem causa. Controle
   negativo vermelho.
8. **`90b70a6c` (achado da revisão sobre `974865f4`): mapa criado pela main sem feição era dado como padrão do 1º
   boot mesmo com vista salva ou base trocada** (perda silenciosa desses campos). Agora exige campos de fábrica ou
   iguais aos do destino. 3 casos novos; controle negativo vermelho; navegador com a main real (dois modos) segue
   sem Recuperado e com a nota.

## Medido sem defeito
- Restaurar da lixeira devolve o estado do servidor intacto (feições, camadas, versão iguais antes/depois).
- Transferir posse com B dentro e trabalho pendente: B vira dono ao vivo, A vira gestor, o trabalho de B chega ao
  servidor.
- Lixeira com B SEM REDE: ao voltar, a leitura HTTP (404) já o tirava do atlas; com `a3ad72de` o resgate vale
  nessa porta também (caso novo `74c47aa6`). Uma sonda extra por falhas de reconexão NÃO foi commitada: o caso
  passava sem ela (controle negativo não ficou vermelho).

## Confirmado e não corrigido
- **Rebaixado para leitura/comentário com trabalho pendente**: um toast único diz a verdade ("seu acesso a este atlas
  não permite mais edição. Peça permissão ao gestor"), mas o selo fica "Enviando 1…" para sempre enquanto cada
  envio volta 403 (`describeSyncWork`, `account/sync-phrases.js`, não conhece a recusa por permissão). Tela mentindo,
  sem perda (a fila fica e sai se o acesso voltar).
- Revogação com B SEM REDE: não medido; pela leitura, a reabertura dá "sem acesso" e a fila fica no namespace
  retido, sem resgate automático.
- Não cobertos: excluir definitivo com colega dentro, clonar no meio das edições (o clone copia o que está no
  servidor, por desenho), tornar privado com visitante de link.

## Linhas propostas para o livro-razão
- `2026-09-24 [codigo] o teardown do atlas excluído/revogado esvaziava a fila do colega junto com os dados; trabalho só desta máquina não volta pela lixeira. -> resgate como atlas local no teardown de colega; atlas-some-com-trabalho-pendente.repro.spec.js.`
- `2026-09-24 [codigo] o fechamento 4003 "access revoked" era lido como queda de rede e o cliente reconectava para sempre sobre edições que nunca sairiam. -> accessRevoked confirmado por HTTP; mesma saída do atlas excluído.`
- `2026-09-24 [processo] uma sonda de reconexão escrita para o caso sem rede passou verde com ela desligada: não entrou. Controle negativo decide o que é conserto.`
