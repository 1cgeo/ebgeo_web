# Catálogo 3D (nota histórica: o segundo catálogo saiu)

**Esta página descreve algo que não existe mais.** Ela fica porque a pergunta que a criou continua sendo feita ("existem dois catálogos de modelo 3D?") e porque uma dúzia de páginas apontam para cá; o que mudou é a resposta.

Até 2026-08-19 havia **dois** catálogos de modelo 3D no sistema, com modelos de permissão distintos:

- `public.tilesets`, servido em `GET /api/config` e resolvido pelo visualizador (`frontend/src/js/3d_models_viewer_tool/map_3d.js`), com o eixo de acesso de [[acesso-a-recurso-privado]];
- uma tabela de catálogo no schema `ng`, servida por uma rota `/nomes/catalogo3d`, com permissão por modelo (direta e por grupo) em duas tabelas próprias.

**O segundo saiu inteiro**: a tabela, as duas tabelas de permissão, a rota, o controller, o service, o schema Joi e o par de consultas que carregava o predicado de acesso. Sobra `public.tilesets`, e a descoberta de modelo 3D passa a ter uma fonte só. Detalhe em [[resources-catalogo]] e no achado 1 de [[modelo-de-dados]].

## Por que ele saiu em vez de ser unificado

Três medições, e as três apontam para o mesmo lado:

- **Zero consumidores.** Nenhuma referência a `catalogo3d` em `frontend/src/`. O visualizador sempre resolveu por `config.tilesets`.
- **O filtro de acesso era inalcançável.** As duas tabelas de permissão de modelo não tinham **nenhum escritor** em `backend/src`: as únicas escritas que já existiram foram fixtures de teste. Um recurso privado que ninguém consegue conceder é um recurso que ninguém vê, e um predicado que nada alimenta é um predicado que só custa manutenção.
- **O predicado estava duplicado verbatim** entre a consulta de listagem e a de contagem, com o comentário nomeando uma função SQL que nunca foi escrita. É a mesma classe de defeito que [[acesso-a-recurso-privado]] existe para não repetir, e que motivou o predicado daquele eixo a nascer como função.

**Os dois acervos não eram cópias um do outro**, e é isso que tornava a escolha real em vez de óbvia: a tabela do `ng` era populada pelo importador do gazetteer, a partir do backup externo, e `tilesets` pelo importador do config legado. Fontes diferentes, acervos diferentes. Por isso a saída não é só apagar: `dev/import-gazetteer.mjs` teve o ramo do catálogo 3D **repontado para `tilesets`**, convertendo a forma da linha na passagem (o `type` da origem vira o discriminador `config.type === 'glb'`, município e estado viram `local`, palavras-chave viram `keywords`). O acervo continua carregável, no catálogo que sobrevive.

## O que herda o assunto

- **Descoberta e metadados de modelo 3D:** [[resources-catalogo]] (a tabela `tilesets` e as três irmãs de catálogo).
- **Quem vê um modelo privado:** [[acesso-a-recurso-privado]]. Este eixo conhece credenciado, produtor, concessão com prazo e empréstimo por atlas, nada do que o eixo antigo conhecia.
- **Os bytes:** [[assets3d-distribuicao]]. Descoberta nunca foi distribuição; o binário sempre saiu por outra rota, e continua saindo.
- **A lista heterogênea:** `config.tilesets` carrega **dois tipos de linha** desde 2026-08-14, separados pelo discriminador `viewer` ([[primeira-pessoa-3d]]). Quem consome precisa particionar antes de usar, porque uma cena entregue ao visualizador Cesium é um id sem tileset atrás.

## O que ficou como buraco declarado

A taxonomia de tipo do catálogo que sobrevive é mais pobre que a do que saiu. O vocabulário antigo distinguia três formas (tileset 3D, modelo isolado e nuvem de pontos); `tilesets` distingue só duas, por `config.type === 'glb'` presente ou ausente. Na conversão do importador a **nuvem de pontos foi mapeada para tileset**, que é o carregador certo (o formato dela é parte do 3D Tiles) e não quebra nada — o que se perde é poder dizer na tela que aquele item é uma nuvem, e filtrar por isso. Declarar a taxonomia é trabalho próprio; inventá-la na conversão criaria um valor que nenhum leitor conhece.

E o log de acesso do gazetteer continua registrando só as **chaves** da query, nunca os valores (`backend/src/middleware/nomes-access-log.js`): num gazetteer militar o termo buscado e as coordenadas clicadas são o dado sensível, e logs operacionais podem seguir para agregadores. Auditoria em nível de valor é [[auditoria]], não o logger.
