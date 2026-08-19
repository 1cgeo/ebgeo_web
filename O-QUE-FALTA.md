# O que falta no branch `permissoes-recursos`

Documento de passagem, escrito em 2026-08-19 para o próximo agente. Cobre **três frentes
abertas**, e para cada uma diz o que já existe, o que falta, onde o código está, e a
armadilha que morde quem não ler.

Contexto mínimo: este branch construiu um sistema de permissão para os cinco tipos de
recurso do catálogo (basemap, camada de dados, camada de análise, modelo 3D e panorama
360), com marca público/privado, concessão em árvore com prazo de um ano, empréstimo por
atlas e quatro papéis globais que **não são uma escada**. O eixo está em
[`docs/wiki/acesso-a-recurso-privado.md`](docs/wiki/acesso-a-recurso-privado.md) e o
modelo de dados inteiro em [`docs/wiki/modelo-de-dados.md`](docs/wiki/modelo-de-dados.md).
Leia os dois antes de tocar em qualquer frente.

---

## 1. Grupo de acesso: existe no banco, não existe no produto

**Prioridade: alta.** É a única frente onde o schema promete algo que o produto não
entrega, e essa é exatamente a classe de defeito que este branch passou a semana
removendo: `ng.groups` tinha permissão por grupo funcionando e nenhuma forma de pôr
alguém no grupo, então aquele ramo do predicado nunca devolveu uma linha em produção.

### O que já existe

- `access_groups` (`id`, `name`, `description`, `created_by`, `created_at`,
  `deleted_at`) e `access_group_members` (`group_id`, `user_id`, `added_by`, `added_at`),
  em `public`, com FK para `users` e cascata. Migração `008_acesso_a_recurso.sql`.
- Índice único parcial de nome entre os vivos (`uq_access_groups_nome_vivo`).
- `resource_grants.grantee_group_id`, com `CHECK (num_nonnulls(grantee_id,
  grantee_group_id) = 1)`: pessoa e grupo são **alternativos**, nunca simultâneos.
- `fn_user_group_ids` e o ramo de grupo dentro de `fn_granted_resource_ids`, nos **dois**
  sítios: o braço direto e o do dono do atlas que sustenta o empréstimo.

### O que falta

Toda a superfície. Uma varredura por `grantee_group_id` em `backend/src/` fora de
`migrations/` devolve **zero**: hoje a coluna só se preenche por SQL direto.

1. **CRUD de grupo.** Módulo novo em `backend/src/modules/`, no padrão da casa
   (`.routes.js` / `.controller.js` / `.service.js` / `.queries.js` / `.schemas.js` /
   `index.js`): listar, criar, renomear, apagar (soft) e gerir membros.
2. **Conceder a grupo.** A rota de criar concessão hoje só aceita o beneficiário
   pessoa. Precisa aceitar o grupo como alternativa, e o Joi tem de recusar os dois
   juntos **espelhando o CHECK do banco**; sem isso o erro chega como `23514` genérico
   em vez de um 400 legível.
3. **A tela.** O Painel do Administrador tem as abas de catálogo, configuração, pessoal
   e usuários; falta a de grupos. E o modal de compartilhar recurso
   (`frontend/src/js/catalog/resource-share.modal.js`) só busca usuário.

### Armadilhas

- **Quem administra o grupo e quem concede a ele são perguntas diferentes.** Conceder
  já passa por `requireResourceShare` (papel global, produção, ou concessão viva com
  `view_share`). Administrar o grupo é outra coisa; `requireAdmin` é a escolha óbvia,
  mas é decisão do dono e **não está tomada**.
- **Apagar o grupo já revoga o que ele concedia**, porque `fn_user_group_ids` exige
  `deleted_at IS NULL`. Não escreva código que pode as concessões ao apagar: isso
  destruiria a resposta de auditoria, pela mesma razão que a revogação é soft.
- **`public.groups` já existe e é outra coisa** (grupos de feição dentro de um mapa).
  Nomear qualquer coisa nova de "group" sem qualificar recria a armadilha de
  `streetview_markers`, onde uma tabela morta e um módulo vivo dividiam o nome.
- **Auditoria é obrigatória** e há censo que reprova rota de escrita sem trilha. Ação
  nova entra no `CHECK` de `audit_trail` por migração, e o alvo precisa caber no
  vocabulário de `target_type`.

---

## 2. Taxonomia 3D declarada

**Prioridade: média.** Não há defeito hoje; há uma variante que o produto não sabe
nomear.

### O estado

O visualizador distingue as formas por **dois discriminadores improvisados dentro do
`config`**, sem enumeração e sem constraint:

- `type === 'glb'` decide entre carregar como modelo e carregar como tileset
  (`frontend/src/js/3d_models_viewer_tool/map_3d.js`);
