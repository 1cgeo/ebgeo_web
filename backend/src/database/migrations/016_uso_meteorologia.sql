-- O PAINEL DE METEOROLOGIA (as linhas de previsão da matriz das condições meteorológicas do
-- PITCIC) conta as aberturas no uso do produto, e o evento `meteorologia.aberta` entra no
-- vocabulário (dono, 2026-09-23).
--
-- Migração incremental, no molde de `015_uso_luminosidade.sql`. O CHECK é REDECLARADO INTEIRO,
-- e a armadilha é essa: um CHECK escrito sem o evento da luminosidade faria o banco recusar a
-- telemetria daquele painel. O teste de catálogo lê o CHECK da última migração que o redeclara,
-- então ele acusa a omissão. O CHECK só ALARGA: todo evento aceito antes continua aceito, e
-- nenhuma linha existente é tocada.
ALTER TABLE uso_eventos_dia DROP CONSTRAINT IF EXISTS uso_eventos_dia_evento_check;
ALTER TABLE uso_eventos_dia ADD CONSTRAINT uso_eventos_dia_evento_check CHECK (evento IN (
    'pagina.vista',
    'atlas.aberto',
    'ferramenta.ativada',
    'medicao.aberta',
    'visualizador3d.aberto',
    'visualizador360.aberto',
    'primeira-pessoa.aberto',
    'briefing.apresentado',
    'temporal.ativado',
    'pdf.exportado',
    'ebgeo.exportado',
    'ebgeo.importado',
    'indisponivel.visto',
    'migracao.resultado', 'sync.resultado', 'logout.descarte',
    'preferencia.base', 'preferencia.camada', 'recurso.aberto',
    'luminosidade.aberta',
    'meteorologia.aberta'
));
