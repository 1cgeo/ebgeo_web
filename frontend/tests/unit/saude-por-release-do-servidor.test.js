// Path: tests/unit/saude-por-release-do-servidor.test.js

/**
 * @fileoverview O CARTÃO "SAÚDE POR RELEASE" TEM DUAS CONTAS, e este arquivo é sobre a que o
 * servidor passou a mandar em 2026-09-02 e sobre a escolha entre as duas.
 *
 * POR QUE A DO SERVIDOR VENCE: ela traz o DENOMINADOR. "Sete defeitos novos" não diz nada sem
 * saber se a build rodou em setenta sessões ou em sete mil, e a conta do cliente
 * (`saudeDasReleases`, sobre a lista carregada) nunca teve como saber isso — ela conta defeitos
 * sobre uma lista recortada por janela, filtros e teto de consulta.
 *
 * A FRASE DA FONTE NÃO É DECORAÇÃO, e é o caso mais importante daqui. As duas contas têm o mesmo
 * título, os mesmos nomes de release e dois rótulos em comum, e dão números diferentes: sem a
 * linha que diz qual está no ar, um administrador que abrisse a aba antes e depois de o servidor
 * ganhar o bloco veria os números mudarem sem nada explicar, e a conclusão natural é que a tela
 * quebrou. As duas frases são asseridas como DIFERENTES, porque uma frase única passaria verde em
 * qualquer asserção de conteúdo e não distinguiria nada.
 *
 * OS DOIS CONTROLES NEGATIVOS, ambos RODADOS:
 *
 *   1. **A TAXA COM ZERO NO DENOMINADOR.** `sessoesComErro / sessoes` sem a guarda devolve `NaN`
 *      (0/0) ou `Infinity`, e um `?? 0` em cima disso publica "0,0%" — saúde afirmada a partir de
 *      ausência de dado, sobre uma build que ninguém usou. O caso mede `null` e o travessão.
 *   2. **`saudeInformadaPeloServidor` POR VERACIDADE.** Trocar `Array.isArray` por um teste de
 *      verdade faz um `releases: {}` (ou qualquer resposta que a tela não sabe ler) ser tratado
 *      como bloco presente e VAZIO, e o cartão anuncia "nenhuma release" com a conta do cliente
 *      disponível ao lado.
 */

import { describe, it, expect } from 'vitest';
import {
    FONTE_DA_SAUDE,
    NUMEROS_DA_SAUDE,
    NUMEROS_DA_SAUDE_DO_SERVIDOR,
    TETO_DE_RELEASES,
    buildNoArLabel,
    desfechoDaSaude,
    saudeDoServidor,
    saudeFonteNotice,
    saudeNotice,
    taxaDeErroLabel,
} from '@js/admin/defeito-phrases.js';

const RELEASES = [
    { release: '1.2.0+abc1234', sessoes: 400, sessoesComErro: 12, defeitosNovos: 3, regressoes: 1 },
    { release: '1.1.0+def5678', sessoes: 900, sessoesComErro: 0, defeitosNovos: 7, regressoes: 0 },
];

