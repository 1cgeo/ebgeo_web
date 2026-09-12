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
    const retomar = () => {
        const pendentes = [];
        try {
            const s = storage();
            for (let i = 0; i < (s?.length ?? 0); i++) {
                const key = s.key(i);
                if (!key?.startsWith(PREFIXO)) continue;
                try { pendentes.push([JSON.parse(s.getItem(key)), key]); } catch { apagar(key); falhas++; }
            }
        } catch { falhas++; }
        for (const [item, key] of pendentes.slice(0, 30)) enviarItem(item, key);
        for (const [, key] of pendentes.slice(30)) { apagar(key); falhas++; }
    };
    return {
        retomar,
        falhas: () => falhas,
        enviar(corpo, url) {
            const loteId = generateUUID();
            const item = { corpo: { ...corpo, loteId, identidade: identidade() }, url,
                identidade: identidade(), expira: Date.now() + VALIDADE_MS };
            const key = PREFIXO + loteId;
            try { storage()?.setItem(key, JSON.stringify(item)); } catch { falhas++; }
            enviarItem(item, key);
            return true;
        },
    };
}
