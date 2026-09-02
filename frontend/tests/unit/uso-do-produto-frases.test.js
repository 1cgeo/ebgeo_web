// Path: tests/unit/uso-do-produto-frases.test.js

/**
 * @fileoverview AS QUATRO SEÇÕES DE USO DO PRODUTO da aba "Uso": sessões, mais usados, desempenho
 * no cliente e indisponibilidade vista da ponta. Só a lógica pura; o DOM fica de fora, como na
 * suíte irmã (`uso-frases.test.js`).
 *
 * A DIFERENÇA DE FONTE É O ASSUNTO. As seções antigas contam o que o SERVIDOR registrou; estas
 * quatro contam o que NAVEGADORES relataram, e por isso quase todo caso aqui é sobre a distinção
 * entre "não aconteceu" e "não conseguimos contar".
 *
 * OS QUATRO CONTROLES NEGATIVOS, todos RODADOS (reverter a peça, ver o vermelho, restaurar):
 *
 *   1. **O p75 AUSENTE VIRANDO ZERO.** `p75Label(null)` devolvendo "0 ms" é a melhor nota possível
 *      atribuída a uma medição que não houve, e ela entraria assim no relatório: o instrumento
 *      desligado se leria como desempenho perfeito. É a mesma classe do `numeroLabel` da aba, com
 *      o agravante de o zero ser BOM aqui, e não neutro.
 *   2. **A UNIDADE DE `amostras` OMITIDA.** O servidor manda `origem` justamente porque a palavra
 *      "amostra" muda de grandeza: sessões quando a linha por sessão ainda existe, DIAS quando a
 *      retenção já a levou. Sem a unidade escrita, "412" e "30" se leem como a mesma coisa, e a
 *      segunda parece uma queda brutal de uso.
 *   3. **O HORIZONTE DE USO FUNDIDO COM O DE PODA.** Reusar `horizonteEncurtadoNotice` aqui faria
 *      a tela dizer "ou o histórico foi apagado por inteiro" sobre uma instrumentação que apenas
 *      nasceu semana passada, mandando o administrador procurar um expurgo que nunca houve. O caso
 *      mede que a frase de uso NÃO carrega a palavra de poda.
 *   4. **A SESSÃO FORA DE `periodoSemMovimento`.** O EBGeo roda ANÔNIMO por desenho, então uma
 *      janela inteira de visitantes deixa os cinco números antigos em zero. Sem o termo novo, o
 *      período é declarado PARADO e as quatro seções que têm o que mostrar não são desenhadas.
 */

import { describe, it, expect } from 'vitest';
import {
    COLUNAS_DE_DESEMPENHO,
    FONTE_DO_HORIZONTE_DE_USO,
    HORIZONTE,
    ORIGENS_DE_DESEMPENHO,
    SEM_AMOSTRA,
    amostrasLabel,
    clsLabel,
    disponibilidadeGraficoLegenda,
    disponibilidadeHint,
    disponibilidadeNaoInformadoNotice,
    duracaoLabel,
    estadoDaFonte,
    eventoDeUsoLabel,
    ferramentasHint,
    lerMetricasDeSessoes,
    linhasDeDesempenho,
    linhasDeFerramentas,
    p75Label,
    paginaDeUsoLabel,
    periodoSemMovimento,
    PROP_LABEL_POR_EVENTO,
    propDeUsoLabel,
    serieDeDisponibilidade,
    serieDeSessoes,
    sessoesAnonimas,
    sessoesInformado,
    sessoesNaoInformadoNotice,
    sessoesRetidasNotice,
    tituloDeBarraDeIndisponibilidade,
    tituloDeBarraDeSessao,
    usoDoProdutoHint,
    usoHorizonteNotice,
} from '@js/admin/uso-phrases.js';
import { PROPS_PERMITIDAS } from '@js/session/eventos-de-uso.js';

