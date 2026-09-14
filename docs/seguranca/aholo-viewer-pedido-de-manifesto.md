# Pedido de manifesto ao fornecedor do `@manycore/aholo-viewer`

Aberto em 2026-09-14 pela decisão D9, item V5 (`docs/decisions/decisions-2026.md`). **Este documento é para o dono enviar**, não uma ação que o repositório executa: o texto abaixo está pronto para colar num e-mail ou numa issue do fornecedor.

## Por que pedir, em uma frase

O pacote não distribui `.wasm` como arquivo: ele embute três módulos nativos em base64 dentro dos `.js`. Um deles (zstd) publica a seção `producers` e responde sozinho; os outros dois (Draco e o transcodificador Basis Universal / KTX2) tiveram as seções custom removidas e **não deixam string de versão nenhuma**. Eles processam bytes de arquivo vindos do servidor, e são o ponto cego que resta do inventário de dependências. Ou se fecham por hash contra os artefatos publicados de cada projeto, ou se pergunta a quem os empacotou.

## O que já se determinou sozinho, para não pedir o que já se sabe

Tudo abaixo foi lido do pacote instalado em 2026-09-14, versão `1.8.1`, e está no manifesto de dependências.

| o que | valor | como |
|---|---|---|
| bibliotecas JS vendorizadas | `semver` 7.8.5 e `fflate` 0.8.3 | comentários de caminho de módulo em texto claro no `dist`, confirmados pelos sourcemaps que o pacote publica |
| módulo nativo 1, zstd | libzstd 1.5.7, via `zstd-sys` 2.0.16 | seção `producers` do próprio wasm |
| cadeia de build daquele módulo | rustc 1.91.1 (2025-11-07), clang 22.1.8, walrus 0.26.4, wasm-bindgen 0.2.122 | mesma seção `producers` |
| módulo nativo 2, Draco | **sem versão** | sem seção custom nenhuma |
| módulo nativo 3, Basis Universal / KTX2 | **sem versão** | sem seção custom nenhuma |

## O texto a enviar

O fornecedor é a MANYCORE, INC. (licença MIT, `LICENSE` no pacote). O texto vai em inglês, que é o que o `README` e o `CHANGELOG` do pacote usam.

---

Subject: `@manycore/aholo-viewer` 1.8.1, request for a manifest of the embedded native modules

Hello,

We use `@manycore/aholo-viewer` (pinned to the exact version `1.8.1`) in a GIS product and we are closing a dependency inventory for a release. We are not reporting a problem: everything below is a question about provenance.

The published `dist` embeds three WebAssembly modules as base64 inside the JavaScript files rather than shipping them as `.wasm` files:

1. a zstd module, about 138,633 bytes decoded, present in both dist/index.js and dist/splat-worker.js;
2. a Draco module, about 285,948 bytes decoded, in dist/index.js;
3. a Basis Universal / KTX2 transcoder, about 613,861 bytes decoded, in dist/transcoder-worker.js (about 90% of that file).

The first one answers for itself: it keeps its `producers` section, which reports `zstd-sys 2.0.16 (zstd 1.5.7)`, built with rustc 1.91.1, clang 22.1.8, walrus 0.26.4 and wasm-bindgen 0.2.122.

Modules 2 and 3 have no custom sections at all, so they carry no version string of any kind. That leaves us unable to answer a basic question about two native decoders that parse untrusted file bytes: which upstream release are they, and therefore which published security advisories apply to them.

Could you tell us, for the exact `1.8.1` artifact:

- the upstream version (or git commit) of the Draco decoder embedded in dist/index.js;
- the upstream version (or git commit) of the Basis Universal / KTX2 transcoder embedded in dist/transcoder-worker.js;
- whether either carries local patches on top of that upstream;
- ideally, the SHA-256 of the upstream artifacts you started from, so that we can verify the embedded bytes ourselves without asking again at each release.

Two suggestions that would remove the need for this exchange in the future, if they fit your build:

- keep the `producers` custom section in all three modules, as the zstd one already does; it is a few hundred bytes and it makes every module self-describing;
- or publish a small manifest file in the package (say dist/native-modules.json) listing each embedded module with its upstream version and hash.

We are also happy to hear that a version is deliberately not disclosed; a clear "no" is a better answer for our records than silence.

Thank you,

---

## O que fazer com a resposta

Ela entra no manifesto `dependencias-lancamento-inventario.json`, no bloco datado do dia em que chegar, ao lado da declaração do ponto cego, que então deixa de ser cego. Se a resposta não vier, **o ponto cego declarado permanece**, e continua sendo melhor que a alternativa recusada na mesma decisão: declarar `semver` e `fflate` como dependências diretas só para o `npm audit` falar delas produziria um verde sobre a versão do lockfile e não sobre a que está fundida no bundle, e no dia em que o fornecedor publicar 1.8.2 com outra `fflate` dentro o verde continuaria verde.

O caminho que não depende de resposta é fechar os dois por hash contra os artefatos publicados de Draco e Basis Universal, que é o método que resolveu o Turf neste mesmo inventário. Ele não bloqueia lançamento e pode ser feito a qualquer momento.
