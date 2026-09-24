// Path: tests/unit/avisos-do-servidor-duas-portas.test.js

/**
 * @fileoverview As duas portas do envio de um atlas local ao servidor ("Enviar ao servidor" em
 * `atlas.html` e "Salvar no servidor" no menu da conta do mapa) dizem a MESMA perda relatada pelo
 * servidor. A do mapa jogava fora `summary.prunedResourceRefs` até 2026-09-23 e anunciava sucesso
 * sobre um atlas sem os itens 3D e 360; o caso de navegador que prende a fiação é o de poda em
 * `tests/e2e-ui/browser-save-local-to-server.spec.js`.
 */

import { describe, it, expect } from 'vitest';
import { avisosDoServidor } from '@js/projects/server-send-phrases.js';
import { sendFailureNotice, sendToServerNotice, NoticeKind } from '@js/projects/local-atlas-notices.js';

describe('avisosDoServidor', () => {
    it('nomeia a poda de item 3D e 360 com o motivo', () => {
        const avisos = avisosDoServidor({
            summary: { prunedResourceRefs: { 'cesium3d.cameraPositions': 1, 'sv360.markers': 2 } },
            sent: { maps: 1, features: 1 },
        });
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toContain('descartou 1 posição de câmera 3D e 2 marcadores 360');
        expect(avisos[0]).toContain('não está no catálogo');
    });

    it('nomeia a contagem que o servidor gravou a menos', () => {
        const avisos = avisosDoServidor({
            summary: { mapsImported: 13, featuresImported: 805 },
            sent: { maps: 14, features: 805 },
        });
        expect(avisos).toEqual(['O servidor gravou só 13 mapas dos 14 que subiram.']);
    });

    it('fica vazio quando o servidor gravou tudo, e quando não disse nada', () => {
        expect(avisosDoServidor({ summary: { mapsImported: 1, featuresImported: 3, prunedResourceRefs: {} },
            sent: { maps: 1, features: 3 } })).toEqual([]);
        expect(avisosDoServidor({ summary: null, sent: { maps: 1, features: 3 } })).toEqual([]);
        expect(avisosDoServidor(undefined)).toEqual([]);
    });

    it('é a mesma frase que a porta de atlas.html já dizia (controle de paridade)', () => {
        const result = {
            atlasId: 'a1', name: 'X', stats: {}, imageStats: {},
            sent: { maps: 1, features: 1 }, local: { maps: 1, features: 1 },
            summary: { prunedResourceRefs: { 'cesium3d.markers': 3 } },
        };
        const notice = sendToServerNotice(result);
        expect(notice.kind).toBe(NoticeKind.WARNING);
        for (const frase of avisosDoServidor(result)) expect(notice.message).toContain(frase);
    });
});

describe('o envio grande demais (413) não manda tentar de novo', () => {
    const MB = 1024 * 1024;
    const erro413 = () => Object.assign(new Error('Não foi possível concluir ou confirmar a importação.'), {
        stage: 'preparation', status: 413, tamanhoDoEnvio: 57.2 * MB,
    });

    it('diz que o atlas é grande demais, com o tamanho, e o que fazer', () => {
        const n = sendFailureNotice(erro413(), { name: 'Acervo com fotos' });
        expect(n.kind).toBe(NoticeKind.ERROR);
        expect(n.message).toContain('grande demais');
        expect(n.message).toContain('58 MB');
        expect(n.message).toMatch(/fotos anexas/i);
        expect(n.message).toContain('continua neste navegador');
    });

    it('não promete que repetir resolve: um 413 se repete a cada tentativa', () => {
        expect(sendFailureNotice(erro413(), { name: 'X' }).message).not.toMatch(/tente de novo|tente novamente/i);
    });

    it('sem o tamanho medido a frase continua dizendo o que fazer', () => {
        const e = erro413();
        delete e.tamanhoDoEnvio;
        const n = sendFailureNotice(e, { name: 'X' });
        expect(n.message).toContain('grande demais');
        expect(n.message).not.toContain('MB');
    });
});
