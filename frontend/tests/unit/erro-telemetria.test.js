// Path: tests/unit/erro-telemetria.test.js

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    TETOS,
    TETOS_DE_CONTEXTO,
    TIPOS_DE_ATLAS,
    MotivoDeEnvio,
    SEM_MENSAGEM,
    SEM_QUADRO,
    assinaturaDeErro,
    contextoSeguro,
    criarLimitador,
    formaDeValor,
    montarCorpo,
    normalizarMensagem,
    normalizarStack,
    paginaDaUrl,
    quadroUtil,
    textoDeErro,
    truncar,
    urlSegura,
    TETOS_DE_MIGALHA,
    migalhasSeguras,
} from '@js/session/erro-telemetria-assinatura.js';
import {
    instalarTelemetriaDeErro,
    estadoDaTelemetria,
    relatarErro,
    descarregarFilaDeRelatos,
    versaoDoBuild,
} from '@js/session/erro-telemetria.js';
import { OrigemDeErro, ORIGENS_DE_ERRO, ORIGENS_DO_CLIENTE } from '@js/session/origens-de-erro.js';
import { migalhas, TipoDeMigalha } from '@js/session/migalhas.js';
import { criarFilaDeRelatos } from '@js/session/fila-de-relatos.js';
import { deveEnfileirarIndisponivel, BlockingCause } from '@ui/unavailable-screen.js';

// A TELEMETRIA DE ERRO DO NAVEGADOR, e as quatro propriedades que valem mais que ela.
//
// O incidente: dezenove linhas de console coladas à mão, porque erro de navegador não era
// registrado em lugar nenhum. As dezenove eram O MESMO defeito, chegaram em segundos, e é isso
// que define o que este arquivo mede.
//
// CONTROLE NEGATIVO — o que fica VERMELHO ao reverter cada peça, um a um:
//
//   - tire a troca de hash/UUID de `normalizarMensagem` e "cada carga vira um grupo novo" reprova:
//     duas cargas do mesmo defeito passam a ter assinaturas diferentes ("assinatura sobrevive ao
//     hash do build", "…ao UUID do atlas", "…ao carimbo de HMR").
//   - tire o quadro da assinatura (só a mensagem) e dois defeitos diferentes com a mesma frase
//     colidem ("dois arquivos diferentes com a mesma frase não colidem").
//   - tire o dedupe do limitador e as dezenove viram dezenove envios ("dezenove idênticos, um
//     envio").
//   - tire o teto e o vigésimo primeiro erro DISTINTO sai ("o teto da sessão corta").
//   - tire o intervalo mínimo e uma rajada de distintos sai inteira ("a rajada de distintos
//     respeita o intervalo").
//   - tire a guarda de reentrância e o envio que gera erro se recaptura ("um erro DENTRO do envio
//     não dispara outra captura"): sem ela a captura aninhada conta como capturada e volta a
//     tentar enviar, que é o laço.
//   - tire qualquer `try` do módulo de decisão e os casos de entrada estranha (null, string solta,
//     objeto circular, pilha vazia) passam a lançar de dentro do manipulador de erro.
//   - tire o `.then(undefined, …)` do despacho e o envio que rejeita vira `unhandledrejection`,
//     que é o evento que este módulo assina: o laço pela outra ponta ("promessa rejeitada não
//     escapa").
//
// O QUE ELE NÃO ALCANÇA, declarado: a rota do servidor (outro pacote), e o fato de os quatro
// entries chamarem a instalação — isso é o teste estrutural do fim do arquivo, que lê os quatro
// arquivos e nada mais.

/** Um armazenamento de mentira, com a superfície que as duas folhas usam. */
function criarArmazenamento(inicial = {}) {
    const dados = new Map(Object.entries(inicial));
    return {
        dados,
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
    };
}

/** Um alvo de eventos de mentira, com a superfície que o instalador usa. */
function criarAlvo({ href = 'http://local/index.html', comConsole = false } = {}) {
    const ouvintes = new Map();
    const url = new URL(href);
    const linhas = [];
    return {
        location: { href, pathname: url.pathname },
        // O embrulho de `console.error` só existe quando o alvo TEM console: um caso que não
        // pede console não pode acabar embrulhando o do vitest.
        console: comConsole
            ? { error: (...args) => { linhas.push(args); }, warn: () => {} }
            : undefined,
        linhas,
        addEventListener(tipo, fn) {
            if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
            ouvintes.get(tipo).push(fn);
        },
        removeEventListener(tipo, fn) {
            const lista = ouvintes.get(tipo) || [];
            const i = lista.indexOf(fn);
            if (i >= 0) lista.splice(i, 1);
        },
        /** Dispara o evento como o navegador dispararia. */
        emitir(tipo, evento) {
            for (const fn of [...(ouvintes.get(tipo) || [])]) fn(evento);
        },
        contar(tipo) {
            return (ouvintes.get(tipo) || []).length;
        },
    };
}

/** Instalação com transporte espião, relógio parado e nada de rede. */
function instalarEspiao(opcoes = {}) {
    const alvo = opcoes.alvo ?? criarAlvo();
    const enviados = [];
    let relogio = 0;
    const fila = opcoes.fila ?? criarFilaDeRelatos({ storage: criarArmazenamento() });
    const instalacao = instalarTelemetriaDeErro({
        alvo,
        agora: () => relogio,
        enviar: (corpo) => {
            enviados.push(corpo);
            return opcoes.aoEnviar ? opcoes.aoEnviar(corpo) : undefined;
        },
        resolverAtlasId: opcoes.resolverAtlasId ?? (() => null),
        resolverBase: () => '/api/v1',
        resolverSessaoId: opcoes.resolverSessaoId ?? (() => SESSAO),
        fila,
        max: opcoes.max,
        intervaloMs: opcoes.intervaloMs,
    });
    return {
        alvo,
        enviados,
        instalacao,
        fila,
        avancar: (ms) => { relogio += ms; },
    };
}

/** Uma exceção de código, como o `error` de um `ErrorEvent`. */
function erroCom(mensagem, stack) {
    const e = new Error(mensagem);
    e.stack = stack;
    return e;
}

/** Um id de aba de mentira, com a forma que o servidor valida. */
const SESSAO = '11111111-2222-4333-8444-555555555555';

const PILHA = [
    'TypeError: Cannot read properties of undefined (reading nome)',
    '    at desenhar (http://local/assets/core-Ab12Cd34.js:1204:19)',
    '    at http://local/assets/ui-Zz99Yy88.js:44:7',
].join('\n');

let ativa = null;
afterEach(() => {
    // A instalação é módulo-global de propósito (uma por página); soltá-la é o que mantém os casos
    // independentes.
    ativa?.instalacao?.desinstalar?.();
    ativa = null;
    // A TRILHA também é módulo-global (uma por página), e cada instalação lhe acrescenta a
    // migalha de navegação: sem esvaziá-la, um caso leria a trilha do caso anterior.
    migalhas.limpar();
});

describe('normalização: o que muda a cada carga da página não pode entrar na assinatura', () => {
    it('troca o hash de nome de arquivo do build', () => {
        expect(normalizarMensagem('falha em core-Ab12Cd34.js'))
            .toBe('falha em core-<hash>.js');
    });

    it('troca o UUID', () => {
        expect(normalizarMensagem('atlas 3f2504e0-4f89-11d3-9a0c-0305e82c3301 sumiu'))
            .toBe('atlas <uuid> sumiu');
    });

    it('tira o carimbo de HMR do dev server', () => {
        expect(normalizarMensagem('erro em /src/js/a.js?t=1712345678901'))
            .toBe('erro em /src/js/a.js');
    });

    it('troca hex solto e número longo, e colapsa espaço', () => {
        expect(normalizarMensagem('sha 9f8e7d6c5b4a  em  1712345678901\ne mais'))
            .toBe('sha <hash> em <n> e mais');
    });

    it('NÃO come palavra que só parece hexadecimal (sem dígito, fica)', () => {
        // `defaced` são sete letras do alfabeto hexadecimal. Sem a exigência de um dígito, ela
        // viraria `<hash>` e a mensagem perderia uma palavra de verdade.
        expect(normalizarMensagem('o arquivo defaced quebrou')).toBe('o arquivo defaced quebrou');
    });

    it('NÃO come nome de módulo sem dígito (`-configuration.js` fica)', () => {
        expect(normalizarMensagem('em app-configuration.js')).toBe('em app-configuration.js');
    });

    it('troca blob: e data:', () => {
        expect(normalizarMensagem('falha em blob:http://local/9f8e-aa'))
            .toBe('falha em <blob>');
        expect(normalizarMensagem(`falha em data:${'x'.repeat(30)}`))
            .toBe('falha em <data>');
    });

    it('a pilha normalizada preserva as linhas (ilegível é pior que agrupável)', () => {
        const saida = normalizarStack(PILHA);
        expect(saida.split('\n')).toHaveLength(3);
        expect(saida).toContain('core-<hash>.js');
        expect(saida).toContain('ui-<hash>.js');
    });
});

describe('quadro útil: o primeiro que nomeia arquivo e linha', () => {
    it('pega o primeiro quadro do V8, já com o hash trocado e SEM a coluna', () => {
        expect(quadroUtil(PILHA)).toBe('core-<hash>.js:1204');
    });

    it('entende a forma do Firefox', () => {
        expect(quadroUtil('desenhar@http://local/assets/core-Ab12Cd34.js:1204:19'))
            .toBe('core-<hash>.js:1204');
    });

    it('descarta a linha da mensagem (que não tem arquivo:linha)', () => {
        expect(quadroUtil('TypeError: x\n    at a (http://local/b.js:9:1)')).toBe('b.js:9');
    });

    it('PULA o quadro da própria telemetria, senão todo defeito vira um grupo só', () => {
        const pilha = [
            'Error: x',
            '    at capturar (http://local/assets/erro-telemetria.js:80:3)',
            '    at desenhar (http://local/assets/mapa.js:12:4)',
        ].join('\n');
        expect(quadroUtil(pilha)).toBe('mapa.js:12');
    });

    it('tira a query do caminho do arquivo', () => {
        expect(quadroUtil('    at a (http://local/src/js/a.js?t=1712345678901:9:1)'))
            .toBe('a.js:9');
    });

    it('pilha ausente, vazia ou sem quadro devolve vazio, nunca lança', () => {
        expect(quadroUtil(null)).toBe('');
        expect(quadroUtil(undefined)).toBe('');
        expect(quadroUtil('')).toBe('');
        expect(quadroUtil('   ')).toBe('');
        expect(quadroUtil({})).toBe('');
        expect(quadroUtil('sem nada de útil aqui')).toBe('');
    });
});