describe('desfechoDaSaude — TRÊS desfechos, e o terceiro é o que faltava', () => {
    it('a lista do servidor é a fonte preferida', () => {
        expect(desfechoDaSaude({ releases: RELEASES })).toBe(FONTE_DA_SAUDE.SERVIDOR);
        // A lista VAZIA continua sendo resposta: o servidor respondeu e não há release na
        // janela dele. Ela não pode virar "indisponível".
        expect(desfechoDaSaude({ releases: [] })).toBe(FONTE_DA_SAUDE.SERVIDOR);
    });

    it('o campo AUSENTE é o servidor de versão anterior, e só ele', () => {
        expect(desfechoDaSaude({})).toBe(FONTE_DA_SAUDE.AUSENTE);
        expect(desfechoDaSaude({ releases: undefined })).toBe(FONTE_DA_SAUDE.AUSENTE);
    });

    it('o pulso recusado e o `null` do servidor são INDISPONÍVEL, e não versão anterior', () => {
        // ESTES DOIS ERAM O MESMO `false` DA PRIMEIRA VERSÃO, junto com o ausente acima, e a
        // frase acusava "versão anterior" nos três. Nos dois de agora o servidor ESTÁ
        // atualizado: ele mandou `null` porque o banco dele não respondeu, ou a requisição foi
        // recusada. Acusar versão anterior manda procurar o problema no lugar errado.
        expect(desfechoDaSaude({ pulsoFalhou: true })).toBe(FONTE_DA_SAUDE.INDISPONIVEL);
        expect(desfechoDaSaude({ releases: null })).toBe(FONTE_DA_SAUDE.INDISPONIVEL);
        // O pulso recusado vence, mesmo com um valor no campo.
        expect(desfechoDaSaude({ pulsoFalhou: true, releases: RELEASES }))
            .toBe(FONTE_DA_SAUDE.INDISPONIVEL);
    });

    it('o irreconhecível é INDISPONÍVEL, e nunca lista vazia', () => {
        // Desenhar "nenhuma release" sobre um servidor que respondeu outra coisa é a afirmação
        // mais perigosa que uma tela de medição pode fazer.
        expect(desfechoDaSaude({ releases: {} })).toBe(FONTE_DA_SAUDE.INDISPONIVEL);
        expect(desfechoDaSaude({ releases: 'x' })).toBe(FONTE_DA_SAUDE.INDISPONIVEL);
        expect(desfechoDaSaude()).toBe(FONTE_DA_SAUDE.AUSENTE);
        expect(Object.isFrozen(FONTE_DA_SAUDE)).toBe(true);
    });
});

describe('saudeDoServidor — normalização e a taxa derivada', () => {
    it('preserva a ordem do servidor e deriva a taxa', () => {
        const linhas = saudeDoServidor(RELEASES);
        expect(linhas.map((l) => l.release)).toEqual(['1.2.0+abc1234', '1.1.0+def5678']);
        expect(linhas[0].taxa).toBeCloseTo(3, 10);
        expect(linhas[1].taxa).toBe(0);
    });

    it('sem sessão NÃO há fração: a taxa é `null`, e nunca zero', () => {
        // 0% de zero sessões é uma afirmação sobre o conjunto vazio, e ela se lê como saúde.
        const [linha] = saudeDoServidor([
            { release: 'v', sessoes: 0, sessoesComErro: 0, defeitosNovos: 2, regressoes: 0 },
        ]);
        expect(linha.taxa).toBe(null);
        expect(linha.defeitosNovos).toBe(2);
    });

    it('recusa linha sem release e normaliza número ausente para zero', () => {
        const linhas = saudeDoServidor([
            { release: '   ', sessoes: 5 },
            { sessoes: 5 },
            null,
            { release: ' v1 ' },
        ]);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toEqual({
            release: 'v1', sessoes: 0, sessoesComErro: 0, taxa: null,
            defeitosNovos: 0, regressoes: 0,
        });
    });

    it('corta no teto de três, o mesmo da conta do cliente', () => {
        const muitas = Array.from({ length: 9 }, (_, i) => (
            { release: `v${i}`, sessoes: 10, sessoesComErro: 1 }
        ));
        expect(saudeDoServidor(muitas)).toHaveLength(TETO_DE_RELEASES);
        expect(saudeDoServidor(muitas, { limite: 2 })).toHaveLength(2);
        expect(saudeDoServidor(null)).toEqual([]);
    });
});

describe('taxaDeErroLabel — a fração, e o que ela nunca inventa', () => {
    it('uma casa decimal em pt-BR', () => {
        expect(taxaDeErroLabel(3)).toBe('3,0%');
        expect(taxaDeErroLabel(12.34)).toBe('12,3%');
        expect(taxaDeErroLabel(100)).toBe('100,0%');
    });

    it('zero medido aparece como zero, e o não medido como travessão', () => {
        expect(taxaDeErroLabel(0)).toBe('0,0%');
        expect(taxaDeErroLabel(null)).toBe('—');
        expect(taxaDeErroLabel(undefined)).toBe('—');
        expect(taxaDeErroLabel(Number.NaN)).toBe('—');
        expect(taxaDeErroLabel(-1)).toBe('—');
    });

    it('uma fração positiva minúscula não arredonda para zero', () => {
        // Arredondar erro real para 0% é dizer que ele não houve.
        expect(taxaDeErroLabel(0.02)).toBe('<0,1%');
    });
});

