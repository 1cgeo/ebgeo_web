// Path: tests/unit/resumo-frases.test.js

/**
 * @fileoverview A LÓGICA PURA da seção "Resumo" da aba Diagnóstico: os três desfechos de um bloco,
 * a premissa por fonte, o delta de p95 com sinal, a duração legível e as frases de cada cartão.
 *
 * `resumo-phrases.js` é folha de ZERO IMPORTS, e por isso tudo aqui roda em node puro. O que fica
 * de fora é o DOM e a rede, presos estruturalmente em `diagnostico-secoes-de-log.test.js`.
 *
 * OS CONTROLES NEGATIVOS desta suíte, isto é, o que ficaria vermelho se o código voltasse ao
 * óbvio:
 *
 *   1. **`desfechoDoBloco` binário.** É a forma que se escreve primeiro (`bloco ? ok : sem-fonte`)
 *      e ela colapsa o servidor que NÃO CONHECE o bloco com o que não conseguiu LER a fonte. A
 *      providência é oposta (atualizar a implantação contra olhar o log), e o caso do bloco
 *      `undefined` ao lado do bloco `{ disponivel: false }` reprova a fusão.
 *   2. **Premissa só na má notícia.** Um `if (!disponivel)` que escrevesse a premissa e um `else`
 *      que só desenhasse números devolveria a frase tranquilizadora sem procedência, que é a que
 *      mentiu por meses no comando. Os casos de `premissaDoBloco` medem as duas fontes com dado
 *      bom.
 *   3. **`parcial` esquecido.** Sem a palavra, "os que mais ocorreram" se lê como o pódio da
 *      janela, quando é o pódio DENTRE OS QUE VIERAM (a consulta corta por recência).
 *   4. **Delta sem sinal, ou com o sinal do formatador.** `latenciaLabel` recusa número negativo
 *      (devolve travessão), então delegar o módulo a ele apagaria a metade da coluna que diz
 *      "melhorou". O caso do delta negativo reprova.
 *   5. **`deltaTom` pintando de vermelho a rota sem base.** Uma rota que não existia na janela
 *      anterior não ficou infinitamente mais lenta, e alarmar ali ensina a ignorar a coluna.
 *   6. **`duracaoLegivel` devolvendo "0 s" para o campo ausente.** Zero ali afirmaria que a última
 *      amostra acabou de sair, que é a boa notícia desenhada a partir de dado que não chegou.
 *   7. **`saudeSituacaoNotice` afirmando "nada faltou" com a série curta.** Os dois primeiros
 *      ramos existem para não contar buraco quando ninguém contou nada.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    BLOCOS_DO_RESUMO,
    DELTA,
    RESUMO_DESFECHO,
    SITUACOES_DA_SERIE,
    blocoAusenteNotice,
    blocoDoPayload,
    compostoEmNotice,
    defeitosResumoNotice,
    defeitosVazioNotice,
    deltaNotice,
    deltaTom,
    deltaTruncadoNotice,
    desfechoDoBloco,
    discoNotice,
    duracaoLegivel,
    estimativaFragilNotice,
    indisponivelNotice,
    indisponivelRessalva,
    intervaloEmPalavras,
    janelaAnteriorNotice,
    maiorBuracoNotice,
    maisChamadasNotice,
    origensNotice,
    premissaDoBloco,
    queriesLentasFonteNotice,
    queriesLentasHint,
    queriesLentasNotice,
    resumoDesconhecidoNotice,
    resumoEscopoNotice,
    resumoFailureNotice,
    resumoReconhecido,
    resumoSubtitulo,
    resumoTitulo,
    rotasVaziasNotice,
    saudeSituacaoNotice,
    semFonteNotice,
    situacaoDaSerieLabel,
    statusDetalheNotice,
    statusVazioNotice,
    topoTitulo,
    totalTruncadoNotice,
    ultimaAmostraNotice,
} from '@js/admin/resumo-phrases.js';

/** Um formatador de milissegundos com a mesma recusa de negativo que `latenciaLabel` tem. */
const ms = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? `${Math.round(n)} ms` : '—');