describe('duracaoLabel — três faixas, e o símbolo não flexiona', () => {
    it('abaixo de um minuto conta segundos', () => {
        expect(duracaoLabel(0)).toBe('0 s');
        expect(duracaoLabel(1)).toBe('1 s');
        expect(duracaoLabel(59)).toBe('59 s');
    });

    it('entre um minuto e uma hora conta minutos', () => {
        expect(duracaoLabel(60)).toBe('1 min');
        expect(duracaoLabel(750)).toBe('13 min');
        expect(duracaoLabel(3540)).toBe('59 min');
    });

    it('acima de uma hora conta hora e minuto, e omite o minuto redondo', () => {
        expect(duracaoLabel(3600)).toBe('1 h');
        expect(duracaoLabel(4800)).toBe('1 h 20 min');
        expect(duracaoLabel(7200)).toBe('2 h');
    });

    it('o que não é contagem vira travessão, e nunca zero', () => {
        for (const v of [null, undefined, Number.NaN, -1, 'x', {}]) {
            expect(duracaoLabel(v)).toBe('—');
        }
    });
});

describe('sessoesAnonimas — derivada, com piso em zero', () => {
    it('é o total menos as autenticadas', () => {
        expect(sessoesAnonimas({ total: 100, autenticadas: 30 })).toBe(70);
        expect(sessoesAnonimas({ total: 5, autenticadas: 5 })).toBe(0);
    });

    it('nunca é negativa: duas consultas diferentes podem divergir', () => {
        // Um negativo na tela se lê como tela quebrada, e não como divergência de fonte.
        expect(sessoesAnonimas({ total: 3, autenticadas: 9 })).toBe(0);
    });

    it('ponta ausente é `null`, e não zero', () => {
        expect(sessoesAnonimas({ total: 10 })).toBe(null);
        expect(sessoesAnonimas({ autenticadas: 2 })).toBe(null);
        expect(sessoesAnonimas(null)).toBe(null);
        expect(sessoesAnonimas(undefined)).toBe(null);
    });
});

describe('lerMetricasDeSessoes — cinco ladrilhos, todos do PERÍODO', () => {
    const SESSOES = {
        total: 120, autenticadas: 40, usuariosDistintos: 17, duracaoMedianaS: 930, comErro: 6,
    };

    it('desenha os cinco, com o regime em campo e a duração formatada', () => {
        const m = lerMetricasDeSessoes(SESSOES, '30d');
        expect(m.map((x) => x.chave)).toEqual([
            'total', 'usuariosDistintos', 'anonimas', 'duracaoMedianaS', 'comErro',
        ]);
        // NENHUM É ESTOQUE: uma sessão é um evento, não um saldo. O regime é campo justamente
        // para que ninguém escreva a legenda à mão em cinco lugares.
        for (const x of m) expect(x.regimeTexto).toBe('nos últimos 30 dias');
        expect(m.find((x) => x.chave === 'anonimas').texto).toBe('80');
        expect(m.find((x) => x.chave === 'duracaoMedianaS').texto).toBe('16 min');
        expect(m.find((x) => x.chave === 'comErro').texto).toBe('6');
    });

    it('bloco ausente vira cinco travessões, e não cinco zeros', () => {
        const m = lerMetricasDeSessoes(undefined, '7d');
        expect(m.map((x) => x.texto)).toEqual(['—', '—', '—', '—', '—']);
    });

    it('a mediana `null` é travessão: zero segundo seria uma MEDIDA', () => {
        const m = lerMetricasDeSessoes({ ...SESSOES, duracaoMedianaS: null }, '30d');
        expect(m.find((x) => x.chave === 'duracaoMedianaS').texto).toBe('—');
    });
});

