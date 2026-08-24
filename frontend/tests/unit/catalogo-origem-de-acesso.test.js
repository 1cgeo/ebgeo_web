// Path: tests/unit/catalogo-origem-de-acesso.test.js

/**
 * @fileoverview O vocabulário do eixo de acesso privado nas telas de leitura: o selo por
 * procedência, o filtro de acesso da grade e o prazo da concessão.
 *
 * O QUE ESTE VERDE PROVA. O selo do catálogo e o do seletor de camada base diziam, para TODA
 * origem, "só quem recebeu acesso enxerga este item". Essa frase é falsa exatamente para o
 * perfil que mais a lê: o credenciado enxerga o acervo privado inteiro por PAPEL, sem ter
 * recebido nada de ninguém. Os casos abaixo prendem a PROPRIEDADE de cada frase (a de papel não
 * afirma recebimento, só a de empréstimo avisa que some ao trocar de atlas), nunca a redação
 * inteira, que faria o próximo teste falhar por vírgula.
 *
 * O CASO `null` É O CASO FREQUENTE, e é o que um teste ingênuo esqueceria: servidor mais velho
 * que este build, ou soma de recursos que falhou. Ele tem de degradar para uma frase VERDADEIRA
 * sem origem, e não para uma das três escolhida como padrão.
 *
 * A INVARIANTE DO CONTADOR está no bloco de `countByAccessFilter`, e ela é o teste que vale mais
 * que os outros: para toda chave, o número ao lado do botão é o tamanho da lista que aquele
 * botão produz sozinho. Contador que discorda da lista é pior que contador nenhum, e a única
 * forma de garantir isso é derivar os dois lados da MESMA classificação, que é o que se afirma
 * aqui comparando contagem contra o predicado, item a item.
 */

import { describe, it, expect } from 'vitest';
import {
    ACCESS_FILTER,
    ACCESS_ORIGIN,
    accessExpiryPhrase,
    accessFilterLabel,
    catalogEmptyNotice,
    classifyAccess,
    countByAccessFilter,
    matchesAccessFilter,
    normalizeAccessFilters,
    normalizeAccessOrigin,
    privateBadgePhrase,
} from '../../src/js/catalog/access-origin-phrases.js';
// O DONO DO DADO, importado aqui SÓ para o teste de espelho abaixo. O módulo de frases não
// pode importá-lo (zero imports é contrato dele: ele é lido do chunk do mapa e do chunk de
// `ui-components`), então as duas listas são cópias, e cópia sem guarda diverge.
import { RESOURCE_ORIGIN } from '../../src/js/store/sync/resource-access.service.js';

describe('normalizeAccessOrigin', () => {
    it('aceita as três origens, com espaço e caixa alta', () => {
        expect(normalizeAccessOrigin('papel')).toBe(ACCESS_ORIGIN.PAPEL);
        expect(normalizeAccessOrigin('  CONCESSAO ')).toBe(ACCESS_ORIGIN.CONCESSAO);
        expect(normalizeAccessOrigin('Emprestimo')).toBe(ACCESS_ORIGIN.EMPRESTIMO);
    });

    it('recusa qualquer outra coisa devolvendo null, e não um padrão', () => {
        // Um valor fora da lista é um servidor mais novo que este build. As duas leituras
        // possíveis são "não sei" e "chutei"; chutar produz um selo que afirma a origem errada
        // com toda a confiança.
        for (const lixo of [null, undefined, '', '   ', 'produtor', 42, {}, [], NaN, true]) {
            expect(normalizeAccessOrigin(lixo)).toBeNull();
        }
    });
});

describe('o vocabulário é ESPELHO do dono do dado', () => {
    it('as três origens do módulo de frases são exatamente as de `RESOURCE_ORIGIN`', () => {
        // ASSERÇÃO ABSOLUTA ANTES DA IGUALDADE, senão duas listas vazias (ou duas erradas do
        // mesmo jeito) passariam verde. O selo é decidido comparando string com string; uma
        // grafia nova de um lado só não dá erro em lugar nenhum, ela só faz TODO selo cair no
        // caso genérico, que é o modo de falha silencioso desta mudança inteira.
        expect(Object.values(ACCESS_ORIGIN).sort()).toEqual(['concessao', 'emprestimo', 'papel']);
        expect(Object.values(RESOURCE_ORIGIN).sort()).toEqual(Object.values(ACCESS_ORIGIN).sort());
        for (const valor of Object.values(RESOURCE_ORIGIN)) {
            expect(normalizeAccessOrigin(valor)).toBe(valor);
        }
    });
});

