// Path: tests/unit/ambiente-frases.test.js

/**
 * @fileoverview What the two admin tabs say about the browser environment.
 *
 * NEGATIVE CONTROLS (checked by reverting):
 *   1. **"Windows 10" from "NT 10.0".** Reading the UA version as Windows 10 turns the Windows
 *      case red: every Windows 11 says NT 10.0, and the label would be wrong for all of them.
 *   2. **The family row as the sum of its versions.** Summing the version rows (which are cut at
 *      twenty) turns the table case red where a family has a version off the list.
 *   3. **The fallback without saying it.** Dropping the note of an occurrence that predates the
 *      block turns the fallback case red: the tab would present a UA reading as a declaration.
 *   4. **"Since the first report".** Putting that promise back in the title of the "Navegadores"
 *      cell turns its case red: reports older than the field never declared a browser.
 */

import { describe, it, expect } from 'vitest';
import {
    COLUNAS_DE_AMBIENTE,
    ambienteAusenteNotice,
    ambienteCurtoLabel,
    ambienteUsoCorteNotice,
    ambienteUsoInformado,
    ambienteUsoPisoNotice,
    linhasDeNavegadores,
    linhasDeSistemas,
    linhasDoAmbiente,
    navegadorComVersaoLabel,
    navegadoresDasOcorrenciasNotice,
    navegadoresDoDefeitoLabel,
    sistemaLabel,
} from '@js/admin/ambiente-phrases.js';

const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
const UA_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/140.0.0.0 Safari/537.36';

describe('sistemaLabel — the operating system as a reading', () => {
    it('CONTROL 1: NT 10.0 is "Windows 10 ou 11", and the Client Hints decide', () => {
        const ua = sistemaLabel({ so: 'windows', soVersao: '10.0' });
        expect(ua.texto).toBe('Windows 10 ou 11');
        expect(ua.detalhe).toContain('Firefox nunca diz');
        expect(sistemaLabel({ so: 'windows', soVersao: '10.0', soVersaoCh: '15.0.0' }).texto).toBe('Windows 11');
        expect(sistemaLabel({ so: 'windows', soVersao: '10.0', soVersaoCh: '13.0.0' }).texto).toBe('Windows 11');
        expect(sistemaLabel({ so: 'windows', soVersao: '10.0', soVersaoCh: '10.0.0' }).texto).toBe('Windows 10');
        expect(sistemaLabel({ so: 'windows', soVersaoCh: '0.3.0' }).texto).toBe('Windows 7 ou 8');
        expect(sistemaLabel({ so: 'windows', soVersao: '6.1' }).texto).toBe('Windows 7');
        expect(sistemaLabel({ so: 'windows' }).texto).toBe('Windows');
    });

    it('macOS, Android, iOS and the rest', () => {
        expect(sistemaLabel({ so: 'macos', soVersao: '10.15.7' }).texto).toBe('macOS');
        expect(sistemaLabel({ so: 'macos', soVersao: '10.15.7' }).detalhe).toContain('congelada');
        expect(sistemaLabel({ so: 'macos', soVersaoCh: '14.5.0' }).texto).toBe('macOS 14.5');
        expect(sistemaLabel({ so: 'android', soVersao: '14' }).texto).toBe('Android 14');
        expect(sistemaLabel({ so: 'android', soVersao: '10', soVersaoCh: '15.0.0' }).texto).toBe('Android 15');
        expect(sistemaLabel({ so: 'ios', soVersao: '17.4' }).texto).toBe('iOS 17.4');
        expect(sistemaLabel({ so: 'linux' }).texto).toBe('Linux');
        expect(sistemaLabel({ so: 'outro' }).texto).toBe('Outro sistema');
        expect(sistemaLabel(null).texto).toBe('Sistema não declarado');
        expect(sistemaLabel({ so: 'toString' }).texto).toBe('Sistema não declarado');
    });

    it('navegadorComVersaoLabel: family and MAJOR version', () => {
        expect(navegadorComVersaoLabel('firefox', '143.0')).toBe('Firefox 143');
        expect(navegadorComVersaoLabel('chrome', 140)).toBe('Chrome 140');
        expect(navegadorComVersaoLabel('edge', null)).toBe('Edge');
        expect(navegadorComVersaoLabel(null, '1')).toBe('Navegador não declarado');
        expect(navegadorComVersaoLabel('constructor', null)).toBe('Navegador não declarado');
    });
});

