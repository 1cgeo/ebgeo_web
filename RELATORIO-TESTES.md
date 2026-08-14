# A suíte auditada

Auditoria do frontend, 2026-08-14. A lente 9 leu os **321 arquivos de teste**
com uma pergunta só: **o que este verde estaria provando se o código estivesse
errado?**

Achou 87 defeitos, e os piores não estavam em testes periféricos. Estavam nos
guardas que o projeto mais usa para confiar em si mesmo.

> **Correção deste relatório.** A primeira versão falava em 244 arquivos: o
> inventário da auditoria tinha omitido `tests/e2e/` e `tests/store/`, os 77
> arquivos que foram lidos depois. Vale registrar que a doc da própria suíte
> continha o mesmo defeito, e por muito mais tempo (ver §8).

**Nenhum teste foi removido.** Onde havia cobertura vazia, ela foi preenchida; o
único caso reescrito por inversão está documentado abaixo, com o motivo.

Métrica: 2.851 → **3.200** testes, 141 → **173** arquivos.

---

## 1. O elo 6 do full-chain nunca executou

`tests/e2e-ui/helpers/collab-helpers.js` e `helpers/full-chain.js`

O full-chain anuncia, no README e no próprio docblock, que verifica **seis elos**
de cada operação: IndexedDB do autor, transporte, Postgres, sinal, IndexedDB do
par e browser do par. O sexto é condicionado a uma flag, `__EBGEO_TRACE_RENDER__`,
que **não tem um único escritor em todo o repositório**. A busca global devolve
cinco ocorrências, todas leituras. A checagem era sempre pulada. Eram cinco elos.

Ligada a flag, apareceu a segunda camada, e ela é pior: a sonda que alimenta o
elo lia `src._data.features`, e o MapLibre desta versão guarda `{ geojson: data }`.
Todo span saía `inSource: false`. Quem esperava `true` nunca via a condição
satisfeita; quem esperava `false` — o caso do delete — via na primeira leitura,
olhasse o mapa o que olhasse.

**Duas camadas de cobertura vazia empilhadas, e a de fora escondia a de dentro.**

O que mudou: a flag é ligada em `openClient`; o assert passou a ler a fonte viva
do par pela API pública `getData()`; e o portão condicional saiu, porque um portão
cujo único efeito é pular a asserção não é portão. A sonda de produção foi
corrigida em commit próprio (`176db58a`).

**Controle negativo:** desligada a ponte que repopula as sources do par
(`remote-feature-render.js`), o elo 6 acusa, com a leitura real da fonte na
mensagem de erro. Antes da correção, essa mesma regressão passava verde.

Depois: 37 de 38 specs de colaboração passam, 1 flaky (verde no retry, causa
conhecida e alheia), zero `BROKE AT LINK`.

---

## 2. Um repro que não repro, e a regressão viva que ele escondia

`tests/integration/import-phantom-map.repro.test.js`

O teste de regressão do mapa-fantasma **reimplementava** `addMap` e a normalização
dentro do próprio arquivo (`replayAddMap`). A correção real podia ser revertida
sem nenhum teste ficar vermelho.

Passou a chamar o código de produção e ficou vermelho **na hora**. O defeito:

1. `createMapCompat` cunha um UUID incondicionalmente, mesmo com a chave por nome.
2. Com sync desligado, o registro persistido fica com `id` = nome, mas a função
   **devolve** o objeto com o UUID.
3. `addMap` lê esse UUID, vê que difere do nome e registra no resolver um
   mapeamento para uma chave que não guarda nada.
4. A escrita seguinte resolve pelo resolver e grava numa **segunda** entrada.
5. E `getMap(nome)` continua acertando a entrada antiga, agora obsoleta.

Feição desenhada num mapa recém-criado era escrita numa chave e lida de outra:
**sumia**. Não era só import: valia para qualquer `addMap` no uso local anônimo.

