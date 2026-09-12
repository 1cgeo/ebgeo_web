# Execução da correção da migração

Data: 12/09/2026. Branch: integracao_backend. Base de produção informada: main,
commit 8b611113aa73c3faedc967ccf77132604255ea8d. Alterações locais, sem publicação.

O código das entregas 1 a 3 do [plano](plano-correcao-migracao-main-integracao-backend.md)
foi implementado. Os ensaios automatizados da entrega 4 foram ampliados. A publicação
continua condicionada aos ensaios de ambiente e aos passos operacionais abaixo.

## Comportamento implementado

- O mapa e a página de atlas verificam a transição antes de iniciar os serviços e de
  registrar/adotar o acervo antigo. A tela informa o andamento da cópia.
- Os bancos locais sem sufixo, inclusive um atlas já adotado em 3.0, são copiados para
  um endereço exclusivo. A identidade do atlas existente permanece. Os originais
  continuam no navegador, sem limpeza automática e sem aparecer como um segundo atlas.
- Um registro persistente guarda destino, inventário SHA-256, progresso e etapa.
  O registro de atlas só passa a apontar para o destino depois da cópia e da migração.
  A preparação usa escopo explícito e não muda a seleção de atlas da aba.
- A conversão de 1.x persiste IDs e registros antes de escrever. Copia imagens para os
  IDs novos, mantém as chaves antigas e verifica os resultados. Preserva camada ativa
  e referências de grupos. O preenchimento histórico de 3D conserva campos já existentes.
- O protocolo da main é reconhecido. Uma janela antiga conhecida impede o prosseguimento
  da nova. Uma janela suspensa que volte posteriormente só conhece os bancos originais.
  Alterações tardias são detectadas na abertura e no retorno de foco e podem ser
  recuperadas em outro atlas, sem sobrescrever o trabalho atualizado.
- Falhas de migração abrem recuperação, em vez de continuar com um editor parcial.
  O arquivo ZIP de recuperação conserva os registros locais brutos e os binários,
  incluindo cópias interrompidas. A restauração verifica o inventário e cria outro atlas.
  Esse caminho também fica disponível quando a API de configuração está indisponível.
- Resíduos remotos sem reivindicação local não são copiados/exportados como atlas locais.
  Operações locais antigas sem destino continuam preservadas na fila de origem e não
  são encaminhadas automaticamente para sincronização.

Entradas principais: [transição](../../frontend/src/js/store/migration/legacy-transition.js),
[plano de IDs](../../frontend/src/js/store/migration/v1-to-v2.migration.js),
[recuperação](../../frontend/src/js/store/migration/recovery-archive.js) e
[tela de recuperação](../../frontend/src/js/ui/migration-recovery.js).

## Evidência automatizada

- Os cinco casos de reprodução originais passaram, incluindo os três bloqueadores.
- A matriz de integração cobre versões 1.3 a 1.7 e 2.0 a 3.0, origem remota,
  atlas já adotado, outros atlas existentes, versão sem suporte e ausência de Web Locks.
- Foram interrompidas 39 gravações da atualização, antes e depois de cada uma:
  78 cenários de retomada. A origem e as associações permaneceram consistentes.
  Há teste adicional de interrupção da recuperação de alterações tardias.
- Os testes de navegador cobrem a fixture 2.2 (11 mapas, 262 feições, 17 camadas,
  2 grupos, 2 briefings e 5 imagens), duas abas concorrentes, o código de tab-lock
  da main publicada nas duas ordens de abertura, alterações tardias e recuperação
  com a API indisponível. Incluem importação/exportação e ida ao servidor e volta.
- Mais dois casos em Chromium cobrem a falha de quota injetada na escrita IndexedDB
  e um binário adicional de 8 MiB. As rodadas de navegador passaram sem retries.
- Backend completo: 5.009 testes aprovados, zero falhas ou skips. Banco descartável
  ebgeo_migration_fix_20260912. Cobertura de linhas: 98,28%.
- Frontend completo: 12.126 testes aprovados em 622 arquivos, zero falhas ou skips.
  Lint JavaScript/CSS aprovado e build de produção concluído em 1 min 32 s.
  Navegador: 14 casos aprovados nas duas rodadas descritas, zero retries ou skips.

