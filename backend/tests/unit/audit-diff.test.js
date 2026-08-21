// Path: tests/unit/audit-diff.test.js
//
// O DE-PARA REGISTRA O QUE MUDOU E NUNCA O SEGREDO.
//
// Este arquivo é o guarda de `src/utils/audit-diff.js`, e o defeito que ele existe para
// impedir é permanente: a trilha de auditoria NÃO SE EDITA, então um campo que entre por
// engano na allowlist de VALOR vaza para sempre, e o vazamento fica legível para todo
// administrador e para todo produtor da OM dona. É a razão de a lista ser fechada e de o
// default ser o regime nome-só.
//
// A ORDEM DAS ASSERÇÕES É DELIBERADA em cada caso: primeiro o PISO (o de-para existe e
// registra alguma coisa), depois as ausências. Sem o piso, um `diffAuditavel` que
// devolvesse listas vazias passaria em TODA asserção de "não contém o segredo" — que é a
// cobertura vazia canônica desta casa, um verde que não prova nada.
//
// Os CONTROLES NEGATIVOS de cada caso estão escritos no próprio caso, porque eles são a
// única forma de saber que estas asserções discriminam alguma coisa.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CAMPOS_COM_IMPRESSAO,
  CAMPOS_COM_VALOR,
  LIMITE_DETALHES_BYTES,
  LIMITE_VALOR_LITERAL,
  TAMANHO_IMPRESSAO,
  diffAuditavel,
  impressaoDeValor,
} from '../../src/utils/audit-diff.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Uma miniatura embutida realista: data URL WebP de ~200 kB. */
const THUMB_GRANDE = `data:image/webp;base64,${'QUJD'.repeat(50000)}`;
/** Uma URL de serviço com credencial na query string — o pior caso do regime 2. */
const URL_COM_SEGREDO = 'https://tiles.om.example.mil.br/v1/svc?api_key=SUPERSEGREDO-XPTO';

const entradaDe = (diff, campo) => diff.mudou.find((m) => m.campo === campo);

