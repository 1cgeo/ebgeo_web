---
paths:
  - "frontend/tests/e2e-ui/**"
  - "frontend/playwright*.config.js"
---

# Testes de tela (Playwright)

O laço de UI, o `retries: 1` e a tabela de portas estão em [testing.md](testing.md), que carrega sempre. Aqui fica o detalhe de cada armadilha.

**A ÚLTIMA LINHA SÃO VÁRIOS CONFIGS E NÃO UMA CAMADA NOVA, e é por isso que ela não ganha coluna
própria.** `playwright.atlas-safety.config.js`, `playwright.migration-data.config.js`,
`playwright.release-checks.config.js`, `playwright.release-production.config.js` e, desde 2026-09-23, `playwright.release-long-session.config.js` e `playwright.release-large-atlas.config.js` (todos em
`frontend/`) fazem spread do `playwright.config.js` base e trocam só testMatch, `retries` e
`timeout`, de modo que herdam o `globalSetup`, a porta do backend, a do Vite e o banco: uma
rodada de cenário colide com uma rodada de `test:e2e:ui` exatamente como duas rodadas de
`test:e2e:ui` colidem entre si, e as três variáveis de isolamento do parágrafo adiante são as
mesmas. Três coisas que não se leem na tabela e cada uma já custou uma leitura errada: nem todos têm
script (têm `test:e2e:atlas`, `test:e2e:migracao`, `test:e2e:sessao-longa` e `test:e2e:atlas-grande`;
`release-checks` e `release-production` se rodam nomeando o config); o de dados de migração **lança na importação** se `EBGEO_MIGRATION_DATA_DIR` não estiver
no ambiente, de propósito, porque nenhuma rodada normal pode depender do acervo externo de
alguém; e o de produção é o único que troca o `webServer`, por um HTTPS em 127.0.0.1:44431 com
`reuseExistingServer: false`, mas o `globalSetup` PRÓPRIO dele sobe o mesmo backend na 3912 e no
mesmo banco, então trocar o servidor do app não o isola de nada.

**A COLUNA DA PORTA DO PLAYWRIGHT TEM DOIS NÚMEROS, e o segundo é o que morde calado.**
A 3912 é o backend, e ela GRITA (ver adiante). A 4321 é o Vite que serve o APP, e
`playwright.config.js` a abre com `reuseExistingServer: !process.env.CI`: se outro checkout
já tiver um Vite ali, o Playwright REUSA aquele servidor e a sua rodada passa a medir o
`src/` do OUTRO worktree, sem um aviso em lugar nenhum. É a forma mais pura de "o
instrumento está medindo outra cópia do sujeito": os specs passam, a captura sai bonita, e
nada do que você editou entrou na medida.

MEDIDO em 2026-09-14, e o que denunciou foi uma CONTRADIÇÃO entre rodadas: duas capturas do
mesmo commit relataram `ms.getVersion()` 3.0.4 e depois 3.0.2, e a segunda pediu
`/vendors/milsymbol.min.js`, um arquivo que aquele commit tinha apagado. O dono da 4321 era o
`frontend` de outro worktree. A regra prática que sai daí: **ao capturar ou depurar, registre
os pedidos de REDE do recurso em questão**, porque o caminho servido nomeia a árvore, enquanto
o resultado visual não nomeia nada.

A saída já existe e está documentada em `frontend/tests/e2e-ui/constants.js`: as quatro
coordenadas são sobrescritíveis por ambiente, e **isolar uma sem isolar as outras ainda
colide**. O conjunto completo é `EBGEO_UI_E2E_APP_PORT`, `EBGEO_UI_E2E_BACKEND_PORT` e
`EBGEO_UI_E2E_DB_NAME`. Dois agentes na mesma máquina definem os três e param de esperar um
pelo outro.

**E A ESPERA DE UM SPEC DE COLABORAÇÃO É DE REDE, NUNCA LEITURA DE FILA POR `page.evaluate`**
(medido em 2026-09-22). A cena de primeira pessoa deixa a página a cerca de dois quadros por
segundo no harness sem GPU, cada salto de IndexedDB espera um quadro, e o ciclo de flush faz
muitos: uma op já enviável esperou de 0,2 a 11 s pelo envio, com o intervalo do auto-flush em
1,5 s. Um `expect.poll` de 10 s sobre o Postgres reprovava 3 em 16 sem separar RECUSA de
LENTIDÃO. E a primeira sonda lia `operationQueue.countByState()` de dentro da página a cada
500 ms, que é a MESMA caminhada que o flush faz, então cada amostra levava de 5 a 11 s: o
instrumento disputava com o sujeito. A forma que vale é por degraus de ESTADO (o cartão fechado
separa recusa de lentidão) e `waitForResponse` do POST `/sync` como o degrau que antecede o
veredito no banco (modelo: `frontend/tests/e2e-ui/first-person-collaboration.spec.js`).