O histórico, levantado por `git log -S`, é o que dá o tamanho do problema:
corrigido em `8e2eed65` (2026-06-03), **reintroduzido** por outra porta em
`ee8b87dd` (2026-06-21), e 18 dias sem ninguém ver, porque o repro era uma cópia
do código.

Corrigido em `map.operations.js`: o mapeamento só é registrado quando o mapa é de
fato UUID-keyed. **Controle negativo:** reintroduzido o registro incondicional,
dois casos reprovam.

### O caso reescrito, e por que não é acomodar regressão

O caso `BUG (pre-fix shape)` afirmava que um id injetado **produz** o mapa
fantasma. Era descrição correta do defeito. Fechada a origem, o comportamento
mudou, e a asserção foi **invertida**: o mesmo id injetado agora não parte o mapa
em dois. O comportamento antigo era o bug; a expectativa mudou porque o código
melhorou, e não o contrário.

### Uma honestidade que o relatório precisa carregar

Acrescentei um caso com sync **ligado**, para a correção não trocar um defeito por
outro. Medido por mutação: **ele não discrimina a linha corrigida**, porque
`LocalRepository.saveMap` também registra o mapeamento ao gravar. O comentário do
teste diz isso, em vez de aparentar rigor que não tem. O que ele prende é a
garantia de ponta: com sync ligado, uma chave só, ela é o UUID, e o nome chega
nela.

---

## 3. Um teste sem nenhuma assertiva

`tests/integration/operation-queue-lifecycle.test.js:268`

O caso `compaction flag prevents re-entrancy` setava a flag, chamava `_compact()`
e desfazia a flag. Zero `expect`. Verde para qualquer comportamento, inclusive
para uma compactação que apagasse a fila inteira.

Reescrito para asserir o **efeito** do guarda, em duas metades: com a flag ligada
nada muda, e com a flag desligada a compactação de fato acontece. Sem a segunda
metade, o teste passaria com `_compact()` quebrada.

---

## 4. Um mock que apagava um caminho inteiro

`tests/integration/sync-engine.test.js:57`

O mock da fila não tinha `getAll()`. Todo teste de flush estourava um `TypeError`
dentro de `_reconcileConvergenceGuard()`, que o próprio código sob teste engolia
num `catch`. O passo de reconciliação pós-flush **nunca rodava em teste**, e a
suíte ficava verde sobre um caminho inexistente.

Isto foi encontrado **executando** com `--disableConsoleIntercept`, não lendo: a
mensagem aparecia no console e ninguém a olhava. A evidência da correção é a
mensagem ter desaparecido.

---

## 5. O nível `manage` não era exercido em nenhum spec de browser

`tests/e2e-ui/browser-collab-permissions.spec.js`

A busca por `permission:` em `tests/e2e-ui` devolvia `comment` (1), `read` (6) e
`write` (18). Zero `manage`. É exatamente o nível que uma lista fechada
`write || owner` exclui em silêncio, e que já causou bug real **duas vezes** neste
repositório, dos dois lados.

Entrou um bloco curto, focado no que só o browser prova: o co-Gestor desenha com
a ferramenta real, a feição chega ao dono pelos seis elos, e a interface dele é a
de Gestor (com barra de desenho e "Compartilhar", sem "Excluir projeto").

**Controle negativo:** mutada a capacidade e mutado o gate da interface, o caso
acusa nos dois.

---

## 6. Convergência que aceitava acordo entre pares

`tests/e2e-ui/browser-collab-three-client-flow.spec.js:142`

O poll aceitava `ca === cb && cb === cc` como convergência, sem ler o Postgres e
sem esperar o `push.ack` de ninguém. Três clientes podem concordar num valor que
o servidor nunca aceitou. Dois specs irmãos já tinham documentado e corrigido
exatamente esse padrão.

Agora ancora no servidor: espera o `enqueue` e o `push.ack` de cada cliente,
confirma no log de operações, e a conferência final lê o **banco**. A concordância
entre pares virou consequência verificada, não critério.

---