describe('sessoesRetidasNotice — a ressalva que só aparece quando há divergência', () => {
    it('cala quando ainda há sessão retida na janela', () => {
        expect(sessoesRetidasNotice({ total: 100, sessoesRetidas: 100 })).toBe('');
        expect(sessoesRetidasNotice({ total: 100, sessoesRetidas: 1 })).toBe('');
    });

    it('fala quando o total existe e nenhuma sessão sobreviveu à retenção', () => {
        const frase = sessoesRetidasNotice({ total: 100, sessoesRetidas: 0 });
        expect(frase).toContain('pessoas distintas');
        expect(frase).toContain('duração mediana');
        // E ela NOMEIA o que continua valendo, senão a ressalva derruba a seção inteira.
        expect(frase).toContain('continuam valendo');
    });

    it('cala no período sem sessão nenhuma e no campo ausente', () => {
        expect(sessoesRetidasNotice({ total: 0, sessoesRetidas: 0 })).toBe('');
        expect(sessoesRetidasNotice({ total: 100 })).toBe('');
        expect(sessoesRetidasNotice(null)).toBe('');
    });
});

describe('serieDeSessoes — a série diária, com as duas chaves possíveis', () => {
    it('lê `sessoes`, que é o nome do contrato', () => {
        expect(serieDeSessoes([
            { dia: '2026-08-01', sessoes: 3 },
            { dia: '2026-08-03', sessoes: 5 },
        ])).toEqual([
            { dia: '2026-08-01', total: 3 },
            // O BURACO É PREENCHIDO COM ZERO: um dia que sumisse do eixo se leria como dado que
            // não chegou, que é a afirmação oposta.
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 5 },
        ]);
    });

    it('aceita `total` também, e o que não é lista vira lista vazia', () => {
        expect(serieDeSessoes([{ dia: '2026-08-01', total: 7 }]))
            .toEqual([{ dia: '2026-08-01', total: 7 }]);
        expect(serieDeSessoes(null)).toEqual([]);
        expect(serieDeSessoes({})).toEqual([]);
    });

    it('o `title` da barra fala de SESSÕES, e não de operações', () => {
        expect(tituloDeBarraDeSessao('2026-08-05', 1)).toBe('05/08/2026: 1 sessão');
        expect(tituloDeBarraDeSessao('2026-08-05', 1200)).toBe('05/08/2026: 1.200 sessões');
        expect(tituloDeBarraDeSessao('2026-08-05', 0)).toBe('05/08/2026: 0 sessões');
    });
});

