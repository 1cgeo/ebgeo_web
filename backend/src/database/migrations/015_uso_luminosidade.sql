-- O PAINEL DE LUMINOSIDADE (dados solares e lunares do PITCIC) conta as aberturas no uso do
-- produto, e o evento `luminosidade.aberta` entra no vocabulário (pedido do dono, 2026-09-23).
--
-- Migração incremental: as bases estão congeladas desde 2026-09-22. O CHECK de evento é
-- espelho de `backend/src/modules/uso/eventos-de-uso.js` e de
-- `frontend/src/js/session/eventos-de-uso.js`; valor novo entra nos três no mesmo commit, NO
-- FIM da lista. O CHECK só ALARGA: todo evento aceito antes continua aceito, e nenhuma linha
-- existente é tocada.
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
    'luminosidade.aberta'
));
