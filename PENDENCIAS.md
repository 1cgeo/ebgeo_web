# Pendências: o que a auditoria achou e não corrigiu

Auditoria do frontend, 2026-08-14. Aqui está só o que **exige decisão sua**, não
o que ficou por falta de tempo. Cada item foi confirmado no código e passou por
um refutador adversarial; o que sobrou é escolha de produto, não de engenharia.

O que depende do servidor está em [PENDENCIAS-BACKEND.md](PENDENCIAS-BACKEND.md).
O inventário de cobertura está em [COBERTURA.md](COBERTURA.md).

Não há nenhum `TODO` nem `FIXME` pendente no código: as três ocorrências que a
busca encontra são a palavra "TODOS" em mensagens de confirmação em português.

---

## 1. Mover feição no celular não move nada

**Onde:** `frontend/src/js/phone/phone-layout.js:309-325`.

Ao confirmar o arrasto, o app exibe "Posição atualizada". Nenhum ponto do fluxo
lê `map.getCenter()`, e nenhum chama a store. Lido linha a linha: `onMoveStart`
só faz `snapTo('peek')` e esconde os botões flutuantes; `phone-move-actions.js`
tem 109 linhas e nenhuma leitura de mapa; `isMoving()` é definido e não tem um
consumidor sequer. O recurso não existe.

**Escolha:**

- **(A) Parar de mentir.** Trocar o toast de sucesso por nada, ou por um aviso de
  que mover ainda não está disponível. Uma linha, sem escolha de produto.
- **(B) Implementar.** Capturar o centro no início, calcular o deslocamento no
  fim, transladar a geometria inteira (percurso recursivo em `coordinates`) e
  persistir pela store. É trabalho real, e muda o que o usuário pode fazer.

Não apliquei nenhuma das duas: (A) remove um recurso da interface e (B) cria um.

---

## 2. Quarenta pontos de coordenação usam o mesmo desenho

**Onde:** `frontend/src/js/military_tools/coordination_measure_tool/coordination_points_catalog.js`.

Medido sobre o catálogo real: são 105 pontos, e a mesma string SVG aparece 41
vezes. São os 14 escalões, os 14 de força-tarefa e as 12 classes de suprimento,
todos com o mesmo `viewBox` e o mesmo path. As funções que os geram só trocam
nome, categoria e âncora: o desenho é idêntico. Na tela, quarenta opções distintas
produzem o mesmo símbolo.

**Escolha:**

- **(A) Autorar os 40 símbolos** conforme MIL-STD-2525 e T34-400 (barras e pontos
  de escalão sobre o retângulo, algarismo romano da classe dentro do ícone de
  suprimento). É trabalho de dado, e a fonte dos glifos precisa ser definida por
  você.
- **(B) Esconder do combo** o que ainda não tem símbolo próprio, removendo as
  duas entradas de escalão de `getPointsGroupedOptions`.

Corrigi, nesta auditoria, um defeito vizinho e independente: 61 dos 77 tipos
estavam **inalcançáveis** porque a lista de ordenação de categorias estava sem
acento e o casamento é por igualdade exata. Isso era defeito, e está consertado.
O símbolo repetido não é defeito, é ausência de autoria.

---

## 3. Trinta e oito exports que só o barril reexporta

**Onde:** espalhados; o levantamento por família está no relatório de auditoria.

O knip aponta 143 exports sem uso, dos quais 38 são reexportados por um barril
`index.js` ou pela fachada `store.js` sem nenhum consumidor final. Uma API de
barril exportada de propósito para consumo futuro é legítima; um helper que
sobrou de refatoração não é. Os dois casos são indistinguíveis de fora.

**Escolha por família, não item a item:** `atlas/` (5), `tool_manager/helpers/` (6),
`attribute_table/components/` (4), `coordination_measure_tool/` e o restante. Diga
quais famílias são superfície pública deliberada, e eu removo o resto com prova de
não uso.

---

## 4. `undoLastAction` e `redoLastAction` existem duas vezes, com regras diferentes

**Onde:** `frontend/src/js/store/map.operations.js:649` e `:659`.

Há duas funções de mesmo nome no mesmo pacote, e uma delas tem a guarda de mapa
bloqueado que a outra não tem. Duas funções homônimas com semântica de permissão
diferente é uma armadilha que só aparece quando alguém importa a errada.

**Escolha:** apagar as de `map.operations.js`, ou dar a elas a mesma guarda
`isCurrentMapLockedSync`. Não deixar como está.

---

## 5. Três decisões de peso do pacote que exigem medição sua

Todas com número medido, nenhuma aplicada, porque as três trocam risco por bytes.

- **`proj4` inteiro no pacote inicial** para converter apenas UTM: até 110 kB
  minificados. Registrar só o núcleo mais duas projeções, ou escrever a conversão
  UTM direta (cerca de 2 kB, e testável com fast-check, já que o ambiente é node
  puro).
- **`milsymbol.min.js` global e ansioso**, 835 kB, 15,4% do JS inicial da página
  do mapa. Antes de mexer, é preciso instrumentar `window.ms` com um Proxy e
  confirmar que nada o toca antes do primeiro gesto do usuário. Não fiz essa
  medição.
- **Tabelas de símbolo militar**, 215,5 kB dos 456,8 kB do grupo. Separar o que o
  gerador precisa do que só o seletor precisa exige partir catálogos que hoje são
  um arquivo só.

---

## 6. Duas fotos panorâmicas de amostra, 828 MB, publicadas a cada deploy

**Onde:** `frontend/public/street_view/IMG` (657 JPEG) e `METADATA`.

O build copia tudo para o `dist`, que sai de cerca de 370 MB para 1,2 GB. Apenas
11 arquivos desse diretório estão versionados, então são dado local. Neste branch
o visualizador 360 consome o backend, o que sugere resíduo do modelo anterior.

**Antes de remover, confirme** que nenhum fluxo ainda serve dessas amostras. O
`npm run deploy` publica por troca de symlink contra produção, então são 828 MB
de transferência por publicação. Não removi porque apagar dado de 657 arquivos
sem sua confirmação não é reversível por `git`.