describe('os seis cartões do resumo', () => {
    it('a lista é fechada, e "Queries lentas" aponta para o bloco de latência', () => {
        expect(BLOCOS_DO_RESUMO.map((b) => b.id)).toEqual([
            'defeitos', 'latencia', 'saude', 'indisponivel', 'status', 'queriesLentas',
        ]);
        // O CAMPO É O BLOCO DO PAYLOAD, e o único cartão em que ele diverge do id é o de queries
        // lentas: o servidor conta aquilo DENTRO do bloco de latência, e um `campo: 'queriesLentas'`
        // faria o cartão procurar um sexto bloco que não existe, caindo em "sem fonte" para sempre.
        const porId = Object.fromEntries(BLOCOS_DO_RESUMO.map((b) => [b.id, b.campo]));
        expect(porId.queriesLentas).toBe('latencia');
        for (const b of BLOCOS_DO_RESUMO) {
            if (b.id !== 'queriesLentas') expect(b.campo).toBe(b.id);
            expect(b.titulo.length).toBeGreaterThan(2);
        }
    });

    it('todo cartão tem título próprio: dois iguais fariam a grade se ler como repetição', () => {
        const titulos = BLOCOS_DO_RESUMO.map((b) => b.titulo);
        expect(new Set(titulos).size).toBe(titulos.length);
    });
});

describe('o desfecho de um bloco', () => {
    it('é TERNÁRIO: ausente, sem fonte e disponível não são dois estados', () => {
        expect(desfechoDoBloco(undefined)).toBe(RESUMO_DESFECHO.AUSENTE);
        expect(desfechoDoBloco(null)).toBe(RESUMO_DESFECHO.AUSENTE);
        expect(desfechoDoBloco({ disponivel: false, motivo: 'o banco não respondeu' }))
            .toBe(RESUMO_DESFECHO.SEM_FONTE);
        expect(desfechoDoBloco({ disponivel: true })).toBe(RESUMO_DESFECHO.DISPONIVEL);
        // `disponivel` AUSENTE não é disponível: um bloco sem o campo veio de um contrato que esta
        // tela não conhece, e desenhar números dali é afirmar sobre o que não foi declarado.
        expect(desfechoDoBloco({ novos: 3 })).toBe(RESUMO_DESFECHO.SEM_FONTE);
        // E nem a string "true" nem o 1 passam: só o booleano.
        expect(desfechoDoBloco({ disponivel: 'true' })).toBe(RESUMO_DESFECHO.SEM_FONTE);
    });

    it('o array não conta como bloco, e `typeof [] === "object"` é por que a checagem é explícita', () => {
        expect(blocoDoPayload({ defeitos: [] }, 'defeitos')).toBeNull();
        expect(blocoDoPayload([], 'defeitos')).toBeNull();
        expect(blocoDoPayload(null, 'defeitos')).toBeNull();
        expect(blocoDoPayload('texto', 'defeitos')).toBeNull();
        expect(blocoDoPayload({ defeitos: { disponivel: true } }, 'defeitos'))
            .toEqual({ disponivel: true });
    });

    it('a resposta é reconhecida por UM bloco, e zero blocos é falha e não vazio', () => {
        expect(resumoReconhecido({ saude: { disponivel: false } })).toBe(true);
        expect(resumoReconhecido({ periodo: { desde: '24h' } })).toBe(false);
        expect(resumoReconhecido({ erro: 'Not Found' })).toBe(false);
        expect(resumoReconhecido(null)).toBe(false);
        // Uma grade de seis cartões "o servidor não informou" se leria como seis fatos, quando o
        // fato é um só e é sobre a resposta inteira. Daí a frase de desconhecido ser de SEÇÃO.
        expect(resumoDesconhecidoNotice()).toMatch(/nenhum dos blocos/i);
    });

    it('as duas frases de ausência de dado são DIFERENTES, e cada uma nomeia a providência', () => {
        const ausente = blocoAusenteNotice();
        const semFonte = semFonteNotice({ motivo: 'o diretório de log não existe' });
        expect(ausente).not.toBe(semFonte);
        expect(ausente).toMatch(/implantação anterior/i);
        expect(semFonte).toContain('o diretório de log não existe');
        // A RESSALVA É DAQUI e não do servidor: sem ela um cartão vazio parece um que ainda carrega.
        expect(semFonte).toMatch(/nenhum número/i);
    });

    it('sem motivo declarado a frase ainda diz que a fonte não respondeu', () => {
        expect(semFonteNotice({ disponivel: false })).toMatch(/não respondeu/i);
        expect(semFonteNotice({ disponivel: false, motivo: '   ' })).toMatch(/não respondeu/i);
    });
});