describe('audit-diff — o de-para seletivo da trilha', () => {
  it('registra o campo permitido e NUNCA o data URL da miniatura nem a URL com credencial', () => {
    const antes = {
      name: 'Modelo X',
      description: 'antes',
      config: { url: '/publico/tileset.json', previewThumbnail: 'data:image/webp;base64,QQ==' },
    };
    const depois = {
      name: 'Modelo X',
      description: 'depois',
      config: { url: URL_COM_SEGREDO, previewThumbnail: THUMB_GRANDE },
    };

    const diff = diffAuditavel(antes, depois);

    // PISO — o de-para EXISTE. Sem esta metade, todas as ausências abaixo passariam
    // idênticas num diff vazio, e o arquivo inteiro seria cobertura vazia.
    assert.deepEqual(
      entradaDe(diff, 'description'),
      { campo: 'description', de: 'antes', para: 'depois' },
      'o regime VALOR precisa registrar o valor literal de um campo pequeno',
    );
    assert.equal(diff.truncado, false, 'este diff cabe no teto; se truncar, o piso acima mente');

    // PISO 2 — os dois campos sensíveis foram MESMO percebidos como mudados. Sem isto,
    // "não contém o segredo" seria verdade por eles nem terem sido comparados.
    const url = entradaDe(diff, 'config.url');
    const thumb = entradaDe(diff, 'config.previewThumbnail');
    assert.equal(url?.regime, 'impressao', 'a URL entra por impressão, e precisa ENTRAR');
    assert.equal(thumb?.regime, 'impressao', 'a miniatura entra por impressão, e precisa ENTRAR');
    assert.notEqual(url.de, url.para, 'a impressão precisa DISCRIMINAR a troca de endereço');
    assert.notEqual(thumb.de, thumb.para);
    assert.equal(url.bytesPara, Buffer.byteLength(URL_COM_SEGREDO, 'utf8'),
      'o tamanho é o que a impressão não diz, e ele é o valor real');

    // A DISCRIMINAÇÃO — o JSON inteiro dos detalhes, que é o que vai para a coluna.
    const serializado = JSON.stringify({ table: 'tilesets', fields: ['name', 'config'], ...diff });
    assert.doesNotMatch(serializado, /data:image/, 'nenhum data URL na trilha');
    assert.equal(serializado.includes('SUPERSEGREDO'), false, 'nenhuma credencial na trilha');
    assert.equal(serializado.includes('api_key'), false, 'nem o nome do parâmetro de credencial');
    assert.equal(serializado.includes(URL_COM_SEGREDO), false, 'nem a URL crua');
    assert.equal(serializado.includes('/publico/tileset.json'), false,
      'nem o endereço ANTIGO: o regime é do campo, não do valor');
    assert.ok(Buffer.byteLength(serializado, 'utf8') < LIMITE_DETALHES_BYTES,
      'a linha inteira cabe no teto mesmo com uma miniatura de 200 kB do outro lado');

    // CONTROLE NEGATIVO, EXECUTADO E MEDIDO: trocar a condição do regime VALOR por
    // `COM_VALOR.has(campo) || COM_IMPRESSAO.has(campo)` — isto é, apagar a filtragem por
    // allowlist e mandar todo campo classificado para o literal — derruba ESTE caso e o
    // do teto de 200 caracteres, e deixa os outros QUATRO verdes (2 de 6 vermelhos). Se
    // todos ficarem vermelhos juntos, o arquivo está medindo outra coisa (provavelmente um
    // diff que parou de rodar).
  });

  it('impressão: determinística, discriminante, chaveada, e não é uma fatia do valor', () => {
    // PISO — a mesma entrada dá a mesma saída. Sem isto a impressão não responde
    // "voltou ao que era", que é a única pergunta que ela existe para responder.
    const a = impressaoDeValor(URL_COM_SEGREDO);
    const b = impressaoDeValor(URL_COM_SEGREDO);
    assert.equal(a, b, 'determinística');
    assert.match(a, new RegExp(`^[0-9a-f]{${TAMANHO_IMPRESSAO}}$`), 'hex minúsculo, tamanho fixo');

    // DISCRIMINAÇÃO 1 — dois valores que diferem SÓ no token dão impressões diferentes.
    const outroToken = URL_COM_SEGREDO.replace('SUPERSEGREDO-XPTO', 'SUPERSEGREDO-XPTA');
    assert.notEqual(impressaoDeValor(outroToken), a, 'um caractere de diferença muda a impressão');

    // DISCRIMINAÇÃO 2 — a impressão não é um pedaço do valor. Testada sobre TODO n-grama
    // de 4 do original que contenha ao menos um caractere não-hexadecimal, o que torna a
    // asserção determinística: um n-grama todo-hex poderia coincidir por acaso e a
    // afirmação viraria probabilística, que é a classe de teste que esta casa recusa.
    const ngramas = [];
    for (let i = 0; i + 4 <= URL_COM_SEGREDO.length; i += 1) {
      const pedaco = URL_COM_SEGREDO.slice(i, i + 4);
      if (!/^[0-9a-f]{4}$/i.test(pedaco)) ngramas.push(pedaco.toLowerCase());
    }
    assert.ok(ngramas.length > 40, `guarda: a varredura precisa ter n-gramas (achou ${ngramas.length})`);
    const vazados = ngramas.filter((pedaco) => a.includes(pedaco));
    assert.deepEqual(vazados, [], 'a impressão não pode conter nenhuma fatia do valor original');

    // DISCRIMINAÇÃO 3 — a saída DEPENDE da chave. É o que separa a impressão de um hash
    // nu, que transformaria a trilha em oráculo de confirmação para quem a lê.
    assert.notEqual(impressaoDeValor(URL_COM_SEGREDO, 'outra-chave-de-servidor'), a);

    // DISCRIMINAÇÃO 4 — objeto igual com chaves em outra ordem tem a MESMA impressão.
    // Sem canonicalização, o painel reenviando o mesmo `config` fabricaria mudanças.
    assert.equal(
      impressaoDeValor({ tipo: 'vector', url: '/a' }),
      impressaoDeValor({ url: '/a', tipo: 'vector' }),
    );

    // CONTROLE NEGATIVO, EXECUTADO E MEDIDO: trocar o HMAC por
    // `String(canonico(valor)).slice(0, 12)` mantém o DETERMINISMO (a primeira asserção
    // continuaria verde sozinha) e derruba tudo o mais — formato hex, ausência de fatias,
    // dependência da chave. Ele deixa TRÊS dos seis casos vermelhos (este, o da allowlist
    // e o do teto de 200), o que é a medida de que a impressão está de fato em uso nos
    // três lugares e não só declarada.
  });

  it('edição sem mudança não fabrica linha de de-para, e o desconhecido continua nome-só', () => {
    const config = { url: '/a/tileset.json', opacity: 0.5, locate: { lon: 1, lat: 2 } };
    // PISO — reenviar exatamente o mesmo objeto (outra instância, mesmo conteúdo) não
    // produz nada. O painel reenvia o `config` inteiro a cada gravação; sem esta
    // propriedade toda gravação viraria um de-para de dez campos idênticos.
    const igual = diffAuditavel(
      { name: 'X', description: null, config, sort_order: 0 },
      { name: 'X', description: null, config: structuredClone(config), sort_order: 0 },
    );
    assert.deepEqual(igual, { mudou: [], outros: [], truncado: false });

    // DISCRIMINAÇÃO — uma chave que NINGUÉM classificou entra por nome, sem valor. É a
    // garantia de HOJE preservada como piso: o desconhecido nunca ganha valor.
    const comInventada = diffAuditavel(
      { name: 'X', config: { ...config, inventado: 'valor-que-nao-pode-vazar' } },
      { name: 'X', config: { ...config, inventado: 'outro-valor-que-nao-pode-vazar' } },
    );
    assert.deepEqual(comInventada.mudou, [], 'chave desconhecida NÃO ganha entrada em `mudou`');
    assert.deepEqual(comInventada.outros, ['config.inventado']);
    assert.equal(JSON.stringify(comInventada).includes('valor-que-nao-pode-vazar'), false);

    // CONTROLE NEGATIVO: fazer o walker comparar por identidade (`de !== para`) em vez de
    // por valor canônico faz o piso acima reportar mudança em `config.locate` (o único
    // valor não-escalar da fixture) e o `deepEqual` fica vermelho.
  });

  it('uma string inesperadamente longa num campo de VALOR cai para impressão', () => {
    // O regime VALOR é uma expectativa sobre TAMANHO, não uma garantia: `description` é
    // `Joi.string()` sem `max` no schema do catálogo, então nada impede um texto de 50 kB.
    const curta = 'a'.repeat(LIMITE_VALOR_LITERAL);
    const longa = 'b'.repeat(LIMITE_VALOR_LITERAL + 1);

    // PISO — no limite exato ela ainda é literal.
    const noLimite = diffAuditavel({ description: 'x' }, { description: curta });
    assert.deepEqual(entradaDe(noLimite, 'description'), { campo: 'description', de: 'x', para: curta });

    // DISCRIMINAÇÃO — um caractere acima, o MESMO campo troca de regime.
    const acima = entradaDe(diffAuditavel({ description: 'x' }, { description: longa }), 'description');
    assert.equal(acima.regime, 'impressao');
    assert.equal(acima.bytesPara, LIMITE_VALOR_LITERAL + 1);
    assert.equal(JSON.stringify(acima).includes('bbbb'), false, 'nem uma fatia do texto longo');
  });

  it('o teto derruba TUDO para nome-só, e diz que derrubou', () => {
    // Um de-para grande o bastante para estourar o teto: cem campos desconhecidos com
    // nomes longos. `outros` carrega só nomes, então é o caminho barato de estourá-lo
    // sem depender de nenhum valor entrar na linha.
    const nomes = Array.from({ length: 100 }, (_, i) => `chave_bem_comprida_de_teste_numero_${i}`);
    const a = { name: 'X', config: Object.fromEntries(nomes.map((n) => [n, 1])) };
    const b = { name: 'Y', config: Object.fromEntries(nomes.map((n) => [n, 2])) };

    const diff = diffAuditavel(a, b);
    // PISO — ele de fato estourou (senão o caso mede o caminho normal e não o teto).
    assert.equal(diff.truncado, true, 'guarda: a fixture precisa MESMO passar do teto');
    // DISCRIMINAÇÃO — o `name`, que caberia literal, também cai para nome-só. Meia
    // degradação seria uma linha que mente por omissão sem dizer que omitiu.
    assert.deepEqual(diff.mudou, []);
    assert.ok(diff.outros.includes('name'), 'o campo de VALOR desce junto');
    assert.equal(diff.outros.length, 101);

    // E o vizinho que NÃO pode mudar: um diff pequeno continua não truncado.
    assert.equal(diffAuditavel({ name: 'X' }, { name: 'Y' }).truncado, false);
  });

  it('as duas listas são disjuntas e nenhum nome de campo sensível está no regime VALOR', () => {
    // GUARDA ESTRUTURAL contra a edição futura que este arquivo existe para vigiar: um
    // campo em AMBAS as listas teria regime decidido pela ordem dos `if`, que é a forma
    // mais silenciosa de um endereço virar valor literal.
    const emComum = CAMPOS_COM_VALOR.filter((c) => CAMPOS_COM_IMPRESSAO.includes(c));
    assert.deepEqual(emComum, []);
    assert.ok(CAMPOS_COM_VALOR.length >= 10, 'piso: a lista de VALOR precisa ter conteúdo');

    // E nenhum campo de VALOR pode ter nome de endereço, arquivo ou credencial. É uma
    // heurística e está declarada como tal: ela não substitui a leitura, ela pega a
    // adição distraída de `config.tileUrl` numa manhã de pressa.
    const suspeito = /url|uri|path|src|href|token|key|secret|senha|pass|thumb|image|video|style/i;
    const errados = CAMPOS_COM_VALOR.filter((c) => suspeito.test(c));
    assert.deepEqual(errados, [], 'campo com nome de endereço/mídia não entra no regime VALOR');
  });

  it('a CHAVE DE IMPRESSÃO só é citada em dois arquivos, e nenhum deles responde requisição', () => {
    // O RISCO QUE ISTO FECHA está escrito no cabeçalho de `audit-diff.js`: a impressão só
    // não é um oráculo de adivinhação enquanto a chave for de servidor. Uma resposta que a
    // expusesse — mesmo por acidente, num `res.json(config.security)` — desarmaria o
    // desenho inteiro, e nenhuma asserção de comportamento pega isso, porque o vazamento
    // moraria numa rota que nada neste arquivo exercita.
    //
    // O INVENTÁRIO VEM DO VERSIONAMENTO, como nos censos, para que o arquivo escrito há
    // cinco minutos entre na varredura sem depender de um `git add`.
    const arquivos = execFileSync(
      'git', ['ls-files', '-co', '--exclude-standard', 'src'],
      { cwd: RAIZ, encoding: 'utf8' },
    ).split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
    assert.ok(arquivos.length > 50, `guarda: a varredura precisa ver o código (viu ${arquivos.length})`);

    const citam = arquivos.filter(
      (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8').includes('auditFingerprintKey'),
    );
    // PISO — os dois legítimos ESTÃO lá. Sem isto, um `grep` que parasse de casar (uma
    // renomeação da constante) passaria verde comparando vazio com vazio.
    assert.deepEqual(citam.sort(), ['src/config.js', 'src/utils/audit-diff.js']);
  });
});
