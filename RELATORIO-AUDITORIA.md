# Auditoria do frontend

2026-08-14, branch `integracao_backend`. Leitura integral de **1020 arquivos**,
sem amostragem, por nove lentes. O inventário arquivo a arquivo está em
[COBERTURA.md](COBERTURA.md), com zero pendentes.

> **Correção deste relatório.** A primeira versão dizia 907 arquivos e declarava
> cobertura total. O inventário tinha sido enumerado à mão e **omitia
> `tests/e2e/` (55 arquivos, o guarda da fronteira entre os pacotes) e
> `tests/store/` (19)**. Os 77 arquivos foram lidos depois, e o inventário passou
> a ser derivado de `git ls-files`. Um inventário enumerado erra por ausência
> silenciosa; um derivado erra por exclusão explícita, que aparece na tabela.
> O episódio está no [livro-razão](livro-razao.md), porque é exatamente a classe
> de defeito que esta auditoria persegue: conferir um subconjunto e tratá-lo
> como o conjunto.

---

## Sumário

A auditoria achou **799 defeitos** em 419 dos 1020 arquivos. Foram corrigidos os
de comportamento, contrato e segurança; o que exige decisão de produto está em
[PENDENCIAS.md](PENDENCIAS.md) e [PENDENCIAS-BACKEND.md](PENDENCIAS-BACKEND.md).

Três achados valem mais que a soma dos outros, e nenhum dos três é um bug comum:

**1. Os guardas estavam quebrados, e apontavam para o lado errado.** O
`knip.json` declarava uma única entrada, então as três páginas sem mapa (admin,
projetos, calibração) apareciam inteiras como código morto: 16 dos 18 arquivos
que ele acusava eram código vivo, entry point incluso. Um guarda de código morto
que aponta para produto convida a apagar produto, e esta auditoria começou com
uma lente encarregada exatamente de apagar. Foi o primeiro conserto, em commit
isolado, antes de qualquer outra coisa.

**2. O escapador de HTML não escapava aspas, e o JSDoc dizia que escapava.**
`escapeHtml` era `textContent → innerHTML`, e a serialização de um nó de texto
troca apenas `&`, `<` e `>`. Aspas só são escapadas dentro de valor de atributo,
e um nó de texto nunca é um. Resultado: a função era segura no caso que o exemplo
do JSDoc mostrava (conteúdo de elemento) e insegura nos 28 pontos, em 9 arquivos,
que interpolavam dentro de atributo. Como nome de feição viaja entre usuários
pelo sync, o payload era armazenado e disparava na sessão de outra pessoa.

**3. Um soluço de rede apagava o trabalho local.** Não era um defeito, eram três
encadeados, e nenhum deles isolado parece grave: `refresh()` destruía a sessão em
qualquer erro (não só 401); isso virava `handleSessionLost` → `_handleLogout` →
`clearAllDataStore()`; e o flush seguia falhando calado. O gatilho não é
hipotético: o limitador de refresh do backend é chaveado por IP e o deploy é rede
militar atrás de NAT, então um pico de uso de colegas gera 429 para quem não fez
nada. Só a lente de contrato, olhando o sistema inteiro, viu os três juntos.

---

## Números

| Métrica | Antes | Depois |
|---|---:|---:|
| Testes (frontend) | 2.851 | 3.182 |
| Arquivos de teste | 141 | 172 |
| Testes e2e | 169 | 169 |
| Cobertura do backend (statements) | 98,02% | 98,02% |
| Avisos de lint | 0 | 0 |
| JS gerado no build | 9,65 MB | 9,62 MB |
| Payload inicial de `index.html` | — | **−240,7 kB** (−95,7 kB gzip, −13,5%) |
| Playback temporal, 5.000 feições | 15,2 ms/frame | **8,1 ms/frame** |
| Layout de direções do 360, 50 alvos | 70 µs/frame | **0,01 µs/frame** |
| Arquivos "mortos" reportados pelo knip | 18 (16 falsos) | 2 |

