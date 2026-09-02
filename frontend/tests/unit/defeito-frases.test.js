// Path: tests/unit/defeito-frases.test.js

/**
 * @fileoverview A LÓGICA PURA da seção "Defeitos" da aba Diagnóstico: o vocabulário do ciclo de
 * vida, quais atos cada estado oferece, o tempo relativo, a ordem da lista, as duas contas de
 * "novo" e a saúde por release.
 *
 * `defeito-phrases.js` é folha de ZERO IMPORTS, e por isso tudo aqui roda em node puro. O que fica
 * de fora é o DOM e a rede, presos estruturalmente em `diagnostico-secoes-de-log.test.js`.
 *
 * OS CONTROLES NEGATIVOS desta suíte, isto é, o que ficaria vermelho se o código voltasse ao
 * óbvio:
 *
 *   1. **`acoesDoEstado` devolvendo tudo sempre.** É a forma que parece inofensiva ("deixa a
 *      pessoa decidir") e não é: oferecer "Resolver" num defeito já resolvido, e oferecer
 *      qualquer transição a partir de um estado que este build não conhece, é escrever por cima
 *      de um ciclo de vida que a tela não entende. A asserção mede os quatro estados e o
 *      desconhecido.
 *   2. **`ordenarDefeitos` por contagem.** É a ordem "natural" (o mais frequente primeiro) e é
 *      exatamente o pódio sobre amostra alheia: o servidor corta por `ultima_em DESC LIMIT 50`, e
 *      a contagem é VITALÍCIA. O caso do defeito de 90 relatos que é o mais ANTIGO dos dois
 *      reprova a inversão.
 *   3. **`ehNovo` sem marca tratando tudo como novo.** Sem `localStorage` (primeira visita, janela
 *      privativa, dados limpos) o `null` marcaria a lista inteira, que é o alarme que ensina a
 *      ignorar alarme.
 *   4. **`navegadorLabel` perguntando por Chrome antes de Edge.** O Edge diz `Chrome` na própria
 *      string, e o Chrome diz `Safari`: a ordem dos testes É o contrato, e inverter dois deles
 *      classifica todo Edge como Chrome sem nada ficar vermelho, a não ser aqui.
 *   5. **`saudeDasReleases` contando "novos" por `ultimaRelease`.** A pergunta do cartão é o que
 *      ESTA build trouxe, e um defeito que nasceu três builds atrás e continua ocorrendo não é
 *      novidade dela; contar pelo avistamento mais recente faria toda release parecer culpada por
 *      tudo o que ainda dói.
 */

import { describe, it, expect } from 'vitest';
import {
    ACAO,
    COLUNAS,
    ESTADOS,
    ESTADO_DE_DEFEITO,
    FILTRO_TODOS,
    NUMEROS_DA_SAUDE,
    ORIGENS,
    PAGINAS,
    TETO_DE_RELEASES,
    acaoEmVooLabel,
    acaoFalhaNotice,
    acaoLabel,
    acaoSucessoNotice,
    acoesDoEstado,
    buildNoArLabel,
    contagemNotice,
    contarNovos,
    defeitosEmptyNotice,
    defeitosFiltradosEmptyNotice,
    ehNovo,
    escopoNotice,
    estadoAlvoDaAcao,
    estadoDescricao,
    estadoLabel,
    estadoTom,
    filtroNovosHint,
    janelaEmVooNotice,
    navegadorLabel,
    novoChipTitulo,
    novosDesdeNotice,
    ocorrenciasTitulo,
    ordenarDefeitos,
    origemLabel,
    pilhaBrutaResumo,
    primeiraVisitaNotice,
    releaseLabel,
    releasesDetalhe,
    releasesDoDefeito,
    resolucaoNotice,
    rotaEStatusLabel,
    saudeDasReleases,
    sessaoCurta,
    temFiltroAtivo,
    tempoRelativo,
    textoDeMigalhaLabel,
    tipoDeMigalhaLabel,
} from '../../src/js/admin/defeito-phrases.js';

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;

