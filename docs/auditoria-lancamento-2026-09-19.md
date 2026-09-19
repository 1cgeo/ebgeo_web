# Ensaio de lançamento com os acervos de teste

Data: 19/09/2026. Complemento da [auditoria de preservação](auditoria-preservacao-dados-2026-09-19.md). Branch `integracao_backend`, base auditada `1ba66c77`; os ensaios foram executados sobre as correções antes do commit. Nenhuma publicação na intranet foi feita. A verificação da intranet real foi excluída por orientação do usuário.

## Acervos e integridade

Origem somente para leitura: `C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste`. Os arquivos são fixtures representativas produzidas pelas versões antigas, conforme seu README; não são uma amostra de perfis de navegador de usuários da instalação. Todos os ensaios escreveram em perfis, bancos ou diretórios separados.

| Arquivo | Mapas | Feições | Imagens | Resultado |
| --- | ---: | ---: | ---: | --- |
| 01-completo.ebgeo | 11 | 262 | 5 | Migração, três inicializações, recuperação bruta e importação pela interface aprovadas |
| 02-minimo.ebgeo | 1 | 1 | 0 | Aprovado nos mesmos caminhos |
| 03-completo-2.4.ebgeo | 14 | 805 | 149 | Aprovado; também ensaiado com settings 1.7 e atlas 2.4 |
| 04-completo-2.3.ebgeo | 14 | 787 | 131 | Aprovado |
| 05-completo-2.2.ebgeo | 14 | 776 | 131 | Aprovado |

Foram **11 cenários Chromium**, sem retries. As comparações de migração e recuperação bruta não encontraram diferenças. Na importação pela interface, um bitmap de simbologia antiga é regenerado nas fixtures 2.2 e 2.3; os testes validam explicitamente a origem, o SIDC e a representação atualizada, em vez de aceitar qualquer diferença de imagem. Os SHA-256 dos arquivos originais permaneceram iguais. Inventário, hashes e medições: [migration.json](auditoria-lancamento-2026-09-19/migration.json).

O acervo 2.4 inclui 21 camadas, três grupos, dois briefings, sete slides e três ícones personalizados. Sua migração levou cerca de 1,5 s nesta máquina e produziu uma recuperação bruta de aproximadamente 2,5 MB. Esses tempos não dimensionam os perfis de todos os usuários.

Os diretórios 360, 360 SQLite e 3D foram examinados e copiados para um backup temporário, depois restaurados em outro diretório. Resultado: **4.321 arquivos, 2.296.563.932 bytes, nenhuma divergência de SHA-256**, dois bancos SQLite com `integrity_check` aprovado após restaurar. A inspeção estrutural também validou imagens, JSON, referências de tilesets e cabeçalhos GLB/B3DM. Evidências: [assets.json](auditoria-lancamento-2026-09-19/assets.json) e [assets-backup.json](auditoria-lancamento-2026-09-19/assets-backup.json). Isso verifica integridade dos arquivos; não equivale a testar cada cena e panorama no visualizador.

## Defeitos adicionais corrigidos durante o ensaio

1. **Fechar a aba no meio de uma cópia podia deixar um atlas incompleto visível.** Cópias locais e cópias de remoto para local agora ficam em preparação, fora do registro público. A entrada só é publicada depois de copiar, verificar, ajustar sua identidade e remover referências privadas. Um journal permite recolher preparações abandonadas no próximo boot, sob Web Lock. Uma interrupção depois do commit conserva a cópia concluída, inclusive se o registro se perder e sua referência sobreviver apenas no espelho. Sem Web Locks, a limpeza automática é omitida para não apagar uma preparação ainda ativa em outra aba.
2. **Fechar a página com uma gravação de estilo pendente não avisava.** O salvamento adiado de estilo mantém um aviso de saída enquanto existe trabalho pendente ou em gravação. O aviso desaparece após o commit; falha definitiva de gravação mostra mensagem. Não há promessa de salvar uma edição quando o usuário força o encerramento do processo ou confirma sair antes de gravar.
3. **Ferramentas deixavam de ativar no pacote minificado.** O gerenciador inferia o tipo pelo nome da classe, alterado pelo build. As instâncias agora recebem o tipo estável já declarado no registro. O defeito foi reproduzido ao desenhar pelo pacote de produção e corrigido para controles iniciais e carregados sob demanda.
4. **A publicação tinha uma janela sem `current` e abandonava chunks das abas antigas.** O script agora substitui o symlink com `mv -Tf`, serializa publicação e rollback com `flock`, conserva os assets das três releases retidas e usa nomes sem colisão entre publicações no mesmo segundo. O rollback escolhe a versão anterior à realmente ativa, inclusive quando repetido. A retenção usa um manifesto dos assets próprios de cada release para não acumular indefinidamente todo o histórico.

