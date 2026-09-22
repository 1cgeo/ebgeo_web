// Path: tests/unit/enderecos-frases.test.js

/**
 * @fileoverview A seção "Endereços de acesso" da aba Diagnóstico: as frases e os rótulos, que são
 * puros (`enderecos-phrases.js`, folha de zero imports), e o CONSUMIDOR, preso por varredura de
 * texto como as irmãs em `diagnostico-secoes-de-log.test.js`.
 *
 * O QUE SE PRENDE, e a leitura errada que cada item impede:
 *
 *   1. o documento irreconhecível não é lista vazia: sem `enderecos` e `distintos`, a seção falha
 *      com botão em vez de dizer "ninguém usou";
 *   2. o bloco de nomes tem TRÊS desfechos, e o ausente não é o cego: a providência é oposta;
 *   3. o visitante anônimo é UM rótulo com a contagem, nunca uma conta, e a conta que o banco não
 *      achou é "removida", nunca um nome inventado;
 *   4. com os nomes cegos, a conta sai pelo identificador, e não some;
 *   5. a chave do mapa de nomes é lida com `Object.hasOwn`: `__proto__` vindo do log não resolve
 *      para o protótipo;
 *   6. do lado do consumidor: a seção existe, lê a rota nova, passa o ENVELOPE `janela` às duas
 *      perguntas de leitura e não monta HTML.
 *
 * CONTROLES NEGATIVOS (o que fica vermelho ao voltar cada peça ao óbvio):
 *   - `desfechoDasContas` binário (`contas?.disponivel ? ... : ...`): o caso do bloco ausente
 *     reprova, porque ele sairia como cego;
 *   - trocar `Object.hasOwn(porId, id)` por `porId[id]`: o caso do `__proto__` reprova;
 *   - somar o anônimo como conta: o caso da célula mista reprova com um rótulo `conta` a mais;
 *   - passar o payload nu a `leitorCego` na seção: o último caso reprova.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COLUNAS_DE_ENDERECOS,
    DESFECHO_DAS_CONTAS,
    TIPO_DE_ROTULO,
    contasNotice,
    desfechoDasContas,
    enderecoLabel,
    enderecoTitulo,
    enderecoUnicoNotice,
    enderecosEscopoNotice,
    enderecosReconhecido,
    minutosDeAgora,
    requisicoesTitulo,
    rotulosDasContas,
    semEnderecoNotice,
    usandoAgoraTitulo,
} from '@js/admin/enderecos-phrases.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const contar = (n) => `#${n}`;

describe('enderecos-phrases — o documento', () => {
    it('reconhece só o documento com lista e contagem', () => {
        expect(enderecosReconhecido({ enderecos: [], distintos: 0 })).toBe(true);
        expect(enderecosReconhecido({ enderecos: [], distintos: -1 })).toBe(false);
        expect(enderecosReconhecido({ distintos: 3 })).toBe(false);
        expect(enderecosReconhecido({ enderecos: 'x', distintos: 3 })).toBe(false);
        expect(enderecosReconhecido(null)).toBe(false);
        expect(enderecosReconhecido([])).toBe(false);
    });

    it('os nomes têm TRÊS desfechos, e ausente não é cego', () => {
        expect(desfechoDasContas(undefined)).toBe(DESFECHO_DAS_CONTAS.AUSENTE);
        expect(desfechoDasContas({ disponivel: true })).toBe(DESFECHO_DAS_CONTAS.AUSENTE);
        expect(desfechoDasContas({ disponivel: false, motivo: 'x' })).toBe(DESFECHO_DAS_CONTAS.SEM_FONTE);
        expect(desfechoDasContas({ disponivel: true, porId: {} })).toBe(DESFECHO_DAS_CONTAS.DISPONIVEL);

        expect(contasNotice({ disponivel: true, porId: {} })).toBe('');
        const cego = contasNotice({ disponivel: false, motivo: 'o banco não respondeu (ECONNREFUSED)' });
        expect(cego).toMatch(/ECONNREFUSED/);
        expect(cego).toMatch(/continuam valendo/);
        const ausente = contasNotice(undefined);
        expect(ausente).not.toBe(cego);
        expect(ausente).toMatch(/não informou/);
    });

    it('o "agora" diz os minutos que o servidor declarou, e é tráfego, não presença', () => {
        expect(minutosDeAgora(5 * 60_000)).toBe(5);
        expect(minutosDeAgora(90_000)).toBe(2);
        expect(minutosDeAgora(10)).toBe(1);
        // Ausente ou lixo cai no padrão, em vez de dizer "0 minutos".
        expect(minutosDeAgora(undefined)).toBe(5);
        expect(minutosDeAgora(Number.NaN)).toBe(5);
        expect(minutosDeAgora(-1)).toBe(5);
        expect(usandoAgoraTitulo(10 * 60_000)).toMatch(/últimos 10 minutos/);
        expect(usandoAgoraTitulo(10 * 60_000)).toMatch(/não é presença|e não presença/);
    });

    it('o endereço único aponta o número de proxies e nomeia o endereço que se repete', () => {
        const nua = enderecoUnicoNotice({ distintos: 1 });
        expect(nua).toMatch(/TRUST_PROXY_HOPS/);
        expect(nua).toMatch(/costuma indicar/);
        expect(nua).toMatch(/^Todos os acessos chegaram de um só endereço\./);
        expect(nua).not.toMatch(/—|indício|veredito/);

        const nomeada = enderecoUnicoNotice({ distintos: 1, enderecos: [{ ip: ' 192.0.2.10 ' }] });
        expect(nomeada).toMatch(/^Todos os acessos chegaram de um só endereço \(192.0.2.10\)\./);

        // O sentinela não é endereço: a frase não o nomeia.
        const sentinela = enderecoUnicoNotice({ distintos: 1, enderecos: [{ ip: 'unknown', indeterminado: true }] });
        expect(sentinela).not.toMatch(/unknown/);
        expect(sentinela).toMatch(/um só endereço\./);
    });

    it('as ressalvas saem só quando valem', () => {
        expect(enderecoUnicoNotice({ distintos: 1 })).toMatch(/TRUST_PROXY_HOPS/);
        expect(enderecoUnicoNotice({ distintos: 2, enderecos: [{ ip: 'a' }, { ip: 'b' }] })).toBe('');
        expect(enderecoUnicoNotice({ distintos: 2 })).toBe('');
        expect(enderecoUnicoNotice({ distintos: 0 })).toBe('');
        expect(semEnderecoNotice({ semEndereco: 0 })).toBe('');
        expect(semEnderecoNotice({ semEndereco: 1 })).toMatch(/^1 requisição/);
        expect(semEnderecoNotice({ semEndereco: 1200 }, { contar })).toMatch(/^#1200 requisições/);
        expect(semEnderecoNotice({})).toBe('');
    });

    it('o escopo diz NAT, anônimo, quem vê e onde ir além de sete dias', () => {
        const t = enderecosEscopoNotice();
        expect(t).toMatch(/NAT/);
        expect(t).toMatch(/link público/);
        expect(t).toMatch(/administrador/);
        expect(t).toMatch(/npm run diag -- enderecos/);
        expect(t).not.toMatch(/—/);
    });
});

describe('enderecos-phrases — a linha', () => {
    it('o sentinela do servidor vira "não determinável", com o porquê no title', () => {
        expect(enderecoLabel({ ip: 'unknown', indeterminado: true })).toBe('não determinável');
        expect(enderecoTitulo({ ip: 'unknown', indeterminado: true })).toMatch(/não havia endereço/);
        expect(enderecoLabel({ ip: ' 10.0.0.1 ' })).toBe('10.0.0.1');
        expect(enderecoLabel({})).toBe('—');
    });

    it('as requisições dizem quantas falharam', () => {
        expect(requisicoesTitulo({ requisicoes: 1, comErro: 0 })).toBe('1 requisição, 0 com status de erro (400 ou mais)');
        expect(requisicoesTitulo({ requisicoes: 12, comErro: 3 }, { contar })).toBe('#12 requisições, #3 com status de erro (400 ou mais)');
        expect(requisicoesTitulo({})).toBe('');
    });

    it('as colunas são seis, e a de "Primeira" diz que é da janela', () => {
        expect(COLUNAS_DE_ENDERECOS.map((c) => c.rotulo))
            .toEqual(['Endereço', 'Última', 'Primeira', 'Requisições', 'Abas', 'Contas']);
        expect(COLUNAS_DE_ENDERECOS[2].titulo).toMatch(/DENTRO DA JANELA/);
        expect(COLUNAS_DE_ENDERECOS[4].titulo).toMatch(/piso/);
    });
});

describe('enderecos-phrases — os rótulos da célula de contas', () => {
    const contasOk = {
        disponivel: true,
        porId: {
            [A]: { username: 'fulano', nome: 'Fulano de Tal', ativo: true },
            [B]: { username: 'beltrano', nome: null, ativo: false },
        },
    };

    it('conta, inativa, removida, "+N" e anônimo, cada um com o seu tipo', () => {
        const item = {
            contas: [
                { userId: A, requisicoes: 3, ultima: 1 },
                { userId: B, requisicoes: 1, ultima: 2 },
                { userId: '33333333-3333-4333-8333-333333333333', requisicoes: 1, ultima: 3 },
            ],
            contasDistintas: 5,
            anonimas: 7,
            deLinkPublico: 2,
        };
        const r = rotulosDasContas(item, contasOk, { contar, hora: (t) => `t${t}` });
        expect(r.map((x) => x.tipo)).toEqual([
            TIPO_DE_ROTULO.CONTA, TIPO_DE_ROTULO.INATIVA, TIPO_DE_ROTULO.REMOVIDA,
            TIPO_DE_ROTULO.MAIS, TIPO_DE_ROTULO.ANONIMO,
        ]);
        expect(r[0].texto).toBe('fulano');
        expect(r[0].titulo).toMatch(/Fulano de Tal/);
        expect(r[0].titulo).toMatch(/#3 requisições, a última em t1/);
        expect(r[1].texto).toBe('beltrano (inativa)');
        expect(r[2].texto).toMatch(/^33333333… \(removida\)$/);
        expect(r[3].texto).toBe('+#2 contas');
        expect(r[4].texto).toBe('anônimo');
        expect(r[4].titulo).toBe('#7 requisições sem conta, #2 de visitante de link público');
    });

    it('com os nomes CEGOS a conta sai pelo identificador, e não some', () => {
        const r = rotulosDasContas({ contas: [{ userId: A, requisicoes: 1 }] },
            { disponivel: false, motivo: 'x' });
        expect(r).toHaveLength(1);
        expect(r[0].tipo).toBe(TIPO_DE_ROTULO.SEM_NOME);
        expect(r[0].texto).toBe('11111111…');
        expect(r[0].titulo).toContain(A);
    });

    it('só anônimo: UM rótulo, e nenhuma conta inventada', () => {
        const r = rotulosDasContas({ contas: [], contasDistintas: 0, anonimas: 1, deLinkPublico: 0 }, contasOk);
        expect(r).toEqual([{ texto: 'anônimo', titulo: '1 requisição sem conta', tipo: TIPO_DE_ROTULO.ANONIMO }]);
        expect(rotulosDasContas({}, contasOk)).toEqual([]);
    });

    it('um id `__proto__` vindo do log não resolve para o protótipo', () => {
        const r = rotulosDasContas({ contas: [{ userId: '__proto__', requisicoes: 1 }] }, contasOk);
        expect(r).toHaveLength(1);
        expect(r[0].tipo).toBe(TIPO_DE_ROTULO.REMOVIDA);
    });
});

describe('a seção de endereços, do lado do CONSUMIDOR', () => {
    const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
    const FONTE = readFileSync(path.join(RAIZ, 'src/js/admin/diag-tab.js'), 'utf8').replace(/\r\n/g, '\n');
    const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    function corpo(re, fecho) {
        const m = re.exec(FONTE);
        if (!m) return '';
        const fim = FONTE.indexOf(fecho, m.index);
        return fim === -1 ? '' : semComentarios(FONTE.slice(m.index, fim));
    }

    const pintor = corpo(/^ {4}_pintarEnderecos\(host, resultado, janela\)\s*\{/m, '\n    }\n');
    const linha = corpo(/^function linhaDeEndereco\(/m, '\n}\n');
    const celula = corpo(/^function celulaDeContas\(/m, '\n}\n');

    it('a seção existe, é montada e pede a rota nova com a janela da aba', () => {
        expect(pintor.length).toBeGreaterThan(400);
        expect(FONTE).toContain("this._secaoEnderecos = this._secao('admin-diag-enderecos')");
        expect(FONTE).toMatch(/enderecos: `\/diag\/enderecos\?desde=\$\{desde\}&limite=\$\{LIMITE_ENDERECOS\}`/);
        expect(FONTE).toContain('this._enderecosResponderam(geracao, janela,');
    });

    it('as perguntas de leitura recebem o ENVELOPE `janela`, nunca o payload nu', () => {
        expect(pintor).toContain('leitorCego(payload.janela)');
        expect(pintor).not.toMatch(/leitorCego\(payload\)/);
        expect(pintor).toContain('this._notasDaLeitura(host, payload.janela');
        expect(pintor).toContain('enderecosReconhecido(payload)');
        // As três ressalvas do documento passam pela tela.
        for (const chamada of ['contasNotice(payload.contas)', 'enderecoUnicoNotice(payload)', 'semEnderecoNotice(payload']) {
            expect(pintor).toContain(chamada);
        }
        // O vazio desta seção não é boa notícia.
        expect(pintor).not.toContain('bomVazio(');
    });

    it('endereço e nome entram por textContent: nenhum HTML montado nos três construtores', () => {
        expect(linha.length).toBeGreaterThan(200);
        expect(celula.length).toBeGreaterThan(200);
        for (const trecho of [pintor, linha, celula]) {
            expect(trecho).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
        }
        expect(celula).toContain('rotulosDasContas(item, contas');
        expect(linha).toContain('enderecoLabel(item)');
    });
});