describe('o vocabulário do ciclo de vida', () => {
    it('são QUATRO estados, na ordem do ciclo de vida e não alfabética', () => {
        // A ordem é a mesma do espelho do servidor (`estados-de-defeito.js`) e do CHECK: onde todo
        // defeito nasce, os dois desfechos humanos, e o que só a máquina escreve.
        expect(ESTADOS.map((e) => e.valor)).toEqual([
            'aberto', 'resolvido', 'ignorado', 'regrediu',
        ]);
        expect(Object.values(ESTADO_DE_DEFEITO).sort())
            .toEqual(['aberto', 'ignorado', 'regrediu', 'resolvido']);
    });

    it('o rótulo do estado desconhecido sai por ele mesmo, e não como travessão', () => {
        // Um valor que o servidor inventou depois deste build ainda LOCALIZA a linha; apagá-lo
        // esconderia justamente a novidade.
        expect(estadoLabel('aberto')).toBe('Aberto');
        expect(estadoLabel('regrediu')).toBe('Regrediu');
        expect(estadoLabel('adormecido')).toBe('adormecido');
        expect(estadoLabel('')).toBe('Sem estado');
        expect(estadoLabel(undefined)).toBe('Sem estado');
        expect(estadoLabel(42)).toBe('Sem estado');
    });

    it('o tom do desconhecido é PRÓPRIO: ele não herda a cor de um estado conhecido', () => {
        // Mesma decisão de `faixaEstado` e `estadoDaLatencia`: pintar de verde um estado que
        // ninguém classificou afirmaria conserto sobre um valor que este build não entende.
        expect(estadoTom('aberto')).toBe('aberto');
        expect(estadoTom('resolvido')).toBe('resolvido');
        expect(estadoTom('ignorado')).toBe('ignorado');
        expect(estadoTom('regrediu')).toBe('regrediu');
        expect(estadoTom('adormecido')).toBe('desconhecido');
        expect(estadoTom(undefined)).toBe('desconhecido');
        // E os cinco são DISTINTOS: quatro cores iguais não separariam nada.
        const tons = new Set(ESTADOS.map((e) => e.tom));
        expect(tons.size).toBe(4);
        expect(tons.has('desconhecido')).toBe(false);
    });

    it('a descrição separa `ignorado` de `resolvido`, que é o par que se confunde', () => {
        expect(estadoDescricao('ignorado')).toContain('nada move');
        expect(estadoDescricao('resolvido')).toContain('regressão');
        expect(estadoDescricao('adormecido')).toContain('não conhece');
    });
});

describe('acoesDoEstado — o que cada estado oferece', () => {
    it('aberto e regrediu oferecem os MESMOS dois: uma regressão é um defeito aberto com história', () => {
        expect(acoesDoEstado('aberto')).toEqual([ACAO.RESOLVER, ACAO.IGNORAR]);
        expect(acoesDoEstado('regrediu')).toEqual([ACAO.RESOLVER, ACAO.IGNORAR]);
    });

    it('resolvido e ignorado oferecem só o caminho de volta', () => {
        expect(acoesDoEstado('resolvido')).toEqual([ACAO.REABRIR]);
        expect(acoesDoEstado('ignorado')).toEqual([ACAO.REABRIR]);
    });

    it('CONTROLE NEGATIVO 1: o estado desconhecido não oferece transição nenhuma', () => {
        // Oferecer os três atos aqui é escrever por cima de um ciclo de vida que a tela não
        // entende, e é a forma que parece generosa.
        expect(acoesDoEstado('adormecido')).toEqual([]);
        expect(acoesDoEstado(undefined)).toEqual([]);
        expect(acoesDoEstado(null)).toEqual([]);
    });

    it('cada ato leva o estado que o PATCH pede, e o inexistente devolve null', () => {
        // A string do corpo sai do vocabulário, e não do sítio do clique: literal espalhada é o
        // erro de digitação que o CHECK do banco só acusa em produção.
        expect(estadoAlvoDaAcao(ACAO.RESOLVER)).toBe('resolvido');
        expect(estadoAlvoDaAcao(ACAO.IGNORAR)).toBe('ignorado');
        expect(estadoAlvoDaAcao(ACAO.REABRIR)).toBe('aberto');
        expect(estadoAlvoDaAcao('apagar')).toBeNull();
        expect(estadoAlvoDaAcao(undefined)).toBeNull();
    });

    it('o rótulo e a frase do voo existem para os três, e degradam sem inventar', () => {
        expect(acaoLabel(ACAO.RESOLVER)).toBe('Resolver');
        expect(acaoLabel('apagar')).toBe('');
        expect(acaoEmVooLabel(ACAO.IGNORAR)).toBe('Marcando como ignorado…');
        expect(acaoEmVooLabel('apagar')).toBe('Enviando…');
    });
});