describe('a premissa de um bloco disponível', () => {
    it('a do BANCO diz quantos de quantos, e nomeia a lista parcial', () => {
        const inteira = premissaDoBloco({
            premissa: { fonte: 'banco', vistos: 12, total: 12, parcial: false },
        });
        expect(inteira).toContain('12 defeitos de 12');
        expect(inteira).not.toMatch(/parcial/i);

        const cortada = premissaDoBloco({
            premissa: { fonte: 'banco', vistos: 50, total: 431, parcial: true },
        });
        expect(cortada).toContain('50 defeitos de 431');
        // SEM ESTA PALAVRA o topo mente: a consulta corta por recência, então os cinco maiores são
        // os cinco maiores DENTRE OS QUE VIERAM.
        expect(cortada).toMatch(/PARCIAL/);
        expect(cortada).toMatch(/dentre os que vieram/i);
    });

    it('a do ARQUIVO diz arquivos e linhas, e o singular é singular', () => {
        expect(premissaDoBloco({ premissa: { fonte: 'arquivo', arquivos: 1, linhas: 1 } }))
            .toBe('Premissa: 1 arquivo de log, 1 linha lida na janela.');
        expect(premissaDoBloco({ premissa: { fonte: 'arquivo', arquivos: 3, linhas: 402_113 } }))
            .toContain('3 arquivos de log, 402.113 linhas lidas');
        // ZERO É PLURAL em português, e é o desfecho mais comum numa instalação nova.
        expect(premissaDoBloco({ premissa: { fonte: 'arquivo', arquivos: 0, linhas: 0 } }))
            .toContain('0 arquivos de log, 0 linhas lidas');
    });

    it('premissa ausente ou incompleta DIZ isso, em vez de sumir', () => {
        expect(premissaDoBloco({ disponivel: true })).toBe('');
        expect(premissaDoBloco({ premissa: { fonte: 'banco' } })).toMatch(/não declarou/i);
        expect(premissaDoBloco({ premissa: { fonte: 'arquivo' } })).toMatch(/não declarou/i);
    });
});

describe('o cartão de defeitos', () => {
    it('conta novos e regressões, com singular, plural e zero', () => {
        expect(defeitosResumoNotice({ novos: 0, regressoes: 0 }))
            .toBe('0 defeitos novos na janela, 0 regressões.');
        expect(defeitosResumoNotice({ novos: 1, regressoes: 1 }))
            .toBe('1 defeito novo na janela, 1 regressão.');
        expect(defeitosResumoNotice({ novos: 7, regressoes: 2 }))
            .toBe('7 defeitos novos na janela, 2 regressões.');
    });

    it('campo ausente NÃO vira zero: dizer "0 novos" sobre o que não chegou inventa um fato', () => {
        expect(defeitosResumoNotice({})).toMatch(/sem contagem/i);
        expect(defeitosResumoNotice({ novos: 3 })).toBe('3 defeitos novos na janela.');
        expect(defeitosResumoNotice({ regressoes: 2 })).toBe('2 regressões.');
        expect(defeitosResumoNotice({ novos: Number.NaN })).toMatch(/sem contagem/i);
    });

    it('a origem é TERNÁRIA, e o terceiro balde é o que faz as contas fecharem', () => {
        expect(origensNotice({ servidor: 2, cliente: 5, semOrigem: 41 }))
            .toBe('Origem: 2 do servidor, 5 do navegador, 41 sem origem declarada.');
        expect(origensNotice(undefined)).toBe('');
        expect(origensNotice({ servidor: 0, cliente: 0, semOrigem: 0 }))
            .toContain('0 sem origem declarada');
    });

    it('o vazio é uma frase própria, e o subtítulo do pódio não some junto', () => {
        expect(defeitosVazioNotice()).toBe('Nenhum defeito na janela.');
        expect(topoTitulo()).toMatch(/ocorreram/i);
    });
});