describe('the occurrence: declared block first, the UA only as a fallback', () => {
    const DECLARADA = {
        userAgent: UA_FIREFOX,
        ambiente: {
            navegador: 'firefox', navegadorVersao: '143.0', so: 'windows', soVersao: '10.0',
            dispositivo: 'desktop', toque: 0, telaLargura: 1920, telaAltura: 1080, escala: 1.25,
            janelaLargura: 1536, janelaAltura: 730, idioma: 'pt-BR', fuso: 'America/Sao_Paulo',
            nucleos: 8, webgl: 'webgl2', gpu: 'NVIDIA GeForce GTX 980, or similar', texturaMax: 16384,
            armazenamentoUsoMb: 12, armazenamentoCotaMb: 2048, armazenamentoPersistente: false,
            online: true, cookies: true, contextoSeguro: false, indexedDB: true,
        },
    };

    it('the short label of the button', () => {
        expect(ambienteCurtoLabel(DECLARADA)).toBe('Firefox 143 · Windows 10 ou 11');
        expect(ambienteCurtoLabel({ userAgent: UA_CHROME })).toBe('Chrome 140 · Linux');
        expect(ambienteCurtoLabel({})).toBe('navegador não declarado');
    });

    it('the rows of a declared block, in reading order, with what the browser withholds said', () => {
        const linhas = linhasDoAmbiente(DECLARADA);
        expect(linhas.map((l) => l.rotulo)).toEqual([
            'Navegador', 'Sistema', 'Dispositivo', 'Tela', 'Janela do navegador', 'Idioma e fuso',
            'Processador', 'Memória', 'WebGL', 'Placa de vídeo', 'Armazenamento local', 'Navegador no instante',
        ]);
        const valor = (r) => linhas.find((l) => l.rotulo === r).valor;
        expect(valor('Navegador')).toBe('Firefox 143.0');
        expect(linhas[0].titulo).toBe(UA_FIREFOX);
        expect(valor('Dispositivo')).toBe('Computador, sem toque');
        expect(valor('Tela')).toBe('1920 × 1080, escala 1,25');
        expect(valor('Idioma e fuso')).toBe('pt-BR · America/Sao_Paulo');
        expect(valor('Processador')).toBe('8 núcleos lógicos');
        // Firefox never exposes memory: the row stays, and says why.
        expect(valor('Memória')).toBe('não informada');
        expect(linhas.find((l) => l.rotulo === 'Memória').detalhe).toContain('Chromium');
        expect(valor('WebGL')).toBe('WebGL 2, textura máxima 16384');
        expect(valor('Armazenamento local'))
            .toBe('12 MB usados de uma cota de cerca de 2 GB, o navegador pode apagar sob pressão de espaço');
        // The quota is a power of two on purpose, and the row says why instead of passing a round
        // number off as a measurement.
        expect(linhas.find((l) => l.rotulo === 'Armazenamento local').detalhe).toContain('arredondada');
        expect(valor('Navegador no instante')).toBe('conectado · cookies ativos · IndexedDB disponível · conexão sem HTTPS');
        expect(ambienteAusenteNotice(DECLARADA)).toBe('');
    });

    it('memory is capped at 8 by the browser, and a masked GPU is said', () => {
        const linhas = linhasDoAmbiente({ ambiente: { navegador: 'chrome', memoriaGb: 8, webgl: 'webgl' } });
        expect(linhas.find((l) => l.rotulo === 'Memória').valor).toBe('cerca de 8 GB');
        expect(linhas.find((l) => l.rotulo === 'Memória').detalhe).toContain('arredonda');
        const grande = linhasDoAmbiente({ ambiente: { navegador: 'chrome', memoriaGb: 32 } });
        expect(grande.find((l) => l.rotulo === 'Memória').valor).toBe('cerca de 32 GB');
        expect(linhas.find((l) => l.rotulo === 'Placa de vídeo').valor).toBe('não informada');
        const sem = linhasDoAmbiente({ ambiente: { navegador: 'firefox', webgl: 'nenhum' } });
        expect(sem.find((l) => l.rotulo === 'WebGL').valor).toContain('indisponível');
        expect(sem.some((l) => l.rotulo === 'Placa de vídeo')).toBe(false);
    });

    it('CONTROL 3: an occurrence from before the block is read from its UA, and says so', () => {
        const antiga = { userAgent: UA_FIREFOX };
        expect(ambienteAusenteNotice(antiga)).toContain('versão anterior do EBGeo');
        expect(linhasDoAmbiente(antiga).map((l) => l.rotulo)).toEqual(['Navegador', 'Sistema']);
        expect(ambienteAusenteNotice({ origem: 'servidor' })).toContain('do servidor');
        expect(ambienteAusenteNotice({})).toContain('não informou');
        expect(linhasDoAmbiente({})).toEqual([]);
    });

    it('the distribution of the stored occurrences, most frequent first', () => {
        const ocs = [
            { ambiente: { navegador: 'firefox', navegadorVersao: '143.0' } },
            { ambiente: { navegador: 'firefox', navegadorVersao: '143.0.1' } },
            { userAgent: UA_CHROME },
            { ambiente: { navegador: 'firefox', navegadorVersao: '128.0' } },
            { origem: 'servidor' },
        ];
        expect(navegadoresDasOcorrenciasNotice(ocs))
            .toBe('Nas 5 ocorrências guardadas: Firefox 143 (2), Chrome 140 (1), Firefox 128 (1).');
        expect(navegadoresDasOcorrenciasNotice([{ userAgent: UA_CHROME }]))
            .toBe('Na ocorrência guardada: Chrome 140 (1).');
        expect(navegadoresDasOcorrenciasNotice([{ origem: 'servidor' }])).toBe('');
        expect(navegadoresDasOcorrenciasNotice([])).toBe('');
        expect(navegadoresDasOcorrenciasNotice(null)).toBe('');
    });
});

