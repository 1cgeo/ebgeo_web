-- AS QUATRO CAMADAS DE EXEMPLO DO CATÁLOGO SAEM DA INSTALAÇÃO (decisão do dono de 2026-09-26).
--
-- A base do catálogo semeava duas camadas de análise (declividade e hipsometria) e duas de dados
-- (rodovias-federais e limites-municipais) com endereço http://localhost/tiles/..., marcado ali
-- mesmo como exemplo a trocar. Fora de uma máquina de desenvolvimento elas nunca carregam, e sob
-- https viram conteúdo misto. A base está congelada, então a saída é esta migração, e a forma é a
-- do próprio catálogo: `active = false`, o que a exclusão pela tela faz. O administrador cadastra
-- as camadas reais depois do deploy.
--
-- SÓ ONDE A URL AINDA É O EXEMPLO: uma instalação em que o administrador já trocou a URL pela real
-- não é tocada.
--
-- Os testes e a máquina de desenvolvimento continuam com as quatro, semeadas por
-- `src/database/catalogo-de-exemplo.js` (chamado pelos harnesses de teste e pelo `db:seed`).

UPDATE analysis_layers
   SET active = false, updated_at = NOW()
 WHERE id IN ('declividade', 'hipsometria')
   AND active
   AND config->'source'->>'url' LIKE 'http://localhost/%';

UPDATE data_layers
   SET active = false, updated_at = NOW()
 WHERE id IN ('rodovias-federais', 'limites-municipais')
   AND active
   AND config->'source'->>'url' LIKE 'http://localhost/%';
