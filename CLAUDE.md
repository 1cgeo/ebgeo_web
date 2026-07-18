# EBGeo: constituição

GIS web do Exército Brasileiro. Monorepo de dois pacotes simétricos: **web** em [`frontend/`](frontend/) (Vanilla JS, Vite, MapLibre + Cesium + Three.js, IndexedDB) e **backend** em [`backend/`](backend/) (Express + PostgreSQL/PostGIS + `ws`), com [`backend/CLAUDE.md`](backend/CLAUDE.md) próprio. A raiz só orquestra: os scripts dela delegam com `--prefix`, e cada pacote tem seu `package.json`, seu `node_modules` e seu `.gitignore`.

Este arquivo carrega **método, armadilha e convenção que diverge do default**. O que se deriva lendo o código não mora aqui: detalhe de arquitetura em [`.claude/rules/`](.claude/rules/), o porquê das decisões em [`docs/wiki/index.md`](docs/wiki/index.md), fatos duráveis em [`MEMORY.md`](MEMORY.md), princípios integrais em [`docs/doutrina.md`](docs/doutrina.md).

## Os seis princípios (condensados)

1. **Competência só compõe se for codificada, nunca lembrada.** O que não virou teste, regra ou learning considera-se perdido.
2. **O laço se alimenta da realidade, nunca de si mesmo.** Em software a realidade tem três vozes: o **código** (não a prosa que o descreve, inclusive esta), o **teste** (não a intenção de quem o escreveu) e o **comportamento observado** (não o `exit 0`).
3. **Plasticidade na periferia, rigidez no núcleo.** Contrato congelado e invariante de dados não se mexem sem decisão registrada; o resto é livre.
4. **Confiança é gradiente, ganho por tarefa e revogável.** Dry-run antes de mutar; pare no irreversível. Esclarecimento de escopo **não é** autorização.
5. **Melhoria se descobre por seleção, não se decreta.** Controle negativo: reverta o fix e confirme que o teste falha.
6. **O direito de desaprender é tão sagrado quanto o de aprender.** Podar regra morta e página dormente é manutenção, não perda.

## Verificação: a lição que mais custou

Três episódios de `verificacao-fantasma` e dois de `teste-que-nao-prende` no [`livro-razao.md`](livro-razao.md) têm a mesma raiz: **uma checagem que não checa**. As três formas:

- **Verificação que chega depois da ação não é verificação.** Rodar lint na mesma linha de comando do `git commit` faz a saída aparecer depois do commit já ter passado. Comando separado, antes.
- **Conferir um subconjunto e tratar como o conjunto.** `grep` em dois arquivos da raiz deu por completa uma busca que tinha alvos em `backend/`. Onde existe teste que varre tudo, não confira à mão.
- **Cobertura vazia passa verde.** Teste cuja regra não casa com nada reporta sucesso sem verificar nada. Pergunte sempre *o que este verde estaria provando se o código estivesse errado*.

Não chancele a própria saída: rodar o teste não é a mudança funcionar; escrever a doc não é a doc estar certa.

## Não negociável

- **Não use ferramenta de preview ou browser.** Verificação de lógica é `npm run lint` + `npm test`; de UI, o Playwright (`npm run test:e2e:ui`).
- **Trate como frágil, sem hook para segurar:** `deploy/` (roda contra produção), `.env`, lockfile e `frontend/public/vendors/`. O bloqueio automático foi removido em 2026-07-18 a pedido; agora é julgamento, então confirme antes de escrever nesses caminhos.
- **Trabalhe no branch atual.** `main` é outra linha do produto; não sincronize sem pedir.
- **Login é opcional; servidor não é.** O app roda anônimo, mas o boot é fail-fast em `GET /api/config`; sem backend alcançável, tela "EBGeo indisponível". `frontend/src/js/config.js` é só o *shape* que o servidor hidrata; **não há fallback estático**. Anônimo ≠ offline.
- **Permissão por atlas tem CINCO níveis:** `read < comment < write < manage < owner`. Sempre gate pela hierarquia. Lista fechada tipo `perm === 'write' || perm === 'owner'` exclui o `manage` em silêncio e já causou bug real, duas vezes, nos dois pacotes.
- **Escrita de entidade colaborativa é só via sync.** Não crie rota REST de escrita para feature/map/layer/group/briefing/slide.
- **Mudança que cruza os dois pacotes** (envelope de sync, `/api/config`, permissões, contrato congelado) é verificada **dos dois lados no mesmo commit**. O E2E sobe o backend real e é o guarda dessa fronteira.

## Comandos

Os scripts estão em `package.json`; os que não se adivinham:

```bash
npm run dev           # stack completo: backend :8080 + Vite :3000 (dev:web sobe só o Vite,
                      #   que sozinho não boota: fail-fast em GET /api/config)
npm run build         # compila para dist/ ;  npm run deploy publica (symlink swap)
npm run test:backend  # exige PostgreSQL + PostGIS + superusuário; cria e dropa ebgeo_test
npm run test:e2e:ui   # Playwright com o backend REAL de backend/
npm run knip          # dead-code
```

Arquivos `.js`/`.css` editados passam por lint automático (hook PostToolUse), e a saída aparece depois de cada escrita.

## Convenções que divergem do default

- **Imports por alias em código novo** (não há regra de lint; 64 dos 567 arquivos de `frontend/src/js/` ainda usam `../../`, e migrá-los é decisão pendente, não dívida silenciosa): `@/`, `@js/`, `@store/`, `@utils/`, `@tools/`, `@toolbar/`, `@modals/`, `@sidebar/`, `@layers/`, `@catalog/`, `@ui/`, `@events/`, `@state/`, `@css/`. Cada pasta de módulo expõe um barrel `index.js`.
- **Idioma:** string de UI em pt-BR com acento correto; comentário e JSDoc em inglês; propriedade de feição em português (`nome`, `descricao`, `visivel`, `bloqueado`).
- **Comentário de caminho na linha 1** de todo arquivo JS, relativo ao `src/` do pacote: `// Path: js/draw_tools/point_tool/add_point_control.js`. Nunca remova.
- **Sem estilo inline em JS.** Classes BEM em arquivo CSS; exceção só para valor computado em runtime (cor vinda do JS, posição calculada).
- **XSS:** nunca `innerHTML` com dado de usuário. Use `textContent` ou `createElement`; `escapeHtml` de `@utils/html-escape.js` ao interpolar. Ícone SVG estático é ok.
- **Limpeza de recurso** via `@utils/event-cleanup.js`. Todo `map.on()` do MapLibre pareado com `map.off()` no `onRemove()`; handler do Cesium com `.destroy()`; timer sempre limpo.
- **Utilitários obrigatórios:** `deepClone()` (não `JSON.parse(JSON.stringify())`), `showToast()` (não `alert()`), `generateUUID()` para todo id, constantes `EventTypes.XXX` (nunca string literal de evento).
- **CSS** em `frontend/src/css/` com os custom properties de `design-tokens.css`. Anime com `transform: translateX()`, nunca `left` (evita layout thrashing).
- **Sem em-dash na prosa** de documentação; vírgula, parênteses ou frase separada.

## Padrões estruturais

**Ferramenta de desenho = 3 arquivos:** `add_*_control.js` (IControl do MapLibre) + `add_*_geometry.js` (geometria pura, testável em node) + `*_attributes_panel.js`. Use a skill `new-tool`.

**Transação do store é persistence-first**: efeito colateral só roda depois que o IndexedDB confirma. Se a persistência lança, nada mais acontece:

```javascript
await runTransaction(async (tx) => {
    tx.deferSync(() => updateColorTracking(feature));   // UI
    tx.deferAsync(() => logFeatureOperation(...));       // log / fila de sync
    return async () => { await repo.set(key, data); };   // persistência: roda PRIMEIRO
});
```

Ordem: persistência → deferSync → deferAsync. Detalhe na skill `store-op`.

**Erro de store, três casos:** argumento inválido (bug do chamador) → `throw new Error`; falha esperada (mapa bloqueado) → `return` + emitir `STORE_OPERATION_BLOCKED`; risco de perda de dado (IndexedDB) → `throw` + emitir `STORE_PERSIST_ERROR`.

**Serviços:** `initServices()` antes de qualquer componente; depois `getEventBus()` / `getStateManager()` / `getLayerManager()`.

## Documentação

A wiki em [`docs/wiki/`](docs/wiki/index.md) **é** a documentação, e vale um critério só: **o código já é a evidência**. Antes de escrever um parágrafo, pergunte se um engenheiro competente chegaria nele sozinho lendo o código. Se sim, não escreva. Entra o porquê e a alternativa rejeitada, a armadilha, o contrato congelado, o não-óbvio que atravessa arquivos. Regras de manutenção em [`docs/wiki/wiki-schema.md`](docs/wiki/wiki-schema.md).

Documentação desatualizada é **pior que ausente**: engana ativamente, e engana em dobro um agente, que a trata como verdade. Por isso ela é verificada por teste ([`frontend/tests/unit/docs-integridade.test.js`](frontend/tests/unit/docs-integridade.test.js)) e não por disciplina: todo caminho citado e todo wikilink precisam resolver.

Ao corrigir um desvio, registre uma linha no [`livro-razao.md`](livro-razao.md) dizendo **onde a lição foi codificada**. Correção que recorre significa que a guia não pegou: mude a abordagem, não re-anote.