describe('the "Navegadores" cell of a defect', () => {
    it('CONTROL 4: the set is of the reports that DECLARED a browser, and the title says so', () => {
        // A defect born before the field has reports that never said their browser; after one
        // new Firefox report the set reads "Firefox" over a thousand old Chrome ones. The cell
        // cannot tell, so the title must never promise "since the first report".
        const so = navegadoresDoDefeitoLabel({ navegadores: ['firefox'] });
        expect(so.texto).toBe('Firefox');
        expect(so.detalhe).toContain('relatos que informaram o navegador');
        expect(so.detalhe).toContain('Versões anteriores do EBGeo não informavam');
        expect(so.detalhe).not.toMatch(/primeiro relato/);
        expect(navegadoresDoDefeitoLabel({ navegadores: ['chrome', 'firefox'] }).texto).toBe('Chrome, Firefox');
    });

    it('a quota under a gigabyte stays in megabytes, and an absent half leaves the other', () => {
        const so = (ambiente) => linhasDoAmbiente({ ambiente: { navegador: 'firefox', ...ambiente } })
            .find((l) => l.rotulo === 'Armazenamento local');
        expect(so({ armazenamentoCotaMb: 256 }).valor).toBe('cota de cerca de 256 MB');
        expect(so({ armazenamentoUsoMb: 3 }).valor).toBe('3 MB usados');
        expect(so({ armazenamentoUsoMb: 3 }).detalhe).toBeUndefined();
        expect(so({})).toBeUndefined();
    });

    it('empty: the server defect, the older report by its UA, and nothing', () => {
        expect(navegadoresDoDefeitoLabel({ navegadores: [], origem: 'servidor' })).toEqual({
            texto: '—', detalhe: 'Defeito do servidor: não há navegador.',
        });
        const antigo = navegadoresDoDefeitoLabel({ navegadores: [], userAgent: UA_FIREFOX });
        expect(antigo.texto).toBe('Firefox');
        expect(antigo.detalhe).toContain('último relato');
        expect(navegadoresDoDefeitoLabel({}).texto).toBe('—');
    });
});