Diff total: 116 arquivos, 7.318 linhas adicionadas, 564 removidas, em 9 commits.

### Achados por lente

| Lente | P0 | P1 | P2 | P3 | Total |
|---|---:|---:|---:|---:|---:|
| 4 — bug e corretude | 8 | 61 | 95 | 59 | 223 |
| 1 — código morto | 0 | 5 | 49 | 110 | 164 |
| 6 — UI e acessibilidade | 0 | 2 | 69 | 36 | 107 |
| 2 — ruído | 0 | 0 | 10 | 83 | 93 |
| 9 — testes | 1 | 10 | 37 | 39 | 87 |
| 3 — bloat | 0 | 0 | 22 | 45 | 67 |
| 7 — performance | 0 | 1 | 23 | 7 | 31 |
| 5 — contrato | 4 | 4 | 4 | 2 | 14 |
| 8 — segurança | 3 | 4 | 3 | 3 | 13 |
| **Total** | **16** | **87** | **312** | **384** | **799** |

Mais 164 itens registrados como **pergunta**, e não como achado, por confiança
insuficiente. Confiança baixa não virou commit.

---

## Método, e por que ele importa para ler o resto

Cada achado passou por um **refutador adversarial** com a tarefa explícita de
derrubá-lo, lendo o código de hoje e procurando ativamente a razão pela qual o
defeito não aconteceria. Dos 64 achados P0 e P1 submetidos, 53 foram confirmados,
8 ficaram parciais, 2 viraram decisão de produto e 1 foi refutado: taxa de
confirmação de 83%.

A refutação pagou por si em casos como o `map-lock.controller`, onde o achado
descrevia corretamente a mistura de nome e UUID, mas o refutador provou, lendo o
call site atual, que o envenenamento do lote de flush **já não acontecia**.
Aplicar o achado original teria sido consertar o que estava certo.

E os aplicadores recusaram trabalho com prova. O caso mais instrutivo: memoizar
`normalizeTrajectory` por identidade de array prometia 99% de redução, e foi
recusado porque a premissa era falsa — o editor de trajetória muta o **mesmo**
array no lugar, de propósito, para o painel não perder a referência. O memo
devolveria o valor velho após cada edição, e o sintoma seria trajetória que não
atualiza na tela, sem erro nenhum. Ganho medido trocado por bug silencioso.

Todo teste novo levou **controle negativo executado**, não imaginado: desfazer o
fix e confirmar o vermelho. Onde isso não foi possível, está dito.

---

## O que foi corrigido

### Segurança

| Arquivo | Achado |
|---|---|
| `utilities/html-escape.js` | não escapava aspas; 28 interpolações em atributo ficavam abertas |
| `briefing/export/pdf-page-composer.js:267` | HTML de slide de outro usuário via `innerHTML` no documento vivo, sem sanitizar |
| `attribute_table/attribute-table.control.js:840` | CSV sem neutralizar fórmula; um valor iniciado por `=` executa no Excel |
| `baselayers/base-layer.control.js:126` | nome e URL do catálogo interpolados em `innerHTML` |

O escape de CSV levou uma guarda que o achado original não tinha: número negativo
**não** é prefixado, senão toda coluna numérica viraria texto.

### Permissão e sincronização

Nenhuma operação de escrita de `cesium3d`, `streetview360` e catálogo consultava
`checkPermission`. As `GuardAction` existiam e nunca eram lidas: um Comentarista
conectado a um atlas remoto gravava e **enfileirava** a operação, que só morria do
outro lado. São 15 entradas gateadas no 3D, 8 no 360 e 3 no catálogo, sempre pela
hierarquia dos cinco níveis, nunca por lista fechada — que é como o co-Gestor já
foi silenciado duas vezes neste repositório.

Quatro operações de marcador 360 passavam o **nome** do mapa onde o logger espera
o UUID, e o dispatcher descarta em silêncio toda operação com `mapId` não-UUID. O
trabalho sumia sem erro. O teste que existia **prendia o defeito**, afirmando o
nome como valor esperado; foi corrigido junto.