describe('o que o toast diz DEPOIS da resposta', () => {
    it('o desfecho é lido do item devolvido, e o resolvido nomeia release e commit', () => {
        // O SERVIDOR CARIMBA `resolvido_na_release` SOZINHO, e é ela que decide a regressão
        // seguinte: anunciar o pedido esconderia o campo que governa a transição.
        expect(acaoSucessoNotice({
            estado: 'resolvido', resolvidoNaRelease: '2.1+ab12cd', resolvidoNoCommit: 'ab12cd3',
        })).toBe('Defeito marcado como resolvido na release 2.1+ab12cd, commit ab12cd3.');
    });

    it('sem release e sem commit a frase encurta, e não escreve "undefined"', () => {
        const texto = acaoSucessoNotice({ estado: 'resolvido' });
        expect(texto).toBe('Defeito marcado como resolvido.');
        expect(texto).not.toContain('undefined');
        expect(texto).not.toContain('null');
    });

    it('os outros estados saem pelo próprio nome, o desconhecido inclusive', () => {
        expect(acaoSucessoNotice({ estado: 'ignorado' })).toBe('Defeito marcado como ignorado.');
        expect(acaoSucessoNotice({ estado: 'aberto' })).toBe('Defeito marcado como aberto.');
        expect(acaoSucessoNotice({})).toBe('Defeito marcado como sem estado.');
        expect(acaoSucessoNotice(null)).toBe('Defeito marcado como sem estado.');
    });

    it('a falha nomeia o ato, e degrada para uma frase que ainda faz sentido', () => {
        expect(acaoFalhaNotice(ACAO.RESOLVER)).toBe('Não foi possível resolver este defeito.');
        expect(acaoFalhaNotice('apagar')).toBe('Não foi possível mudar o estado deste defeito.');
    });
});

describe('os vocabulários de origem e de página', () => {
    it('são as ONZE origens do CHECK, com `servidor` por último', () => {
        // As dez primeiras dizem por qual porta o erro entrou no coletor DO NAVEGADOR; a décima
        // primeira diz que não houve navegador nenhum, e é o filtro que separa as duas metades.
        expect(ORIGENS).toHaveLength(11);
        expect(ORIGENS.map((o) => o.valor)).toEqual([
            'boot', 'nao-tratado', 'rejeicao', 'console', 'store', 'ws', 'maplibre', 'cesium',
            'sv360', 'indisponivel', 'servidor',
        ]);
    });

    it('a origem AUSENTE tem nome próprio, e não travessão', () => {
        // A maior parte das linhas antigas tem `origem` nula (o cliente não declarava o campo), e
        // chamar isso de "sem dado" faria a coluna parecer quebrada na maior parte da tabela.
        expect(origemLabel('sv360')).toBe('360');
        expect(origemLabel('servidor')).toBe('Servidor');
        expect(origemLabel(null)).toBe('Não declarada');
        expect(origemLabel('')).toBe('Não declarada');
        // Origem que este build não conhece sai por ela mesma, para a novidade aparecer.
        expect(origemLabel('webgpu')).toBe('webgpu');
    });

    it('as páginas do filtro são as QUATRO do produto', () => {
        expect(PAGINAS.map((p) => p.valor)).toEqual([
            'index.html', 'atlas.html', 'admin.html', 'calibracao.html',
        ]);
    });

    it('o valor de "todos" é a string vazia, que é o que um select devolve', () => {
        expect(FILTRO_TODOS).toBe('');
    });
});

