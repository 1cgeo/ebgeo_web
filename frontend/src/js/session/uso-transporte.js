// Path: js/session/uso-transporte.js
import { generateUUID } from '@utils/uuid.js';
import { apiClient } from '@store/sync/api-client.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';

const PREFIXO = 'ebgeo:telemetria:lote:';
const VALIDADE_MS = 86400000;

// Each batch owns a key, so two tabs cannot overwrite each other's queue.
export function criarTransporteDeUso({ alvo = globalThis, identidade = () => null } = {}) {
    const emVoo = new Set();
    let falhas = 0;
    const storage = () => { try { return alvo.localStorage; } catch { return null; } };
    const apagar = key => { try { storage()?.removeItem(key); } catch { /* best effort */ } };
    const valido = item => item && typeof item === 'object' && item.corpo && Number.isFinite(item.expira)
        && item.url === `${resolveBackendBaseUrl()}/uso/eventos`
        && item.expira >= Date.now() && (item.identidade === null || item.identidade === identidade());
    const enviarItem = async (item, key) => {
        if (emVoo.has(key)) return;
        if (!item || typeof item !== 'object' || !item.corpo || !Number.isFinite(item.expira)
            || item.url !== `${resolveBackendBaseUrl()}/uso/eventos`) {
            apagar(key); falhas++; return;
        }
        if (item.expira < Date.now() || (item.identidade !== null && item.identidade !== identidade())) {
            apagar(key);
            falhas++;
            return;
        }
        emVoo.add(key);
        try {
            const auth = await apiClient.authHeader();
            if (item.identidade !== null && item.identidade !== identidade()) { apagar(key); falhas++; return; }
            const response = await alvo.fetch(item.url, {
                method: 'POST', credentials: 'same-origin', keepalive: true,
                headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify(item.corpo),
                signal: AbortSignal.timeout(10000),
            });
            if (response.ok) {apagar(key);} else {
                falhas++;
                if ([400, 401, 403, 409, 422].includes(response.status)) apagar(key);
            }
        } catch { falhas++; } finally { emVoo.delete(key); }
    };
    const coletar = () => {
        const pendentes = [];
        try {
            const s = storage();
            // Snapshot keys before deleting: localStorage indexes shift on removal.
            const keys = Array.from({ length: s?.length ?? 0 }, (_, i) => s.key(i));
            for (const key of keys) {
                if (!key?.startsWith(PREFIXO)) continue;
                try {
                    const item = JSON.parse(s.getItem(key));
                    if (valido(item)) {pendentes.push([item, key]);} else { apagar(key); falhas++; }
                } catch { apagar(key); falhas++; }
            }
        } catch { falhas++; }
        pendentes.reverse().sort((a, b) => b[0].expira - a[0].expira);
        for (const [, key] of pendentes.slice(30)) { apagar(key); falhas++; }
        return pendentes.slice(0, 30);
    };
    const retomar = () => { for (const [item, key] of coletar()) enviarItem(item, key); };
    return {
        retomar,
        falhas: () => falhas,
        enviar(corpo, url) {
            const loteId = generateUUID();
            const item = { corpo: { ...corpo, loteId, identidade: identidade() }, url,
                identidade: identidade(), expira: Date.now() + VALIDADE_MS };
            const key = PREFIXO + loteId;
            try { storage()?.setItem(key, JSON.stringify(item)); } catch { falhas++; }
            coletar();
            enviarItem(item, key);
            return true;
        },
    };
}