describe('privateBadgePhrase', () => {
    it('o selo de PAPEL não afirma que a pessoa recebeu acesso de alguém', () => {
        const selo = privateBadgePhrase(ACCESS_ORIGIN.PAPEL);
        expect(selo.title).toMatch(/papel/i);
        expect(selo.title).not.toMatch(/recebeu/i);
        expect(selo.volatil).toBe(false);
    });

    it('o selo de CONCESSÃO fala do recebimento e da validade da concessão', () => {
        const selo = privateBadgePhrase(ACCESS_ORIGIN.CONCESSAO);
        expect(selo.title).toMatch(/recebeu/i);
        expect(selo.title).toMatch(/concess/i);
        expect(selo.volatil).toBe(false);
    });

    it('SÓ o de EMPRÉSTIMO avisa que o acesso some ao sair do atlas', () => {
        const emprestimo = privateBadgePhrase(ACCESS_ORIGIN.EMPRESTIMO);
        expect(emprestimo.volatil).toBe(true);
        expect(emprestimo.title).toMatch(/sair/i);
        expect(emprestimo.title).toMatch(/atlas/i);
        expect(emprestimo.rotulo).toMatch(/atlas/i);

        for (const estavel of [ACCESS_ORIGIN.PAPEL, ACCESS_ORIGIN.CONCESSAO, null]) {
            const selo = privateBadgePhrase(estavel);
            expect(selo.volatil).toBe(false);
            expect(selo.title).not.toMatch(/sair daqui/i);
            expect(selo.rotulo).toBe('Privado');
        }
    });

    it('sem procedência conhecida diz algo VERDADEIRO sem afirmar origem', () => {
        // O degrau de compatibilidade: servidor antigo, ou soma que falhou.
        for (const desconhecida of [null, undefined, 'origem-que-nao-existe', 7]) {
            const selo = privateBadgePhrase(desconhecida);
            expect(selo.origem).toBeNull();
            expect(selo.rotulo).toBe('Privado');
            expect(selo.rotuloCurto).toBe('Privado');
            expect(selo.title).not.toMatch(/recebeu|papel|empresta/i);
            expect(selo.title.length).toBeGreaterThan(10);
        }
    });

    it('o rótulo curto do empréstimo cabe na miniatura da camada base', () => {
        const { rotulo, rotuloCurto } = privateBadgePhrase(ACCESS_ORIGIN.EMPRESTIMO);
        expect(rotuloCurto.length).toBeLessThan(rotulo.length);
        expect(rotuloCurto).toBe('Emprestado');
    });

    it('o sujeito da frase é do chamador, e o vazio cai no padrão', () => {
        const base = privateBadgePhrase(ACCESS_ORIGIN.PAPEL, { sujeito: 'Camada base privada' });
        expect(base.title).toMatch(/^Camada base privada/);
        for (const vazio of [undefined, null, '', '   ']) {
            expect(privateBadgePhrase(ACCESS_ORIGIN.PAPEL, { sujeito: vazio }).title)
                .toMatch(/^Recurso privado/);
        }
        expect(privateBadgePhrase(ACCESS_ORIGIN.PAPEL, {}).title).toMatch(/^Recurso privado/);
        expect(privateBadgePhrase(ACCESS_ORIGIN.PAPEL).title).toMatch(/^Recurso privado/);
    });
});

describe('classifyAccess', () => {
    it('item público é público, com ou sem origem pendurada', () => {
        expect(classifyAccess({ privado: false })).toBe(ACCESS_FILTER.PUBLICO);
        expect(classifyAccess({ privado: false, origem: 'papel' })).toBe(ACCESS_FILTER.PUBLICO);
        expect(classifyAccess({})).toBe(ACCESS_FILTER.PUBLICO);
        expect(classifyAccess()).toBe(ACCESS_FILTER.PUBLICO);
    });

    it('privado com origem conhecida vira a própria origem', () => {
        expect(classifyAccess({ privado: true, origem: 'papel' })).toBe(ACCESS_FILTER.PAPEL);
        expect(classifyAccess({ privado: true, origem: 'concessao' })).toBe(ACCESS_FILTER.CONCESSAO);
        expect(classifyAccess({ privado: true, origem: 'emprestimo' }))
            .toBe(ACCESS_FILTER.EMPRESTIMO);
    });

    it('privado sem origem legível continua PRIVADO, e não vira público', () => {
        // A direção da degradação importa: cair em "público" faria o filtro de privado
        // esconder um item restrito, que é o erro na direção que engana.
        for (const lixo of [null, undefined, 'sei-la', 0]) {
            expect(classifyAccess({ privado: true, origem: lixo })).toBe(ACCESS_FILTER.PRIVADO);
        }
    });
});