describe('assinatura: agrupa o mesmo defeito e separa defeitos diferentes', () => {
    it('sobrevive ao hash do build (duas cargas, uma assinatura)', () => {
        const a = assinaturaDeErro({
            mensagem: 'x is not a function',
            stack: '    at f (http://local/assets/core-Ab12Cd34.js:10:2)',
        });
        const b = assinaturaDeErro({
            mensagem: 'x is not a function',
            stack: '    at f (http://local/assets/core-Qq77Ww66.js:10:2)',
        });
        expect(a).toBe(b);
    });

    it('sobrevive ao UUID do atlas na mensagem', () => {
        const a = assinaturaDeErro({ mensagem: 'atlas 3f2504e0-4f89-11d3-9a0c-0305e82c3301 falhou' });
        const b = assinaturaDeErro({ mensagem: 'atlas 11111111-2222-3333-4444-555555555555 falhou' });
        expect(a).toBe(b);
    });

    it('sobrevive ao carimbo de HMR', () => {
        const a = assinaturaDeErro({ stack: '    at f (http://local/src/a.js?t=111111:3:1)' });
        const b = assinaturaDeErro({ stack: '    at f (http://local/src/a.js?t=999999:3:1)' });
        expect(a).toBe(b);
    });

    it('dois arquivos diferentes com a MESMA frase não colidem', () => {
        const frase = 'Cannot read properties of undefined (reading nome)';
        const a = assinaturaDeErro({ mensagem: frase, stack: '    at f (http://local/a.js:1:1)' });
        const b = assinaturaDeErro({ mensagem: frase, stack: '    at f (http://local/b.js:1:1)' });
        expect(a).not.toBe(b);
    });

    it('sem pilha e sem mensagem ainda produz chave estável, nunca lança', () => {
        expect(assinaturaDeErro()).toBe(`${SEM_MENSAGEM}@${SEM_QUADRO}`);
        expect(assinaturaDeErro({ mensagem: null, stack: null })).toBe(`${SEM_MENSAGEM}@${SEM_QUADRO}`);
    });
});

describe('textoDeErro: o argumento quase nunca é um Error', () => {
    it('Error', () => {
        const { mensagem, stack } = textoDeErro(erroCom('boom', PILHA));
        expect(mensagem).toBe('Error: boom');
        expect(stack).toBe(PILHA);
    });

    it('string solta (a rejeição mais comum do produto)', () => {
        expect(textoDeErro('deu ruim')).toEqual({ mensagem: 'deu ruim', stack: '' });
    });

    it('null e undefined (um `Promise.reject()` seco)', () => {
        expect(textoDeErro(null).mensagem).toBe(SEM_MENSAGEM);
        expect(textoDeErro(undefined).mensagem).toBe(SEM_MENSAGEM);
    });

    it('número e booleano', () => {
        expect(textoDeErro(42).mensagem).toBe('42');
        expect(textoDeErro(false).mensagem).toBe('false');
    });

    it('objeto que não é Error vira a FORMA dele, nunca o conteúdo', () => {
        // Era `JSON.stringify` até 2026-09-01, e a troca é de PRIVACIDADE: ver o `fileoverview`
        // de `formaDeValor` e o repro em `relato-sem-conteudo-de-usuario.repro.test.js`. O que se
        // perdeu foi o despejo; o diagnóstico continua, porque `code`/`message`/`status` viajam
        // por valor.
        expect(textoDeErro({ status: 500, code: 'X' }).mensagem)
            .toBe('Object{code,status} code=X status=500');
    });

    it('objeto CIRCULAR não lança (e agora nem depende do JSON para isso)', () => {
        const circ = { a: 1 };
        circ.self = circ;
        expect(() => textoDeErro(circ)).not.toThrow();
        expect(textoDeErro(circ).mensagem).toBe('Object{a,self}');
    });

    it('objeto cujo `message` EXPLODE não lança', () => {
        const hostil = { get message() { throw new Error('explodi'); } };
        expect(() => textoDeErro(hostil)).not.toThrow();
        expect(textoDeErro(hostil).mensagem).toBe(SEM_MENSAGEM);
    });

    it('string vazia e string de espaços caem no marcador', () => {
        expect(textoDeErro('').mensagem).toBe(SEM_MENSAGEM);
        expect(textoDeErro('   ').mensagem).toBe(SEM_MENSAGEM);
    });
});

describe('página e URL', () => {
    it('nomeia as quatro páginas', () => {
        expect(paginaDaUrl('/')).toBe('mapa');
        expect(paginaDaUrl('/index.html')).toBe('mapa');
        expect(paginaDaUrl('/sub/atlas.html')).toBe('atlas');
        expect(paginaDaUrl('/admin.html')).toBe('admin');
        expect(paginaDaUrl('/calibracao.html')).toBe('calibracao');
    });

    it('herança de protótipo NÃO vira nome de página', () => {
        // `PAGINAS[base] ?? …` devolveria a função `toString` para `/toString`, e `Object.freeze`
        // não protege disso. Mesma armadilha já paga em `ARRIVAL_NOTICES`.
        expect(paginaDaUrl('/toString')).toBe('toString');
        expect(paginaDaUrl('/constructor')).toBe('constructor');
    });

    it('entrada estranha não lança', () => {
        expect(paginaDaUrl(null)).toBe('desconhecida');
        expect(paginaDaUrl(undefined)).toBe('desconhecida');
        expect(paginaDaUrl(42)).toBe('desconhecida');
    });

    it('oculta a credencial de uso único e PRESERVA o resto do diagnóstico', () => {
        const saida = urlSegura('http://local/?atlas=abc&verify=segredo&aba=catalog');
        expect(saida).not.toContain('segredo');
        expect(saida).toContain('atlas=abc');
        expect(saida).toContain('aba=catalog');
        expect(urlSegura('http://local/?atlasPublico=tok')).not.toContain('tok');
    });

    it('URL sem nada sensível passa intacta; entrada inválida não lança', () => {
        expect(urlSegura('http://local/x?y=1')).toBe('http://local/x?y=1');
        expect(urlSegura(null)).toBe('');
        expect(() => urlSegura('::::')).not.toThrow();
    });
});

describe('limitador: as dezenove do incidente', () => {
    it('dezenove idênticos, UM envio', () => {
        const lim = criarLimitador({ agora: () => 0 });
        const assinatura = 'x@a.js:1';
        const oks = Array.from({ length: 19 }, () => lim.permite(assinatura)).filter((r) => r.ok);
        expect(oks).toHaveLength(1);
        expect(lim.estado()).toMatchObject({ enviados: 1, duplicadas: 18 });
    });

    it('a rajada de DISTINTOS respeita o intervalo mínimo', () => {
        let t = 0;
        const lim = criarLimitador({ intervaloMs: 2000, agora: () => t });
        expect(lim.permite('a').ok).toBe(true);
        expect(lim.permite('b')).toEqual({ ok: false, motivo: MotivoDeEnvio.INTERVALO });
        t = 1999;
        expect(lim.permite('c').ok).toBe(false);
        t = 2000;
        expect(lim.permite('d').ok).toBe(true);
    });

    it('o RECUSADO não é memorizado: a mesma assinatura sai quando o intervalo passa', () => {
        let t = 0;
        const lim = criarLimitador({ intervaloMs: 1000, agora: () => t });
        lim.permite('primeiro');
        expect(lim.permite('segundo').motivo).toBe(MotivoDeEnvio.INTERVALO);
        t = 1000;
        // Se o recusado tivesse sido memorizado, este viria como `duplicada` e o defeito NUNCA
        // chegaria ao servidor.
        expect(lim.permite('segundo')).toEqual({ ok: true, motivo: MotivoDeEnvio.NOVO });
    });

    it('o teto da sessão corta, e corta com motivo próprio', () => {
        let t = 0;
        const lim = criarLimitador({ max: 3, intervaloMs: 0, agora: () => (t += 10) });
        expect(lim.permite('a').ok).toBe(true);
        expect(lim.permite('b').ok).toBe(true);
        expect(lim.permite('c').ok).toBe(true);
        expect(lim.permite('d')).toEqual({ ok: false, motivo: MotivoDeEnvio.TETO });
        expect(lim.estado()).toMatchObject({ enviados: 3, limitadas: 1 });
    });

    it('o teto padrão é 20', () => {
        let t = 0;
        const lim = criarLimitador({ intervaloMs: 0, agora: () => (t += 10) });
        const oks = Array.from({ length: 40 }, (_, i) => lim.permite(`s${i}`)).filter((r) => r.ok);
        expect(oks).toHaveLength(20);
    });

    it('relógio que devolve lixo não trava o limitador', () => {
        const lim = criarLimitador({ agora: () => NaN });
        expect(lim.permite('a').ok).toBe(true);
        expect(lim.permite('b').ok).toBe(true);
    });
});

