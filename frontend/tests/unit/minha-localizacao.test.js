// Path: tests/unit/minha-localizacao.test.js

/**
 * "Ir para minha localização" (barra inferior direita, pedido do dono em 2026-09-24): quando o
 * navegador pode dar a posição, e o que cada falha diz à pessoa (`bottom-controls/my-location-phrases.js`).
 *
 * O comando é SEMPRE desenhado. Sem conexão segura ou sem a API de localização, o clique recusa
 * nomeando o estado, que é reversível; por isso a frase diz o que fazer, e não só o que falhou.
 */

import { describe, it, expect } from 'vitest';
import {
    myLocationUnavailableNotice, myLocationErrorNotice, MY_LOCATION_OPTIONS, MY_LOCATION_MIN_ZOOM,
} from '@js/bottom-controls/my-location-phrases.js';

const geolocationOk = { getCurrentPosition() {} };

describe('ir para minha localização', () => {
    it('conexão segura com a API: pode pedir a posição', () => {
        expect(myLocationUnavailableNotice({ isSecureContext: true, geolocation: geolocationOk })).toBeNull();
    });

    it('sem conexão segura (http fora de localhost): recusa e manda abrir por https', () => {
        const aviso = myLocationUnavailableNotice({ isSecureContext: false, geolocation: geolocationOk });
        expect(aviso).toMatch(/conexão segura/);
        expect(aviso).toMatch(/https/);
    });

    it('sem a API de localização: recusa e sugere outro navegador', () => {
        expect(myLocationUnavailableNotice({ isSecureContext: true })).toMatch(/não informa a localização/);
        expect(myLocationUnavailableNotice({ isSecureContext: true, geolocation: {} })).toMatch(/outro navegador/);
    });

    it('ambiente ausente conta como sem conexão segura, sem lançar', () => {
        expect(myLocationUnavailableNotice(undefined)).toMatch(/conexão segura/);
    });

    it.each([
        [1, /bloqueada para este site/],
        [2, /Não foi possível obter/],
        [3, /demorou demais/],
    ])('erro de código %i tem a frase dele', (code, frase) => {
        expect(myLocationErrorNotice({ code })).toMatch(frase);
    });

    it('erro desconhecido, ou nenhum, cai na frase de posição indisponível', () => {
        expect(myLocationErrorNotice({ code: 99 })).toMatch(/Não foi possível obter/);
        expect(myLocationErrorNotice(null)).toMatch(/Não foi possível obter/);
    });

    it('toda frase diz o que fazer, e nenhuma carrega código ou jargão', () => {
        const frases = [
            myLocationUnavailableNotice({ isSecureContext: false }),
            myLocationUnavailableNotice({ isSecureContext: true }),
            myLocationErrorNotice({ code: 1 }), myLocationErrorNotice({ code: 2 }), myLocationErrorNotice({ code: 3 }),
        ];
        for (const f of frases) {
            expect(f).toMatch(/(tente de novo|Tente de novo|Abra|Use outro|Libere)/);
            expect(f).not.toMatch(/\b\d{3}\b|PERMISSION|TIMEOUT|geolocation/i);
        }
    });

    it('as opções pedem precisão com teto de espera, e o zoom mínimo é o de reconhecer o lugar', () => {
        expect(MY_LOCATION_OPTIONS).toMatchObject({ enableHighAccuracy: true, timeout: 15000 });
        expect(MY_LOCATION_MIN_ZOOM).toBe(15);
    });
});
