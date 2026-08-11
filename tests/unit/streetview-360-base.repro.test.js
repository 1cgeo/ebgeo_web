/**
 * Reprodutor: a base do 360 nao pode apontar para localhost num pacote de
 * producao.
 *
 * O DEFEITO QUE ESTE TESTE MATA. A base vivia numa linha com `localhost` fixo, e
 * o valor de producao era uma edicao a mao fora do git. O `deploy/deploy.sh`
 * chama `vite build` puro, sem substituir nada, entao construir de um checkout
 * limpo publicava `http://localhost:8081` para todo navegador da EBNET.
 *
 * O MODO DE FALHA E MUDO, e por isso o teste existe. O navegador nao alcanca
 * `localhost:8081`, e a camada de panoramicas some inteira: sem foto, sem ponto,
 * sem tracado. Nada disso levanta erro que alguem note, e 2.756 testes passavam
 * com o defeito no lugar, porque todos rodam em modo de desenvolvimento.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/**
 * Importa o config com o ambiente do Vite forcado, sem cache entre chamadas.
 * @param {boolean} dev - valor de import.meta.env.DEV
 * @returns {Promise<Object>} O objeto de configuracao
 */
async function carregarConfig(dev) {
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return (await import('../../src/js/config.js')).default;
}

describe('base do ebgeo_360 no config', () => {
  it('em producao NAO aponta para localhost', async () => {
    const { streetView360 } = await carregarConfig(false);

    const enderecos = [
      streetView360.serviceUrl,
      streetView360.pointsSource.tiles[0],
      streetView360.linesSource.data,
    ];

    for (const url of enderecos) {
      expect(url).not.toContain('localhost');
      expect(url).not.toContain('127.0.0.1');
    }
  });

  it('em producao usa o prefixo publico do proxy', async () => {
    const { streetView360 } = await carregarConfig(false);
    expect(streetView360.serviceUrl).toBe('/ebgeo_360');
  });

  it('em desenvolvimento continua apontando para o servico local', async () => {
    const { streetView360 } = await carregarConfig(true);
    expect(streetView360.serviceUrl).toBe('http://localhost:8081/api/v1');
  });

  // A URL do tile e a unica que morre com base relativa, porque o MapLibre a
  // pede de dentro de um worker criado de um blob, onde nao ha base para
  // resolver caminho relativo. As outras saem da thread principal.
  it('a URL do tile e absoluta quando ha origem de pagina', async () => {
    vi.stubGlobal('location', { origin: 'https://ebgeo.exemplo.mil.br' });
    const { streetView360 } = await carregarConfig(false);

    const tile = streetView360.pointsSource.tiles[0];
    expect(tile).toBe(
      'https://ebgeo.exemplo.mil.br/ebgeo_360/tiles/fotos/{z}/{x}/{y}.pbf',
    );
    expect(() => new Request(tile.replace('{z}/{x}/{y}', '12/2048/2048'))).not.toThrow();

    vi.unstubAllGlobals();
  });
});