describe('o delta de p95', () => {
    it('tem SINAL nos dois sentidos, e o módulo não passa negativo ao formatador', () => {
        expect(deltaNotice({ p95: 150, p95Anterior: 120, delta: 30, deltaPct: 25 }, ms))
            .toBe('150 ms (era 120 ms, +30 ms / +25%)');
        // O CONTROLE DO CASO 4: com o negativo entregue a `latenciaLabel` a saída viraria um
        // travessão, e a metade da coluna que diz "melhorou" desapareceria.
        expect(deltaNotice({ p95: 90, p95Anterior: 120, delta: -30, deltaPct: -25 }, ms))
            .toBe('90 ms (era 120 ms, -30 ms / -25%)');
        expect(deltaNotice({ p95: 120, p95Anterior: 120, delta: 0, deltaPct: 0 }, ms))
            .toBe('120 ms (era 120 ms, 0 ms / 0%)');
    });

    it('a fração vira vírgula, e o inteiro não ganha casa decimal à toa', () => {
        expect(deltaNotice({ p95: 130, p95Anterior: 100, delta: 30, deltaPct: 30.4 }, ms))
            .toContain('+30,4%');
        expect(deltaNotice({ p95: 130, p95Anterior: 100, delta: 30, deltaPct: 30 }, ms))
            .toContain('+30%');
    });

    it('sem base na janela anterior a frase NOMEIA a ausência, em vez de inventar 100%', () => {
        expect(deltaNotice({ p95: 150, p95Anterior: null, delta: null, deltaPct: null }, ms))
            .toBe('150 ms (sem base na janela anterior)');
        // E sem percentual (p95 anterior de 0 ms, que dividiria por zero) a frase fica sem a fração.
        expect(deltaNotice({ p95: 150, p95Anterior: 0, delta: 150, deltaPct: null }, ms))
            .toBe('150 ms (era 0 ms, +150 ms)');
    });

    it('sem p95 medido não há frase de comparação, e sem formatador não há frase nenhuma', () => {
        expect(deltaNotice({ p95: null, delta: 3 }, ms)).toBe('sem p95 medido');
        expect(deltaNotice({ p95: Number.NaN }, ms)).toBe('sem p95 medido');
        // SEM QUEDA PARA UMA SEGUNDA RÉGUA: a de "quando ms vira s" é a da tabela de latência, e
        // duas divergiriam na mesma tela.
        expect(deltaNotice({ p95: 150, delta: 30 }, undefined)).toBe('');
    });

    it('o tom não alarma onde não há nada a dizer', () => {
        expect(deltaTom({ p95: 150, delta: 30 })).toBe(DELTA.PIORA);
        expect(deltaTom({ p95: 90, delta: -30 })).toBe(DELTA.MELHORA);
        expect(deltaTom({ p95: 120, delta: 0 })).toBe(DELTA.ESTAVEL);
        // O CONTROLE DO CASO 5.
        expect(deltaTom({ p95: 150, delta: null })).toBe(DELTA.SEM_BASE);
        expect(deltaTom({ p95: null, delta: 30 })).toBe(DELTA.DESCONHECIDO);
        expect(deltaTom(undefined)).toBe(DELTA.DESCONHECIDO);
    });

    it('o truncamento tem ressalva PRÓPRIA, e ela fala do delta e não da lista', () => {
        // A DA SEÇÃO (`truncamentoNotice`, em `diag-phrases.js`) diz que os registros mais antigos
        // ficaram de fora, o que vale para a aba toda. Esta diz a consequência específica: o que o
        // anel descarta É a janela de comparação, então o delta compara uma janela cheia com uma
        // pela metade e "piorou" é a leitura errada.
        const frase = deltaTruncadoNotice();
        expect(frase).toMatch(/mais ANTIGOS/);
        expect(frase).toMatch(/janela de comparação/);
        expect(frase).toMatch(/base incompleta/);
        expect(frase).not.toContain('—');
    });

    it('a nota diz por que estas rotas, e a janela anterior sai datada', () => {
        expect(maisChamadasNotice()).toMatch(/MAIS CHAMADAS/);
        expect(rotasVaziasNotice()).toMatch(/Nenhuma requisição com duração/);
        const hora = (t) => `H${t}`;
        expect(janelaAnteriorNotice({ premissa: { janelaAnterior: { inicio: 1, fim: 2 } } }, hora))
            .toBe('Comparado com H1 a H2, que é a janela imediatamente anterior, do mesmo tamanho.');
        expect(janelaAnteriorNotice({ premissa: {} }, hora)).toBe('');
        expect(janelaAnteriorNotice({ premissa: { janelaAnterior: { inicio: 1, fim: 2 } } }, null))
            .toBe('');
    });
});

