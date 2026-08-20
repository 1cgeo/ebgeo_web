-- Path: src/database/migrations/010_forma_3d.sql
-- A FORMA DO 3D VIRA CAMPO DECLARADO, e as linhas existentes recebem o valor derivado.
--
-- O QUE ESTA MIGRACAO CONSERTA. `tilesets` distinguia as formas de 3D por EXCLUSAO, em dois
-- discriminadores improvisados dentro do `config` JSONB e sem enumeracao nenhuma:
-- `config.type = 'glb'` escolhia entre carregar como modelo isolado e carregar como tileset, e
-- `config.viewer <> 'firstPerson'` tirava a cena indoor da lista de modelos 3D. A taxonomia real
-- tem QUATRO formas -- tiles3d, glb, pointcloud, indoor -- e duas delas nao tinham nome: a nuvem
-- de pontos caia no ramo do tileset (que e o carregador CERTO, porque o formato dela e parte do
-- 3D Tiles) e aparecia na tela como um modelo qualquer. Pior que a nuvem sem rotulo e a
-- propriedade da forma por exclusao: uma quinta variante acrescentada amanha continuaria
-- satisfazendo "nao e glb e nao e firstPerson" e cairia no mesmo ramo, calada.
--
-- POR QUE `config` E NAO UMA COLUNA NOVA. As quatro tabelas de catalogo sao obrigadas a ter
-- colunas identicas (`tests/integration/catalog-tabelas-paridade.test.js`), porque o servico roda
-- a mesma lista de colunas e os mesmos INSERT/UPDATE contra as quatro. Uma coluna util so a
-- `tilesets` custaria a mesma coluna MORTA em `basemaps`, `data_layers` e `analysis_layers`.
--
-- O RETRO-PREENCHIMENTO NAO ADIVINHA NUVEM DE PONTOS, E A AUSENCIA E DECISAO, NAO ESQUECIMENTO.
-- Decidido pelo dono em 2026-08-19. `glb` e `indoor` se derivam do que esta GRAVADO, e todo o
-- resto vira `tiles3d`. No banco uma nuvem de pontos e literalmente indistinguivel de um tileset
-- comum: mesma coluna, mesmo shape de `config`, mesma `url` para um `tileset.json`. Qualquer
-- heuristica aqui (farejar o caminho do arquivo, o nome do item) inventaria uma classificacao que
-- ninguem pediu e que so seria descoberta errada na tela. Marcar uma nuvem e trabalho MANUAL, uma
-- a uma, pelo `<select>` "Forma do modelo 3D" da aba Catalogo do painel de administracao.
--
-- PENDENCIA NOMEADA, QUE ESTA MIGRACAO NAO FAZ: o acervo tem arquivo CRU de nuvem (`.pts`,
-- `.las`, `.laz`). Isso nao e suporte no visualizador, e CONVERSAO NA INGESTAO, e e trabalho
-- proprio -- nem o Cesium nem este campo leem esses formatos. A pendencia esta registrada com o
-- porque em `frontend/tests/unit/forma-3d-censo.test.js` (secao PENDENCIAS), que reprova se
-- alguem apagar a nota sem entregar a conversao.
--
-- SEM DDL: e um UPDATE de JSONB, que nao e destrutivo e por isso nao entra em
-- `EXCECOES_DESTRUTIVAS` (`tests/unit/migrations-higiene.test.js`). E ele nao devolve linha
-- nenhuma, que e o que o `t.none()` do runner exige.

UPDATE tilesets
   SET config = jsonb_set(
         config,
         '{forma3d}',
         to_jsonb(
           CASE
             -- Os dois discriminadores legados, na ordem em que o cliente os le
             -- (`derivarForma3d`, em `frontend/src/js/catalog/forma-3d.js`): a cena indoor
             -- primeiro, porque ela nunca foi um tileset; o modelo isolado depois.
             WHEN config->>'viewer' = 'firstPerson' THEN 'indoor'
             WHEN config->>'type'   = 'glb'         THEN 'glb'
             -- O default historico. A nuvem de pontos mora AQUI, e sai daqui a mao.
             ELSE 'tiles3d'
           END
         ),
         true
       )
 -- `jsonb_typeof` porque `jsonb_set` levanta em valor escalar: a coluna e NOT NULL DEFAULT '{}',
 -- mas nada no schema impede que alguem tenha gravado um numero ou uma string ali.
 WHERE jsonb_typeof(config) = 'object'
 -- `->>` devolve NULL tanto para a chave AUSENTE quanto para o JSON `null`, e os dois casos
 -- precisam do preenchimento. Sem esta clausula a migracao sobrescreveria uma forma ja declarada
 -- pela derivacao legada, que e mais pobre.
   AND config->>'forma3d' IS NULL;
