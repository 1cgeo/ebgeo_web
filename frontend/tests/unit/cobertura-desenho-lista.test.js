// Path: tests/unit/cobertura-desenho-lista.test.js

/**
 * @fileoverview A lista de ferramentas dos specs de cobertura de desenho
 * (`tests/e2e-ui/helpers/cobertura-desenho.js`, `FERRAMENTAS`) cobre TODA ferramenta de desenho e
 * de linha militar que a barra do produto oferece, menos as exclusões declaradas aqui com o motivo.
 *
 * Os dois lados são lidos como TEXTO: o helper importa o Playwright e a barra importa ícones, e
 * nenhum dos dois carrega em node puro. Uma ferramenta nova na barra reprova até entrar na lista ou
 * numa exclusão com motivo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ler = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Ferramentas da barra fora desta campanha, cada uma com o motivo. */
const EXCLUIDAS = Object.freeze({
    image: 'escolha de arquivo; coberta pelos specs de imagem (figura-aparece-na-hora, imagem-reencodada-gif-bmp)',
    azimuthDistance: 'painel de pernas, grava ponto/linha/polígono; coberta por drawing-delayed-azimuth e drawing-duplicate-azimuth',
    militarySymbol: 'símbolo, frente de símbolos',
    coordination: 'medida de coordenação, frente de símbolos',
    engineeringSymbol: 'símbolo de engenharia, frente de símbolos',
    declination: 'declinação magnética, frente de símbolos',
});

/** Os ids de ferramenta dos grupos `draw` e `military` da barra. */
function idsDaBarra() {
    const texto = ler('../../src/js/toolbar/toolbar.constants.js');
    const ids = [];
    for (const grupo of ['draw', 'military']) {
        const inicio = texto.indexOf(`id: '${grupo}'`);
        expect(inicio, `grupo ${grupo} na barra`).toBeGreaterThan(-1);
        const fim = texto.indexOf('\n    },', inicio);
        const trecho = texto.slice(inicio, fim);
        for (const m of trecho.matchAll(/\{\s*id: '([A-Za-z]+)', label:/g)) ids.push(m[1]);
    }
    return ids;
}

describe('lista de ferramentas da cobertura de desenho', () => {
    it('cobre toda ferramenta de desenho e de linha militar da barra, menos as exclusoes declaradas', () => {
        const barra = idsDaBarra();
        // O piso: sem isto, uma leitura que não achasse nada passaria verde.
        expect(barra.length).toBeGreaterThanOrEqual(15);
        const lista = [...ler('../e2e-ui/helpers/cobertura-desenho.js').matchAll(/\{ id: '([A-Za-z]+)', tipo:/g)].map((m) => m[1]);
        expect(lista.length).toBeGreaterThanOrEqual(13);
        const faltam = barra.filter((id) => !lista.includes(id) && !Object.hasOwn(EXCLUIDAS, id));
        expect(faltam).toEqual([]);
        // E nenhuma exclusão sobra de uma ferramenta que saiu da barra.
        expect(Object.keys(EXCLUIDAS).filter((id) => !barra.includes(id))).toEqual([]);
    });

    it('o balde e a fonte de alcas de cada ferramenta sao os do registro de ferramentas', () => {
        const registro = ler('../../src/js/tool_manager/tool-registry.js');
        const lista = [...ler('../e2e-ui/helpers/cobertura-desenho.js')
            .matchAll(/\{ id: '(\w+)', tipo: '(\w+)', [^\n]*?balde: '(\w+)'[^\n]*?alca: (null|'[\w-]+') \}/g)]
            .map(([, id, tipo, balde, alca]) => ({ id, tipo, balde, alca: alca === 'null' ? null : alca.slice(1, -1) }));
        expect(lista.length).toBeGreaterThanOrEqual(13);
        const divergencias = [];
        for (const { id, tipo, balde, alca } of lista) {
            const inicio = registro.indexOf(`tipoDeFeicao: '${tipo}'`);
            if (inicio < 0) { divergencias.push(`${id}: tipo ${tipo} fora do registro`); continue; }
            const fim = registro.indexOf('tipoDeFeicao:', inicio + 1);
            const trecho = registro.slice(inicio, fim < 0 ? undefined : fim);
            const fontes = /fontes: \[([^\]]*)\]/.exec(trecho)?.[1] ?? '';
            if (!fontes.includes(`'${balde}'`)) divergencias.push(`${id}: balde ${balde} nao esta em [${fontes}]`);
            const doRegistro = /alcaDeEdicao: (null|'[\w-]+')/.exec(trecho)?.[1];
            const esperado = doRegistro === 'null' ? null : doRegistro?.slice(1, -1);
            if (esperado !== alca) divergencias.push(`${id}: alca ${alca} contra ${esperado} no registro`);
        }
        expect(divergencias).toEqual([]);
    });
});