describe('linhasDeFerramentas — o que foi mais acionado', () => {
    const DADOS = [
        { evento: 'ferramenta.ativada', prop: 'point', contagem: 40 },
        { evento: 'pdf.exportado', prop: 'mosaico', contagem: 10 },
        { evento: 'ferramenta.ativada', prop: 'militarysymbol', contagem: 50 },
    ];

    it('ordena da maior para a menor e calcula a fatia sobre a soma da lista', () => {
        const linhas = linhasDeFerramentas(DADOS);
        expect(linhas.map((l) => l.contagem)).toEqual([50, 40, 10]);
        expect(linhas[0].fatia).toBe('50,0%');
        expect(linhas[2].fatia).toBe('10,0%');
    });

    it('traduz evento e alvo, e guarda o id CRU para quem for procurar no código', () => {
        const [primeira] = linhasDeFerramentas(DADOS);
        expect(primeira.rotulo).toBe('Ferramenta');
        expect(primeira.alvo).toBe('Símbolo militar');
        expect(primeira.bruto).toBe('ferramenta.ativada militarysymbol');
    });

    it('o DESCONHECIDO sobrevive com a chave crua, e não vira "Outros"', () => {
        // Sumir com o desconhecido esconderia uso real, que é o oposto do que a aba existe para
        // fazer. Uma ferramenta nova aparece com o id dela até alguém traduzi-la.
        const linhas = linhasDeFerramentas([
            { evento: 'ferramenta.ativada', prop: 'hipsometria', contagem: 3 },
            { evento: 'gesto.inventado', prop: '', contagem: 2 },
        ]);
        expect(linhas[0].alvo).toBe('hipsometria');
        expect(linhas[1].rotulo).toBe('gesto.inventado');
    });

    it('`prop` vazia é um VALOR e não ausência: o gesto sem qualificador', () => {
        const [linha] = linhasDeFerramentas([{ evento: 'medicao.aberta', prop: '', contagem: 4 }]);
        expect(linha.alvo).toBe('');
        expect(linha.bruto).toBe('medicao.aberta');
    });

    it('TODO qualificador de lista fechada tem nome em pt-BR, e não sai cru', () => {
        // A PRIMEIRA VERSÃO DESTE CASO CONGELAVA O CRU: ela afirmava que `publico` e `folha`
        // saíam como estavam, o que descrevia o defeito em vez de prendê-lo. A tela mostrava
        // "publico" e "folha" numa coluna cujo vizinho dizia "Símbolo militar".
        expect(propDeUsoLabel('ferramenta.ativada', 'point')).toBe('Ponto');
        expect(propDeUsoLabel('atlas.aberto', 'local')).toBe('Local');
        expect(propDeUsoLabel('atlas.aberto', 'servidor')).toBe('Servidor');
        expect(propDeUsoLabel('atlas.aberto', 'publico')).toBe('Público');
        expect(propDeUsoLabel('pdf.exportado', 'folha')).toBe('Folha única');
        expect(propDeUsoLabel('pdf.exportado', 'mosaico')).toBe('Mosaico');
        expect(propDeUsoLabel('ferramenta.ativada', '')).toBe('');
    });

    it('a tabela é POR EVENTO: o mesmo id em dois eventos não se confunde', () => {
        // Nada impede que nasça uma ferramenta com id `folha`; com uma tabela única, a coluna
        // "Alvo" chamaria um PDF de ferramenta, e a divergência só apareceria na tela.
        expect(propDeUsoLabel('medicao.aberta', 'folha')).toBe('folha');
        expect(propDeUsoLabel('ferramenta.ativada', 'folha')).toBe('folha');
        expect(propDeUsoLabel('atlas.aberto', 'point')).toBe('point');
        expect(Object.keys(PROP_LABEL_POR_EVENTO).sort())
            .toEqual(['atlas.aberto', 'ferramenta.ativada', 'pdf.exportado']);
    });

    it('TODA lista fechada do catálogo está traduzida (nenhum valor sobra cru)', () => {
        // A AMARRAÇÃO COM O CATÁLOGO: um valor novo em `PROPS_PERMITIDAS` nasce cru na tela até
        // alguém traduzi-lo, e sem esta varredura ninguém saberia. O evento LIVRE fica de fora,
        // porque a lista dele cresce a cada ferramenta e não é contrato de nada.
        const crus = [];
        for (const [evento, permitidas] of Object.entries(PROPS_PERMITIDAS)) {
            if (permitidas === null || permitidas.length === 0) continue;
            for (const valor of permitidas) {
                if (propDeUsoLabel(evento, valor) === valor) crus.push(`${evento} ${valor}`);
            }
        }
        expect(crus, 'qualificador de lista fechada sem nome em pt-BR').toEqual([]);
    });

    it('corta no teto e recusa o que não é lista', () => {
        const muitas = Array.from({ length: 30 }, (_, i) => (
            { evento: 'ferramenta.ativada', prop: `t${i}`, contagem: i + 1 }
        ));
        expect(linhasDeFerramentas(muitas)).toHaveLength(20);
        expect(linhasDeFerramentas(null)).toEqual([]);
        expect(linhasDeFerramentas('x')).toEqual([]);
    });

    it('a nota diz que a contagem é de ACIONAMENTO, e não de tempo', () => {
        expect(ferramentasHint()).toContain('ACIONAMENTOS');
        expect(eventoDeUsoLabel('pdf.exportado')).toBe('PDF exportado');
        expect(eventoDeUsoLabel(null)).toBe('Sem evento');
    });
});