describe('montarCorpo: os tetos da rota, aplicados ANTES do envio', () => {
    it('trunca mensagem e pilha nos tetos declarados', () => {
        const corpo = montarCorpo({
            mensagem: 'a'.repeat(2000),
            stack: 'b'.repeat(9000),
            url: `http://local/${'c'.repeat(2000)}`,
            pagina: 'mapa',
        });
        expect(corpo.mensagem).toHaveLength(TETOS.mensagem);
        expect(corpo.stack).toHaveLength(TETOS.stack);
        expect(corpo.url.length).toBeLessThanOrEqual(TETOS.url);
    });

    it('OS OPCIONAIS SOMEM quando não existem (nunca `null` no corpo)', () => {
        const corpo = montarCorpo({ mensagem: 'x', pagina: 'mapa', url: 'http://local/' });
        expect(Object.hasOwn(corpo, 'release')).toBe(false);
        expect(Object.hasOwn(corpo, 'atlasId')).toBe(false);
        expect(Object.hasOwn(corpo, 'userAgent')).toBe(false);
    });

    it('a ASSINATURA viaja (o servidor agrupa por ela e o Joi da borda a exige)', () => {
        const corpo = montarCorpo({ mensagem: 'boom', stack: PILHA });
        expect(corpo.assinatura).toBe(assinaturaDeErro({ mensagem: 'boom', stack: PILHA }));
        expect(corpo.assinatura.length).toBeLessThanOrEqual(TETOS.assinatura);
    });

    it('assinatura longa é cortada no teto de 300 que a rota valida', () => {
        const corpo = montarCorpo({ mensagem: 'a'.repeat(900) });
        expect(corpo.assinatura).toHaveLength(TETOS.assinatura);
    });

    it('atlasId QUE NÃO É UUID não vai, senão o 422 derruba o envio inteiro', () => {
        // Um atlas LOCAL não tem UUID, e a coluna do servidor é `uuid`: mandar o id local
        // custaria o erro inteiro por causa do campo mais dispensável dele.
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x', atlasId: 'local-3' }), 'atlasId'))
            .toBe(false);
        expect(montarCorpo({ mensagem: 'x', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).atlasId)
            .toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    });

    it('NENHUM campo de usuário sai daqui: o corpo tem no máximo os oito do contrato', () => {
        const corpo = montarCorpo({
            mensagem: 'x', stack: PILHA, url: 'http://local/', pagina: 'mapa',
            release: '1.0.0', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            userAgent: 'Mozilla/5.0',
        });
        expect(Object.keys(corpo).sort())
            .toEqual(['assinatura', 'atlasId', 'mensagem', 'pagina', 'release', 'stack',
                'url', 'userAgent']);
    });

    it('release fora do teto é cortado', () => {
        const corpo = montarCorpo({ mensagem: 'x', release: 'r'.repeat(500) });
        expect(corpo.release).toHaveLength(TETOS.release);
    });

    it('entrada inteiramente vazia produz corpo válido, não exceção', () => {
        const corpo = montarCorpo();
        expect(corpo.mensagem).toBe(SEM_MENSAGEM);
        expect(corpo.stack).toBe('');
        expect(corpo.pagina).toBe('desconhecida');
    });

    it('truncar tolera não-string', () => {
        expect(truncar(null, 10)).toBe('');
        expect(truncar(undefined, 10)).toBe('');
        expect(truncar(123, 10)).toBe('');
    });
});

describe('instalação: as quatro propriedades, contra um window de mentira', () => {
    it('assina os dois eventos e devolve na hora, sem rede', () => {
        ativa = instalarEspiao();
        expect(ativa.instalacao.instalada).toBe(true);
        expect(ativa.alvo.contar('error')).toBe(1);
        expect(ativa.alvo.contar('unhandledrejection')).toBe(1);
        expect(ativa.enviados).toHaveLength(0);
    });

    it('um erro do window vira UM corpo, com página e endereço', () => {
        ativa = instalarEspiao({ alvo: criarAlvo({ href: 'http://local/admin.html?aba=catalog' }) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].pagina).toBe('admin');
        expect(ativa.enviados[0].url).toContain('aba=catalog');
        expect(ativa.enviados[0].mensagem).toContain('boom');
        expect(ativa.enviados[0].stack).toContain('core-<hash>.js');
    });

    it('uma rejeição não tratada vira corpo do mesmo jeito', () => {
        ativa = instalarEspiao();
        ativa.alvo.emitir('unhandledrejection', { reason: erroCom('rejeitado', PILHA) });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].mensagem).toContain('rejeitado');
    });

    it('DEZENOVE IDÊNTICOS EM SEGUNDOS: um envio (o incidente inteiro)', () => {
        ativa = instalarEspiao();
        for (let i = 0; i < 19; i++) {
            ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        }
        expect(ativa.enviados).toHaveLength(1);
        expect(estadoDaTelemetria().duplicadas).toBeGreaterThanOrEqual(18);
    });

    it('o teto global corta a sessão inteira', () => {
        ativa = instalarEspiao({ max: 3, intervaloMs: 0 });
        for (let i = 0; i < 12; i++) {
            ativa.avancar(10);
            ativa.alvo.emitir('error', { error: erroCom(`boom ${i}`, `at f (http://local/a${i}.js:1:1)`) });
        }
        expect(ativa.enviados).toHaveLength(3);
    });

    it('NÃO REENTRA: um erro DENTRO do envio não dispara outra captura', () => {
        const alvo = criarAlvo();
        let aninhadas = 0;
        ativa = instalarEspiao({
            alvo,
            intervaloMs: 0,
            aoEnviar: () => {
                aninhadas++;
                // O envio explode do jeito mais hostil possível: emitindo o evento de erro de novo,
                // que é o laço que derruba o navegador e inunda o servidor.
                alvo.emitir('error', { error: erroCom('falha do envio', 'at s (http://local/s.js:1:1)') });
                throw new Error('falha do envio');
            },
        });
        expect(() => alvo.emitir('error', { error: erroCom('boom', PILHA) })).not.toThrow();
        expect(aninhadas).toBe(1);
        expect(ativa.enviados).toHaveLength(1);
        expect(estadoDaTelemetria().reentrancias).toBeGreaterThanOrEqual(1);
    });

    it('a exceção do transporte NÃO propaga para o manipulador do window', () => {
        ativa = instalarEspiao({ aoEnviar: () => { throw new Error('rede caiu'); } });
        expect(() => ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) })).not.toThrow();
        expect(estadoDaTelemetria().falhasDeEnvio).toBeGreaterThanOrEqual(1);
    });

    it('promessa REJEITADA não escapa (senão ela mesma vira unhandledrejection)', async () => {
        ativa = instalarEspiao({ aoEnviar: () => Promise.reject(new Error('502')) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        await Promise.resolve();
        await Promise.resolve();
        expect(estadoDaTelemetria().falhasDeEnvio).toBeGreaterThanOrEqual(1);
    });

    it('entrada estranha do evento não lança e não some com a instalação', () => {
        ativa = instalarEspiao({ intervaloMs: 0 });
        for (const evento of [undefined, null, {}, { error: null }, { reason: undefined }, { message: '' }]) {
            ativa.avancar(10);
            expect(() => ativa.alvo.emitir('error', evento)).not.toThrow();
            expect(() => ativa.alvo.emitir('unhandledrejection', evento)).not.toThrow();
        }
        expect(ativa.alvo.contar('error')).toBe(1);
    });

    it('falha de CARREGAMENTO de recurso (alvo é o elemento) é ignorada', () => {
        ativa = instalarEspiao();
        ativa.alvo.emitir('error', { target: { tagName: 'IMG' }, error: null });
        expect(ativa.enviados).toHaveLength(0);
    });

    it('o resolvedor de atlasId que EXPLODE não custa o envio', () => {
        ativa = instalarEspiao({ resolverAtlasId: () => { throw new Error('sem escopo'); } });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados).toHaveLength(1);
        expect(Object.hasOwn(ativa.enviados[0], 'atlasId')).toBe(false);
    });

    it('o atlasId entra quando existe e é UUID', () => {
        const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
        ativa = instalarEspiao({ resolverAtlasId: () => uuid });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados[0].atlasId).toBe(uuid);
    });

    it('a assinatura DO CORPO é a mesma que o limitador deduplicou', () => {
        ativa = instalarEspiao();
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        // O segundo, idêntico, é recusado por duplicata: as duas contagens só podem casar se a
        // chave enviada for a chave deduplicada.
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].assinatura)
            .toBe(assinaturaDeErro({ mensagem: 'Error: boom', stack: PILHA }));
    });

    it('instalar duas vezes não dobra os manipuladores', () => {
        ativa = instalarEspiao();
        const segunda = instalarTelemetriaDeErro({ alvo: ativa.alvo, enviar: () => {} });
        expect(segunda.instalada).toBe(false);
        expect(ativa.alvo.contar('error')).toBe(1);
    });

    it('alvo sem addEventListener devolve não-instalada, sem lançar', () => {
        expect(() => instalarTelemetriaDeErro({ alvo: {} })).not.toThrow();
        expect(instalarTelemetriaDeErro({ alvo: {} }).instalada).toBe(false);
    });

    it('desinstalar solta os dois ouvintes', () => {
        const espiao = instalarEspiao();
        espiao.instalacao.desinstalar();
        expect(espiao.alvo.contar('error')).toBe(0);
        expect(espiao.alvo.contar('unhandledrejection')).toBe(0);
    });
});