describe('tempoRelativo', () => {
    const agora = Date.UTC(2026, 8, 2, 12, 0, 0);

    it('as fronteiras estão onde a documentação diz, e o singular concorda', () => {
        expect(tempoRelativo(agora, agora)).toBe('agora mesmo');
        expect(tempoRelativo(agora - 44_999, agora)).toBe('agora mesmo');
        expect(tempoRelativo(agora - 45_000, agora)).toBe('há 1 minuto');
        expect(tempoRelativo(agora - 2 * MINUTO, agora)).toBe('há 2 minutos');
        expect(tempoRelativo(agora - 59 * MINUTO, agora)).toBe('há 59 minutos');
        // AS FRONTEIRAS SÃO 60 MIN E 24 H, e não 90 e 36: com as maiores, o singular de hora e o
        // de dia ficavam INALCANÇÁVEIS (90 minutos já arredondam para duas horas, e 36 horas para
        // dois dias), ou seja, dois ramos de concordância que nenhuma entrada exercitava. Foi
        // este caso que os achou, ao pedir "há 1 hora" e receber "há 60 minutos".
        expect(tempoRelativo(agora - 60 * MINUTO, agora)).toBe('há 1 hora');
        expect(tempoRelativo(agora - 89 * MINUTO, agora)).toBe('há 1 hora');
        expect(tempoRelativo(agora - 2 * HORA, agora)).toBe('há 2 horas');
        expect(tempoRelativo(agora - 23 * HORA, agora)).toBe('há 23 horas');
        expect(tempoRelativo(agora - 24 * HORA, agora)).toBe('há 1 dia');
        expect(tempoRelativo(agora - 36 * HORA, agora)).toBe('há 2 dias');
        expect(tempoRelativo(agora - 7 * DIA, agora)).toBe('há 7 dias');
    });

    it('a data no futuro é DITA, e não arredondada para "agora mesmo"', () => {
        // Ela significa relógio de cliente adiantado, que é informação de diagnóstico. A folga de
        // um minuto absorve o desencontro banal entre o relógio do servidor e o do navegador.
        expect(tempoRelativo(agora + 30_000, agora)).toBe('agora mesmo');
        expect(tempoRelativo(agora + 5 * MINUTO, agora)).toBe('com data no futuro');
    });

    it('recebe NÚMEROS e nada mais: qualquer outra coisa vira vazio, nunca 1970', () => {
        // Este arquivo não parseia data (ver o `@fileoverview` dele). Uma string de epoch aqui
        // viraria `NaN` numa aritmética e "há NaN dias" na tela.
        for (const v of ['1788119395550', '', null, undefined, NaN, Infinity, {}]) {
            expect(tempoRelativo(v, agora)).toBe('');
            expect(tempoRelativo(agora, v)).toBe('');
        }
    });
});