describe('desempenho no cliente — ausência nunca vira zero', () => {
    it('o p75 ausente diz "sem amostra", e nunca "0 ms"', () => {
        // ZERO MILISSEGUNDO É A MELHOR NOTA POSSÍVEL: publicá-lo sobre uma medição que não houve
        // anunciaria desempenho perfeito a partir de instrumento desligado.
        expect(p75Label(null)).toBe(SEM_AMOSTRA);
        expect(p75Label(undefined)).toBe(SEM_AMOSTRA);
        expect(p75Label(Number.NaN)).toBe(SEM_AMOSTRA);
        expect(p75Label(1234)).toBe('1.234 ms');
        expect(p75Label(0)).toBe('0 ms');
    });

    it('o CLS sai com TRÊS casas, porque a faixa útil inteira cabe abaixo de 0,25', () => {
        expect(clsLabel(0.0834)).toBe('0,083');
        expect(clsLabel(0.1)).toBe('0,100');
        expect(clsLabel(0)).toBe('0,000');
        expect(clsLabel(null)).toBe(SEM_AMOSTRA);
    });

    it('a coluna de amostras carrega a UNIDADE, que muda com a fonte da linha', () => {
        expect(amostrasLabel(412, 'sessoes')).toBe('412 sessões');
        expect(amostrasLabel(1, 'sessoes')).toBe('1 sessão');
        expect(amostrasLabel(30, 'diario')).toBe('30 dias');
        expect(amostrasLabel(1, 'diario')).toBe('1 dia');
        // Origem que este build não conhece cai em algo vago e honesto, nunca no número nu.
        expect(amostrasLabel(9, 'inventada')).toBe('9 amostras');
        expect(amostrasLabel(9, undefined)).toBe('9 amostras');
        expect(Object.keys(ORIGENS_DE_DESEMPENHO).sort()).toEqual(['diario', 'sessoes']);
    });

    it('as linhas saem na ordem FIXA das quatro páginas, e o desconhecido vai para o fim', () => {
        const linhas = linhasDeDesempenho([
            { pagina: 'admin', origem: 'sessoes', amostras: 12 },
            { pagina: 'relatorio', origem: 'sessoes', amostras: 1 },
            { pagina: 'mapa', origem: 'sessoes', amostras: 400 },
            { pagina: 'calibracao', origem: 'diario', amostras: 3 },
        ]);
        expect(linhas.map((l) => l.pagina)).toEqual(['mapa', 'admin', 'calibracao', 'relatorio']);
        expect(linhas[0].rotulo).toBe('Mapa');
        expect(linhas[3].rotulo).toBe('relatorio');
    });

    it('cada linha traz as cinco células, com a marca de vazio só nos percentis', () => {
        const [linha] = linhasDeDesempenho([{
            pagina: 'mapa', origem: 'sessoes', amostras: 200,
            lcpP75Ms: 1800, inpP75Ms: null, clsP75: 0.0421, tempoAteMapaP75Ms: 2600,
        }]);
        expect(linha.celulas.map((c) => c.campo))
            .toEqual(COLUNAS_DE_DESEMPENHO.map((c) => c.campo));
        expect(linha.celulas[0].texto).toBe('1.800 ms');
        expect(linha.celulas[1].texto).toBe(SEM_AMOSTRA);
        expect(linha.celulas[1].vazia).toBe(true);
        expect(linha.celulas[2].texto).toBe('0,042');
        expect(linha.celulas[4].texto).toBe('200 sessões');
        // A coluna de amostras NUNCA é "vazia": ela é uma contagem, e zero amostras é um fato.
        expect(linha.celulas[4].vazia).toBe(false);
    });

    it('a página sem mapa não tem "até o mapa", e isso não é falha', () => {
        const [linha] = linhasDeDesempenho([{
            pagina: 'admin', origem: 'sessoes', amostras: 5, tempoAteMapaP75Ms: null,
        }]);
        const ate = linha.celulas.find((c) => c.campo === 'tempoAteMapaP75Ms');
        expect(ate.texto).toBe(SEM_AMOSTRA);
        expect(paginaDeUsoLabel('admin')).toBe('Administração');
        expect(paginaDeUsoLabel('')).toBe('Sem página');
    });

    it('bloco que não é lista vira lista vazia', () => {
        expect(linhasDeDesempenho(null)).toEqual([]);
        expect(linhasDeDesempenho({})).toEqual([]);
    });
});