## Revisão posterior solicitada: pendências e arquivos gerados

- **Falha de gravação de estilo:** a revisão encontrou que esgotar os retries retirava o aviso de saída e deixava o painel fechar. A última edição agora é retida para retry explícito; o aviso continua ativo e Concluir aguarda a gravação, mantendo o painel aberto se falhar. Recusa explícita, como a proteção contra troca de atlas, também deixa o trabalho marcado como não salvo. Três testes adicionais cobrem recusa, falha, preservação e sucesso na nova tentativa.
- **CSS inválido do docsify:** corrigido por um plugin PostCSS limitado ao seletor defeituoso do tema instalado. A correção funciona após `npm ci`, em dev e no build, sem modificar ou copiar a dependência.
- **Imports dinâmicos ineficazes:** os módulos de confirmação, recuperação e API 360, já alcançados estaticamente, passam a usar imports estáticos nos consumidores que emitiam avisos. As bibliotecas pesadas de visualização continuam sob demanda.
- **Arquivos gerados:** o `.gitignore` exclui JSONs avulsos dos ensaios, dumps, cache Python, arquivos privados de ambiente e arquivos temporários de publicação. Testes, scripts, relatórios Markdown e os seis JSONs pequenos de evidência em `docs/` permanecem versionáveis. Os logs e diretórios de saída do Playwright já estavam ignorados.

Permanecem os diagnósticos de tamanho dos chunks 3D e de tempo gasto em plugins. São avisos de desempenho do build bem-sucedido; não foram escondidos nem convertidos artificialmente em sucesso por aumento do limite. Os demais limites operacionais estão explicitados na auditoria de preservação, atualizada para não apresentar como pendentes os ensaios e proteções já concluídos.

**Validação final da revisão:** 13.218 testes em 715 arquivos aprovados na suíte completa, lint JavaScript/CSS aprovado, build concluído em 1 min 22 s e dez cenários Chromium aprovados: quatro de logout/indisponibilidade, quatro de interrupção e dois do pacote HTTPS. O ensaio HTTPS foi repetido com trace após substituir a navegação interceptada de preparação por uma página real servida pelo HTTPS local; a falha anterior ocorreu antes de carregar o aplicativo. A asserção estrutural do teste de marcadores 360 foi atualizada para conferir o novo import estático do mesmo serviço. O build terminou antes da suíte que mede os arquivos compilados.

## Ensaio HTTPS e restauração do backend

Foi servido o **pacote compilado em `frontend/dist`**, por HTTPS local e proxy HTTP/WebSocket para um backend real com PostgreSQL de teste. A página não importou módulos de `/src`. O teste verificou contexto seguro e Web Locks, migração do acervo 2.4 preservando os bancos originais e reabertura após recarregar.

O fluxo pela interface importou 14 mapas/805 feições, enviou o atlas ao servidor e o reabriu. Com os POSTs de sincronização bloqueados, criou uma feição, confirmou 806 no armazenamento local e 805 no servidor, recarregou a página, manteve a edição e depois confirmou 806 no servidor ao liberar o envio. Também verificou conexão WSS e preservação do atlas local original. O bloqueio nesse caso atinge os envios de sincronização; não é uma desconexão total da máquina.

Para restaurar, o escritor foi encerrado antes de copiar o banco e os arquivos. Foram executados `pg_dump` e `pg_restore` em banco descartável diferente, comparados quantidade e hash do conteúdo de todas as tabelas e iniciado outro backend usando os arquivos restaurados. Caminhos de imagens, absolutos ou relativos ao diretório do backend, foram remapeados apenas no banco restaurado para garantir que o teste não lesse os originais. O snapshot foi comparado por identidade de mapas, grupos e vínculos grupo/feição: a ordem de transporte dessas coleções não é garantida pelas consultas; `atlas.mapOrder`, ordem de camadas, arrays de feições, coordenadas e membros dos grupos continuam comparados integralmente.

Resultado da execução sobre o último build: **56 tabelas, 9.515 linhas comparadas** (incluindo tabelas de referência do PostGIS), 501 arquivos binários copiados e comparados, e todas as **14 imagens vinculadas ao atlas no servidor** baixadas do backend restaurado e conferidas por SHA-256. As 149 imagens da fixture também contêm caches de simbologia; essa contagem não é a de uploads vinculados no servidor. O diretório binário de teste contém arquivos de outras execuções, por isso a contagem de arquivos copiados é maior. Evidência: [server-backup.json](auditoria-lancamento-2026-09-19/server-backup.json).