## 7. Contagens que não contavam, e um nome que mentia

`tests/e2e-ui/browser-feature-panel-edits.spec.js:136` — a asserção que dizia
provar "update não é um segundo create" era tautológica: os helpers terminam em
`.find(...) || null`, então devolvem no máximo um objeto, e a contagem era
derivada de "achei ou não achei". A contagem não contava. Passou a contar de
verdade sobre o pull.

`tests/e2e-ui/browser-cesium3d.spec.js:242` — o título prometia `two creates with
the SAME id collapse to one` e o corpo enviava create + **update**. Nome de teste
também é afirmação, e este contradizia o corpo. Etiqueta corrigida para o que ele
prova, e a idempotência de create duplicado ganhou caso próprio.

`tests/e2e-ui/browser-p11-roundtrip.spec.js` — o id do usuário B vinha da resposta
de `register()`, que desde 2026-07-25 não devolve mais dado de conta; e o `fetch`
do compartilhamento não guardava o retorno nem conferia status, então uma falha de
autorização aparecia dez passos adiante como timeout de UI.

---

## O que ficou vermelho e não foi mascarado

**O P11 está quebrado de verdade.** Corrigido o seed do teste, ele revelou que a
configuração temporal por mapa **não chega ao par**. O agente verificou elo a elo,
com sonda isolada em porta e banco próprios, e confirmou que o servidor está
correto. A expectativa **não** foi ajustada: o comportamento antigo é o defeito.
Isso está em [PENDENCIAS.md](PENDENCIAS.md) para decisão, porque a correção toca o
contrato de sincronização da configuração temporal.

---

## 8. A documentação da própria suíte era a única não vigiada, e apodreceu

`tests/TESTING.md` e `tests/TESTING-BACKLOG.md`

O projeto verifica a documentação **por teste**, e não por disciplina:
`docs-integridade.test.js` exige que todo caminho e todo símbolo citados existam.
A lista de alvos cobria `CLAUDE.md`, `README.md`, `MEMORY.md`, o livro-razão, os
dois do backend, e as pastas `docs/`, `.claude/rules`, `.claude/skills` e
`.claude/agents`.

**Não cobria `frontend/tests/`.** E foram exatamente esses dois documentos que
apodreceram:

- O roadmap mandava escrever quatro suítes **que já existem**.
- O backlog declara o Lote 1 concluído, nomeando nove suítes, e vinte linhas
  abaixo manda começar por oito dessas mesmas nove.
- E `TESTING.md` afirma que `npm test` "roda toda a suíte", quando o
  `vitest.config.js` exclui `tests/e2e/**` e `tests/e2e-ui/**`. Um agente que
  segue o guia roda `npm test`, vê verde, e nunca executa a camada que sobe o
  backend real.

Esse último é o mesmo defeito que **eu** cometi no inventário desta auditoria, e
que o documento vinha cometendo havia muito mais tempo: descrever um subconjunto
e chamá-lo de conjunto.

Os dois arquivos entraram na lista de alvos, e o guarda acusou 19 caminhos
quebrados na primeira execução. Cobertura que para na borda de um diretório é
cobertura que não cobre, e o comentário do próprio teste já dizia isso a respeito
de `.claude/agents`, por um episódio idêntico em 2026-07-18.

---

## Um aviso operacional que custou medições

A suíte `e2e-ui` usa **porta e banco fixos** (Vite 4321, backend 3912, banco
`ebgeo_ui_e2e`) e não suporta duas execuções simultâneas: o `global-setup` faz
DROP/CREATE e mata a migração da outra, e a execução atropelada termina com
`N skipped` e **código de saída 0**. Ou seja, uma colisão produz um verde que não
verificou nada.

Vários agentes tiveram medições invalidadas por isso, e o que resolveu foi
serializar as execuções e detectar a assinatura da colisão para repetir. Vale
registrar no repositório: qualquer automação que rode `e2e-ui` em paralelo está
medindo o vazio.