describe('indisponibilidade vista pelo cliente', () => {
    it('a série lê `vistos` e preenche o dia sem incidente com ZERO', () => {
        // Num gráfico de FALHA o buraco é a leitura mais perigosa possível: ele se lê como "não
        // medimos" ao lado de um pico.
        expect(serieDeDisponibilidade([
            { dia: '2026-08-01', vistos: 2 },
            { dia: '2026-08-03', vistos: 1 },
        ])).toEqual([
            { dia: '2026-08-01', total: 2 },
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 1 },
        ]);
        expect(serieDeDisponibilidade(undefined)).toEqual([]);
    });

    it('o `title` fala de TELAS', () => {
        expect(tituloDeBarraDeIndisponibilidade('2026-08-05', 1)).toBe('05/08/2026: 1 tela');
        expect(tituloDeBarraDeIndisponibilidade('2026-08-05', 4)).toBe('05/08/2026: 4 telas');
    });

    it('a legenda do gráfico NÃO é a ressalva de causa (a captura pegou as duas juntas)', () => {
        // MEDIDO NA TELA: a primeira versão passava `disponibilidadeHint()` como legenda do
        // gráfico E como nota da seção, e a captura mostrou o mesmo parágrafo duas vezes, palavra
        // por palavra. Repetir uma ressalva não a reforça: ela passa a ser lida como erro de
        // montagem, e a segunda ocorrência ensina a pular a primeira.
        expect(disponibilidadeGraficoLegenda()).not.toBe(disponibilidadeHint());
        // A legenda diz o que a BARRA é, como nas outras duas séries da aba.
        expect(disponibilidadeGraficoLegenda()).toContain('Cada barra é um dia');
        expect(disponibilidadeGraficoLegenda()).not.toContain('ERRO DO PROGRAMA');
    });

    it('a ressalva NOMEIA o que esta contagem NÃO alcança, e para onde o resto foi', () => {
        // Sem a segunda metade a ressalva vira desculpa: a queda de servidor não se perde, ela é
        // contada pelo lado dos DEFEITOS, que tem fila.
        const frase = disponibilidadeHint();
        expect(frase).toContain('ERRO DO PROGRAMA');
        expect(frase).toContain('Diagnóstico');
        expect(frase).toContain('indisponivel');
        // A FRASE DE BLOCO AUSENTE NÃO AFIRMA CAUSA: ela pode faltar porque o servidor é de
        // versão anterior OU porque ele não conseguiu montá-la desta vez, e daqui não dá para
        // distinguir. Mandar atualizar o servidor por causa de um banco que não respondeu manda
        // procurar o problema no lugar errado.
        expect(disponibilidadeNaoInformadoNotice()).toContain('não dá para dizer');
        expect(disponibilidadeNaoInformadoNotice()).toContain('não conseguiu montar');
    });
});