describe('the Uso section: browsers and systems of the sessions', () => {
    const BLOCO = {
        sessoes: 11,
        familias: [
            { navegador: 'firefox', sessoes: 7, sessoesComErro: 3, usuariosDistintos: 1 },
            { navegador: 'chrome', sessoes: 4, sessoesComErro: 0, usuariosDistintos: 0 },
        ],
        // The server cut one Firefox version off the list: the family row still says seven.
        versoes: [
            { navegador: 'firefox', versao: 143, sessoes: 4, sessoesComErro: 2, usuariosDistintos: 1 },
            { navegador: 'chrome', versao: 140, sessoes: 2, sessoesComErro: 0, usuariosDistintos: 0 },
            { navegador: 'chrome', versao: null, sessoes: 2, sessoesComErro: 0, usuariosDistintos: 0 },
        ],
        versoesCortadas: 1,
        sistemas: [
            { so: 'windows', sessoes: 8, sessoesComErro: 3, usuariosDistintos: 1 },
            { so: null, sessoes: 3, sessoesComErro: 0, usuariosDistintos: 0 },
        ],
    };

    it('the columns, in drawing order', () => {
        expect(COLUNAS_DE_AMBIENTE.map((c) => c.rotulo)).toEqual(['Sessões', 'Fatia', 'Com erro', 'Taxa de erro', 'Pessoas']);
    });

    it('CONTROL 2: each family, then its versions, and the family row is the server\'s', () => {
        const linhas = linhasDeNavegadores(BLOCO);
        expect(linhas.map((l) => [l.nivel, l.rotulo])).toEqual([
            ['familia', 'Firefox'], ['versao', 'versão 143'],
            ['familia', 'Chrome'], ['versao', 'versão 140'], ['versao', 'versão não declarada'],
        ]);
        expect(linhas[0].celulas).toEqual(['7', '63,6%', '3', '42,9%', '1']);
        expect(linhas[2].celulas).toEqual(['4', '36,4%', '0', '0%', '0']);
    });

    it('the systems, with the undeclared as a row of its own', () => {
        const linhas = linhasDeSistemas(BLOCO);
        expect(linhas.map((l) => l.rotulo)).toEqual(['Windows', 'Sistema não declarado']);
        expect(linhas[0].celulas).toEqual(['8', '72,7%', '3', '37,5%', '1']);
    });

    it('the cut is said, and the absent block is not zero', () => {
        expect(ambienteUsoCorteNotice(BLOCO)).toContain('Uma versão de navegador');
        expect(ambienteUsoCorteNotice({ versoesCortadas: 3 })).toContain('3 versões');
        expect(ambienteUsoCorteNotice({ versoesCortadas: 0 })).toBe('');
        expect(ambienteUsoInformado(BLOCO)).toBe(true);
        expect(ambienteUsoInformado(undefined)).toBe(false);
        expect(ambienteUsoInformado({ familias: [] })).toBe(false);
        expect(linhasDeNavegadores(undefined)).toEqual([]);
    });

    it('the retention floor: only when retention removed sessions the window asks for', () => {
        const desde = Date.UTC(2026, 7, 1);
        // The daily totals reach back to 25/07 and the kept sessions only to 20/08: pruned.
        const curto = ambienteUsoPisoNotice({
            desde,
            horizonte: { usoDesde: Date.UTC(2026, 6, 25), usoSessoesDesde: Date.UTC(2026, 7, 20) },
            timeZone: 'UTC',
        });
        expect(curto).toContain('20/08/2026');
        expect(curto).toContain('retenção');
        // A YOUNG installation (the measurement itself starts on 20/08) is said by the header of
        // the usage half, and this section adds nothing.
        expect(ambienteUsoPisoNotice({
            desde, horizonte: { usoDesde: Date.UTC(2026, 7, 20), usoSessoesDesde: Date.UTC(2026, 7, 20) },
        })).toBe('');
        expect(ambienteUsoPisoNotice({ desde, horizonte: { usoSessoesDesde: desde - 1 } })).toBe('');
        expect(ambienteUsoPisoNotice({ desde, horizonte: {} })).toBe('');
    });
});
