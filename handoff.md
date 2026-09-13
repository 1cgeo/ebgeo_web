# Handoff: onde está o trabalho de lançamento

Esta linha (`integracao_backend` e as branches de bloco que saem dela) leva o EBGeo da main em produção para a integração com backend. A **produção é a main**, servida em HTTPS, e protocolo e domínio se mantêm, então a origem não muda e os bancos IndexedDB dos usuários atuais continuam visíveis ao candidato. A **primeira implantação do backend é uma instalação nova**: esta linha nunca foi implantada, não existe banco a migrar e não há script de transição.

**O candidato não está liberado.**

## Para onde ir

- **O que ainda falta:** [pendências abertas](docs/reviews/pendencias-abertas.md). É o único documento de trabalho vivo: estado por bloco, o que resta em cada um com arquivo e aceite, a decisão pendente do dono, a matriz de homologação e o roteiro de liberação interna.
- **Por que o produto funciona assim:** a [wiki](docs/wiki/index.md). Os mecanismos deste trabalho foram absorvidos por ela (diário write-ahead, lote lógico por gesto, camada padrão remota, pendências de sincronização, inventário de vendors, presença administrativa, mais as seções novas de fila de saída, modelo de conflito, imagens, coordenação entre abas, namespace por atlas e observabilidade).
- **O que foi decidido, e quando:** [decisões de 2026](docs/decisions/decisions-2026.md). As decisões do dono de 13/09 estão lá, com D7 ainda pendente.
- **O que se aprendeu errando:** [livro-razão](docs/livro-razao.md).
- **O que mudou no código:** `git log`. A lista de correções que este arquivo carregava saiu: ela duplicava o histórico e envelhecia a cada commit.

Antes de retomar, leia as regras de trabalho em [CLAUDE.md](CLAUDE.md) e as do produto em [CONSTITUICAO.md](CONSTITUICAO.md); para backend, também [backend/CLAUDE.md](backend/CLAUDE.md).

## Verificação, que é a parte que não se negocia

- **Lógica:** `npm run lint` e `npm test` na RAIZ, em DOIS comandos separados, rodados depois da última escrita. Na mesma linha de comando a saída do lint aparece depois de o commit já ter passado, o que não é verificação. A raiz exige PostgreSQL com PostGIS, e não pode concorrer com outra rodada de backend nem com medição de cobertura alheia.
- **Interface:** fora da suíte. Captura do Playwright dirigindo app e backend reais, e depois LER a imagem produzida; apague o spec temporário. Leia a contagem de `flaky` antes de declarar verde.
- **Controle negativo em todo guarda novo:** reverta o fix, veja o vermelho, restaure a fonte byte a byte. Verde que passa com e sem a correção não prova nada.
- **Corrida se mede em série**, com a taxa relatada. Um verde único de algo probabilístico é indistinguível do determinístico.
- **Build não concorre** com suíte que inspeciona `dist`; suítes com banco rodam em sequência.

Os dados de ensaio ficam fora do repositório, em uma pasta irmã deste diretório. Use somente CÓPIAS. O servidor interno não é alcançável desta linha de trabalho, e nenhuma implantação foi feita.