### Persistência que não persistia

`hasFeatureChanged` ignorava propriedades em **seis** ferramentas: elipse,
retângulo, setor e círculo não comparavam `lineStyle`; imagem e texto não
comparavam `zoomCorrectionEnabled`; o símbolo militar não comparava `sidc`, os
amplificadores textuais e as extensões. Como `saveFeatures` só chama `update` sob
esse portão, mudar só o estilo da linha era descartado sem aviso. Cada ferramenta
tinha sua própria lista fechada, e todas envelheceram junto com as propriedades
que foram sendo acrescentadas.

No celular, salvar feição chamava `updateFeature(type, featureId, { properties })`
contra uma assinatura que espera o **objeto** da feição. `cleanFeature` recebia uma
string, caía em `!feature.type`, emitia `console.warn` e retornava `null`; a função
retornava sem lançar; e a linha seguinte exibia "Feição atualizada".

### Coisas que sumiam em silêncio

- `processGroupsForAdditiveImport` chamava `.values()` sobre um objeto plano. O
  `TypeError` era engolido por um `try/catch` e **todos** os grupos do arquivo
  importado desapareciam.
- 61 dos 77 tipos de ponto de coordenação eram inalcançáveis pela interface,
  porque a lista de ordenação de categorias estava sem acento e o casamento é por
  igualdade exata.
- Desselecionar um grupo lançava `TypeError` no primeiro dos 14 controles que leem
  `feature.properties.id` sem guarda, abortando o resto da desseleção.
- Renomear mapa recusava sem devolver nada, e o chamador seguia apontando o mapa
  corrente para um nome inexistente.
- Um atlas compartilhado como Gestor ou Comentarista aparecia **sem crachá
  nenhum** no Atlas Drive, porque o rótulo só existia para três dos cinco níveis.

### Recursos que vazavam

Promessas que nunca resolviam (captura de tela sem failsafe, leitura de arquivo
cujo `abort()` dispara `onloadend` e não `onerror`, `wsClient.connect()` cujo
`_connectReject` era atribuído e jamais invocado), timers não cancelados no
`destroy()`, e recálculo de visibilidade fora da fila que serializa os outros dois
caminhos.

### Performance

Ver a tabela de números. O detalhe que vale registrar: os nomes dos chunks
gerados **mentem**, porque são rótulos de grupo, e um chunk subdividido herda o
nome de um dos grupos fundidos. O chunk que carrega o Chart.js inteiro chama-se
`analysis-tools-*`, e admin e projetos baixam um `cesium-integration-*` que não
contém Cesium. A atribuição foi feita decodificando as VLQ dos sourcemaps, não
pelo nome.

---

## O que NÃO foi corrigido, e por quê

Está tudo em [PENDENCIAS.md](PENDENCIAS.md), com a escolha explicitada. Em resumo:
mover feição no celular não faz nada (corrigir é remover um recurso ou criar um);
40 dos 105 pontos de coordenação compartilham o mesmo desenho (falta autoria de
dado, não código); 38 exports só reexportados por barril (decidir por família o
que é superfície pública deliberada); três decisões de peso de pacote que exigem
medição sua; e 828 MB de fotos de amostra que o build publica a cada deploy.

Duas pendências dependem do servidor, em
[PENDENCIAS-BACKEND.md](PENDENCIAS-BACKEND.md): o limitador de refresh chaveado
por IP numa rede atrás de NAT (a causa da cadeia de perda de dado, cujos efeitos
já foram cortados no cliente) e o blob de imagem órfão que nunca é recolhido.

---

## Sobre a suíte de testes

Está em [RELATORIO-TESTES.md](RELATORIO-TESTES.md). O resumo desconfortável: a
lente 9 achou **cobertura vazia nos próprios guardas**, incluindo o elo 6 do
full-chain ("apareceu no browser do par"), que nunca executava porque ninguém
liga a flag que o condiciona. O README anunciava seis elos verificados; eram
cinco.

Nenhum teste foi removido nesta auditoria.
