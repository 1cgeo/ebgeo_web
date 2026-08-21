# Pendências do branch `integracao_main_360`

O que **não** entrou na integração de 2026-08-20, com a evidência de cada item e o
motivo de ter ficado de fora. Escrito para ser executado por quem chegar depois, sem
precisar refazer o levantamento.

O que ENTROU está nos 11 commits do branch e não se repete aqui. A decisão de
arquitetura da fase, com as seis alternativas recusadas, está em
[`docs/decisions/decisions-2026.md`](docs/decisions/decisions-2026.md), na entrada de
2026-08-20.

## Como este inventário foi levantado

Um fan-out de 39 agentes classificou **77 itens** (os 44 commits de `origin/main` mais o
delta do `ebgeo_360`) em cinco estados, com uma rodada adversarial que derrubou 4
vereditos de "já portado". A base do levantamento continua válida: nada abaixo é
palpite sobre o que existe, é leitura do código dos dois repositórios.

Dois fatos do levantamento que mudam como se lê tudo o mais:

1. **`origin/main` e este branch consomem o 360 por topologias diferentes.** O `main` é
   monolito e fala com o serviço do `ebgeo_360` direto; aqui o 360 foi internalizado em
   `backend/` e o acervo chega por bundle. Por isso portar só o cliente, como o `main`
   fez, produziria ramo morto aqui.
2. **Ancestralidade não serve de filtro.** `git merge-base --is-ancestor` é falso para os
   44 commits (só `951b99fc` é ancestral), porque tudo que já estava aqui chegou por
   porte manual sem registrar o sha de origem. Só grep de símbolo decide.

---

## 1. Calibração (`calibracao.html`) ficou na versão pré-tiles

**O maior bloco pendente, e o único cujo trabalho já está desbloqueado.** Enquanto o
backend não servia pirâmide, portar a calibração seria ramo morto; agora as rotas
existem, então o porte passou a fazer sentido.

O estúdio de calibração foi trazido do `ebgeo_360` em 2026-08-13/14 e apanhou tudo que
existia até `229fe9d`. Dos 16 arquivos do lado de lá, **dez não recebem commit desde
antes do porte** (toda divergência neles é adaptação de monorepo, não falta de porte).
Os **cinco** que mudaram depois são exatamente os da pirâmide:

| arquivo (origem `ebgeo_360/public/calibration/js/`) | destino | estado |
|---|---|---|
| `viewer.js` | `frontend/src/js/calibration/viewer.js` | divergente: compõe tiles, cai no full |
| `preview-viewer.js` | `frontend/src/js/calibration/preview-viewer.js` | divergente: mesma queda |
| `project-map.js` | `frontend/src/js/calibration/project-map.js` | divergente: miniatura por tile |
| `pyramid-math.js` | pyramid-math.js sob frontend/src/js/calibration/ | **ausente** |
| `tile-loader.js` | tile-loader.js sob frontend/src/js/calibration/ | **ausente** |

Commits do lado B que carregam esse trabalho: `c23d2e5`, `3f0deb5`, `a12ae2c`, `741a9a4`.

Os dois destinos ausentes estão escritos SEM crase de propósito: crase promete código que
existe, e o guarda de integridade da doc cobra isso. Quando os arquivos forem criados,
eles podem voltar a ser citados entre crases.

**Armadilhas conhecidas deste porte:**

- a calibração **não pode arrastar** `@store` nem o barrel `@utils` (regra de páginas sem
  mapa). O `tile-loader.js` importa `config.js`, que é folha, mas isso precisa ser
  **conferido no build pelo sourcemap**, nunca pelo nome do chunk;
- ao portar, decidir se a calibração reusa
  `frontend/src/js/street_view_tool/pyramid-math.js` ou ganha cópia própria. Se ganhar
  cópia, ela entra no guarda de paridade (ver item 8), que hoje compara duas
  implementações e passaria a comparar três;
- `state.js` diverge por comportamento **de propósito**: no `ebgeo_360` toda escrita de
  ângulo grava `manual`, aqui só o lote grava. Não espelhar de volta.
- o guarda `frontend/tests/unit/calibracao-espelha-marcador-andar.test.js` cobre só a
  altura do ícone na troca de andar, o rótulo do andar de destino e o arranjo da fila.
  Fora desses três itens a conferência ainda é diff na mão.

---

## 2. ETL offline de projetos 360 recusa acervo podado

**Arquivo:** `backend/scripts/sv360-import.js`

O caminho de **upload** foi corrigido (o ingest aceita acervo só-tiles com a guarda
trocada). O de **linha de comando** não. Ele confere o tamanho do arquivo contra a soma
de `full_size_bytes + preview_size_bytes` do manifesto, e o `index.db` do lado B **não
zerou** esses campos ao apagar os blobs.