describe('o corpo ESPELHA o Joi da borda, que está no outro pacote', () => {
    // ESTE É O GUARDA QUE FALTOU E QUE QUASE CUSTOU O RECURSO INTEIRO. A primeira versão deste
    // cliente mandava seis campos e NÃO mandava `assinatura`, que o Joi da rota declara
    // `.required()`: todo envio teria voltado 422, e o desfecho de um 422 numa telemetria é o
    // silêncio — o mesmo silêncio que ela existe para acabar, agora com código do lado do cliente
    // fazendo parecer que existe telemetria. Nada no frontend ficaria vermelho.
    //
    // Ele lê a FONTE do outro pacote em vez de importá-la (o Joi não é dependência do frontend), e
    // é o mesmo papel de `sync-trace-espelha-backend.test.js`: o alcance é o VOCABULÁRIO e os
    // TETOS, nunca a semântica. Um campo aceito com o significado errado passa verde aqui.
    const SCHEMA = '../../../backend/src/modules/diag/diag.schemas.js';

    /** @returns {string} O bloco do `erroDeClienteSchema`, da abertura à chave que o fecha. */
    function blocoDoSchema() {
        const fonte = readFileSync(fileURLToPath(new URL(SCHEMA, import.meta.url)), 'utf8');
        const inicio = fonte.indexOf('erroDeClienteSchema');
        // A guarda do próprio guarda: o alvo renomeado tem de ficar VERMELHO dizendo isso, e não
        // passar verde por não ter achado nada que medir.
        expect(inicio, 'o `erroDeClienteSchema` sumiu do backend — este espelho perdeu o alvo')
            .toBeGreaterThan(-1);
        const fim = fonte.indexOf('\n});', inicio);
        return fonte.slice(inicio, fim);
    }

    /** Um corpo com TODOS os campos preenchidos: é o que o cliente pode mandar no máximo. */
    const CORPO_CHEIO = montarCorpo({
        mensagem: 'boom', stack: PILHA, stackBruta: PILHA, url: 'http://local/', pagina: 'mapa',
        release: '1.0.0', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        userAgent: 'Mozilla/5.0', sessaoId: SESSAO, origem: OrigemDeErro.BOOT,
        contexto: { atlasKind: 'servidor', causa: 'x', camada: 'y', conexao: 'ONLINE', status: 403 },
        migalhas: [{ t: 1, tipo: 'navegacao', texto: 'mapa /index.html' }],
    });

    it('todo campo REQUIRED do servidor é mandado pelo cliente', () => {
        const bloco = blocoDoSchema();
        const obrigatorios = [...bloco.matchAll(/^\s{2}(\w+):[^\n]*\.required\(\)/gm)]
            .map((m) => m[1]);
        expect(obrigatorios.length, 'nenhum campo obrigatório encontrado: o recorte não casou')
            .toBeGreaterThan(0);
        for (const campo of obrigatorios) {
            expect(Object.hasOwn(CORPO_CHEIO, campo), `o corpo não manda \`${campo}\`, que a rota exige`)
                .toBe(true);
        }
    });

    it('todo campo que o cliente manda existe no schema (o resto o servidor descarta calado)', () => {
        const bloco = blocoDoSchema();
        for (const campo of Object.keys(CORPO_CHEIO)) {
            expect(new RegExp(`^\\s{2}${campo}:`, 'm').test(bloco), `\`${campo}\` não existe no schema`)
                .toBe(true);
        }
    });

    /**
     * O recorte do `contexto`, que é um objeto ANINHADO e por isso não cai no recorte de cima.
     * @returns {string} Da abertura de `contexto: Joi.object({` até o `})` que a fecha.
     */
    function blocoDoContexto() {
        const bloco = blocoDoSchema();
        const inicio = bloco.indexOf('contexto: Joi.object({');
        expect(inicio, 'o `contexto` sumiu do schema — este espelho perdeu o alvo')
            .toBeGreaterThan(-1);
        const fim = bloco.indexOf('}).unknown(', inicio);
        expect(fim, 'o fecho do `contexto` mudou de forma — o recorte não casou')
            .toBeGreaterThan(inicio);
        return bloco.slice(inicio, fim);
    }

    it('o `contexto` do servidor tem exatamente as CINCO chaves que o cliente sabe montar', () => {
        // O servidor roda com `unknown(false)`, e ali isso VENCE o `stripUnknown`: uma chave que o
        // cliente invente derruba o relato INTEIRO num 422, não só o campo. É a razão de este
        // espelho existir, e de ele comparar o CONJUNTO em vez de só procurar o que ele conhece.
        const campos = [...blocoDoContexto().matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
        expect(campos.sort())
            .toEqual(['atlasKind', 'camada', 'causa', 'conexao', 'status']);
    });

    it('os três tetos de texto do `contexto` são os `TETOS_DE_CONTEXTO` do cliente', () => {
        const bloco = blocoDoContexto();
        let conferidos = 0;
        for (const [campo, teto] of Object.entries(TETOS_DE_CONTEXTO)) {
            const casou = bloco.match(new RegExp(`^\\s{4}${campo}:[^\\n]*?\\.max\\((\\d+)\\)`, 'm'));
            expect(casou, `\`${campo}\` não tem \`max()\` no schema do servidor`).toBeTruthy();
            expect(Number(casou[1]), `teto de \`contexto.${campo}\` divergiu do servidor`).toBe(teto);
            conferidos++;
        }
        // Cobertura vazia passa verde: sem esta linha, um recorte que parasse de casar reportaria
        // sucesso sem ter comparado um número sequer.
        expect(conferidos, 'nenhum teto de contexto foi comparado').toBe(3);
    });

    it('os três `atlasKind` do servidor são os `TIPOS_DE_ATLAS` do cliente', () => {
        const casou = blocoDoContexto().match(/atlasKind:[^\n]*?\.valid\(([^)]*)\)/);
        expect(casou, 'o `valid()` de `atlasKind` sumiu do servidor').toBeTruthy();
        const doServidor = [...casou[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
        expect(doServidor).toEqual([...TIPOS_DE_ATLAS]);
    });

    it('a faixa de `status` do servidor é a que o cliente aplica', () => {
        const bloco = blocoDoContexto();
        const min = bloco.match(/status:[^\n]*?\.min\((\d+)\)/);
        const max = bloco.match(/status:[^\n]*?\.max\((\d+)\)/);
        expect(min, 'o `min()` de `status` sumiu do servidor').toBeTruthy();
        expect(max, 'o `max()` de `status` sumiu do servidor').toBeTruthy();
        const piso = Number(min[1]);
        const teto = Number(max[1]);
        // Comparado pelo COMPORTAMENTO do cliente, e não contra um número escrito duas vezes aqui:
        // o que precisa casar é a faixa que `contextoSeguro` deixa passar.
        expect(contextoSeguro({ status: piso })).toEqual({ status: piso });
        expect(contextoSeguro({ status: teto })).toEqual({ status: teto });
        expect(contextoSeguro({ status: piso - 1 })).toBeNull();
        expect(contextoSeguro({ status: teto + 1 })).toBeNull();
    });

    it('o cabeçalho que o cliente manda é o que o servidor lê', () => {
        // O backend NÃO se importa daqui (o `request-logger.js` puxa a config e exige
        // `DATABASE_URL`: importá-lo derruba a suíte hermética), então lê-se a FONTE, como no
        // espelho do Joi logo acima. O servidor guarda o nome em minúsculas, porque é assim que o
        // Node normaliza `req.headers`; o cliente escreve na forma canônica.
        const LOGGER = '../../../backend/src/middleware/request-logger.js';
        const fonteDoLogger = readFileSync(fileURLToPath(new URL(LOGGER, import.meta.url)), 'utf8');
        const doServidor = fonteDoLogger.match(/CABECALHO_DE_SESSAO\s*=\s*'([^']+)'/);
        expect(doServidor, 'o `CABECALHO_DE_SESSAO` sumiu do backend — este espelho perdeu o alvo')
            .toBeTruthy();

        const fonteDoCliente = readFileSync(
            fileURLToPath(new URL('../../src/js/store/sync/api-client.js', import.meta.url)),
            'utf8',
        );
        const doCliente = fonteDoCliente.match(/headers\['([^']+)'\]\s*=\s*sessaoId\(\)/);
        expect(doCliente, 'o cliente parou de carimbar o cabeçalho em `_request`').toBeTruthy();
        expect(doCliente[1].toLowerCase()).toBe(doServidor[1].toLowerCase());
    });

    it('os TETOS do cliente são os `max()` do servidor, campo a campo', () => {
        const bloco = blocoDoSchema();
        let conferidos = 0;
        for (const [campo, teto] of Object.entries(TETOS)) {
            const casou = bloco.match(new RegExp(`^\\s{2}${campo}:[^\\n]*?\\.max\\((\\d+)\\)`, 'm'));
            if (!casou) continue;   // `atlasId` é uuid, sem `max`
            expect(Number(casou[1]), `teto de \`${campo}\` divergiu do servidor`).toBe(teto);
            conferidos++;
        }
        // Cobertura vazia passa verde: sem esta linha, um recorte que parasse de casar nada
        // reportaria sucesso sem ter comparado um número sequer.
        expect(conferidos, 'nenhum teto foi comparado').toBeGreaterThanOrEqual(5);
    });
});

describe('fiação: as QUATRO páginas instalam a telemetria', () => {
    // Estrutural de propósito: os quatro entries só existem dentro de um navegador (MapLibre,
    // IndexedDB, quatro fases de boot), então a camada hermética não os executa. O que se pode
    // prender de graça é que a chamada não SAIA numa refatoração — que é como a captura de erro
    // volta a não existir sem ninguém perceber.
    const ENTRIES = [
        'src/js/index.js',
        'src/js/projects/projects-page.js',
        'src/js/admin/admin-page.js',
        'src/js/calibration/calibracao-page.js',
    ];

    it.each(ENTRIES)('%s importa e CHAMA `instalarTelemetriaDeErro`', (relativo) => {
        const fonte = readFileSync(
            fileURLToPath(new URL(`../../${relativo}`, import.meta.url)),
            'utf8',
        );
        expect(fonte).toContain('instalarTelemetriaDeErro');
        expect(fonte).toContain('erro-telemetria.js');
        // A CHAMADA, e não só o import: um import sem chamada é fiação que não liga nada.
        expect(fonte).toMatch(/instalarTelemetriaDeErro\(/);
    });
});

describe('A6 — a FORMA do valor, nunca o conteúdo', () => {
    // CONTROLE NEGATIVO: devolva o `JSON.stringify(valor).slice(0, TETOS.mensagem)` ao ramo de
    // objeto de `textoDeErro` e os dois primeiros casos daqui ficam vermelhos, mais o repro
    // inteiro de `relato-sem-conteudo-de-usuario.repro.test.js`.

    it('nomeia o tipo e as chaves de topo, ORDENADAS', () => {
        expect(formaDeValor({ b: 1, a: 2 })).toBe('Object{a,b}');
        expect(formaDeValor([1, 2, 3])).toBe('Array{0,1,2}');
    });

    it('a ordem de inserção NÃO muda a saída (senão a assinatura mudaria de grupo)', () => {
        expect(formaDeValor({ z: 1, a: 2, m: 3 })).toBe(formaDeValor({ a: 2, m: 3, z: 1 }));
    });

    it('corta em doze chaves e diz quantas sobraram', () => {
        const largo = Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i]),
        );
        const saida = formaDeValor(largo);
        expect(saida).toContain(',+8}');
        expect(saida).toContain('k00');
        expect(saida).not.toContain('k12');
    });

    it('só DUAS chaves têm o VALOR mostrado, e só quando são string ou número', () => {
        expect(formaDeValor({ code: 'E1', status: 404, message: 42, nome: 'Cel Fulano' }))
            .toBe('Object{code,message,nome,status} code=E1 status=404');
        // O valor de `nome` não aparece; o NOME da chave sim, porque nome de chave é esquema.
        expect(formaDeValor({ nome: 'Cel Fulano' })).toBe('Object{nome}');
    });

    it('`message` NÃO tem o valor mostrado: é texto livre de procedência desconhecida', () => {
        // Era a terceira chave do vocabulário e saiu em 2026-09-01: `message` é justamente o campo
        // em que um servidor ecoa o que o usuário escreveu, e deixá-la passar era o resíduo do
        // vazamento que este bloco inteiro existe para fechar.
        const saida = formaDeValor({ message: "a feição 'Posto do Cel Fulano' não pôde ser salva" });
        expect(saida).toBe('Object{message}');
        expect(saida).not.toContain('Fulano');
    });

    it('valor de vocabulário longo é cortado', () => {
        expect(formaDeValor({ code: 'x'.repeat(200) }).length).toBeLessThan(80);
    });

    it('objeto hostil (constructor e keys que explodem) não lança', () => {
        const hostil = new Proxy({}, {
            get() { throw new Error('explodi'); },
            ownKeys() { throw new Error('explodi'); },
        });
        expect(() => formaDeValor(hostil)).not.toThrow();
        expect(typeof formaDeValor(hostil)).toBe('string');
    });

    it('classe nomeada mantém o nome (é metade do diagnóstico)', () => {
        class RespostaDoServidor { constructor() { this.status = 502; } }
        expect(formaDeValor(new RespostaDoServidor())).toBe('RespostaDoServidor{status} status=502');
    });
});