Medição do acervo com binário de 8 MiB: 41 registros de origem, 5,68 s para copiar,
migrar e verificar, com outras verificações em execução nesta máquina. O navegador
estimou 6.107.136 bytes adicionais; essa estimativa não equivale à soma física dos
blobs. O blob de destino manteve 8.388.608 bytes e os hashes foram verificados.
Não é uma medição representativa de acervos de centenas de MiB ou de máquinas da rede.

Logs locais, ignorados pelo Git: migration-implementation-full-final.log,
migration-implementation-backend.log, migration-implementation-browser-final.log,
migration-implementation-browser-volume.log, migration-implementation-lint-final.log
e migration-implementation-build-final.log.

## Limites que ainda impedem aprovação de produção

Complemento posterior: os cinco arquivos externos fornecidos pelo usuário passaram
por 11 cenários de navegador e auditoria dos recursos auxiliares. Consulte o
[ensaio com dados externos](teste-dados-externos-2026-09-12.md) para resultados e
limites. São exportações reais do acervo de teste, ainda sem substituir perfis brutos
de navegador.

1. **Protocolo e navegadores da rede ainda não foram confirmados.** O caminho de
   atualização/restauração requer navigator.locks. Quando indisponível, bloqueia
   a migração e oferece exportação. Não publicar esta versão sobre uma origem HTTP
   interna sem antes resolver e testar essa condição. Trocar para HTTPS por si só
   não transfere o IndexedDB da origem anterior.
2. Os testes históricos usam registros semeados e uma fixture .ebgeo. O código de
   coordenação da main é real, do commit indicado; o ensaio não substitui capturar
   perfis gravados por cada build histórico e trocar o build mantendo a mesma origem.
   Esses perfis reais ainda precisam ser homologados, especialmente acervos já danificados.
   Complemento: o [ensaio com perfil da main atual](perfil-real-main-integracao-2026-09-12.md)
   agora executa os dois builds de produção, com dados criados e editados pela interface
   e troca de servidor na mesma origem. Isso cobre a main atual; não todas as builds
   históricas nem perfis envelhecidos de usuários reais.
3. Foi exercitado Chromium. Outros motores e as versões gerenciadas dos navegadores
   da rede ainda precisam de validação.
4. A quota foi injetada na escrita nativa IndexedDB. A tentativa de limitar a quota
   via CDP informou o limite de 1 byte, mas continuou aceitando gravações, inclusive
   com blob de 12 MiB. Logo, não certifica disco realmente cheio. O registro dessa
   limitação está em migration-implementation-quota-cdp-limit.log.
5. Ainda falta medir memória, tempo e espaço com acervos grandes representativos.
   A cópia exige espaço adicional e a exportação ZIP usa memória. Não foi estabelecido
   um limite máximo de tamanho seguro.
6. O servidor interno não foi acessado. Proxy, cache, configuração, autenticação,
   imagens, WebSocket e o procedimento de reversão real permanecem pendentes.

## Roteiro interno de publicação e reversão

1. Registrar URL completa, incluindo porta, protocolo e caminho, e os navegadores
   usados. Validar a capacidade de coordenação na origem efetiva.
2. Preparar perfis descartáveis com cópias de acervos reais e exportações preventivas.
   Aplicar a troca de build na mesma origem. Ensaiar usuário que pulou versões,
   aba antiga aberta/suspensa, interrupção e segundo/terceiro acesso.
3. Conferir inventários, imagens e referências, além de abrir mapas e atlas diferentes.
   Ensaiar exportação de recuperação e restauração com API desconectada.
4. Verificar configuração, login, imagens e WebSocket através do proxy real.
   HTML deve atualizar sem misturar releases. Preservar assets necessários às abas
   já abertas. Não enviar Clear-Site-Data nem orientar limpeza do armazenamento.
5. Guardar o build validado da integração como release de recuperação, incluindo
   seus assets. Ensaiar sua reinstalação e o acesso à recuperação sem API. A volta
   dos arquivos da main não reverte os bancos: a main abre os originais e não enxerga
   o trabalho novo nos namespaces exclusivos. Não tratar esse comando como rollback
   de dados nem apagar o destino para forçar a main a funcionar.
6. Fazer piloto com responsáveis definidos para suporte, observação e interrupção
   da expansão. Interromper em caso de divergência de inventário, falhas recorrentes
   de quota ou recuperação, ou navegador sem coordenação.
7. Expandir somente após cumprir os aceites. Manter os originais e cópias pendentes.
   A remoção futura desses dados exige uma mudança separada e recuperação verificada.

Nenhuma publicação, alteração de servidor ou limpeza de dados de usuário foi realizada.