**A CAMADA DO PLAYWRIGHT SE ISOLA POR ENV, e são TRÊS variáveis, não uma.**
`frontend/tests/e2e-ui/constants.js` lê `EBGEO_UI_E2E_APP_PORT` (Vite, padrão 4321),
`EBGEO_UI_E2E_BACKEND_PORT` (padrão 3912) e `EBGEO_UI_E2E_DB_NAME`, e o cabeçalho de lá
avisa que isolar uma sem as outras ainda colide: trocar só a porta deixava a segunda rodada
DROPANDO o banco da primeira, e o sintoma que chega é `banco de dados ... não existe` na
rodada de quem não fez nada. Medido em 2026-09-14, com dois agentes na mesma máquina: as
três juntas resolveram. **Desde o mesmo dia o banco DERIVA do checkout** (padrão
`ebgeo_ui_e2e_<chave>`, a mesma `CHECKOUT_KEY` do arquivo de estado), então o que sobra
para lembrar são as duas PORTAS; o nome do banco só precisa ser passado quando duas rodadas
do MESMO checkout coexistem.
Se sua spec instala `page.route` com a origem do app escrita à mão, ela quebra
exatamente aqui: leia `APP_ORIGIN` e `BACKEND_PORT` das constantes, senão o roteamento
engole o próprio `GET /api/config` e o app não boota, com cara de defeito de produto.