describe('os números do cartão são amarrados por CAMPO, nos dois modos', () => {
    it('a tabela do servidor tem cinco entradas, e a ordem começa pelo denominador', () => {
        expect(NUMEROS_DA_SAUDE_DO_SERVIDOR.map((n) => n.campo)).toEqual([
            'sessoes', 'sessoesComErro', 'taxa', 'defeitosNovos', 'regressoes',
        ]);
        // Um cartão que começasse pela taxa mostraria "100%" de uma release com uma sessão, que é
        // o número mais alarmante e menos informativo desta tela.
        expect(NUMEROS_DA_SAUDE_DO_SERVIDOR[0].campo).toBe('sessoes');
    });

    it('só a taxa é percentual; o resto é contagem', () => {
        const percentuais = NUMEROS_DA_SAUDE_DO_SERVIDOR
            .filter((n) => n.formato === 'percentual').map((n) => n.campo);
        expect(percentuais).toEqual(['taxa']);
    });

    it('todo campo declarado existe nas linhas que a função devolve', () => {
        // A AMARRAÇÃO INTEIRA: com os literais escritos no desenho, trocar dois de lugar não
        // ficaria vermelho em lugar nenhum, e um campo renomeado desenharia travessões.
        const [linha] = saudeDoServidor(RELEASES);
        for (const n of NUMEROS_DA_SAUDE_DO_SERVIDOR) {
            expect(n.campo in linha, `${n.campo} não existe na linha`).toBe(true);
            expect(n.rotulo.length).toBeGreaterThan(2);
            expect(n.titulo.length).toBeGreaterThan(40);
        }
    });

    it('a tabela do CLIENTE continua de pé, com os três campos dela', () => {
        expect(NUMEROS_DA_SAUDE.map((n) => n.campo)).toEqual(['novos', 'regressoes', 'defeitos']);
        // "nascidos aqui" e não "novos": três sentidos para a mesma palavra na mesma tela.
        expect(NUMEROS_DA_SAUDE[0].rotulo).toBe('nascidos aqui');
    });
});

describe('saudeFonteNotice — a tela diz QUAL conta está no ar, e por quê', () => {
    it('as TRÊS frases são diferentes entre si', () => {
        // Uma frase repetida entre dois desfechos deixaria a asserção de conteúdo verde sem
        // distinguir nada, que é a cobertura vazia desta família.
        const frases = Object.values(FONTE_DA_SAUDE).map((f) => saudeFonteNotice(f));
        expect(new Set(frases).size).toBe(frases.length);
    });

    it('a do servidor nomeia quem contou e NÃO carrega a ressalva de recorte', () => {
        // A janela, os filtros e o teto da consulta não limitam o resumo do servidor: repetir a
        // ressalva ali seria uma advertência falsa, que custa mais que advertência nenhuma.
        const frase = saudeFonteNotice(FONTE_DA_SAUDE.SERVIDOR);
        expect(frase).toContain('SERVIDOR');
        expect(frase).toContain('independentemente da janela');
    });

    it('a de AUSENTE fala do servidor NAO INFORMAR, e só ela', () => {
        const frase = saudeFonteNotice(FONTE_DA_SAUDE.AUSENTE);
        expect(frase).toContain('CLIENTE');
        expect(frase).toMatch(/janela|filtros/);
        expect(frase).toContain('não informa o resumo por release');
    });

    it('a de INDISPONÍVEL não afirma causa, e não manda atualizar servidor nenhum', () => {
        // O ERRO QUE ELA DESFAZ: a primeira versão dizia "ainda não informa o resumo por
        // release" quando o pulso tinha sido recusado ou o banco do servidor não respondera.
        const frase = saudeFonteNotice(FONTE_DA_SAUDE.INDISPONIVEL);
        expect(frase).toContain('CLIENTE');
        expect(frase).toContain('Não deu para ler o resumo do servidor');
        expect(frase).toContain('não dá para dizer');
        expect(frase).not.toContain('não informa o resumo por release');
    });

    it('a nota de alcance do cliente continua onde estava', () => {
        expect(saudeNotice()).toContain('esta lista carregou');
    });

    it('a build NO AR continua sendo nomeada, e o `null` é estado declarado', () => {
        expect(buildNoArLabel('1.2.0+abc1234')).toBe('Build no ar: 1.2.0+abc1234');
        expect(buildNoArLabel(null)).toContain('não declarou');
    });
});
