// Path: js/session/presenca.js
import { generateUUID, isValidUUID } from '@utils/uuid.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient } from '@store/sync/api-client.js';

let lerPendencias = null;
export function configurarPendenciasDePresenca(ler) { lerPendencias = ler; }

export function instalarPresenca({ alvo = globalThis, falhas = () => 0 } = {}) {
    let id = generateUUID();
    try {
        const chave = 'ebgeo:telemetria:navegador';
        const salvo = alvo.localStorage?.getItem(chave);
        if (isValidUUID(salvo)) id = salvo;
        else alvo.localStorage?.setItem(chave, id);
    } catch { /* Storage unavailable: presence is per page. */ }
    let ocupado = false;
    let vivo = true;
    let prazo = null;
    let falhasLocais = 0;
    let repetir = false;
    let controller = null;
    const pulsar = async () => {
        if (!vivo || alvo.document?.visibilityState === 'hidden') return;
        if (ocupado) { repetir = true; return; }
        ocupado = true;
        try {
            const pendencias = lerPendencias ? await Promise.race([
                Promise.resolve().then(() => lerPendencias()).catch(() => { falhasLocais++; return {}; }),
                new Promise(resolve => { prazo = alvo.setTimeout(() => resolve({}), 3000); }),
            ]) : {};
            alvo.clearTimeout?.(prazo);
            prazo = null;
            const auth = await apiClient.authHeader();
            if (!vivo || alvo.document?.visibilityState === 'hidden') return;
            controller = new AbortController();
            prazo = alvo.setTimeout(() => controller?.abort(), 10000);
            await alvo.fetch(`${resolveBackendBaseUrl()}/uso/presenca`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ navegadorId: id, ...pendencias, falhasColeta: falhas() + falhasLocais }),
                signal: controller.signal,
            });
        } catch { /* A missing pulse expires on the server. */ } finally {
            alvo.clearTimeout?.(prazo); prazo = null; ocupado = false;
            controller = null;
            if (repetir && vivo) { repetir = false; pulsar(); }
        }
    };
    const timer = alvo.setInterval?.(pulsar, 30000);
    alvo.document?.addEventListener('visibilitychange', pulsar);
    pulsar();
    return { pulsar, desinstalar() {
        vivo = false;
        controller?.abort();
        alvo.clearTimeout?.(prazo);
        alvo.clearInterval?.(timer);
        alvo.document?.removeEventListener('visibilitychange', pulsar);
    } };
}