**O TERCEIRO RECURSO COMPARTILHADO É A PORTA, e ela é o contra-exemplo útil.** O backend
do `test:e2e:ui` sobe na 3912, e um órfão de rodada interrompida a segura. Essa colisão
GRITA, e se nomeia: `frontend/tests/e2e-ui/backend.js` recusa subir dizendo "a porta 3912
já responde /api/v1/health antes de subirmos: outro backend está de pé (tipicamente órfão
de uma rodada anterior interrompida)". Achar o dono é `Get-NetTCPConnection -LocalPort 3912
-State Listen`.

**A CAPTURA ESPERA O ESTADO, NÃO O TEMPO, e quem delega a captura relê a imagem** (medido em
2026-09-20). Um toast que nasce num `onload` de imagem, num `fetch` ou em qualquer callback
assíncrono ainda não existe na linha seguinte ao gesto: o `page.screenshot` dispara, o spec fecha
verde e a imagem sai SEM o que ela deveria provar. Foi assim que a recusa de imagem por dimensão
ganhou uma captura sem toast nenhum, e o relatório do agente que a produziu descrevia o texto do
toast mesmo assim. Duas regras daí: antes do screenshot, espere o estado por localizador com o
texto (`expect(page.locator('.toast', { hasText: ... })).toBeVisible()`) e imprima o `innerText`
no stdout, que é o caminho independente da imagem; e ao receber de um subagente um relatório que
diz "li a imagem", abra a imagem, porque a frase é prosa e o arquivo é o pixel.

**E PARA TOAST O ESTADO É A OPACIDADE COMPUTADA, não a visibilidade do Playwright** (medido em
2026-09-21). O toast nasce com `opacity: 0` e anima até 1, e `toBeVisible()` não olha opacidade:
logo depois de ele passar, o toast já está por cima da tela e a frase ainda é invisível, de modo
que a captura sai sem o texto enquanto o spec "prova" que ele estava lá. Espere a opacidade
computada passar de 0,9 (`expect.poll` sobre `getComputedStyle`) antes do screenshot. Da mesma
família: ler `getPaintProperty` logo depois de um `aria-pressed` virar devolve a tinta do estado
ANTERIOR, porque o rótulo é escrito pela view e a tinta passa pelo controlador; espere a própria
expressão.

**A QUEDA DO RENDERIZADOR NÃO SE CONSERTA POR BANDEIRA DE LANÇAMENTO, e a lista de
bandeiras que a intuição oferece JÁ É O PADRÃO DO HARNESS** (medido em 2026-09-15 nesta
máquina, 480 boots em cinco configurações). O sintoma está declarado com mecanismo e taxa no
cabeçalho de `frontend/tests/e2e-ui/vertices-em-cliques-rapidos.spec.js`: o processo da página
morre no boot do mapa e a falha chega como Target crashed, sem erro de página nenhum.

**O primeiro fato mata a prescrição inteira: não há driver de GPU dentro do processo.** A
leitura da extensão de depuração de renderizador dentro da página devolve "ANGLE (Google,
Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", e a linha de comando VIVA do
processo de GPU (`Get-CimInstance Win32_Process`) traz `--use-angle=swiftshader-webgl`,
`--use-gl=angle` e `--enable-unsafe-swiftshader`; o processo do navegador nasce ainda com
`--disable-back-forward-cache` e `--disable-dev-shm-usage`. Ou seja, `--use-angle=swiftshader`,
o par `--use-gl=angle --use-angle=swiftshader-webgl`, `--enable-unsafe-swiftshader`,
`--disable-features=BackForwardCache` e `--disable-dev-shm-usage` são TODOS o padrão do headless
shell do Playwright: acrescentá-los mede a linha de base duas vezes. E a mensagem de console que
fundamentava a suspeita ("GL Driver Message ... GPU stall due to ReadPixels") é saída de
depuração do próprio ANGLE sobre SwiftShader, não de um driver de fornecedor, que ali não
existe. Confira a bandeira contra o PROCESSO antes de gastar bateria com ela.

**O segundo fato diz onde a queda não está.** O Windows registra toda ocorrência como exceção
0x80000003 (STATUS BREAKPOINT) no módulo chrome-headless-shell.exe, sempre no MESMO deslocamento
0x0000000000d7d2c3: é um CHECK determinístico do Chromium, não uma parada de driver e não
corrupção de memória. A memória também não sustenta a leitura de OOM: amostrada a cada 9 s numa
bateria de 64 boots, a soma dos processos oscilou POR TESTE entre 49 MB e 822 MB, com o maior
processo em 519 MB, sem tendência de subida.

**E o log de eventos do Windows NÃO serve de contador.** O WER agrupa duplicata por bucket: uma
janela com TRÊS reprovações deixou UM evento. Quem contar queda pelo Visualizador de Eventos
subconta, e subconta mais quanto pior estiver o quadro. O contador que vale continua sendo a
reprovação do caso, em série e com `--retries=0`.

**A medição**, sempre sobre `frontend/tests/e2e-ui/vertices-em-cliques-rapidos.spec.js` (o
arquivo que mais boota mapa por minuto), em série e sem retry:

| configuração | quedas / boots | taxa | custo |
|---|---|---|---|
| padrão do harness (headless shell, SwiftShader) | 5 / 160 | 3,1% | 5,5 s/caso; boot 3,82 s; viewshed 30,1 s |
| `--use-angle=d3d11` (GPU real, RTX 4070 Ti) | 4 / 128 | 3,1% | 5,3 s/caso; boot 3,74 s; viewshed 21,2 s |
| `--disable-gpu-driver-bug-workarounds` | 1 / 64 | 1,6% | igual ao padrão |
| `--in-process-gpu` | 3 / 64 | 4,7% | igual ao padrão |
| canal `chromium` (binário completo) + SwiftShader | 3 / 64 | 4,7% | boot 3,85 s, e a falha PIORA |

Nenhuma diferença sai do ruído: 16 quedas em 480 boots, 3,3% no agregado, e a 3,3% uma bateria
de 64 espera 2,1 quedas, de modo que 1 e 4 são o mesmo número. A variância entre baterias da
MESMA configuração mostra isso sozinha: as quatro baterias do padrão deram 0 em 32, 2 em 32, 3
em 64 e 0 em 32, ou seja, metade delas voltou limpa. **Nada foi mudado no config, e é
esse o resultado.** Em particular, não promova o 1 de 64 da terceira linha a conserto: ela é a
única bandeira da lista que ainda não era padrão, e o que ela desliga é a lista de contornos de
bug de DRIVER, que sob SwiftShader está vazia. É um dip de ruído com mecanismo nulo.

**A queda sobrevive à troca COMPLETA do rasterizador**, o que tira a pilha de GL da lista de
suspeitos apesar da mensagem de console: ela acontece na mesma taxa com SwiftShader e com o
driver da NVIDIA. E o canal `chromium` é PIOR, com o custo fora da taxa: com o binário completo
a falha deixa de ser Target crashed num caso e vira "worker process exited unexpectedly
(code=3221225477)", isto é, ACCESS VIOLATION derrubando o worker inteiro, que é a assinatura que
custou as duas tentativas de `frontend/tests/e2e-ui/browser-collab-shared-atlas.spec.js` na
rodada completa de 2b809a2f.

**Uma medição de tabela vale por si e não pelo motivo que a gerou**: trocar o rasterizador por
hardware muda 190 de 881280 pixels do `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js` (0,022%)
e 11 pixels de CLASSE (0,001%), com verde e vermelho em 17,331% e 4,824% dos dois lados. A
referência versionada passa sem regeneração, com quase cinquenta vezes de folga dentro do teto
de 1%, e a suíte de viewshed fica um terço mais rápida. Ou seja, o teto daquele arquivo foi bem
escolhido: ele sobrevive a uma troca de GPU, que é exatamente o cenário que o comentário dele
antecipava. Isso não autoriza a troca (ela não conserta nada e amarraria ao driver desta máquina
uma referência hoje reprodutível em qualquer uma), mas tira o pixel da lista de objeções caso
alguém precise de hardware por outro motivo.

**E O COMANDO IGNORA TRÊS ARQUIVOS, NÃO UM.** O testIgnore do `playwright.config.js` tira
da rodada normal o `browser-collab-mega.spec.js` (salvo quando a própria linha de comando o
nomeia, que é o que `TARGETING_MEGA` decide) e, desde 2026-09-21, toda `*.tablet.spec.js`, esta
segunda exclusão INCONDICIONAL. A diferença é o que cada uma mede: a mega é spec de mesa
legítima, só cara, então nomeá-la deve rodá-la; uma spec de tablet só faz sentido num contexto
com `hasTouch`, e num projeto de mesa reprova por construção (o primeiro caso de
`toque-no-mapa.tablet.spec.js` é um CONTROLE DO INSTRUMENTO que afirma o ponteiro grosso). Foi
isso que aconteceu enquanto o testIgnore não as nomeava: `*.tablet.spec.js` casa o
`'**/*.spec.js'` do config padrão, a coleta trazia 489 casos em 188 arquivos, nove deles de
tablet, e os nove reprovavam todo dia; hoje traz 480 em 186, e a camada de tablet, que tem
config próprio desde 2026-09-20 (`playwright.tablet.config.js`) e até então script NENHUM, roda
por `npm run test:e2e:tablet`, espelhado na raiz. O que não é legítimo é ler "`test:e2e:ui`
verde" como "a pasta `tests/e2e-ui/` inteira passou": três arquivos dela não rodam ali.

**QUEM TIRA UMA SPEC DA RODADA PADRÃO HERDA O GUARDA DELA.** `_backend-required.spec.js` é o
que impede o verde por pulo da camada de navegador, e ele só reprova a rodada em que é
COLETADO. As duas de tablet são `state.skip ? test.describe.skip : test.describe` como todas as
outras, então sem Postgres elas pulariam e a rodada de tablet fecharia verde tendo dirigido
zero. Por isso o testMatch daquele config é um ARRAY que recolhe também o guarda (custo
medido: zero, ele não faz E/S nem usa `page`). E um config derivado que faça spread do base
herda o testIgnore do pai, e testIgnore vence testMatch: o de tablet passaria a ignorar as
próprias specs (medido: `0 tests in 0 files`) se não sobrescrevesse a chave. **Desde 2026-09-22 TODOS os
configs recolhem o guarda (a lista mora no censo, não aqui), e o que sustenta isso é censo, não lembrança:**
`frontend/tests/unit/configs-do-playwright-coletam-o-guarda.test.js` tira o inventário de
`git ls-files`, IMPORTA cada config (o objeto RESOLVIDO, depois do spread do base) e cobra as duas
metades, que o testMatch case o guarda e que o testIgnore não o case; config novo reprova até ser
classificado. **O falso verde, porém, NÃO estava alcançável nos cenários que a têm, e dizer
o contrário é inventar defeito:** cada `*.scenario.js` carrega um `test.beforeAll` escrito à mão
que assere `readState().skip === false` e REPROVA em vez de pular (medido com Postgres fora:
`playwright.atlas-safety.config.js` já saía com código 1). O beneficiário concreto é
`release-production.scenario.js`, a única cena sem essa asserção, protegida hoje só porque o
`globalSetup` PRÓPRIO dela (`frontend/tests/e2e-ui/release-production-setup.js`) derruba a rodada
em vez de gravar `skip: true`. **E aquele setup chama `startBackend` com a porta 3912 escrita à
mão**, enquanto o arquivo de estado que ele grava deriva de `BACKEND_PORT`: a rodada é coerente
consigo mesma, mas `EBGEO_UI_E2E_BACKEND_PORT` NÃO a isola, e a linha da tabela de [testing.md](testing.md) que diz
que os configs de cenário herdam a porta do base vale para todos menos ele.

**E UM CASO SÓ MEDE COM O ASSET APONTADO POR AMBIENTE.**
`frontend/tests/e2e-ui/vazamento-viewers.spec.js` §30.2 abre e fecha o visualizador 3D
contra um modelo REAL, e `backend/.gitignore` exclui `data/models3d/`: um checkout limpo e
todo worktree do git ficam sem o arquivo, a rota do tileset responde 404 e o caso PULA,
nomeando a saída. O pulo não aparece como vermelho em lugar nenhum, e enquanto ele acontece
a cobertura sobre o vazamento de listener do visualizador 3D é ZERO. A saída é apontar
`MODELS_3D_DIR` (caminho ABSOLUTO) para um diretório que TENHA o arquivo antes de chamar o
Playwright: `frontend/tests/e2e-ui/backend.js` espalha o ambiente do processo no `spawn` do
backend e não sobrescreve essa variável, e
`backend/src/modules/models3d/models3d.store.js` resolve o caminho do modelo contra ela, de
modo que um absoluto vale de qualquer diretório de trabalho. Medido em 19/09/2026 na árvore
principal, que tem o arquivo: com a variável apontada, §30.2 EXECUTA e dá 3 de 3 verdes em
série com `--retries=0`, a cerca de 36 s por execução. **E o controle mede a metade que a
homologação leu ao contrário:** na MESMA árvore o caso executa TAMBÉM sem a variável, porque
o padrão resolve contra o `backend/` do próprio checkout. Ou seja, o pulo nunca foi do produto
nem da máquina: ele é de QUAL checkout roda o Playwright, e a variável é o conserto de quem
roda de um que não tem o arquivo. Antes de contar aquela célula como aprovada, confira que o
caso RODOU em vez de ter pulado.

- **Sessão num spec de navegador entra por DUAS portas, e nunca por `login()` dentro de
`page.evaluate`** (2026-09-23). O login grava a sessão, e o boot do mapa que ainda não passou da
Fase 2.5 a lê e leva a página para `atlas.html` no meio do caso: medido, 10 de 10 no Firefox e 1
de 10 no Chromium, e esperar não conserta, porque a janela vai do início do documento até a Fase
2.5. Para falar com o servidor, `clienteNaPagina` (token só em memória, vale em qualquer
página e instante, 15 minutos sem renovação); para o app logado, `sessaoDoApp`, que faz o login
real numa página que não boota e só então navega ao destino. Os dois moram em
`frontend/tests/e2e-ui/helpers/cliente-de-teste.js`, o censo
`frontend/tests/unit/login-programatico-so-pelo-helper.test.js` reprova a forma crua (exceções
declaradas com motivo), e a interleaving perdedora é determinística em
`frontend/tests/e2e-ui/login-programatico-no-boot.spec.js`. Detalhe no README daquela pasta.

- **O Playwright lê `aria-disabled` como desabilitado, e isso colide de frente com a regra "o
ESTADO recusa o clique"** (medido em 2026-09-02, três rodadas perdidas num spec do menu de camada).
O comando bloqueado por estado é desenhado com `aria-disabled` e NUNCA com a propriedade
`disabled`, porque o clique é como o motivo chega à pessoa. Mas o `click()` do Playwright espera o
alvo ficar "enabled" e trata `aria-disabled="true"` como não habilitado, então ele espera para
sempre por um botão que a casa desenha assim de propósito; e `toBeEnabled()` reprova pelo mesmo
motivo, medindo o CONTRÁRIO do que a regra pede. No spec, clique o item bloqueado por
`dispatchEvent('click')` e afirme a ausência da propriedade por
`evaluate((el) => el.disabled === true)` igual a falso, além do atributo. Modelo:
`frontend/tests/e2e-ui/browser-layer-transfer-permissions.spec.js`. Da mesma família: um handler
que REMOVE o próprio botão (a alça de continuação, a linha do menu de conversão) também só se
clica por `dispatchEvent`, porque o `click()` tenta de novo ao ver o alvo sumir no meio do gesto.
E rode o Playwright de DENTRO de `frontend/` (`cd frontend && npx playwright test ...`): da raiz
do monorepo o runner carrega os specs com outra instância de `@playwright/test`, acusa
"did not expect test.beforeEach() to be called here" e termina com "No tests found", sem
executar nada, com cara de rodada.

## Collaboration / sync e2e

- For multi-user (collab/sync) behavior, prefer the **SyncLedger** deterministic waits
(`frontend/tests/e2e-ui/helpers/trace-helpers.js`, com `waitForRemoteEntity`/`waitForStage`) over
store polling; on timeout they name the last sync stage reached. See
`frontend/tests/e2e-ui/README.md` §"SyncLedger trace helpers".
