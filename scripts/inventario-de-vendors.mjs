#!/usr/bin/env node
/**
 * Regenera o manifesto de vendors e o confere contra o arquivo versionado.
 *
 * O manifesto mora em docs/seguranca/dependencias-lancamento-inventario.json, sob
 * ["2026-09-13"].vendorInventory2026_09_13.manifestoCompleto.arquivos, e o campo
 * `comoRefazer` daquele bloco descrevia o procedimento em PROSA: "git ls-files das
 * duas pastas, e para cada caminho o sha256 do conteudo e o sha256 do conteudo com
 * CRLF trocado por LF". Procedimento em prosa nao e reprodutivel: quem o repetisse
 * escreveria o proprio laco, com a propria decisao sobre o que normalizar, e a
 * conferencia seguinte compararia duas medicoes que nunca foram a mesma medicao.
 * Este arquivo e aquela prosa executavel.
 *
 *   node scripts/inventario-de-vendors.mjs            # relatorio legivel
 *   node scripts/inventario-de-vendors.mjs --check     # sai 1 se divergir
 *   node scripts/inventario-de-vendors.mjs --json      # manifesto no formato do arquivo
 *
 * O EIXO DA CONFERENCIA E O HASH NORMALIZADO PARA LF, e isso nao e detalhe de
 * formatacao. A arvore de trabalho no Windows esta em CRLF (332 dos 408 arquivos),
 * entao o sha256 CRU de um arquivo de texto e uma propriedade do CHECKOUT, nao do
 * conteudo versionado: ele muda entre duas maquinas sem que um byte tenha mudado no
 * repositorio. Conferir por ele devolve o veredito errado, e ja devolveu (um dos
 * wrappers do GDAL pareceu vir de outra versao so por causa disso). O mesmo vale
 * para `bytes`, que conta os CR do checkout: o manifesto continua guardando os dois
 * porque sao a evidencia de COMO a arvore esta, mas quem decide identidade de
 * conteudo e `sha256Lf ?? sha256`.
 *
 * A LISTA DE ARQUIVOS VEM DO GIT, nunca de um caminhar do disco. As duas pastas sao
 * caminho fragil e recebem artefato de build e resto de experimento; um caminhar do
 * disco contaria o que o repositorio nao guarda e acusaria divergencia em arquivo
 * que nenhum SHA candidato carrega. `git ls-files` responde exatamente "o que este
 * commit publica". O teste que mantem os dois alinhados e
 * frontend/tests/unit/inventario-de-vendors.test.js.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** As duas pastas de copia de terceiro que o inventario cobre. */
export const PASTAS_DE_VENDOR = ['frontend/public/vendors', 'frontend/src/vendor'];

export const CAMINHO_DO_MANIFESTO = 'docs/seguranca/dependencias-lancamento-inventario.json';

const CR = 0x0d;
const LF = 0x0a;

/** @param {Buffer} buf @returns {string} */
function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

const decodificadorEstrito = new TextDecoder('utf8', { fatal: true });

/**
 * Se o arquivo e TEXTO, unico caso em que a troca de CRLF por LF quer dizer alguma
 * coisa. O criterio e o do git: nenhum byte NUL, e aqui tambem UTF-8 valido, que e
 * exatamente a condicao sob a qual um ida e volta por string nao perde byte.
 *
 * Nao e zelo: 166 dos 408 artefatos sao PNG, JPG, WASM ou o pacote de dados do GDAL
 * que POR COINCIDENCIA carregam o par de bytes 0D 0A no meio do conteudo comprimido.
 * Tratar esse par como fim de linha inventa um "hash normalizado" para um arquivo que
 * nao tem linha nenhuma, e o numero que sai dali nao identifica conteudo nem casa com
 * upstream: e ruido com forma de evidencia.
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function ehTexto(buf) {
    if (buf.includes(0)) return false;
    try {
        decodificadorEstrito.decode(buf);
        return true;
    } catch {
        return false;
    }
}

/**
 * Troca CRLF por LF sem tocar num CR solitario (que e conteudo, nao fim de linha).
 * Opera em BYTES: um `replace(/\r\n/g, '\n')` sobre string decodifica em utf8 antes,
 * e todo byte invalido volta como U+FFFD, de modo que o buffer de saida nem sequer
 * tem o tamanho do de entrada. Ver `ehTexto` para quem chama isto e quem nao chama.
 *
 * @param {Buffer} buf
 * @returns {Buffer|null} o buffer normalizado, ou null se nao havia CRLF
 */
export function normalizarCrlf(buf) {
    let encontrou = false;
    for (let i = 0; i + 1 < buf.length; i++) {
        if (buf[i] === CR && buf[i + 1] === LF) { encontrou = true; break; }
    }
    if (!encontrou) return null;

    const saida = Buffer.allocUnsafe(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === CR && buf[i + 1] === LF) continue;
        saida[n++] = buf[i];
    }
    return saida.subarray(0, n);
}

/**
 * Os caminhos versionados das duas pastas, na ordem do git (que ja e lexicografica).
 *
 * @param {string} [raiz]
 * @returns {string[]}
 */
export function listarArquivosVersionados(raiz = RAIZ) {
    const saida = execFileSync('git', ['ls-files', '-z', '--', ...PASTAS_DE_VENDOR], {
        cwd: raiz,
        maxBuffer: 64 * 1024 * 1024,
    });
    return saida.toString('utf8').split('\0').filter(Boolean);
}

/**
 * Uma medicao por arquivo versionado, com a classificacao que decide o eixo de
 * comparacao. `sha256Lf` fica null para binario e para texto que ja esta em LF, que
 * sao os dois casos em que ele nao acrescenta nada ao `sha256`.
 *
 * @param {string} [raiz]
 * @returns {Array<{path:string, bytes:number, sha256:string, sha256Lf:string|null, binario:boolean}>}
 */