describe('o horizonte do uso — idade da medição, e NUNCA poda', () => {
    const DESDE = Date.UTC(2026, 7, 1);

    it('a chave é lida pelo mesmo `estadoDaFonte` dos avisos do topo', () => {
        expect(FONTE_DO_HORIZONTE_DE_USO).toBe('usoDesde');
        expect(estadoDaFonte({
            desde: DESDE, horizonte: { usoDesde: DESDE - 1 }, chave: FONTE_DO_HORIZONTE_DE_USO,
        })).toBe(HORIZONTE.COBRE);
        expect(estadoDaFonte({
            desde: DESDE, horizonte: { usoDesde: DESDE + 86400000 },
            chave: FONTE_DO_HORIZONTE_DE_USO,
        })).toBe(HORIZONTE.ENCURTADO);
        expect(estadoDaFonte({
            desde: DESDE, horizonte: { usoDesde: null }, chave: FONTE_DO_HORIZONTE_DE_USO,
        })).toBe(HORIZONTE.VAZIO);
        expect(estadoDaFonte({
            desde: DESDE, horizonte: {}, chave: FONTE_DO_HORIZONTE_DE_USO,
        })).toBe(HORIZONTE.DESCONHECIDO);
    });

    it('o que COBRE não diz nada, e é o que impede o aviso de virar ruído', () => {
        expect(usoHorizonteNotice(HORIZONTE.COBRE, { janela: '30d' })).toBe('');
    });

    it('o ENCURTADO fala de IDADE DA MEDIÇÃO, e nunca de histórico apagado', () => {
        const frase = usoHorizonteNotice(HORIZONTE.ENCURTADO, {
            alcance: Date.UTC(2026, 7, 20), janela: '30d', timeZone: 'UTC',
        });
        expect(frase).toContain('20/08/2026');
        expect(frase).toContain('nos últimos 30 dias');
        expect(frase).toContain('idade da medição');
        // A PALAVRA DE PODA NÃO PODE APARECER: ela mandaria procurar um expurgo que não houve.
        expect(frase).not.toMatch(/apagad|podad/i);
    });

    it('o VAZIO diz que nenhum navegador relatou, e não que ninguém usou', () => {
        const frase = usoHorizonteNotice(HORIZONTE.VAZIO, { janela: '7d' });
        expect(frase).toContain('Nenhum navegador relatou');
        expect(frase).not.toMatch(/apagad|podad/i);
    });

    it('o DESCONHECIDO é o servidor de versão anterior, e não afirma nada', () => {
        const frase = usoHorizonteNotice(HORIZONTE.DESCONHECIDO, { janela: '90d' });
        expect(frase).toContain('não informou');
        expect(frase).toContain('não dá para afirmar');
    });

    it('a ressalva das quatro seções diz que todo número é um PISO, e por quê', () => {
        const frase = usoDoProdutoHint();
        expect(frase).toContain('PISO');
        expect(frase).toContain('sem fila');
        expect(sessoesInformado({})).toBe(true);
        expect(sessoesInformado(undefined)).toBe(false);
        expect(sessoesNaoInformadoNotice()).toContain('não dá para dizer');
        expect(sessoesNaoInformadoNotice()).toContain('não conseguiu montar');
    });
});

describe('periodoSemMovimento — a sessão entra na conta', () => {
    const PARADO = {
        atlas: { criados: 0, excluidos: 0 },
        pessoas: { novasContas: 0, entraram: 0 },
        producao: { total: 0 },
    };

    it('continua PARADO quando não houve sessão nenhuma', () => {
        expect(periodoSemMovimento(PARADO)).toBe(true);
        expect(periodoSemMovimento({ ...PARADO, sessoes: { total: 0 } })).toBe(true);
    });

    it('NÃO é parado quando houve sessão, mesmo sem produção nem login', () => {
        // É o caso do visitante anônimo: os cinco números antigos ficam em zero, e a única coisa
        // que aconteceu no período está justamente nas quatro seções novas.
        expect(periodoSemMovimento({ ...PARADO, sessoes: { total: 12 } })).toBe(false);
    });

    it('servidor de versão anterior (sem `sessoes`) não muda nada', () => {
        expect(periodoSemMovimento(PARADO)).toBe(true);
        expect(periodoSemMovimento({ ...PARADO, producao: { total: 1 } })).toBe(false);
    });
});