describe('A4 — a pilha CRUA viaja ao lado da normalizada', () => {
    it('a ASSINATURA é idêntica com e sem `stackBruta`', () => {
        // Se a bruta entrasse na chave, cada carga da página viraria um grupo novo — que é
        // exatamente o defeito que `normalizarStack` existe para impedir.
        const com = montarCorpo({ mensagem: 'boom', stack: PILHA, stackBruta: PILHA });
        const sem = montarCorpo({ mensagem: 'boom', stack: PILHA });
        expect(com.assinatura).toBe(sem.assinatura);
        expect(com.mensagem).toBe(sem.mensagem);
        expect(com.stack).toBe(sem.stack);
    });

    it('a normalizada troca o hash; a bruta o preserva (é o que resolve o sourcemap)', () => {
        const corpo = montarCorpo({ mensagem: 'boom', stack: PILHA, stackBruta: PILHA });
        expect(corpo.stack).toContain('core-<hash>.js');
        expect(corpo.stackBruta).toContain('core-Ab12Cd34.js');
    });

    it('ausente ou vazia, o campo simplesmente não existe', () => {
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x' }), 'stackBruta')).toBe(false);
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x', stackBruta: '' }), 'stackBruta'))
            .toBe(false);
    });

    it('é cortada no mesmo teto de 4000 da rota', () => {
        const corpo = montarCorpo({ mensagem: 'x', stackBruta: 'b'.repeat(9000) });
        expect(corpo.stackBruta).toHaveLength(TETOS.stackBruta);
    });

    it('a captura de verdade manda as duas', () => {
        ativa = instalarEspiao();
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados[0].stack).toContain('core-<hash>.js');
        expect(ativa.enviados[0].stackBruta).toContain('core-Ab12Cd34.js');
    });
});

describe('A2 — o id da aba entra no corpo, com o mesmo filtro do atlasId', () => {
    it('UUID entra', () => {
        expect(montarCorpo({ mensagem: 'x', sessaoId: SESSAO }).sessaoId).toBe(SESSAO);
    });

    it('o que não é UUID NÃO entra (a coluna é `uuid`, e o 422 custaria o relato inteiro)', () => {
        for (const ruim of ['abc', '', null, undefined, 42, `${SESSAO}x`]) {
            expect(Object.hasOwn(montarCorpo({ mensagem: 'x', sessaoId: ruim }), 'sessaoId'))
                .toBe(false);
        }
    });

    it('a captura de verdade carimba o id, e o resolvedor que EXPLODE não custa o envio', () => {
        ativa = instalarEspiao();
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados[0].sessaoId).toBe(SESSAO);
        ativa.instalacao.desinstalar();

        ativa = instalarEspiao({ resolverSessaoId: () => { throw new Error('sem storage'); } });
        ativa.alvo.emitir('error', { error: erroCom('outro', PILHA) });
        expect(ativa.enviados).toHaveLength(1);
        expect(Object.hasOwn(ativa.enviados[0], 'sessaoId')).toBe(false);
    });
});

describe('A3 — origem é ETIQUETA, contexto é ENUMERAÇÃO', () => {
    it('a origem NÃO entra na assinatura: o mesmo defeito por duas portas é um grupo só', () => {
        const a = montarCorpo({ mensagem: 'boom', stack: PILHA, origem: OrigemDeErro.CONSOLE });
        const b = montarCorpo({ mensagem: 'boom', stack: PILHA, origem: OrigemDeErro.STORE });
        expect(a.assinatura).toBe(b.assinatura);
        expect(a.origem).not.toBe(b.origem);
    });

    it('origem com forma estranha não viaja', () => {
        for (const ruim of ['MAIÚSCULA', 'com espaço', 'x'.repeat(40), 42, {}, null]) {
            expect(Object.hasOwn(montarCorpo({ mensagem: 'x', origem: ruim }), 'origem')).toBe(false);
        }
    });

    it('as dez origens do vocabulário passam pela forma que `montarCorpo` exige', () => {
        for (const origem of ORIGENS_DE_ERRO) {
            expect(montarCorpo({ mensagem: 'x', origem }).origem).toBe(origem);
        }
    });

    it('o contexto só deixa passar as CINCO chaves; qualquer outra some', () => {
        const seguro = contextoSeguro({
            atlasKind: 'servidor',
            conexao: 'ONLINE',
            causa: 'STORE_PERSIST_ERROR',
            camada: 'relevo-sombreado',
            status: 403,
            // O que um objeto livre traria, e que é justamente o que não pode viajar.
            feature: { nome: 'Posto Fulano', coords: [-22.123456, -43.987654] },
            payload: 'texto do usuário',
        });
        expect(Object.keys(seguro).sort())
            .toEqual(['atlasKind', 'camada', 'causa', 'conexao', 'status']);
        expect(JSON.stringify(seguro)).not.toContain('Fulano');
        expect(JSON.stringify(seguro)).not.toContain('22.12');
    });

    it('atlasKind fora dos três não viaja', () => {
        for (const kind of TIPOS_DE_ATLAS) {
            expect(contextoSeguro({ atlasKind: kind }).atlasKind).toBe(kind);
        }
        expect(contextoSeguro({ atlasKind: 'inventado' })).toBeNull();
    });

    it('cada campo de texto tem o teto declarado', () => {
        for (const [campo, teto] of Object.entries(TETOS_DE_CONTEXTO)) {
            expect(contextoSeguro({ [campo]: 'z'.repeat(500) })[campo]).toHaveLength(teto);
        }
    });

    it('status fora da faixa HTTP não viaja (o 0 do fetch não é resposta)', () => {
        expect(contextoSeguro({ status: 403 }).status).toBe(403);
        expect(contextoSeguro({ status: 0 })).toBeNull();
        expect(contextoSeguro({ status: 99 })).toBeNull();
        expect(contextoSeguro({ status: 600 })).toBeNull();
        expect(contextoSeguro({ status: 403.5 })).toBeNull();
        expect(contextoSeguro({ status: NaN })).toBeNull();
        expect(contextoSeguro({ status: '403' })).toBeNull();
    });

    it('contexto vazio, ausente ou de tipo errado não cria o campo', () => {
        for (const ruim of [undefined, null, 'texto', 42, [], {}, { nada: 1 }]) {
            expect(Object.hasOwn(montarCorpo({ mensagem: 'x', contexto: ruim }), 'contexto'))
                .toBe(false);
        }
    });

    it('o corpo CHEIO tem os doze campos do contrato, e nem um a mais', () => {
        const corpo = montarCorpo({
            mensagem: 'x', stack: PILHA, stackBruta: PILHA, url: 'http://local/', pagina: 'mapa',
            release: '1.0.0', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            userAgent: 'Mozilla/5.0', sessaoId: SESSAO, origem: OrigemDeErro.WS,
            contexto: { causa: 'closed' },
        });
        expect(Object.keys(corpo).sort()).toEqual([
            'assinatura', 'atlasId', 'contexto', 'mensagem', 'origem', 'pagina', 'release',
            'sessaoId', 'stack', 'stackBruta', 'url', 'userAgent',
        ]);
    });
});

describe('A3 — `relatarErro`: a porta manual atravessa o MESMO portão', () => {
    it('antes da instalação é inerte, e CONTA (nunca lança)', () => {
        const antes = estadoDaTelemetria().naoInstalado;
        expect(relatarErro(new Error('cedo demais'), { origem: OrigemDeErro.STORE })).toBe(false);
        expect(estadoDaTelemetria().naoInstalado).toBe(antes + 1);
        expect(estadoDaTelemetria().instalada).toBe(false);
    });

    it('instalada, ela produz um corpo com a origem pedida', () => {
        ativa = instalarEspiao();
        expect(relatarErro(erroCom('manual', PILHA), {
            origem: OrigemDeErro.STORE,
            contexto: { causa: 'STORE_PERSIST_ERROR' },
        })).toBe(true);
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].origem).toBe(OrigemDeErro.STORE);
        expect(ativa.enviados[0].contexto).toEqual({ causa: 'STORE_PERSIST_ERROR' });
    });

    it('origem fora do vocabulário vira a padrão, em vez de custar o relato num 422', () => {
        ativa = instalarEspiao();
        relatarErro(erroCom('manual', PILHA), { origem: 'inventada' });
        expect(ativa.enviados[0].origem).toBe(OrigemDeErro.NAO_TRATADO);
    });

    it('o MESMO defeito por duas portas é UM envio (a origem não separa)', () => {
        ativa = instalarEspiao({ intervaloMs: 0 });
        const erro = erroCom('mesmo defeito', PILHA);
        relatarErro(erro, { origem: OrigemDeErro.STORE });
        ativa.avancar(10);
        ativa.alvo.emitir('error', { error: erro });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].origem).toBe(OrigemDeErro.STORE);
    });

    it('ela respeita o teto da sessão como os automáticos', () => {
        ativa = instalarEspiao({ max: 2, intervaloMs: 0 });
        for (let i = 0; i < 6; i++) {
            ativa.avancar(10);
            relatarErro(erroCom(`manual ${i}`, `at f (http://local/m${i}.js:1:1)`), {
                origem: OrigemDeErro.WS,
            });
        }
        expect(ativa.enviados).toHaveLength(2);
    });

    it('os dois automáticos carimbam as origens certas', () => {
        ativa = instalarEspiao({ intervaloMs: 0 });
        ativa.alvo.emitir('error', { error: erroCom('a', 'at f (http://local/a.js:1:1)') });
        ativa.avancar(10);
        ativa.alvo.emitir('unhandledrejection', {
            reason: erroCom('b', 'at f (http://local/b.js:1:1)'),
        });
        expect(ativa.enviados.map((c) => c.origem))
            .toEqual([OrigemDeErro.NAO_TRATADO, OrigemDeErro.REJEICAO]);
    });
});