export function medirArquivos(raiz = RAIZ) {
    return listarArquivosVersionados(raiz).map((path) => {
        const buf = readFileSync(join(raiz, path));
        const binario = !ehTexto(buf);
        const lf = binario ? null : normalizarCrlf(buf);
        return { path, bytes: buf.length, sha256: sha256(buf), sha256Lf: lf ? sha256(lf) : null, binario };
    });
}

/**
 * O manifesto no MESMO formato do arquivo versionado: uma tupla por arquivo,
 * [path, bytes, sha256, sha256Lf].
 *
 * @param {string} [raiz]
 * @returns {Array<[string, number, string, string|null]>}
 */
export function gerarManifesto(raiz = RAIZ) {
    return medirArquivos(raiz).map((m) => [m.path, m.bytes, m.sha256, m.sha256Lf]);
}

/**
 * O manifesto guardado no arquivo versionado.
 *
 * @param {string} [raiz]
 * @returns {Array<[string, number, string, string|null]>}
 */
export function lerManifestoVersionado(raiz = RAIZ) {
    const doc = JSON.parse(readFileSync(join(raiz, CAMINHO_DO_MANIFESTO), 'utf8'));
    const bloco = doc['2026-09-13']?.vendorInventory2026_09_13?.manifestoCompleto;
    if (!Array.isArray(bloco?.arquivos)) {
        throw new Error(`manifesto ausente ou com outra forma em ${CAMINHO_DO_MANIFESTO}`);
    }
    return bloco.arquivos;
}

/**
 * O hash que identifica CONTEUDO independente do checkout, e o "se" aqui e a lição
 * inteira: em arquivo de TEXTO e o normalizado para LF, porque o bruto muda com a
 * configuracao de fim de linha da maquina; em arquivo BINARIO e o bruto, porque o
 * git nao converte binario e um "normalizado" ali so pode ter saido de tratar um
 * 0D 0A de conteudo como fim de linha.
 *
 * Quem manda na classificacao e a medicao de AGORA, nunca o campo guardado: os 166
 * `sha256Lf` binarios do manifesto sao artefato do instrumento de 2026-09-12, e
 * usa-los como eixo faz a conferencia acusar 166 divergencias em arquivos que nao
 * mudaram um byte. A ressalva esta declarada no proprio manifesto.
 *
 * @param {[string, number, string, string|null]} tupla
 * @param {boolean} binario
 * @returns {string}
 */
function identidade(tupla, binario) {
    return binario ? tupla[2] : (tupla[3] ?? tupla[2]);
}

/**
 * Compara o manifesto versionado com a medicao de agora. Quatro classes, e cada uma
 * quer uma acao diferente de quem a ler: `faltando` e arquivo que saiu do
 * repositorio (poda ou renomeacao), `novo` e copia de terceiro que entrou sem passar
 * pelo inventario, `divergente` significa que o mesmo caminho mudou de conteudo, e
 * `bytesDivergentes` e o aviso mais fraco, porque tamanho em arvore CRLF depende do
 * checkout e sozinho nao prova mudanca nenhuma.
 *
 * @param {Array<[string, number, string, string|null]>} versionado
 * @param {ReturnType<typeof medirArquivos>} medicoes
 */
export function compararManifestos(versionado, medicoes) {
    const antes = new Map(versionado.map((t) => [t[0], t]));
    const agora = new Map(medicoes.map((m) => [m.path, m]));

    const faltando = versionado.filter((t) => !agora.has(t[0])).map((t) => t[0]);
    const novo = medicoes.filter((m) => !antes.has(m.path)).map((m) => m.path);
    const divergente = [];
    const bytesDivergentes = [];

    for (const [caminho, m] of agora) {
        const anterior = antes.get(caminho);
        if (!anterior) continue;
        const esperado = identidade(anterior, m.binario);
        const obtido = identidade([m.path, m.bytes, m.sha256, m.sha256Lf], m.binario);
        if (esperado !== obtido) divergente.push({ caminho, esperado, obtido, binario: m.binario });
        if (anterior[1] !== m.bytes) {
            bytesDivergentes.push({ caminho, esperado: anterior[1], obtido: m.bytes });
        }
    }

    return {
        faltando,
        novo,
        divergente,
        bytesDivergentes,
        igual: faltando.length + novo.length + divergente.length === 0,
    };
}

function principal() {
    const args = process.argv.slice(2);
    const medicoes = medirArquivos();

    if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(gerarManifesto())}\n`);
        return;
    }

    const versionado = lerManifestoVersionado();
    const r = compararManifestos(versionado, medicoes);
    const texto = medicoes.filter((m) => !m.binario);

    console.log(`arquivos versionados: ${medicoes.length} (manifesto: ${versionado.length})`);
    console.log(`bytes na arvore:      ${medicoes.reduce((s, m) => s + m.bytes, 0)}`);
    console.log(`texto: ${texto.length} (${texto.filter((m) => m.sha256Lf).length} em CRLF)  binario: ${medicoes.length - texto.length}`);
    console.log(`faltando: ${r.faltando.length}  novos: ${r.novo.length}  divergentes: ${r.divergente.length}  bytes diferentes: ${r.bytesDivergentes.length}`);
    for (const c of r.faltando) console.log(`  - ${c}`);
    for (const c of r.novo) console.log(`  + ${c}`);
    for (const d of r.divergente) console.log(`  ~ ${d.caminho}\n      esperado ${d.esperado}\n      obtido   ${d.obtido}`);
    for (const d of r.bytesDivergentes) console.log(`  b ${d.caminho}: ${d.esperado} -> ${d.obtido}`);

    if (args.includes('--check') && !r.igual) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    principal();
}
