# Branch hunt/relatorios: a documentação da campanha de 2026-09-24

Este branch é ÓRFÃO: não tem código, só a documentação da campanha de caça de bugs e de cobertura que preparou o lançamento do integracao_backend, feita com subagentes nos dias 23 e 24 de setembro de 2026. Ele existe para que a campanha possa ser retomada em outra máquina, por outros agentes, sem o contexto da sessão original.

Comece pelo arquivo PENDENCIAS-LANCAMENTO.md na raiz do branch integracao_backend. Ele é o índice do que falta e aponta para os arquivos daqui.

## O que há aqui

- campanha-2026-09-24/relatorios/: um relatório por frente de trabalho. Cada um tem a matriz do que foi coberto, os commits, as medições, as decisões tomadas e, no fim, uma seção PRÓXIMO PASSO com o estado exato e o próximo comando. As frentes, pelo nome do arquivo:
  - rede.md e fotos-estrutural.md: fotos anexas por referência (branch hunt/fotos) e a campanha noturna de rede ruim e offline.
  - desempenho.md: o limite de 200 operações (B6.1) e os gestos em massa com uma gravação (branch hunt/b61-lote).
  - rede-ws.md: presença em link lento e atlas de servidor com WebSocket bloqueado (branch hunt/rede-ws).
  - orfas.md: coleta de imagem órfã no servidor (branch hunt/orfas).
  - atributos-por-chave.md: atributos que convergem por chave (já integrado).
  - cobertura-*.md: as campanhas de cobertura (desenho, táticas, briefing, camadas, bloqueio, imagens, importação e exportação). As que ficaram com trabalho em wip têm branch hunt/cob-desenho, hunt/cob-taticas, hunt/cob-briefing, hunt/cob-camadas e hunt/cob-imagens.
  - Os demais (backend-sync.md, migracao.md, producao.md, peso.md, troca-atlas.md, navegadores.md e afins) são da campanha noturna, já integrada; servem de histórico e de fonte das medições.
- campanha-2026-09-24/RETOMADA.md: o índice que o coordenador manteve durante a campanha. Os agentId citados lá não valem em outra sessão; o resto é histórico útil (ordem de integração, decisões, flakes).
- campanha-2026-09-24/GOAL.md: o diário da campanha, hora a hora.
- campanha-2026-09-24/BRIEF-COMUM.md: as regras dadas a todo subagente (isolamento por worktree, portas e bancos próprios, o que não rodar, como commitar). Reaproveitável para uma nova rodada.
- campanha-2026-09-24/RELATORIO-FINAL.md, decisoes-noite.md, indice-noite.md, livro-noite.md: o fechamento da noite de 23 para 24.
- campanha-2026-09-24/ferramentas/: duas specs de Playwright de medição em escala (mil feições com dois navegadores e o Postgres), que eram temporárias e não estão em branch nenhum. Para usar, copie para frontend/tests/e2e-ui/ numa worktree e rode com as variáveis de isolamento.

## O que NÃO está aqui, de propósito

As instruções de nginx para o engenheiro (nginx-srv-arquivos-2026-09-23.txt e nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt) descrevem os servidores de produção e NÃO foram publicadas, porque este repositório é público. Elas ficaram na pasta Downloads da máquina original e precisam ser levadas à mão. O essencial delas está resumido em PENDENCIAS-LANCAMENTO.md, na seção de passos finais.
