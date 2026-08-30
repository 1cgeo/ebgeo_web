import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    TETOS,
    MotivoDeEnvio,
    SEM_MENSAGEM,
    SEM_QUADRO,
    assinaturaDeErro,
    criarLimitador,
    montarCorpo,
    normalizarMensagem,
    normalizarStack,
    paginaDaUrl,
    quadroUtil,
    textoDeErro,
    truncar,
    urlSegura,
} from '@js/session/erro-telemetria-assinatura.js';
import {
    instalarTelemetriaDeErro,
    estadoDaTelemetria,
} from '@js/session/erro-telemetria.js';

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

/** Um alvo de eventos de mentira, com a superfície que o instalador usa. */
function criarAlvo({ href = 'http://local/index.html' } = {}) {
    const ouvintes = new Map();
    const url = new URL(href);
    return {
        location: { href, pathname: url.pathname },
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
    const instalacao = instalarTelemetriaDeErro({
        alvo,
        agora: () => relogio,
        enviar: (corpo) => {
            enviados.push(corpo);
            return opcoes.aoEnviar ? opcoes.aoEnviar(corpo) : undefined;
        },
        resolverAtlasId: opcoes.resolverAtlasId ?? (() => null),
        resolverBase: () => '/api/v1',
        max: opcoes.max,
        intervaloMs: opcoes.intervaloMs,
    });
    return {
        alvo,
        enviados,
        instalacao,
        avancar: (ms) => { relogio += ms; },
    };
}

/** Uma exceção de código, como o `error` de um `ErrorEvent`. */
function erroCom(mensagem, stack) {
    const e = new Error(mensagem);
    e.stack = stack;
    return e;
}

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

    it('objeto que não é Error vira JSON (mais útil que [object Object])', () => {
        expect(textoDeErro({ status: 500, code: 'X' }).mensagem).toBe('{"status":500,"code":"X"}');
    });

    it('objeto CIRCULAR não lança', () => {
        const circ = { a: 1 };
        circ.self = circ;
        expect(() => textoDeErro(circ)).not.toThrow();
        expect(textoDeErro(circ).mensagem).toBe('[object Object]');
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
        mensagem: 'boom', stack: PILHA, url: 'http://local/', pagina: 'mapa',
        release: '1.0.0', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        userAgent: 'Mozilla/5.0',
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
