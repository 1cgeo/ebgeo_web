// Path: js/session/pendencias-monitoramento.js
import { readLocalAtlasRegistry, getStoreFor, remoteScope, StoreName } from '@store/atlas-namespace.js';
import { listRemoteAtlases } from '@store/remote-atlas.api.js';
import { operationBelongsToScope } from '@store/sync/operation-queue.js';
import { configurarPendenciasDePresenca } from '@js/session/presenca.js';

// Only enabled after migration protection. Never mount, mutate, or delete atlas data.
export function instalarMonitoramentoDePendencias() {
    let ultima = 0;
    let resultado = {};
    configurarPendenciasDePresenca(async () => {
        if (Date.now() - ultima < 60000) return resultado;
        ultima = Date.now();
        resultado = {};
        try {
            const locais = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
            const remotos = (await listRemoteAtlases()).filter(e => !locais.has(e.dbSuffix) && !e.discardRequested);
            let pendentes = 0;
            let primeiro = Date.now();
            for (const atlas of remotos) {
                const scope = remoteScope(atlas.atlasId);
                const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
                const keys = (await store.keys()).filter(k => typeof k === 'string' && k.startsWith('op_'));
                if (keys.length > 100000) return resultado;
                for (let i = 0; i < keys.length; i += 100) {
                    const lote = await Promise.all(keys.slice(i, i + 100).map(k => store.getItem(k)));
                    for (const op of lote) {
                        if (!op || !operationBelongsToScope(op, scope.dbSuffix)) continue;
                        pendentes++;
                        if (Number.isFinite(op.timestamp)) primeiro = Math.min(primeiro, op.timestamp);
                    }
                }
            }
            resultado = { pendentes, idadePendenteMs: pendentes ? Math.min(31536000000, Math.max(0, Date.now() - primeiro)) : 0 };
        } catch { /* Unknown is deliberately not zero. */ }
        return resultado;
    });
}