**Sintoma esperado, e ele é silencioso:** uma importação em lote do acervo atual pode
reportar sucesso com todos os 29 projetos em `skipped[]`.

Trabalho: aplicar ao ETL a mesma troca de guarda já feita em `validateImagesDb`
(sondar `PRAGMA table_info(images)`, e sem colunas de blob exigir a pirâmide cobrindo
toda foto viva). O código de referência está em
`backend/src/modules/streetview360/sv360.ingest.js`, função `validatePyramidCoverage`.

---

## 3. Piso de segurança do `vite` foi rebaixado, e a raiz não tem lockfile

Vem de `4a444f80` (`origin/main`), classificado como PARCIAL pela rodada adversarial.

**3a.** O commit de origem subiu o CHÃO para `"vite": "^8.1.2"` e
`"@vitejs/plugin-legacy": "^8.1.0"` — ele é todo sobre *path traversal / `server.fs.deny`
bypass*. Aqui `frontend/package.json` declara `^8.0.0` nos dois, faixa que **inclui as
versões vulneráveis**. `git grep '\^8\.1\.'` não devolve nada na árvore.

O argumento de que "`^8.0.0` engloba 8.1.2" é o inverso da lógica de um piso: o lock é
instantâneo, o range é a declaração durável, e é o range que o Dependabot lê e contra o
qual todo `npm update` re-decide.

**3b.** O pacote RAIZ é um pacote npm real (declara `concurrently`) e **não tem
`package-lock.json`**. Não é ignore mal configurado (`git check-ignore` responde NOT
IGNORED): nunca foi gerado. Consequências: `npm ci` na raiz falharia, e o Dependabot vê
só o range.

Pior, a prosa do `.gitignore` da raiz afirma que "o lockfile de cada pacote É
versionado" — **falso para um dos três pacotes**, e é o tipo de documentação que engana
em dobro.

**Fica pendente porque lockfile é tratado como frágil pela constituição e pede
confirmação do dono antes da escrita.** Escolha entre gerar o lock da raiz ou corrigir a
prosa do `.gitignore` para dizer a verdade.

---

## 4. Instável conhecido: convergência de geometria no CRDT

**Arquivo:** `frontend/tests/e2e-ui/browser-collab-crdt-conflict.spec.js`, caso
`concurrent geometry move of the SAME line`.

Na rodada completa do Playwright (274 passed) este foi o único instável: dois clientes
movem a mesma linha em paralelo, e B não convergiu para a geometria que o servidor
gravou dentro de 20 s. Passou na re-tentativa.

**Diagnóstico parcial, não confirmado:** o teste lê o backend UMA vez
(`collab.db.queryFeatureRow`) e fixa aquele valor como alvo do `poll` dos dois clientes.
Se o backend ainda receber escrita depois dessa leitura, o alvo fica velho. As duas ops
passam por `waitForAcked` antes, o que torna isso menos provável — daí o diagnóstico ser
parcial.

**Não foi consertado de propósito.** É convergência de CRDT, área que este branch não
tocou, e um conserto apressado ali arrisca mais que o flake. O arquivo já passou por uma
rodada de determinismo em `2fb822e6`.

Antes de mexer: medir em série (o padrão desta casa), porque um verde único não
distingue conserto de sorte.

---

## 5. Defeito de tab-lock que continua aberto

**Arquivo:** `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`, caso `A2b`.

A segunda aba no MESMO atlas mostra o overlay de bloqueio e **conecta assim mesmo**,
alguns segundos depois. As duas abas ficam online no mesmo atlas, uma delas atrás de um
overlay que diz que ela está parada. Suspeita registrada na spec: o replay do open
adiado (`deferAtlasOpen` / `resumeDeferredAtlasOpen`) roda sem a aba ter recuperado a
claim.

O que mudou nesta sessão foi **só o instrumento**: o gate media um instante e via o
defeito em 4 de 5 execuções; agora amostra a janela e vê em 5 de 5. O `test.fail()`
continua lá porque o defeito continua lá.

Candidato a fechar junto de E2 (freio + aviso de desmontagem) ou E7, conforme
[`docs/decisions/fase-multiaba-2026-08.md`](docs/decisions/fase-multiaba-2026-08.md).

---

## 6. Verificação pendente do guarda de basemap

Vem de `37c5c0c0`, classificado PARCIAL. **Não há código a portar** — o conserto já está
aqui, e a versão do `main` seria regressão (lá o fallback é
`Object.keys(this.styleUrls)[0]`; aqui consulta `config.getEnabledBasemaps()`, porque o
servidor hidrata os basemaps).