describe('ordenarDefeitos', () => {
    it('CONTROLE NEGATIVO 2: a ordem é por RECÊNCIA, e não pela contagem', () => {
        // ORDENAR POR UM CRITÉRIO E CORTAR POR OUTRO É UM PÓDIO SOBRE AMOSTRA ALHEIA. O servidor
        // devolve as cinquenta mais recentes (`ORDER BY d.ultima_em DESC LIMIT 50`), e a contagem
        // é VITALÍCIA: o item de 90 relatos aqui é o mais ANTIGO dos dois, e a ordem por contagem
        // o poria em cima como se ele fosse o defeito do período.
        const entrada = [
            { id: '1', ocorrencias: 90, ultimaEm: 1000 },
            { id: '2', ocorrencias: 2, ultimaEm: 2000 },
        ];
        expect(ordenarDefeitos(entrada).map((i) => i.id)).toEqual(['2', '1']);
        // NÃO MUTA a entrada.
        expect(entrada.map((i) => i.id)).toEqual(['1', '2']);
    });

    it('empatados no instante, a contagem desempata, e depois o id (ordem estável)', () => {
        const entrada = [
            { id: 'c', ocorrencias: 5, ultimaEm: 2000 },
            { id: 'a', ocorrencias: 5, ultimaEm: 2000 },
            { id: 'b', ocorrencias: 900, ultimaEm: 2000 },
        ];
        expect(ordenarDefeitos(entrada).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    });

    it('item sem data cai para o FIM, e não para o topo por acidente aritmético', () => {
        const entrada = [
            { id: 'x', ocorrencias: 4000 },
            { id: 'y', ocorrencias: 1, ultimaEm: 2000 },
        ];
        expect(ordenarDefeitos(entrada).map((i) => i.id)).toEqual(['y', 'x']);
    });

    it('entrada que não é lista não explode, e linha malformada não derruba a ordem', () => {
        for (const v of [null, undefined, {}, 'x']) expect(ordenarDefeitos(v)).toEqual([]);
        expect(ordenarDefeitos([null, { id: 'a', ultimaEm: 5 }, undefined])).toHaveLength(3);
    });
});

describe('as DUAS palavras "novo", e a que depende da última visita', () => {
    const marca = Date.UTC(2026, 8, 1, 9, 0, 0);

    it('CONTROLE NEGATIVO 3: sem marca NADA é novo, e não tudo', () => {
        // Primeira visita, janela privativa ou dados limpos: o `null` marcaria a lista inteira,
        // que é o alarme que ensina a ignorar alarme.
        expect(ehNovo({ primeiraEm: marca + 1000 }, null)).toBe(false);
        expect(ehNovo({ primeiraEm: marca + 1000 }, undefined)).toBe(false);
        expect(ehNovo({ primeiraEm: marca + 1000 }, NaN)).toBe(false);
        expect(contarNovos([{ primeiraEm: marca + DIA }, { primeiraEm: marca + DIA }], null)).toBe(0);
        // E a contagem usa o MESMO predicado: com marca, os dois de cima contam.
        expect(contarNovos([{ primeiraEm: marca + DIA }, { primeiraEm: marca - DIA }], marca)).toBe(1);
    });

    it('novo é quem NASCEU depois da marca, com a MESMA folga de relógio de tempoRelativo', () => {
        // A FOLGA É DE UM MINUTO, e não zelo: `primeiraEm` vem do relógio do SERVIDOR e a marca do
        // `Date.now()` do NAVEGADOR. Sem ela, um desencontro banal entre os dois faz a linha que a
        // pessoa acabou de ler reaparecer marcada como novidade na visita seguinte, e o alarme que
        // reaparece sozinho é o que ensina a ignorar alarme. Ela erra para o lado de NÃO marcar,
        // que é o mesmo lado da marca ausente.
        expect(ehNovo({ primeiraEm: marca + MINUTO + 1 }, marca)).toBe(true);
        expect(ehNovo({ primeiraEm: marca + MINUTO }, marca)).toBe(false);
        expect(ehNovo({ primeiraEm: marca + 30_000 }, marca)).toBe(false);
        expect(ehNovo({ primeiraEm: marca + 1 }, marca)).toBe(false);
        expect(ehNovo({ primeiraEm: marca }, marca)).toBe(false);
        expect(ehNovo({ primeiraEm: marca - 1 }, marca)).toBe(false);
        // Defeito ANTIGO que disparou agora NÃO é novo: a conta é sobre `primeiraEm`, e é essa a
        // diferença entre "apareceu" e "voltou".
        expect(ehNovo({ primeiraEm: marca - DIA, ultimaEm: marca + 2 * DIA }, marca)).toBe(false);
        expect(ehNovo({}, marca)).toBe(false);
        expect(ehNovo(null, marca)).toBe(false);
    });

    it('a contagem sai por extenso, concorda no singular e o ZERO tem frase própria', () => {
        // Zero não é silêncio: "nenhum defeito novo" é a boa notícia que a pessoa veio buscar, e
        // calar faria a ausência do selo parecer marca que não carregou.
        expect(novosDesdeNotice(0, '01/09/2026, 09:00'))
            .toBe('Nenhum defeito novo desde a sua última visita, em 01/09/2026, 09:00.');
        expect(novosDesdeNotice(1, '01/09/2026, 09:00'))
            .toBe('1 defeito apareceu pela primeira vez desde a sua última visita, em 01/09/2026, 09:00.');
        expect(novosDesdeNotice(3, '01/09/2026, 09:00'))
            .toContain('3 defeitos apareceram pela primeira vez');
        // Sem a data formatada a frase continua gramatical, e sem "undefined".
        expect(novosDesdeNotice(2)).toBe('2 defeitos apareceram pela primeira vez desde a sua última visita.');
        expect(novosDesdeNotice(2)).not.toContain('undefined');
        expect(novosDesdeNotice(undefined)).toBe('');
        expect(novosDesdeNotice(-1)).toBe('');
    });

    it('as duas contas se declaram diferentes na tela, e não só no comentário', () => {
        // O FILTRO é da JANELA e o SELO é da última visita. As duas frases precisam nomear a
        // própria conta, senão a pessoa lê uma como a outra e as duas ficam erradas em metade dos
        // casos.
        expect(filtroNovosHint()).toContain('JANELA');
        expect(filtroNovosHint()).toContain('última visita');
        expect(novoChipTitulo('01/09/2026')).toContain('última visita');
        expect(novoChipTitulo('01/09/2026')).toContain('01/09/2026');
        expect(novoChipTitulo()).not.toContain('undefined');
        expect(primeiraVisitaNotice()).toContain('primeira visita');
    });
});

describe('a saúde por release', () => {
    const itens = [
        { id: '1', primeiraRelease: 'v3', ultimaRelease: 'v3', estado: 'aberto', ultimaEm: 500 },
        { id: '2', primeiraRelease: 'v2', ultimaRelease: 'v3', estado: 'regrediu', ultimaEm: 400 },
        { id: '3', primeiraRelease: 'v2', ultimaRelease: 'v2', estado: 'resolvido', ultimaEm: 300 },
        { id: '4', primeiraRelease: 'v1', ultimaRelease: 'v1', estado: 'aberto', ultimaEm: 200 },
        { id: '5', primeiraRelease: 'v0', ultimaRelease: 'v0', estado: 'aberto', ultimaEm: 100 },
    ];

    it('CONTROLE NEGATIVO 5: "novos" é `primeiraRelease`, e não o avistamento mais recente', () => {
        // A pergunta do cartão é o que ESTA build trouxe. O defeito 2 nasceu na v2 e ainda ocorre
        // na v3: ele conta como REGRESSÃO da v3 e como novo da v2, nunca como novo da v3.
        const saude = saudeDasReleases(itens);
        const v3 = saude.find((r) => r.release === 'v3');
        expect(v3).toEqual({ release: 'v3', defeitos: 2, novos: 1, regressoes: 1, ultimaEm: 500 });
    });

    it('as colunas são independentes: um defeito pode entrar em duas', () => {
        const saude = saudeDasReleases([
            { primeiraRelease: 'v9', ultimaRelease: 'v9', estado: 'regrediu', ultimaEm: 10 },
        ]);
        expect(saude[0]).toMatchObject({ defeitos: 1, novos: 1, regressoes: 1 });
    });

    it('a ordem é por avistamento mais recente, e o teto é de TRÊS', () => {
        // Nome de release não é ordenável (é "versão+hash"), então a única ordem que o payload
        // sustenta é a do relógio.
        expect(TETO_DE_RELEASES).toBe(3);
        expect(saudeDasReleases(itens).map((r) => r.release)).toEqual(['v3', 'v2', 'v1']);
        expect(saudeDasReleases(itens, { limite: 2 }).map((r) => r.release)).toEqual(['v3', 'v2']);
        // Teto inválido cai no padrão em vez de devolver lista vazia ou a lista inteira.
        expect(saudeDasReleases(itens, { limite: 0 })).toHaveLength(3);
        expect(saudeDasReleases(itens, { limite: NaN })).toHaveLength(3);
    });

    it('defeito sem release não inventa um grupo, e entrada inválida devolve lista vazia', () => {
        expect(saudeDasReleases([{ estado: 'aberto', ultimaEm: 1 }])).toEqual([]);
        expect(saudeDasReleases([{ ultimaRelease: '   ', ultimaEm: 1 }])).toEqual([]);
        for (const v of [null, undefined, {}, 'x']) expect(saudeDasReleases(v)).toEqual([]);
    });

    it('o cartão NÃO repete a palavra "novo", que já significa duas coisas nesta tela', () => {
        // TERCEIRO SENTIDO PARA A MESMA PALAVRA NA MESMA TELA (o filtro é da janela, o selo da
        // linha é da última visita, e este seria da BUILD) é a ambiguidade que ninguém percebe
        // estar cometendo: a pessoa lê o número do cartão como se fosse a contagem do selo.
        expect(NUMEROS_DA_SAUDE.map((n) => n.campo)).toEqual(['novos', 'regressoes', 'defeitos']);
        const nascidos = NUMEROS_DA_SAUDE[0];
        expect(nascidos.rotulo).toBe('nascidos aqui');
        expect(nascidos.rotulo).not.toMatch(/novo/i);
        // E o `title` diz a conta inteira, nomeando as outras duas para quem parar em cima.
        expect(nascidos.titulo).toContain('PRIMEIRA');
        expect(nascidos.titulo).toContain('última visita');
        // Os três têm rótulo e explicação, e nenhuma explicação é vazia.
        for (const n of NUMEROS_DA_SAUDE) {
            expect(n.rotulo.length, n.campo).toBeGreaterThan(3);
            expect(n.titulo.length, n.campo).toBeGreaterThan(40);
        }
        // O `campo` casa com o que `saudeDasReleases` devolve, senão o rótulo descreveria outro
        // número: é isso que o amarra ao dado em vez de à ordem em que alguém escreveu os três.
        const linha = saudeDasReleases([
            { primeiraRelease: 'v1', ultimaRelease: 'v1', estado: 'regrediu', ultimaEm: 1 },
        ])[0];
        for (const n of NUMEROS_DA_SAUDE) expect(linha[n.campo], n.campo).toBe(1);
    });

    it('a build no ar nomeia a ausência em voz alta, em vez de calar', () => {
        // `null` é estado legítimo e declarado: a rota manda `release: null` quando a instalação
        // não carimbou `EBGEO_RELEASE`, e a ausência do rótulo se leria como dado que não chegou.
        expect(buildNoArLabel('2.1+ab12cd')).toBe('Build no ar: 2.1+ab12cd');
        expect(buildNoArLabel(null)).toBe('Esta instalação não declarou qual build está no ar.');
        expect(buildNoArLabel('   ')).toBe('Esta instalação não declarou qual build está no ar.');
        expect(buildNoArLabel(undefined)).not.toContain('undefined');
    });
});

describe('as releases de um defeito', () => {
    it('a seta só aparece quando as duas pontas divergem', () => {
        // Nascido e ainda vivo na mesma build é um defeito DESTA build; nascido três builds atrás
        // é dívida. Uma seta que apontasse para o mesmo lugar seria ruído em toda linha recente.
        expect(releasesDoDefeito({ primeiraRelease: 'v1', ultimaRelease: 'v2' })).toBe('v1 → v2');
        expect(releasesDoDefeito({ primeiraRelease: 'v1', ultimaRelease: 'v1' })).toBe('v1');
        expect(releasesDoDefeito({ primeiraRelease: 'v1' })).toBe('v1');
        expect(releasesDoDefeito({ ultimaRelease: 'v2' })).toBe('v2');
        expect(releasesDoDefeito({})).toBe('');
        expect(releasesDoDefeito(null)).toBe('');
    });

    it('o detalhe explica a coluna sem escrever "undefined"', () => {
        expect(releasesDetalhe({ primeiraRelease: 'v1', ultimaRelease: 'v2' }))
            .toBe('Visto pela primeira vez na v1 e pela última na v2.');
        expect(releasesDetalhe({ ultimaRelease: 'v2' })).toBe('Visto só na v2.');
        expect(releasesDetalhe({})).toBe('Nenhuma das ocorrências declarou a build.');
        expect(releasesDetalhe({})).not.toContain('undefined');
    });

    it('releaseLabel apara e recusa o que não é texto', () => {
        expect(releaseLabel('  v1 ')).toBe('v1');
        expect(releaseLabel(null)).toBe('');
        expect(releaseLabel(3)).toBe('');
    });
});

describe('a nota de resolução da linha', () => {
    it('nomeia quem, quando, em que release e em que commit, e concatena o que existe', () => {
        expect(resolucaoNotice({
            estado: 'resolvido',
            resolvidoPorUsername: 'diniz',
            resolvidoNaRelease: 'v2',
            resolvidoNoCommit: 'abc1234',
        }, '01/09/2026, 09:00:00'))
            .toBe('Resolvido por diniz, em 01/09/2026, 09:00:00, na release v2, commit abc1234.');
        expect(resolucaoNotice({ estado: 'resolvido', resolvidoNaRelease: 'v2' }))
            .toBe('Resolvido, na release v2.');
    });

    it('ela também sai no REGREDIU, que é o estado em que ela mais importa', () => {
        // O defeito voltou DEPOIS de alguém afirmar que consertou: saber em qual release foi o
        // conserto é a primeira pergunta diante de uma regressão.
        expect(resolucaoNotice({ estado: 'regrediu', resolvidoNaRelease: 'v1' }))
            .toBe('Resolvido, na release v1.');
    });

    it('não fala sobre quem nunca foi resolvido, nem quando não há o que dizer', () => {
        expect(resolucaoNotice({ estado: 'aberto', resolvidoNaRelease: 'v2' })).toBe('');
        expect(resolucaoNotice({ estado: 'ignorado' })).toBe('');
        expect(resolucaoNotice({ estado: 'resolvido' })).toBe('');
        expect(resolucaoNotice(null)).toBe('');
    });
});

describe('os rótulos da gaveta de ocorrências', () => {
    it('CONTROLE NEGATIVO 4: a ORDEM dos testes de navegador é o contrato', () => {
        // O Edge diz `Chrome` na própria string, e o Chrome diz `Safari`. Perguntar por Chrome
        // antes de Edge classifica todo Edge como Chrome, e nada mais no produto acusaria isso.
        const edge = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
        const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) '
            + 'Chrome/128.0.0.0 Safari/537.36';
        const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
            + '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
        expect(navegadorLabel(edge)).toBe('Edge');
        expect(navegadorLabel(chrome)).toBe('Chrome');
        expect(navegadorLabel(safari)).toBe('Safari');
        expect(navegadorLabel('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0'))
            .toBe('Firefox');
        expect(navegadorLabel('curl/8.4.0')).toBe('outro navegador');
        expect(navegadorLabel('')).toBe('navegador não declarado');
        expect(navegadorLabel(null)).toBe('navegador não declarado');
    });

    it('o id da aba sai curto, e o vazio não vira reticências', () => {
        expect(sessaoCurta('0189d4c2-4b2f-7a1e-9c33-2f6d1b8e0a55')).toBe('0189d4c2');
        expect(sessaoCurta('abc')).toBe('abc');
        expect(sessaoCurta('')).toBe('');
        expect(sessaoCurta(null)).toBe('');
    });

    it('rota e status só saem juntos quando existem, e o status é um código HTTP de verdade', () => {
        expect(rotaEStatusLabel({ rota: 'GET /api/v1/atlas', statusCode: 500 }))
            .toBe('GET /api/v1/atlas · 500');
        expect(rotaEStatusLabel({ rota: 'GET /x' })).toBe('GET /x');
        expect(rotaEStatusLabel({ statusCode: 503 })).toBe('503');
        for (const s of [99, 600, 200.5, '500', null]) {
            expect(rotaEStatusLabel({ statusCode: s })).toBe('');
        }
        expect(rotaEStatusLabel({})).toBe('');
        expect(rotaEStatusLabel(null)).toBe('');
    });

    it('o título das ocorrências diz o TETO em voz alta, e concorda no singular', () => {
        // Vinte ocorrências ao lado de um crachá de nove mil relatos se leria como lista cortada
        // por uma consulta que alguém pode alargar; o teto é da ESCRITA, e não há próxima página.
        expect(ocorrenciasTitulo(1)).toContain('1 ocorrência guardada');
        expect(ocorrenciasTitulo(20)).toContain('20 ocorrências guardadas');
        expect(ocorrenciasTitulo(20)).toContain('20 últimas');
        expect(ocorrenciasTitulo(undefined)).toBe('Ocorrências guardadas');
    });

    it('a migalha malformada não vira "undefined" na trilha', () => {
        expect(tipoDeMigalhaLabel({ tipo: 'api' })).toBe('api');
        expect(tipoDeMigalhaLabel({})).toBe('sem tipo');
        expect(textoDeMigalhaLabel({ texto: ' GET /x 200 5ms ' })).toBe('GET /x 200 5ms');
        expect(textoDeMigalhaLabel({})).toBe('sem texto');
        expect(textoDeMigalhaLabel(null)).toBe('sem texto');
    });
});