- `viewer !== 'firstPerson'` **exclui** a cena indoor da lista de modelos 3D
  (`frontend/src/js/catalog/catalog.service.js`).

A taxonomia real tem quatro formas: **Tiles 3D**, **modelo isolado** (glb), **nuvem de
pontos** e **indoor** (que não usa o Cesium). A nuvem de pontos hoje cai no ramo do
tileset, que é o carregador **certo** (o formato dela é parte do 3D Tiles), mas ela não
tem rótulo, ícone nem filtro. Está declarado como buraco conhecido em
[`docs/wiki/resources-catalogo.md`](docs/wiki/resources-catalogo.md).

### O que fazer

Um eixo declarado com quatro valores (`tiles3d`, `glb`, `pointcloud`, `indoor`), no
`config` do tileset e validado pelo Joi da escrita de catálogo. O visualizador ramifica
pelo valor declarado; o catálogo ganha rótulo e ícone por variante; o formulário do
admin oferece os quatro.

**No `config` e não em coluna nova**, e o motivo é medido: as tabelas de catálogo são
obrigadas a ter colunas idênticas por `catalog-tabelas-paridade`, então uma coluna útil
só a `tilesets` custaria a mesma coluna morta em outras três.

### Armadilhas

- **A taxonomia é expressa hoje por EXCLUSÃO.** É a mesma lista fechada que a
  constituição proíbe no eixo de papel, e quebra do mesmo jeito: uma quinta variante
  acrescentada amanhã cai no ramo do tileset sem rótulo e ninguém percebe, porque "não é
  glb e não é firstPerson" continua verdadeiro.
- **O retro-preenchimento é honesto menos num ponto.** `glb` e `indoor` se derivam do que
  está gravado; o resto vira `tiles3d`. **Nuvem de pontos não é inferível**: no banco ela
  é indistinguível de um tileset comum, então essas linhas precisam ser marcadas à mão.
  Não deixe a migração adivinhar.
- Confirme com o dono se o acervo tem `.pts` **cru**. Se tiver, não é suporte no
  visualizador, é conversão na ingestão.

---

## 3. `ACESSO-SUPERFICIES-E-ROTAS-PUBLICAS.md`: resgatar e apagar

**Prioridade: baixa, é dívida de higiene.** O arquivo está na raiz e nada aponta para
ele.

Ele guarda **uma** coisa que não existe em outro lugar: a comparação das quatro saídas
para proteger os bytes do 3D, com o custo de cada uma. A decisão foi tomada (o regime de
cache segue o recurso, com índice em memória), então as **alternativas recusadas**
pertencem a `docs/decisions/decisions-2026.md`, que é onde a casa as guarda.

O resto já está preservado em melhor forma: o censo de superfícies virou teste
estrutural, e codificado vale mais que em prosa. A seção de pendências dele está
**desatualizada**, porque lista como aberto o regime dos bytes (resolvido) e a
convergência dos dois catálogos 3D (resolvida, o segundo saiu).

Então: mover as alternativas recusadas para o registro de decisões, conferir que
`docs/wiki/acesso-a-recurso-privado.md` cobre o resto, e apagar o arquivo.

---

## Como trabalhar aqui

`npm run lint` e `npm test` na **raiz**, em comandos separados, **depois** da última
escrita. O `npm test` exige PostgreSQL com PostGIS e superusuário.

**Confira a contagem de skips, e confirme o código de saída do `npm`.** As duas coisas
falharam nesta sessão: um `before` quebrado transformou quatro casos em *skip* e a linha
de resumo parecia verde, e o marcador de saída do harness reportou sucesso numa rodada
que tinha falhado. Ecoe o `$?` do próprio `npm`.

No laço apertado use `npm run test:fast --prefix backend -- <um arquivo>` (cerca de
1,5 s), **um alvo por comando**: o runner usa só o primeiro padrão que recebe e reporta
verde pelos dois. E não deixe a suíte completa rodando junto, porque as duas disputam o
mesmo banco de teste.

Vermelho em banco reaproveitado se confirma sem a bandeira antes de virar diagnóstico:
dado de rodada anterior também reprova.

**Existem cinco censos estruturais** (papel global, auditoria, superfícies de recurso nos
dois pacotes, saídas de conteúdo e campos livres). Todos reprovam entrada nova não
classificada e todos têm piso de contagem. Piso que baixa precisa da remoção escrita ao
lado, senão vira o número que alguém abaixa quando incomoda.

E a regra tipográfica tem guarda: crase promete código que **existe**. O que virou
passado se escreve em prosa, sem crase. `docs-integridade` cobra caminho, wikilink e
símbolo, e desde 2026-08-19 ele enxerga também os nomes `fn_*`.