describe('A3 — o embrulho de `console.error`', () => {
    it('o original é SEMPRE chamado, e antes de tudo', () => {
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({ alvo });
        alvo.console.error('falhou de verdade');
        expect(alvo.linhas).toHaveLength(1);
        expect(alvo.linhas[0][0]).toBe('falhou de verdade');
    });

    it('string vira relato com origem `console`', () => {
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({ alvo });
        alvo.console.error('[Store] falhou');
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].origem).toBe(OrigemDeErro.CONSOLE);
        expect(ativa.enviados[0].mensagem).toContain('[Store] falhou');
    });

    it('objeto no primeiro argumento NÃO vira relato (despejo de estado é dado do usuário)', () => {
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({ alvo });
        alvo.console.error({ nome: 'Cel Fulano', coords: [-22.123456] });
        expect(ativa.enviados).toHaveLength(0);
        expect(alvo.linhas).toHaveLength(1);
    });

    it('`console.error(rótulo, erro)` relata o ERRO, e dedupe com o relato explícito', () => {
        // É a forma dominante no produto, e é o que impede DOIS grupos para um defeito só.
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({ alvo, intervaloMs: 0 });
        const erro = erroCom('boom de boot', PILHA);
        alvo.console.error('Application initialization failed:', erro);
        ativa.avancar(10);
        relatarErro(erro, { origem: OrigemDeErro.BOOT });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].mensagem).toContain('boom de boot');
    });

    it('o log DA PRÓPRIA telemetria não vira captura', () => {
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({
            alvo,
            intervaloMs: 0,
            aoEnviar: () => { alvo.console.error('erro dentro do envio'); },
        });
        alvo.console.error('primeiro');
        expect(ativa.enviados).toHaveLength(1);
        expect(estadoDaTelemetria().reentrancias).toBeGreaterThanOrEqual(1);
    });

    it('a mesma linha num laço é UMA assinatura', () => {
        const alvo = criarAlvo({ comConsole: true });
        ativa = instalarEspiao({ alvo, intervaloMs: 0 });
        for (let i = 0; i < 19; i++) {
            ativa.avancar(10);
            alvo.console.error('a mesma linha');
        }
        expect(ativa.enviados).toHaveLength(1);
        expect(alvo.linhas).toHaveLength(19);
    });

    it('desinstalar devolve o `console.error` original', () => {
        const alvo = criarAlvo({ comConsole: true });
        const original = alvo.console.error;
        const espiao = instalarEspiao({ alvo });
        expect(alvo.console.error).not.toBe(original);
        espiao.instalacao.desinstalar();
        expect(alvo.console.error).toBe(original);
    });

    it('alvo SEM console não embrulha nada (e não toca o console do processo)', () => {
        ativa = instalarEspiao();
        expect(ativa.instalacao.instalada).toBe(true);
    });
});

describe('A5 — a fila: o que não sai fica guardado, e sai no próximo boot', () => {
    it('promessa rejeitada enfileira o corpo', async () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        ativa = instalarEspiao({ fila, aoEnviar: () => Promise.reject(new Error('sem rede')) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        await Promise.resolve();
        await Promise.resolve();
        expect(fila.tamanho()).toBe(1);
        expect(estadoDaTelemetria().enfileirados).toBeGreaterThanOrEqual(1);
    });

    it('resposta NÃO-2xx também enfileira (um 502 descarta tão calado quanto um cabo solto)', async () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        ativa = instalarEspiao({ fila, aoEnviar: () => Promise.resolve({ ok: false, status: 502 }) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        await Promise.resolve();
        await Promise.resolve();
        expect(fila.tamanho()).toBe(1);
    });

    it('4xx que recusa o RELATO (422) não enfileira e conta como recusado', async () => {
        // Reenviar o mesmo corpo no próximo boot receberia o mesmo 422; guardá-lo ocuparia para
        // sempre uma das trinta vagas. 408 e 429 são a exceção: o servidor pede para voltar depois.
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        const antes = estadoDaTelemetria().recusados;
        ativa = instalarEspiao({ fila, aoEnviar: () => Promise.resolve({ ok: false, status: 422 }) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        await Promise.resolve();
        await Promise.resolve();
        expect(fila.tamanho()).toBe(0);
        expect(estadoDaTelemetria().recusados).toBe(antes + 1);
        expect(estadoDaTelemetria().falhasDeEnvio).toBeGreaterThanOrEqual(1);
    });

    it('429 e 408 enfileiram (o servidor pediu para voltar depois)', async () => {
        for (const status of [429, 408]) {
            ativa?.instalacao.desinstalar();
            const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
            ativa = instalarEspiao({ fila, aoEnviar: () => Promise.resolve({ ok: false, status }) });
            ativa.alvo.emitir('error', { error: erroCom(`boom ${status}`, PILHA) });
            await Promise.resolve();
            await Promise.resolve();
            expect(fila.tamanho(), `status ${status}`).toBe(1);
        }
    });

    it('resposta 2xx NÃO enfileira', async () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        ativa = instalarEspiao({ fila, aoEnviar: () => Promise.resolve({ ok: true, status: 204 }) });
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        await Promise.resolve();
        await Promise.resolve();
        expect(fila.tamanho()).toBe(0);
    });

    it('`descarregarFilaDeRelatos` manda o que estava guardado, EM SÉRIE, e esvazia', async () => {
        const armazenamento = criarArmazenamento();
        const fila = criarFilaDeRelatos({ storage: armazenamento });
        fila.enfileirar(montarCorpo({ mensagem: 'de ontem 1', stack: 'at f (http://local/a.js:1:1)' }));
        fila.enfileirar(montarCorpo({ mensagem: 'de ontem 2', stack: 'at f (http://local/b.js:1:1)' }));
        ativa = instalarEspiao({ fila, intervaloMs: 2000 });
        const chegaram = await descarregarFilaDeRelatos();
        expect(chegaram).toBe(2);
        expect(ativa.enviados.map((c) => c.mensagem)).toEqual(['de ontem 1', 'de ontem 2']);
        expect(fila.tamanho()).toBe(0);
        expect(estadoDaTelemetria().descarregados).toBeGreaterThanOrEqual(2);
    });

    it('o INTERVALO não corta o descarregamento (senão vinte e nove itens morriam no mesmo ms)', async () => {
        // CONTROLE NEGATIVO: tire o `ignorarIntervalo` de `permite` e este caso cai para 1.
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        for (let i = 0; i < 5; i++) {
            fila.enfileirar(montarCorpo({
                mensagem: `guardado ${i}`, stack: `at f (http://local/g${i}.js:1:1)`,
            }));
        }
        ativa = instalarEspiao({ fila, intervaloMs: 10_000 });
        expect(await descarregarFilaDeRelatos()).toBe(5);
    });

    it('o TETO da sessão continua valendo, e o recusado por ele VOLTA para a fila', async () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        for (let i = 0; i < 4; i++) {
            fila.enfileirar(montarCorpo({
                mensagem: `guardado ${i}`, stack: `at f (http://local/g${i}.js:1:1)`,
            }));
        }
        ativa = instalarEspiao({ fila, max: 2, intervaloMs: 0 });
        expect(await descarregarFilaDeRelatos()).toBe(2);
        // Os dois que sobraram não morreram: a próxima carga da página tem orçamento novo.
        expect(fila.tamanho()).toBe(2);
    });

    it('o que falha de novo é REENFILEIRADO, não perdido', async () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        fila.enfileirar(montarCorpo({ mensagem: 'insistente', stack: 'at f (http://local/a.js:1:1)' }));
        ativa = instalarEspiao({ fila, aoEnviar: () => Promise.reject(new Error('ainda fora')) });
        expect(await descarregarFilaDeRelatos()).toBe(0);
        expect(fila.tamanho()).toBe(1);
    });

    it('fila vazia é um no-op silencioso', async () => {
        ativa = instalarEspiao();
        expect(await descarregarFilaDeRelatos()).toBe(0);
        expect(ativa.enviados).toHaveLength(0);
    });

    it('sem instalação, descarregar é inerte e CONTA', async () => {
        const antes = estadoDaTelemetria().naoInstalado;
        expect(await descarregarFilaDeRelatos()).toBe(0);
        expect(estadoDaTelemetria().naoInstalado).toBe(antes + 1);
    });

    it('`enfileirarSempre` guarda SEM tocar a rede (o servidor está fora, por definição)', () => {
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        ativa = instalarEspiao({ fila });
        expect(relatarErro('EBGeo indisponível: server-unreachable', {
            origem: OrigemDeErro.INDISPONIVEL,
            contexto: { causa: 'server-unreachable' },
            enfileirarSempre: true,
        })).toBe(true);
        expect(ativa.enviados).toHaveLength(0);
        expect(fila.tamanho()).toBe(1);
        expect(fila.drenar()[0].origem).toBe(OrigemDeErro.INDISPONIVEL);
    });

    it('com a fila RECUSANDO, `enfileirarSempre` cai na rede em vez de perder o relato', () => {
        // Armazenamento bloqueado (modo privado) é o caso: a rede é o que sobra.
        const fila = criarFilaDeRelatos({ storage: null });
        ativa = instalarEspiao({ fila });
        relatarErro('EBGeo indisponível: app-error', {
            origem: OrigemDeErro.INDISPONIVEL,
            enfileirarSempre: true,
        });
        expect(ativa.enviados).toHaveLength(1);
    });
});

describe('A1 — `versaoDoBuild`: versão MAIS commit', () => {
    afterEach(() => {
        delete globalThis.__APP_VERSION__;
        delete globalThis.__APP_RELEASE__;
    });

    it('fora do bundle (nenhum dos dois definidos) devolve null, nunca ReferenceError', () => {
        expect(() => versaoDoBuild()).not.toThrow();
        expect(versaoDoBuild()).toBeNull();
    });

    it('com hash, `versao+hash`', () => {
        globalThis.__APP_VERSION__ = '1.2.3';
        globalThis.__APP_RELEASE__ = 'a1b2c3d';
        expect(versaoDoBuild()).toBe('1.2.3+a1b2c3d');
    });

    it('sem hash (build sem git), só a versão', () => {
        globalThis.__APP_VERSION__ = '1.2.3';
        globalThis.__APP_RELEASE__ = '';
        expect(versaoDoBuild()).toBe('1.2.3');
    });

    it('cortado no teto de 100 que a rota valida', () => {
        globalThis.__APP_VERSION__ = 'v'.repeat(90);
        globalThis.__APP_RELEASE__ = 'h'.repeat(90);
        expect(versaoDoBuild()).toHaveLength(TETOS.release);
    });

    it('o `release` do corpo é o que `versaoDoBuild` devolve', () => {
        globalThis.__APP_VERSION__ = '9.9.9';
        globalThis.__APP_RELEASE__ = 'deadbee';
        ativa = instalarEspiao();
        ativa.alvo.emitir('error', { error: erroCom('boom', PILHA) });
        expect(ativa.enviados[0].release).toBe('9.9.9+deadbee');
    });
});

describe('fiação dos emissores: cada porta chama `relatarErro` com a origem dela', () => {
    // ESTRUTURAL de propósito, como o teste das quatro páginas logo acima: os cinco emissores
    // vivem em módulos que precisam de MapLibre, de Cesium, de Three.js ou do barril do store, e
    // a camada hermética não os executa. O que se prende de graça é que a chamada não SAIA numa
    // refatoração — que é como a telemetria volta a não ver nada sem ninguém perceber.
    const EMISSORES = [
        ['src/js/index.js', 'OrigemDeErro.BOOT'],
        ['src/js/store/store-error-listener.js', 'OrigemDeErro.STORE'],
        ['src/js/store/sync/ws-client.js', 'OrigemDeErro.WS'],
        ['src/js/ui/unavailable-screen.js', 'OrigemDeErro.INDISPONIVEL'],
    ];

    it.each(EMISSORES)('%s relata com %s', (relativo, origem) => {
        const fonte = readFileSync(
            fileURLToPath(new URL(`../../${relativo}`, import.meta.url)),
            'utf8',
        );
        expect(fonte).toMatch(/relatarErro\(/);
        expect(fonte).toContain(origem);
    });

    it('o painel de falha de camada relata pela superfície, com UM ponto só', () => {
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/terrain/layer-failure-notice.js', import.meta.url)),
            'utf8',
        );
        expect(fonte).toMatch(/relatarErro\(/);
        expect(fonte).toContain('origemDeSuperficie(kind)');
        // O NOME humano da camada nunca viaja; o id, sim.
        expect(fonte).toMatch(/camada: layerId/);
    });

    it('o cabeçalho `X-EBGeo-Sessao` sai de `_request`, e de um lugar só', () => {
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/store/sync/api-client.js', import.meta.url)),
            'utf8',
        );
        // A ATRIBUIÇÃO, e não a string solta: a contagem anterior casava também o comentário que
        // a explica, então apagar (ou acrescentar) um comentário mexia num número que deveria
        // falar só sobre código.
        expect([...fonte.matchAll(/headers\['X-EBGeo-Sessao'\]/g)]).toHaveLength(1);
        // RELATIVO, e não `@js/`: `api-client.js` é importado em node pelos helpers do
        // Playwright, onde o alias não existe. O alias aqui derrubava toda spec de UI.
        expect(fonte).toContain("import { sessaoId } from '../../session/sessao-id.js'");
    });

    it('o boot do MAPA descarrega a fila DEPOIS do `applyRuntimeConfig` que deu certo', () => {
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/index.js', import.meta.url)),
            'utf8',
        );
        const iConfig = fonte.indexOf('runtimeConfig.applied');
        const iDrenar = fonte.indexOf('descarregarFilaDeRelatos()');
        expect(iConfig).toBeGreaterThan(-1);
        expect(iDrenar).toBeGreaterThan(iConfig);
    });

    it.each([
        'src/js/index.js',
        'src/js/projects/projects-page.js',
        'src/js/admin/admin-page.js',
        'src/js/calibration/calibracao-page.js',
    ])('%s DRENA a fila (senão o relato fica preso na página que o guardou)', (relativo) => {
        // As TRÊS páginas sem mapa também guardam relato (o `APP_ERROR` do admin é o caso), e uma
        // fila que só o mapa esvazia faz a notícia esperar uma visita que pode não acontecer.
        const fonte = readFileSync(
            fileURLToPath(new URL(`../../${relativo}`, import.meta.url)),
            'utf8',
        );
        expect(fonte).toMatch(/descarregarFilaDeRelatos\(\)/);
        expect(fonte).toContain('erro-telemetria.js');
    });
});