O ensaio exigiu ferramentas PostgreSQL da mesma versão principal do servidor local (16). Usar um dump gerado pelo cliente 18 introduziu configuração não suportada pelo servidor 16; o executor foi ajustado para selecionar os binários corretos. Essa foi uma falha do instrumento de restauração, não perda do banco original.

## Publicação e reversão

O script foi executado **somente em cópia isolada em `/tmp` no WSL/Linux**, nunca no diretório de publicação real. O ensaio criou quatro releases, manteve três, realizou 200 trocas com leituras simultâneas, voltou duas versões e recusou rollback além da retenção. Verificou também a recusa de publicação concorrente e os chunks da release mais nova disponíveis após dois rollbacks. Não houve erro de leitura nas trocas. As instruções estão em [deploy-web.md](wiki/deploy-web.md).

Foram 26.862 leituras concorrentes, sem erro, na execução registrada em [deploy.json](auditoria-lancamento-2026-09-19/deploy.json).

Rollback do frontend não reverte nem converte dados do novo esquema. Para a atualização efetiva, continuam necessários backup externo dos atlas dos usuários, cópia consistente do banco e dos arquivos do servidor, fechamento das abas antigas e manutenção exata da origem do navegador: protocolo, hostname e porta.

## Resultado dos checks e decisão de lançamento

- **13.215 testes de frontend em 715 arquivos aprovados** na suíte completa. Após a última proteção do espelho, os 67 testes de registro/cópia/espelho e quatro cenários de interrupção foram executados novamente e aprovados.
- **Lint JavaScript/CSS e build de produção aprovados na campanha inicial.** O build dessa campanha levou aproximadamente 1 min 39 s. Os avisos de imports ineficazes e CSS do docsify foram corrigidos na revisão posterior acima; os diagnósticos de desempenho permanecem.
- **24 cenários Chromium nesta campanha, sem retries:** 11 com os arquivos fornecidos, quatro de interrupção/recuperação, dois do pacote HTTPS e sete de regressão (cópia local, ciclo de arquivo, edição pendente, F5 e reconexão com dois clientes).
- A auditoria anterior já havia aprovado **474 testes de backend em 180 suítes**, além dos cenários de migração e múltiplas abas descritos naquele relatório. Nenhum código de produção do backend foi alterado neste complemento; os novos ensaios usam o backend real em bancos descartáveis.

**Recomendação: avançar para lançamento controlado após as salvaguardas operacionais acima.** Os caminhos locais examinados passaram, inclusive os defeitos adicionais encontrados e corrigidos no ensaio. Não há motivo identificado nesses resultados para exigir outra auditoria genérica antes disso. Isso não certifica o proxy/certificado/políticas da intranet, navegadores diferentes do Chromium testado ou os perfis reais dos usuários; esses itens não foram ensaiados. Limpeza do armazenamento do site, remoção do perfil, falha física e encerramento forçado antes de gravar continuam exigindo backup externo e não podem ser eliminados por esses testes.

## Repetição dos checks

A partir da raiz, com PostgreSQL local e navegadores Playwright instalados:

```powershell
$env:EBGEO_MIGRATION_DATA_DIR='C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste'
npm test --prefix frontend -- --maxWorkers=2
npm run lint --prefix frontend
npm run build --prefix frontend
npm run test:e2e:migracao --prefix frontend
npm run test:e2e:ui --prefix frontend -- --config playwright.release-checks.config.js --project chromium
npm run test:e2e:ui --prefix frontend -- --config playwright.release-production.config.js --project chromium
python frontend/tests/helpers/audit-migration-assets.py $env:EBGEO_MIGRATION_DATA_DIR assets-audit.json
python frontend/tests/helpers/release-assets-backup.py $env:EBGEO_MIGRATION_DATA_DIR assets-backup.json
wsl -d Ubuntu -- python3 /mnt/c/Users/diniz/OneDrive/Desktop/Desenvolvimento/ebgeo_web/deploy/test-release.py
```

As suítes de navegador que usam as mesmas portas e bancos de teste devem rodar sequencialmente. O servidor HTTPS do ensaio requer OpenSSL e usa certificado temporário próprio; não instala certificado no sistema. O helper de restauração usa as credenciais locais de teste e permite `PG_BIN`/`SUPERUSER_DATABASE_URL` para instalações diferentes. Não apontar esses executores para bancos de produção.

O [manifesto do build](auditoria-lancamento-2026-09-19/build.json) identifica o pacote testado. Seu `release.json` apresenta o commit base, porque o ensaio ocorreu antes do commit das correções; o manifesto também identifica o conteúdo do pacote e o diff de código testado. Os logs completos `frontend-release-*.log` e `frontend-audit-followup-*.log` permanecem na raiz, ignorados pelo Git; dumps e arquivos temporários do backend ficam nas saídas ignoradas do Playwright. Eles não integram as evidências versionáveis.
