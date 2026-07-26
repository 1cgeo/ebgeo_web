-- Path: src/database/migrations/009_ng_tipo_peso_palavra.sql
-- `tipo_peso` passa a casar PALAVRA (\m..\M) em vez de SUBSTRING.
--
-- O CASE da 004 usava `LIKE '%rio%'`, e substring não respeita fronteira de palavra:
-- cemite(rio), avia(rio), aterro sanita(rio), superior (graduação), veterina(rio),
-- reservato(rio), pátio rodovia(rio)/aeroportua(rio), ferrovia(rio) e artigos de
-- vestua(rio) casavam o ramo de HIDROGRAFIA, o terceiro maior peso da hierarquia.
-- Medido contra o acervo real de 2026-07-23 (81.964 topônimos, 388 tipos distintos):
-- 658 linhas classificadas como hidrografia sem ser. O caso mais visível aparecia no
-- top-5 de uma busca por "brasilia": `Granja Progresso de Brasília | Agro - Aviário`
-- com tipo_peso 0.85 — e note que `%rio%` vem ANTES de `%agro%` no CASE, então o
-- ramo errado ainda roubava o peso do ramo certo.
--
-- Junto vão as formas que o vocabulário REAL usa e que o LIKE nunca alcançou, porque
-- a 004 foi escrita contra nomes de tipo que este acervo não tem: `lagoa`, `açude`,
-- `lugarejo`, `núcleo`, `sanitário`, e as abreviações de classe (`Ens -`, `Sau -`,
-- `Seg -`, `Ind -`, `Comerc -`, `Rel -`, `San -`, `Saneam -`). Efeito medido: o piso
-- 0.1 cai de 20.508 para 15.125 linhas, e 6.247 linhas mudam de peso.
--
-- NÃO entra `com` como abreviação de comércio, ainda que o padrão `Xxx -` sugira.
-- `com` é preposição e o vocabulário está cheio de `(com fluxo)`: com ele, `Laguna
-- (com fluxo)` vira comércio. Foi medido durante a escrita desta migração — 50 linhas
-- — e é a razão de o ramo listar só `comercio|comerc`. Quem for acrescentar
-- abreviação aqui: rode contra o acervo antes, porque nada nesta função falha alto.
--
-- Forward-only: a 004 fica como está, esta a substitui por CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION ng.calcular_tipo_peso() RETURNS TRIGGER AS $$
DECLARE t TEXT := ng.f_unaccent(lower(COALESCE(NEW.tipo, '')));
BEGIN
  NEW.tipo_peso := CASE
    WHEN t ~ '\mcidades?\M'                                                THEN 1.0
    WHEN t ~ '\m(vilas?|povoados?|lugarejos?|nucleos?)\M'                  THEN 0.9
    WHEN t ~ '\m(rios?|lagos?|lagoas?|represas?|acudes?)\M'                THEN 0.85
    WHEN t ~ '\m(serras?|morros?|ilhas?|picos?|pontas?|praias?)\M'         THEN 0.8
    WHEN t ~ '\mnome local\M'                                              THEN 0.75
    WHEN t ~ '\m(estradas?|rodovias?)\M'                                   THEN 0.7
    WHEN t ~ '\m(arroios?|canal|canais|cachoeiras?|corredeiras?|foz)\M'    THEN 0.6
    WHEN t ~ '\m(unidade de conservacao|terras? indigenas?)\M'             THEN 0.55
    WHEN t ~ '\magro\M'                                                    THEN 0.5
    WHEN t ~ '\m(pontes?|portos?|rodoviarias?|aeroportos?)\M'              THEN 0.4
    WHEN t ~ '\m(saude|sau|ensino|ens|seguranca|seg|administra\w*)\M'      THEN 0.35
    WHEN t ~ '\m(energia|eletrica|eolica|solar|subestacao|termeletrica|hidreletrica)\M' THEN 0.3
    WHEN t ~ '\m(comercio|comerc|industria|ind|lazer)\M'                   THEN 0.25
    WHEN t ~ '\m(saneamento|saneam|sanitario|san|comunicacao|comunic|dutos?)\M' THEN 0.2
    WHEN t ~ '\m(religios\w*|rel|cemiterios?)\M'                           THEN 0.15
    ELSE 0.1
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Trocar a função NÃO reclassifica quem já está gravado: `tipo_peso` é coluna, não
-- expressão. `refresh_busca()` re-dispara o trigger (`UPDATE tipo = tipo`) E recomputa
-- os clusters, que é o outro campo sem trigger nenhum. Sem este bloco a migração
-- aplicaria verde e a busca continuaria ranqueando cemitério como rio.
--
-- `PERFORM` dentro de um DO, e não `SELECT ng.refresh_busca()` solto: o runner executa
-- o arquivo inteiro por `t.none()` (`src/database/migrate.js:77`), que LANÇA se vier
-- qualquer linha de volta. Uma migração que devolve resultado aborta a transação e não
-- é registrada em `_migrations` — falha alto, mas com uma mensagem
-- ("No return data was expected") que não aponta para o SQL culpado.
DO $$ BEGIN PERFORM ng.refresh_busca(); END $$;