describe('A5 — a tela de indisponibilidade escolhe entre a fila e a rede, e a escolha é por CAUSA', () => {
    // O DEFEITO QUE ISTO IMPEDE: enfileirar SEMPRE. As duas causas dizem coisas opostas sobre o
    // servidor, e tratá-las juntas atrasava até a próxima visita (que pode não acontecer) a única
    // notícia de um erro do NOSSO código, num momento em que a rede estava perfeitamente de pé.

    it('servidor inalcançável ENFILEIRA: o relato daquele fato não tem para onde ir', () => {
        expect(deveEnfileirarIndisponivel(BlockingCause.SERVER_UNREACHABLE)).toBe(true);
    });

    it('erro do aplicativo ENVIA: o servidor respondeu, e a frase da tela diz isso', () => {
        expect(deveEnfileirarIndisponivel(BlockingCause.APP_ERROR)).toBe(false);
    });

    it('causa desconhecida ENVIA (falha para o lado da notícia que chega agora)', () => {
        for (const ruim of [undefined, null, '', 'inventada', 42, {}]) {
            expect(deveEnfileirarIndisponivel(ruim)).toBe(false);
        }
    });

    it('as duas causas produzem desfechos DIFERENTES no transporte', () => {
        // O par, contra a telemetria de verdade: uma vai para a fila sem tocar a rede, a outra sai.
        const fila = criarFilaDeRelatos({ storage: criarArmazenamento() });
        ativa = instalarEspiao({ fila, intervaloMs: 0 });

        relatarErro(`EBGeo indisponível: ${BlockingCause.SERVER_UNREACHABLE}`, {
            origem: OrigemDeErro.INDISPONIVEL,
            contexto: { causa: BlockingCause.SERVER_UNREACHABLE },
            enfileirarSempre: deveEnfileirarIndisponivel(BlockingCause.SERVER_UNREACHABLE),
        });
        expect(ativa.enviados).toHaveLength(0);
        expect(fila.tamanho()).toBe(1);

        ativa.avancar(10);
        relatarErro(`EBGeo indisponível: ${BlockingCause.APP_ERROR}`, {
            origem: OrigemDeErro.INDISPONIVEL,
            contexto: { causa: BlockingCause.APP_ERROR },
            enfileirarSempre: deveEnfileirarIndisponivel(BlockingCause.APP_ERROR),
        });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].contexto).toEqual({ causa: BlockingCause.APP_ERROR });
        expect(fila.tamanho()).toBe(1);
    });

    it('a tela usa a função, e não repete a decisão à mão', () => {
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/ui/unavailable-screen.js', import.meta.url)),
            'utf8',
        );
        expect(fonte).toMatch(/enfileirarSempre: deveEnfileirarIndisponivel\(cause\)/);
    });
});

describe('B — as MIGALHAS entram no corpo, com os tetos aplicados ANTES do envio', () => {
    // A TRILHA responde o que o relato sozinho nunca respondeu: o CAMINHO até o defeito. A mesma
    // assinatura de `Cannot read properties of undefined` é outra coisa quando um `POST /sync`
    // voltou 500 três vezes antes, e as duas leituras pedem providências opostas.
    //
    // `montarCorpo` a recebe como VALOR e não por import, porque este módulo é folha de zero
    // imports: quem lê o anel é a fiação, no último instante antes do envio.

    /** Uma trilha de N migalhas bem formadas. */
    const trilha = (n) => Array.from({ length: n }, (_, i) => ({
        t: 1000 + i, tipo: 'evento', texto: `fato ${i}`,
    }));

    it('a trilha viaja no corpo quando existe', () => {
        const corpo = montarCorpo({ mensagem: 'x', migalhas: trilha(3) });
        expect(corpo.migalhas).toHaveLength(3);
        expect(corpo.migalhas[0]).toEqual({ t: 1000, tipo: 'evento', texto: 'fato 0' });
    });

    it('a trilha VAZIA não vira campo (lista vazia diria "não houve nada antes")', () => {
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x', migalhas: [] }), 'migalhas')).toBe(false);
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x' }), 'migalhas')).toBe(false);
        expect(Object.hasOwn(montarCorpo({ mensagem: 'x', migalhas: null }), 'migalhas')).toBe(false);
    });

    it('acima de trinta o corte é pelo FIM: sobra o que está mais perto do erro', () => {
        // Ao contrário da fila de relatos, que corta pela frente. Aqui os fatos que explicam o
        // desfecho são os últimos.
        const corpo = montarCorpo({ mensagem: 'x', migalhas: trilha(45) });
        expect(corpo.migalhas).toHaveLength(TETOS_DE_MIGALHA.itens);
        expect(corpo.migalhas[TETOS_DE_MIGALHA.itens - 1].texto).toBe('fato 44');
    });

    it('cada item sai com EXATAMENTE três campos, e a chave a mais é impossível', () => {
        // A rota roda com `unknown(false)`, onde a chave a mais derruba o relato INTEIRO num 422
        // (é a mesma armadilha já paga em `contexto`). Por isso o item é RECONSTRUÍDO.
        const corpo = montarCorpo({
            mensagem: 'x',
            migalhas: [{ t: 1, tipo: 'api', texto: 'GET /config 200 1ms', userId: 'u-1', payload: {} }],
        });
        expect(Object.keys(corpo.migalhas[0]).sort()).toEqual(['t', 'texto', 'tipo']);
        expect(JSON.stringify(corpo.migalhas)).not.toContain('u-1');
    });

    it('tipo e texto são cortados nos tetos da rota', () => {
        const corpo = montarCorpo({
            mensagem: 'x',
            migalhas: [{ t: 1, tipo: 't'.repeat(60), texto: 'x'.repeat(400) }],
        });
        expect(corpo.migalhas[0].tipo).toHaveLength(TETOS_DE_MIGALHA.tipo);
        expect(corpo.migalhas[0].texto).toHaveLength(TETOS_DE_MIGALHA.texto);
    });

    it('item malformado é descartado UM A UM, e o relato inteiro sobrevive', () => {
        // A lista pode ter vindo da fila do `localStorage`, escrita por outra versão do produto.
        const corpo = montarCorpo({
            mensagem: 'x',
            migalhas: [
                null, 42, 'texto solto', [],
                { tipo: 'evento', texto: 'sem t' },
                { t: 'ontem', tipo: 'evento', texto: 'com t inválido' },
                { t: 5, tipo: '', texto: 'sem tipo' },
                { t: 6, tipo: 'evento', texto: '   ' },
                { t: 7, tipo: 'evento', texto: 'a única boa' },
            ],
        });
        expect(corpo.migalhas).toEqual([{ t: 7, tipo: 'evento', texto: 'a única boa' }]);
    });

    it('`migalhasSeguras` nunca lança, para qualquer entrada', () => {
        for (const ruim of [null, undefined, 42, 'texto', {}, new Set()]) {
            expect(() => migalhasSeguras(ruim)).not.toThrow();
            expect(migalhasSeguras(ruim)).toEqual([]);
        }
    });

    it('o `t` fracionário vira inteiro (a coluna do servidor é inteira)', () => {
        expect(migalhasSeguras([{ t: 12.9, tipo: 'e', texto: 'x' }])[0].t).toBe(12);
    });
});