describe('a duração legível', () => {
    it('sobe de unidade e omite a menor quando ela é redonda', () => {
        expect(duracaoLegivel(0)).toBe('0 s');
        expect(duracaoLegivel(45_000)).toBe('45 s');
        expect(duracaoLegivel(5 * 60_000)).toBe('5 min');
        expect(duracaoLegivel(5 * 60_000 + 20_000)).toBe('5 min 20 s');
        expect(duracaoLegivel(2 * 3_600_000)).toBe('2 h');
        expect(duracaoLegivel(2 * 3_600_000 + 15 * 60_000)).toBe('2 h 15 min');
        expect(duracaoLegivel(3 * 86_400_000)).toBe('3 d');
        expect(duracaoLegivel(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 d 4 h');
    });

    it('o que não é duração devolve VAZIO, e nunca "0 s"', () => {
        // O CONTROLE DO CASO 6: "0 s" afirmaria que a última amostra acabou de sair.
        for (const v of [null, undefined, Number.NaN, Infinity, -1, '5000', {}]) {
            expect(duracaoLegivel(v)).toBe('');
        }
    });
});

describe('o cartão de saúde', () => {
    const medida = {
        situacao: 'medida', amostras: 200, faltantes: 12, esperadas: 212, buracos: 3,
        intervaloMs: 300_000, intervaloOrigem: 'inferido', estimativaFragil: false,
        desdeUltimaMs: 60_000, ultimaAtrasada: false, maiorBuracoMs: 3 * 3_600_000,
    };

    it('a contagem de faltantes carrega a PREMISSA do intervalo, informado ou inferido', () => {
        const frase = saudeSituacaoNotice(medida);
        expect(frase).toContain('200 amostras');
        expect(frase).toContain('12 faltando de 212 em 3 buracos');
        expect(frase).toContain('intervalo de 5 min, INFERIDO da própria série');
        expect(saudeSituacaoNotice({ ...medida, intervaloOrigem: 'informado' }))
            .toContain('intervalo de 5 min, informado');
        expect(intervaloEmPalavras({ intervaloMs: null })).toMatch(/não declarou/i);
    });

    it('série curta e intervalo inestimável NÃO afirmam "nada faltou"', () => {
        // O CONTROLE DO CASO 7.
        for (const situacao of ['sem-amostras', 'amostra-unica']) {
            const frase = saudeSituacaoNotice({ ...medida, situacao, faltantes: null });
            // O TOKEN DO SERVIDOR NÃO SAI CRU: quem lê recebe a frase, não o identificador.
            expect(frase).toContain(situacaoDaSerieLabel(situacao));
            expect(frase).not.toContain(situacao);
            expect(frase).toMatch(/Nada se afirma sobre buraco/i);
            expect(frase).not.toMatch(/faltando/);
        }
        const inestimavel = saudeSituacaoNotice({ ...medida, faltantes: null });
        expect(inestimavel).toMatch(/INTERVALO não foi estimável/);
        expect(inestimavel).toMatch(/não é "nada faltou"/);
    });

    it('a situação da série vira frase, e o token desconhecido SAI COMO VEIO', () => {
        // O CONTROLE DO CASO 8: `sem-amostras` na tela é um identificador de código, e a pessoa que
        // lê o painel não tem por que decodificá-lo. A tabela é a mesma forma de `estadoLabel`, e
        // herda dela a propriedade que importa: o valor que este build não conhece sai CRU, porque
        // é ele que se procura no código e é a única coisa verdadeira que a tela tem a dizer.
        expect(situacaoDaSerieLabel('sem-amostras')).toBe('nenhuma amostra na janela');
        expect(situacaoDaSerieLabel('amostra-unica')).toContain('uma amostra só');
        expect(situacaoDaSerieLabel('medida')).toBe('série medida');
        expect(situacaoDaSerieLabel('situacao-que-o-servidor-inventou'))
            .toBe('situacao-que-o-servidor-inventou');
        expect(situacaoDaSerieLabel(undefined)).toBe('situação não declarada');
        expect(situacaoDaSerieLabel('   ')).toBe('situação não declarada');
        // E a tabela cobre os TRÊS valores que `resumirAmostras` produz: um a menos e o buraco
        // aparece como token cru justamente no desfecho que ninguém testa à mão.
        expect(SITUACOES_DA_SERIE.map((s) => s.valor))
            .toEqual(['sem-amostras', 'amostra-unica', 'medida']);
    });

    it('a estimativa frágil fala, e só quando é frágil', () => {
        expect(estimativaFragilNotice({ estimativaFragil: false })).toBe('');
        expect(estimativaFragilNotice({})).toBe('');
        expect(estimativaFragilNotice({ estimativaFragil: true })).toMatch(/FRÁGIL/);
    });

    it('o maior buraco e a última amostra saem com a distância, e o atraso é o único presente', () => {
        expect(maiorBuracoNotice(medida)).toBe('Maior buraco: 3 h.');
        expect(maiorBuracoNotice({ maiorBuracoMs: null })).toBe('');
        expect(ultimaAmostraNotice(medida)).toBe('Última amostra há 1 min.');
        expect(ultimaAmostraNotice({ ...medida, ultimaAtrasada: true }))
            .toMatch(/ATRASADA: o processo pode estar fora agora/);
        expect(ultimaAmostraNotice({})).toMatch(/não disse há quanto tempo/i);
    });

    it('o disco é INDÍCIO e a ressalva anda colada ao número', () => {
        expect(discoNotice({ livreMb: 800, totalMb: 20_000 }))
            .toBe('Disco do log na última amostra: 800 MB livres de 20.000 MB (indício, não veredito).');
        expect(discoNotice({ livreMb: 800 })).toBe('Disco do log na última amostra: 800 MB livres (indício, não veredito).');
        // O TERCEIRO ESTADO: o campo não existe nas amostras antigas, e calar é o certo aqui,
        // porque a ambiguidade do buraco já está dita no cartão de indisponibilidade.
        expect(discoNotice(null)).toBe('');
    });
});

describe('os cartões de indisponibilidade, pulso e queries lentas', () => {
    it('a ressalva da indisponibilidade sai SEMPRE, zero inclusive', () => {
        expect(indisponivelNotice({ defeitos: 0, ocorrencias: 0 }))
            .toBe('0 assinaturas de origem "indisponivel", 0 ocorrências.');
        expect(indisponivelNotice({ defeitos: 1, ocorrencias: 1 }))
            .toBe('1 assinatura de origem "indisponivel", 1 ocorrência.');
        expect(indisponivelNotice({})).toMatch(/não informou/i);
        const ressalva = indisponivelRessalva();
        expect(ressalva).toMatch(/NÃO prova disponibilidade/);
        expect(ressalva).toMatch(/enfileirado/);
        expect(ressalva).toMatch(/Saúde/);
    });

    it('a contagem de query lenta compara com a janela anterior e diz de onde vem', () => {
        expect(queriesLentasNotice({ janela: 12, anterior: 5 }))
            .toBe('12 queries lentas na janela, 5 na anterior.');
        expect(queriesLentasNotice({ janela: 1, anterior: 0 }))
            .toBe('1 query lenta na janela, 0 na anterior.');
        expect(queriesLentasNotice({ janela: 3 })).toBe('3 queries lentas na janela.');
        expect(queriesLentasNotice(undefined)).toMatch(/não informou/i);
        expect(queriesLentasFonteNotice()).toMatch(/Latência/);
        expect(queriesLentasHint()).toContain('SLOW_QUERY_MS');
    });

    it('o pulso resumido aponta para a distribuição, e o vazio dele é uma frase', () => {
        expect(statusVazioNotice()).toMatch(/Nenhuma requisição registrada/);
        expect(statusDetalheNotice()).toMatch(/Pulso de requisições/);
    });

    it('o truncamento do TOTAL é outro fato, e tem frase própria', () => {
        // NÃO REUSAR A DO DELTA é o ponto: lá o que falta é a BASE de comparação, aqui o que sai
        // errado é o PRÓPRIO número, que é um piso. Dizer "o delta pode estar contra base
        // incompleta" ao lado de "156 requisições" descreveria um problema que não é o daquele
        // ladrilho e deixaria o que é passar batido.
        const frase = totalTruncadoNotice();
        expect(frase).toMatch(/PISO/);
        expect(frase).toMatch(/mais ANTIGAS/);
        expect(frase).not.toBe(deltaTruncadoNotice());
        expect(frase).not.toMatch(/delta/i);
    });
});

describe('a hora da composição', () => {
    it('sai do `gerado_em`, com o formatador vindo de fora', () => {
        const hora = (t) => `H${t}`;
        expect(compostoEmNotice({ gerado_em: 42 }, hora)).toBe('Composto às H42.');
        // A ABA NÃO RECARREGA SOZINHA: um resumo lido às onze pode ter sido composto às nove, e sem
        // esta linha a única pista de que a tela envelheceu é a pessoa lembrar quando abriu.
        expect(compostoEmNotice({}, hora)).toBe('');
        expect(compostoEmNotice(null, hora)).toBe('');
        expect(compostoEmNotice({ gerado_em: '42' }, hora)).toBe('');
        expect(compostoEmNotice({ gerado_em: Number.NaN }, hora)).toBe('');
        // SEM FORMATADOR NÃO HÁ FRASE, e não há queda para um segundo formato escrito no módulo:
        // é a mesma regra de `deltaNotice` e `janelaAnteriorNotice`.
        expect(compostoEmNotice({ gerado_em: 42 }, undefined)).toBe('');
        expect(compostoEmNotice({ gerado_em: 42 }, () => '')).toBe('');
    });
});

describe('a moldura da seção', () => {
    it('o título, o subtítulo e a nota de escopo nomeiam a fonte e a regra', () => {
        expect(resumoTitulo()).toBe('Resumo');
        expect(resumoSubtitulo().length).toBeGreaterThan(20);
        const escopo = resumoEscopoNotice();
        expect(escopo).toContain('npm run diag -- resumo');
        // A REGRA DOS SEIS CARTÕES SAI NA TELA, e não só no código: é ela que explica um cartão sem
        // número ao lado de cinco com número.
        expect(escopo).toMatch(/não desenha número/i);
        expect(resumoFailureNotice()).toMatch(/não informou o resumo/i);
    });

    it('nenhuma frase da seção carrega em-dash nem crase de markdown', () => {
        // A CRASE É SINTAXE DE MARKDOWN, e a tela desenha por `textContent`: ela chega ao olho da
        // pessoa como um caractere solto em volta do comando que ela deveria destacar. O irmão
        // `escopoNotice` (`defeito-phrases.js`) já usa aspas duplas, e é o modelo.
        const frases = [
            resumoTitulo(), resumoSubtitulo(), resumoEscopoNotice(), resumoFailureNotice(),
            resumoDesconhecidoNotice(), blocoAusenteNotice(), semFonteNotice({ motivo: 'x' }),
            defeitosVazioNotice(), topoTitulo(), maisChamadasNotice(), rotasVaziasNotice(),
            queriesLentasHint(), queriesLentasFonteNotice(), indisponivelRessalva(),
            statusVazioNotice(), statusDetalheNotice(), deltaTruncadoNotice(),
            totalTruncadoNotice(), estimativaFragilNotice({ estimativaFragil: true }),
            compostoEmNotice({ gerado_em: 1 }, () => 'agora'),
            saudeSituacaoNotice({ situacao: 'sem-amostras', amostras: 0 }),
        ];
        for (const f of frases) {
            expect(f).not.toContain('—');
            expect(f, f).not.toContain('`');
        }
    });
});

describe('resumo-phrases — a propriedade estrutural que a função pura não prova', () => {
    it('o módulo é FOLHA: zero imports, senão `admin.html` arrasta a store', () => {
        // ELE É IMPORTADO POR `diag-tab.js`, que é da página de Administração, e aquela página boota
        // sem a store. Um import daqui (o barrel `@utils`, o `instante.js` que os irmãos usam, um
        // ajudante qualquer) a traria de volta pelo caminho transitivo, e nada além desta asserção
        // impediria: a suíte inteira continuaria verde, porque as funções puras não dependem disso.
        const src = readFileSync(
            fileURLToPath(new URL('../../src/js/admin/resumo-phrases.js', import.meta.url)),
            'utf8',
        );
        expect(src.length).toBeGreaterThan(1000);
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });
});