describe('normalizeAccessFilters', () => {
    it('descarta chave inválida, remove repetição e devolve na ordem canônica', () => {
        expect(normalizeAccessFilters(['emprestimo', 'publico', 'publico', 'xyz']))
            .toEqual([ACCESS_FILTER.PUBLICO, ACCESS_FILTER.EMPRESTIMO]);
        expect(normalizeAccessFilters(new Set(['privado']))).toEqual([ACCESS_FILTER.PRIVADO]);
    });

    it('entrada que não é coleção vira lista vazia, sem lançar', () => {
        for (const nada of [null, undefined, 42, {}, 'privado', true]) {
            expect(normalizeAccessFilters(nada)).toEqual([]);
        }
    });
});

describe('matchesAccessFilter', () => {
    it('nenhum filtro ligado passa tudo', () => {
        for (const classe of Object.values(ACCESS_FILTER)) {
            expect(matchesAccessFilter(classe, [])).toBe(true);
            expect(matchesAccessFilter(classe, new Set())).toBe(true);
            expect(matchesAccessFilter(classe, null)).toBe(true);
        }
    });

    it('só chaves inválidas equivale a nenhum filtro, e não a filtro que zera a lista', () => {
        expect(matchesAccessFilter(ACCESS_FILTER.PUBLICO, ['xyz'])).toBe(true);
    });

    it('PRIVADO é superconjunto das quatro classes privadas e exclui o público', () => {
        const privadas = [
            ACCESS_FILTER.PAPEL, ACCESS_FILTER.CONCESSAO,
            ACCESS_FILTER.EMPRESTIMO, ACCESS_FILTER.PRIVADO,
        ];
        for (const classe of privadas) {
            expect(matchesAccessFilter(classe, [ACCESS_FILTER.PRIVADO])).toBe(true);
        }
        expect(matchesAccessFilter(ACCESS_FILTER.PUBLICO, [ACCESS_FILTER.PRIVADO])).toBe(false);
    });

    it('uma chave de origem seleciona só ela', () => {
        expect(matchesAccessFilter(ACCESS_FILTER.EMPRESTIMO, [ACCESS_FILTER.EMPRESTIMO])).toBe(true);
        expect(matchesAccessFilter(ACCESS_FILTER.PAPEL, [ACCESS_FILTER.EMPRESTIMO])).toBe(false);
        // O privado de origem desconhecida não responde a nenhuma das três: afirmar que ele é
        // "por papel" seria inventar o dado que falta.
        expect(matchesAccessFilter(ACCESS_FILTER.PRIVADO, [ACCESS_FILTER.PAPEL])).toBe(false);
    });

    it('ligar PRIVADO junto de uma origem absorve a origem, em vez de intersectar', () => {
        expect(matchesAccessFilter(
            ACCESS_FILTER.CONCESSAO, [ACCESS_FILTER.PRIVADO, ACCESS_FILTER.EMPRESTIMO]
        )).toBe(true);
    });
});

describe('countByAccessFilter', () => {
    const acervo = [
        ACCESS_FILTER.PUBLICO, ACCESS_FILTER.PUBLICO, ACCESS_FILTER.PUBLICO,
        ACCESS_FILTER.PAPEL, ACCESS_FILTER.PAPEL,
        ACCESS_FILTER.CONCESSAO,
        ACCESS_FILTER.EMPRESTIMO, ACCESS_FILTER.EMPRESTIMO, ACCESS_FILTER.EMPRESTIMO,
        ACCESS_FILTER.PRIVADO,
    ];

    it('conta cada classe e soma as quatro privadas em PRIVADO', () => {
        const c = countByAccessFilter(acervo);
        expect(c[ACCESS_FILTER.PUBLICO]).toBe(3);
        expect(c[ACCESS_FILTER.PAPEL]).toBe(2);
        expect(c[ACCESS_FILTER.CONCESSAO]).toBe(1);
        expect(c[ACCESS_FILTER.EMPRESTIMO]).toBe(3);
        expect(c[ACCESS_FILTER.PRIVADO]).toBe(7);
    });

    it('INVARIANTE: o número do botão é o tamanho da lista que aquele botão produz', () => {
        const contagem = countByAccessFilter(acervo);
        for (const chave of Object.values(ACCESS_FILTER)) {
            const listados = acervo.filter((classe) => matchesAccessFilter(classe, [chave]));
            expect(contagem[chave]).toBe(listados.length);
        }
    });

    it('acervo vazio, ou entrada que não é lista, dá zero em todas as chaves', () => {
        for (const nada of [[], null, undefined, 'privado', 7]) {
            const c = countByAccessFilter(nada);
            for (const chave of Object.values(ACCESS_FILTER)) expect(c[chave]).toBe(0);
        }
    });
});