describe('B — as migalhas espelham o Joi da borda, que está no outro pacote', () => {
    // MESMO PAPEL do espelho de cima: o alcance é o VOCABULÁRIO e os TETOS, nunca a semântica. Ele
    // lê a FONTE do outro pacote (o Joi não é dependência do frontend).
    //
    // ELE SE PULA COM MOTIVO ESCRITO enquanto o backend não declarar o campo, e a distinção
    // importa: um espelho que passasse verde contra um schema que não tem o campo seria cobertura
    // vazia, e um que ficasse vermelho confundiria "o outro lado ainda não chegou" com "os dois
    // lados divergem".
    const SCHEMA = '../../../backend/src/modules/diag/diag.schemas.js';

    /** @returns {string|null} A janela do campo `migalhas` no schema, ou `null` se ele não existe. */
    function janelaDasMigalhas() {
        const fonte = readFileSync(fileURLToPath(new URL(SCHEMA, import.meta.url)), 'utf8');
        const inicio = fonte.search(/^\s{2}migalhas:/m);
        if (inicio === -1) return null;
        return fonte.slice(inicio, inicio + 1200);
    }

    const JANELA = janelaDasMigalhas();
    const AUSENTE = JANELA === null;

    describe.skipIf(AUSENTE)(
        AUSENTE
            ? 'PULADO: o `diag.schemas.js` do backend ainda não declara `migalhas`'
            : 'o schema do servidor declara o campo com os tetos deste cliente',
        () => {
            it('`migalhas` é um ARRAY com teto de itens igual ao do cliente', () => {
                expect(JANELA).toMatch(/migalhas:\s*Joi\.array\(\)/);
                const casou = JANELA.match(/\.max\((\d+)\)/);
                expect(casou, 'o `max()` da lista sumiu do servidor').toBeTruthy();
                expect(Number(casou[1]), 'o teto de itens divergiu do servidor')
                    .toBe(TETOS_DE_MIGALHA.itens);
            });

            it('o item tem os TRÊS campos, e `t` é inteiro', () => {
                expect(JANELA).toMatch(/\bt:[^\n]*\.integer\(\)/);
                expect(JANELA).toMatch(/\btipo:[^\n]*Joi\.string\(\)/);
                expect(JANELA).toMatch(/\btexto:[^\n]*Joi\.string\(\)/);
            });

            it('os tetos de `tipo` e `texto` são os `TETOS_DE_MIGALHA` do cliente', () => {
                let conferidos = 0;
                for (const campo of ['tipo', 'texto']) {
                    const casou = JANELA.match(new RegExp(`\\b${campo}:[^\\n]*?\\.max\\((\\d+)\\)`));
                    expect(casou, `\`${campo}\` não tem \`max()\` no schema do servidor`).toBeTruthy();
                    expect(Number(casou[1]), `teto de \`migalhas[].${campo}\` divergiu do servidor`)
                        .toBe(TETOS_DE_MIGALHA[campo]);
                    conferidos++;
                }
                // Cobertura vazia passa verde: sem esta linha, um recorte que parasse de casar
                // reportaria sucesso sem ter comparado um número sequer.
                expect(conferidos, 'nenhum teto de migalha foi comparado').toBe(2);
            });

            it('o item recusa chave desconhecida, como o `contexto`', () => {
                // Se ele NÃO recusasse, uma chave a mais seria descartada em silêncio, e a
                // telemetria chegaria pela metade sem ninguém saber.
                expect(JANELA).toMatch(/unknown\(false\)/);
            });

            it('o corpo cheio deste cliente é aceito pela forma que o servidor declara', () => {
                // Comparação pelo COMPORTAMENTO, e não por um número escrito duas vezes aqui.
                const corpo = montarCorpo({
                    mensagem: 'x',
                    migalhas: [{ t: 1, tipo: 'a'.repeat(TETOS_DE_MIGALHA.tipo), texto: 'b'.repeat(TETOS_DE_MIGALHA.texto) }],
                });
                expect(corpo.migalhas[0].tipo).toHaveLength(TETOS_DE_MIGALHA.tipo);
                expect(corpo.migalhas[0].texto).toHaveLength(TETOS_DE_MIGALHA.texto);
            });
        },
    );
});

describe('B — os alimentadores de migalha que não dependem do barramento', () => {
    // Estes três valem para as QUATRO páginas, e é por isso que eles moram na instalação da
    // telemetria: as outras três bootam sem `initServices()` e portanto sem barramento nenhum.

    it('a instalação registra ONDE a carga começou', () => {
        migalhas.limpar();
        ativa = instalarEspiao({ alvo: criarAlvo({ href: 'http://local/admin.html?aba=catalog' }) });
        const [primeira] = migalhas.listar();
        expect(primeira.tipo).toBe(TipoDeMigalha.NAVEGACAO);
        expect(primeira.texto).toContain('admin');
        expect(primeira.texto).toContain('/admin.html');
        // A QUERY não entra: é ali que moram `?verify=` e `?atlasPublico=`.
        expect(primeira.texto).not.toContain('aba=catalog');
    });

    it('`console.error` deixa migalha, DEPOIS de o relato ter sido montado', () => {
        // A migalha vem depois da captura de propósito: o relato que este mesmo `console.error`
        // produziu não pode carregar a si mesmo como última linha da própria trilha.
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo });
        alvo.console.error('[Store] falhou feio');
        expect(ativa.enviados).toHaveLength(1);
        // O relato leva a trilha ANTERIOR (a navegação da instalação) e NÃO a migalha do próprio
        // `console.error` que o produziu.
        expect(ativa.enviados[0].migalhas.map((m) => m.tipo)).toEqual([TipoDeMigalha.NAVEGACAO]);
        const daConsola = migalhas.listar().filter((m) => m.tipo === TipoDeMigalha.CONSOLE);
        expect(daConsola).toHaveLength(1);
        expect(daConsola[0].texto).toBe('erro: [Store] falhou feio');
    });

    it('`console.warn` deixa migalha e NÃO vira relato', () => {
        // A assimetria é deliberada: aviso é o canal do esperado, e relatá-lo gastaria o teto de
        // vinte envios com coisas que ninguém pediu para saber. Mas "avisou três vezes antes do
        // erro" é justamente a frase que o relato não conseguia contar.
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo });
        alvo.console.warn('[WsClient] socket caiu, tentando de novo');
        expect(ativa.enviados).toHaveLength(0);
        const daConsola = migalhas.listar().filter((m) => m.tipo === TipoDeMigalha.CONSOLE);
        expect(daConsola).toHaveLength(1);
        expect(daConsola[0].texto).toBe('aviso: [WsClient] socket caiu, tentando de novo');
    });

    it('`console.warn(objeto)` NÃO deixa migalha (despejo de estado é dado do usuário)', () => {
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo });
        alvo.console.warn({ nome: 'Cel Fulano', coords: [-22.123456] });
        expect(migalhas.listar().filter((m) => m.tipo === TipoDeMigalha.CONSOLE)).toHaveLength(0);
    });

    it('`console.warn(rótulo, erro)` guarda o rótulo, e o `Error` sozinho guarda a mensagem', () => {
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo });
        alvo.console.warn('renovação proativa desligada', { detalhe: 'x' });
        alvo.console.warn(new Error('token quase vencendo'));
        const textos = migalhas.listar()
            .filter((m) => m.tipo === TipoDeMigalha.CONSOLE)
            .map((m) => m.texto);
        expect(textos).toEqual([
            'aviso: renovação proativa desligada',
            'aviso: token quase vencendo',
        ]);
    });

    it('desinstalar devolve o `console.warn` original', () => {
        const alvo = criarAlvo({ comConsole: true });
        const original = alvo.console.warn;
        const espiao = instalarEspiao({ alvo });
        expect(alvo.console.warn).not.toBe(original);
        espiao.instalacao.desinstalar();
        expect(alvo.console.warn).toBe(original);
    });

    it('o `console.warn` DA PRÓPRIA telemetria não vira migalha', () => {
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({
            alvo,
            aoEnviar: () => { alvo.console.warn('aviso de dentro do envio'); },
        });
        alvo.console.error('o defeito de verdade');
        const textos = migalhas.listar().map((m) => m.texto);
        expect(textos).not.toContain('aviso: aviso de dentro do envio');
    });

    it('a trilha acumulada VIAJA no relato seguinte', () => {
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo, intervaloMs: 0 });
        alvo.console.warn('primeiro aviso');
        ativa.avancar(10);
        alvo.console.error('e então quebrou');
        expect(ativa.enviados).toHaveLength(1);
        const textos = ativa.enviados[0].migalhas.map((m) => m.texto);
        expect(textos).toContain('aviso: primeiro aviso');
        // A navegação da instalação é a primeira da trilha.
        expect(ativa.enviados[0].migalhas[0].tipo).toBe(TipoDeMigalha.NAVEGACAO);
    });

    it('a normalização do relato vale para a trilha (o mesmo UUID vira o mesmo marcador)', () => {
        const alvo = criarAlvo({ comConsole: true });
        migalhas.limpar();
        ativa = instalarEspiao({ alvo });
        alvo.console.warn('atlas 3f2504e0-4f89-11d3-9a0c-0305e82c3301 sumiu');
        const daConsola = migalhas.listar().filter((m) => m.tipo === TipoDeMigalha.CONSOLE);
        expect(daConsola[0].texto).toBe('aviso: atlas <uuid> sumiu');
    });
});

describe('B — `servidor` é do BACKEND: este cliente nunca a envia', () => {
    it('`relatarErro` com origem `servidor` cai em `nao-tratado`', () => {
        // Ela É válida no vocabulário (os dois pacotes compartilham a lista, e um segundo enum
        // "quase igual" divergiria do primeiro no primeiro dia) e NÃO é do cliente: mandá-la daqui
        // seria o navegador se passando por servidor num relatório que ninguém confere.
        ativa = instalarEspiao();
        relatarErro(new Error('boom'), { origem: 'servidor' });
        expect(ativa.enviados).toHaveLength(1);
        expect(ativa.enviados[0].origem).toBe(OrigemDeErro.NAO_TRATADO);
    });

    it('as outras dez continuam atravessando como etiqueta', () => {
        let conferidos = 0;
        for (const origem of ORIGENS_DO_CLIENTE) {
            ativa?.instalacao?.desinstalar?.();
            ativa = instalarEspiao({ intervaloMs: 0 });
            relatarErro(new Error(`boom ${origem}`), { origem });
            expect(ativa.enviados[0].origem).toBe(origem);
            conferidos++;
        }
        expect(conferidos, 'nenhuma origem foi conferida').toBe(ORIGENS_DE_ERRO.length - 1);
    });
});