describe('os dois vazios da seção, e o que a tela declara sobre si', () => {
    it('o vazio COM filtro não afirma saúde: ele diz que a pergunta está estreita', () => {
        expect(defeitosEmptyNotice('nas últimas 24 horas'))
            .toBe('Nenhum defeito nas últimas 24 horas.');
        expect(defeitosFiltradosEmptyNotice('nas últimas 24 horas'))
            .toBe('Nenhum defeito nas últimas 24 horas para os filtros escolhidos.');
    });

    it('temFiltroAtivo decide qual dos dois, e a release em branco NÃO conta como filtro', () => {
        expect(temFiltroAtivo({})).toBe(false);
        expect(temFiltroAtivo({ estado: '', origem: '', release: '   ', pagina: '', novos: false }))
            .toBe(false);
        expect(temFiltroAtivo({ estado: 'aberto' })).toBe(true);
        expect(temFiltroAtivo({ release: ' v1 ' })).toBe(true);
        expect(temFiltroAtivo({ novos: true })).toBe(true);
        expect(temFiltroAtivo(null)).toBe(false);
    });

    it('a tela diz onde foi parar a varredura do log, e o que o número dela significa', () => {
        // Uma seção que desaparece sem explicação comunica capacidade perdida.
        expect(escopoNotice()).toContain('npm run diag -- erros');
        expect(escopoNotice()).toContain('endereços');
        // As duas metades da honestidade do número: acumulado E relato.
        expect(contagemNotice()).toContain('acumulado');
        expect(contagemNotice()).toContain('RELATOS');
    });

    it('a recusa do seletor de janela NOMEIA o estado, e o rótulo da pilha crua existe', () => {
        // As duas nasceram de literais que moravam na tela: o `disabled` mudo do seletor virou
        // recusa falada, e o resumo do `<details>` interno era string solta em `diag-tab.js`.
        expect(janelaEmVooNotice()).toContain('lendo o servidor');
        expect(janelaEmVooNotice()).toContain('recorte anterior');
        expect(pilhaBrutaResumo()).toBe('Ver a pilha crua, antes da normalização');
    });

    it('as colunas da tabela põem estado e contagem na frente', () => {
        // As duas perguntas da escolha ("isto está aberto?" e "quantos?") são as duas primeiras.
        expect(COLUNAS[0]).toBe('Estado');
        expect(COLUNAS[1]).toBe('Relatos');
        expect(COLUNAS).toHaveLength(8);
    });
});