O que ficou: `frontend/tests/unit/baselayer-style-uniqueness.repro.test.js` importa os
cinco arquivos estáticos de `frontend/src/js/baselayers/` e **não enxerga**
`config.basemapStyles` hidratado pelo backend. Se um estilo novo chegar por
`/api/config`, o guarda de unicidade não o cobre.

É lacuna real do guarda, registrada aqui e não consertada, porque o conserto muda o
teste de estático para hidratado e merece decisão própria.

---

## 7. Dois pontos de contrato do 360 classificados como PARCIAIS

**7a. Miniatura anunciada que não existe.** `previewThumbnail` é emitido para todo
projeto, exista o arquivo ou não, e o catálogo pede uma imagem que responde 404. A marca
é a mesma nos dois repositórios.

Cuidado ao consertar: `resolveThumbnailPath` já faz o gate de leitura e a miniatura é
ORG-KEYED. Uma coluna "tem thumbnail" exposta na listagem não pode virar canal lateral
que revele a existência de projeto privado.

**7b. Documento TileJSON não portado.** A rodada adversarial derrubou o veredito de
"já portado" deste item: o cliente daqui declara `tiles[]` direto na fonte do MapLibre
(via `withAbsoluteTiles`), que resolve o problema prático, mas o **documento** TileJSON
que o lado B publica (`d0adc31`, `1e66e22`, `fa26146`) não tem equivalente aqui.
Verificar se falta alguma coisa quando o 360 for servido de outra origem.

---

## 8. Guarda de paridade da escada tem alcance conhecido

`backend/tests/unit/escada-espelha-o-cliente.test.js` amarra as duas implementações de
`escadaGravada` (backend e frontend) em seis casos, com asserção absoluta junto.

**O que ele NÃO cobre:** as outras funções de
`frontend/src/js/street_view_tool/pyramid-math.js` (`montarEscada`, `escolherNivel`,
`tilesVisiveis`, `razaoParaLargura`, `custoDaEscada`, `fovHorizontal`,
`larguraNecessaria`) não têm par no backend, porque o servidor só precisa conferir
faixa. Se alguma delas passar a existir dos dois lados, entra no guarda.

Nota de armadilha, paga nesta sessão: `pyramid-math.js` tem **duas** ocorrências do
mesmo trecho de grade, uma em `montarEscada` e outra em `escadaGravada`. Um controle
negativo que substitua "a primeira" mira a função errada e devolve verde falso.

---

## 9. Item não decidido do inventário

`c01e0f1` (`ebgeo_360`): *"o Serra Dourada entra pelo caminho antigo, e o WebP para em
16383 px"*. Classificado **INCERTO** pela rodada: o teto de 16383 px é limite de
dimensão do WebP, e não foi confirmado se ele tem consequência deste lado (o
`tile-loader.js` tem teto de canvas próprio, `LIMITE_CANVAS`).

Trabalho: confirmar se alguma panorâmica do acervo passa desse limite e o que o cliente
daqui faz com ela.

---

## 10. Operacional, não código

- **A cena `museu-1cgeo` não existe neste backend.** Ela era declarada no `config.js`
  estático do monolito; aqui a cena de primeira pessoa é uma linha de `tilesets` no
  catálogo. Quem quiser a cena precisa cadastrá-la pela aba Catálogo do Admin. Sem isso,
  todo o trabalho de primeira pessoa (lista de itens, modo imersivo) não tem onde ser
  exercitado.
- **A UI portada não foi verificada por imagem.** O laço aprovado desta casa é captura
  Playwright do app real seguida de LEITURA da imagem. Não foi feito para o modo
  imersivo nem para a lista de itens, justamente porque depende da cena acima. Assim que
  houver cena cadastrada, capturar e ler.
- **12 vulnerabilidades abertas** no repositório segundo o Dependabot (9 altas, 3
  moderadas), reportadas a cada push. Relacionado ao item 3, e não coberto por ele.
- **`@manycore/aholo-viewer` vendoriza `semver` e `fflate`** dentro do bundle publicado
  sem declará-las como transitivas: um CVE em qualquer das duas deixa o `npm audit` verde
  com o código vulnerável embarcado. Sem guarda hoje.

---

## Ordem sugerida

1. **Item 2 (ETL)** — é o que ainda impede o acervo real de entrar por lote, e o código
   de referência já existe no repositório.
2. **Item 10, primeiro ponto (cadastrar a cena)** — barato, e destrava a verificação
   visual de duas features já entregues.
3. **Item 1 (calibração)** — o maior bloco, agora desbloqueado pelo backend.
4. **Item 3 (lockfile e piso do vite)** — precisa da sua decisão antes da escrita.
5. Itens 4, 5, 6, 7, 9 conforme prioridade de produto.