describe('catalogEmptyNotice', () => {
    it('sem restrição nenhuma, não manda desligar um filtro que não existe', () => {
        const frase = catalogEmptyNotice();
        expect(frase).not.toMatch(/desligue|filtro de/i);
        expect(frase).toMatch(/catálogo/i);
    });

    it('nomeia a busca, o filtro de tipo e o de acesso, e diz o gesto de saída', () => {
        const frase = catalogEmptyNotice({
            temBusca: true,
            tiposAtivos: 2,
            acessosAtivos: [ACCESS_FILTER.EMPRESTIMO],
        });
        expect(frase).toMatch(/busca/i);
        expect(frase).toMatch(/filtros de tipo/i);
        expect(frase).toContain(accessFilterLabel(ACCESS_FILTER.EMPRESTIMO));
        expect(frase).toMatch(/desligue|limpe/i);
    });

    it('um tipo só fala no singular', () => {
        expect(catalogEmptyNotice({ tiposAtivos: 1 })).toMatch(/o filtro de tipo/i);
        expect(catalogEmptyNotice({ tiposAtivos: 1 })).not.toMatch(/os filtros de tipo/i);
    });

    it('contador inválido não vira "NaN" nem inventa restrição', () => {
        for (const lixo of [NaN, -3, undefined, 'dois', null]) {
            const frase = catalogEmptyNotice({ tiposAtivos: lixo });
            expect(frase).not.toMatch(/NaN|undefined/);
            expect(frase).not.toMatch(/filtro de tipo/i);
        }
    });

    it('chave de acesso inválida não aparece na frase', () => {
        const frase = catalogEmptyNotice({ acessosAtivos: ['xyz'] });
        expect(frase).not.toMatch(/xyz/);
        expect(frase).not.toMatch(/filtro de acesso/i);
    });
});

describe('accessExpiryPhrase', () => {
    // Meio-dia local do dia 01/09/2026, para que nenhum caso dependa do fuso da máquina.
    const agora = new Date(2026, 8, 1, 12, 0, 0).getTime();

    it('sem prazo, e com prazo ilegível, não desenha nada', () => {
        for (const nada of [null, undefined, '', 'ontem', {}, NaN, 'nao-e-data']) {
            expect(accessExpiryPhrase(nada, { agora })).toBeNull();
        }
    });

    it('data futura diz a data e explica o sumiço que vem depois dela', () => {
        const frase = accessExpiryPhrase('2026-09-10', { agora });
        expect(frase.estado).toBe('futuro');
        expect(frase.rotulo).toContain('10/09/2026');
        expect(frase.title).toMatch(/sem aviso/i);
    });

    it('A DATA PURA NÃO ANDA PARA TRÁS POR CAUSA DO FUSO', () => {
        // `new Date('2026-09-10')` é meia-noite UTC: formatada no fuso do Brasil ela vira
        // 09/09. Um prazo que aparece um dia mais cedo do que é vale menos que prazo nenhum.
        expect(accessExpiryPhrase('2026-09-10', { agora }).rotulo).toContain('10/09/2026');
        expect(accessExpiryPhrase('2026-01-01', { agora: new Date(2025, 0, 1).getTime() }).rotulo)
            .toContain('01/01/2026');
    });

    it('a data pura vale até o FIM do dia, e nesse dia a frase é "hoje"', () => {
        const frase = accessExpiryPhrase('2026-09-01', { agora });
        expect(frase.estado).toBe('hoje');
        expect(frase.rotulo).toMatch(/hoje/i);
        expect(frase.rotulo).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it('data passada é vencida e diz que o item sai da lista', () => {
        const frase = accessExpiryPhrase('2026-08-20', { agora });
        expect(frase.estado).toBe('vencido');
        expect(frase.rotulo).toContain('20/08/2026');
        expect(frase.title).toMatch(/passou|expirou|já/i);
    });

    it('o instante EXATO do agora já conta como vencido', () => {
        const iso = new Date(agora).toISOString();
        expect(accessExpiryPhrase(iso, { agora }).estado).toBe('vencido');
    });

    it('ISO com hora é lido como instante absoluto', () => {
        const iso = new Date(agora + 3 * 24 * 60 * 60 * 1000).toISOString();
        const frase = accessExpiryPhrase(iso, { agora });
        expect(frase.estado).toBe('futuro');
        const esperado = new Date(iso).toLocaleDateString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        });
        expect(frase.rotulo).toContain(esperado);
    });

    it('`agora` inválido cai no relógio real, em vez de produzir estado sem sentido', () => {
        const futuro = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        expect(accessExpiryPhrase(futuro, { agora: NaN }).estado).toBe('futuro');
        expect(accessExpiryPhrase(futuro).estado).toBe('futuro');
    });
});
