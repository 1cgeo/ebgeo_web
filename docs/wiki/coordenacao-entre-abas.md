# Coordenação entre abas

Duas abas do mesmo navegador colidem quando, e só quando, seguram o MESMO endereço de bancos, e a arbitragem é por ordem total sobre reivindicações anunciadas, não por janela de tempo.

O protocolo em si (mensagens, heartbeat, TTL, overlay) está escrito por extenso no `@fileoverview` de `frontend/src/js/utilities/tab-lock.js`, e não se repete aqui. Esta página guarda o que nenhum arquivo diz sozinho: por que a forma anterior não defendia nada, por que a fiação teve que entrar numa ordem específica, e o que continua aberto.

## A regra do dono é sobre ARMAZENAMENTO, não sobre sessão

O que se arbitra é um endereço: o conjunto de bancos IndexedDB em que a aba escreve. Por isso `keysCollide` (`frontend/src/js/utilities/tab-lock.js`) calcula um endereço com `claimAddress` e compara endereços, em vez de comparar o par (kind, id). Duas consequências que a leitura do predicado não entrega:

- **Falha fechada em `kind` desconhecido.** Uma aba de um deploy futuro, ou com a chave corrompida, ainda colide com uma reivindicação idêntica, porque o endereço é montado interpolando o `kind` cru. Um `switch` por kind não teria essa propriedade, e o preço dele seria pago no dia em que o kind mudasse.
- **O slot adotado é o único lugar em que kind e endereço discordam.** `adoptRemoteAtlasAsLocal` (`frontend/src/js/store/local-atlas.api.js`) resgata trabalho movendo a reivindicação entre registros e ZERO bytes entre bancos, então o slot local resgatado continua nos dez bancos `remote-<atlasId>` do atlas de servidor. Um predicado sobre (kind, id) responderia "não colide" justamente para o par que divide o disco, e a aba do resgate ficaria parada enquanto outra aba abrisse aquele atlas de servidor e apagasse, na entrada, o trabalho que o resgate existia para salvar. Daí o campo `adoptedFrom` na chave local.

**Página sem mapa nunca colide.** `projetos.html`, `admin.html` e `calibracao.html` anunciam `noneKey()`, que não nomeia banco nenhum. Bloquear Mapa mais Administração quebraria um fluxo deliberado (abrir o painel numa segunda aba de propósito), e o lock antigo o quebrava por acidente de desenho: ele bloqueava a segunda aba independentemente de atlas, e só `frontend/src/js/index.js` o chamava.

## Por que ORDEM TOTAL e não janela de tempo

A versão anterior sondava o canal por 1,5 s antes de se declarar ativa, e o buraco dela era **determinístico**, não estatístico: durante a sondagem a aba não respondia ao `PING` (a flag de ativa ainda era falsa e o handler permanente só era instalado quando o timeout disparava), então duas abas com sondagens sobrepostas ficavam ambas ativas. E como a inicialização do lock rodava depois do `await` da criação dos controles, a defasagem necessária para acertar a janela era a defasagem de **BOOT**, não 1,5 s de relógio de parede. Aumentar a janela não conserta, porque o que varia é o tempo de boot.

A resolução de hoje não usa janela nenhuma: `compareClaims` ordena por `claimedAt` e desempata por `tabId`, e toda aba computa a mesma resposta a partir de dados que toda aba transmite. Duas propriedades tornam o buraco impossível por construção: o receptor é instalado ANTES de qualquer mensagem ser postada (não existe estado em que uma aba está muda), e as duas abas chegam à mesma conclusão independentemente de quem responde primeiro, então exatamente uma satisfaz "precede" e exatamente uma bloqueia. A janela de settle de `acquire` sobrevive como cortesia, para a resposta chegar antes de o chamador agir, e não como o mecanismo de segurança.

Ordenar por `claimedAt` primeiro é o que faz o caso comum ler como "quem já estava ganha": uma aba que abre depois reivindica depois. `tabId` sozinho seria arbitrário, e fica só como desempate do caso simultâneo.

## Bloquear significa PARAR, e nunca apagar

O overlay antigo era uma `div` que engolia clique enquanto, atrás dela, o WebSocket seguia conectado, o flush seguia drenando a cada 1,5 s, a presença mantinha a aba no roster e o `ApiClient` seguia rotacionando token. Ou seja: a defesa era visual e o dano continuava.

Hoje a metade que sustenta é `onBlocked`, ligada a `stopAutoFlush()` mais `syncEngine.disconnect()`. Duas restrições sobre ela, e as duas custam dado se ignoradas:

- **Ela não pode apagar.** Duas abas só se bloqueiam quando dividem o endereço, então o que uma apagasse ali seria literalmente o dado vivo da outra, e a fila de saída daquele atlas é uma só para as duas (ela é por atlas, não por aba, ver [[namespace-por-atlas]]): bloquear com `clearAllDataStore()` descartaria trabalho não sincronizado das DUAS. Pare o flush, desconecte, não toque em armazenamento.
- **Ela não pode morar no módulo do lock.** `tab-lock.js` não importa nada de `@store`, porque as três páginas sem mapa o usam e porque um lock capaz de alcançar `clearAllDataStore` está a uma edição de distância de apagar o que ele existe para proteger. O efeito mora do lado do sync, em `frontend/src/js/store/sync/tab-lock-sync-brake.js`, e é preso por `setTabLockEffects`, que é chamada de página e não import. A instalação é late-safe de propósito: uma aba que JÁ está bloqueada quando o freio é instalado roda a parada naquele momento, senão o perdedor do boot ficaria drenando a fila.

"Usar aqui" é handoff de verdade: o requisitante só destrava quando nenhum par vivo em colisão o precede mais, o que é **evidência** de que o outro lado já parou, não suposição de que vai parar.

## Onde o chamador é obrigado a perguntar

O que obriga a perguntar não é a chamada, é o ALVO: um `clearAllDataStore()` que possa cair sobre bancos que outra aba segura é precedido de um `acquire()` **aguardado**. É por isso que `acquire` é um pré-voo aguardável que devolve `{granted}`, e não a leitura de uma flag: logo depois de `initTabLock()` a flag é sempre `false` e não significa nada, porque o lock ainda não ouviu ninguém.

São quatro apagamentos assim, e os dois de boot são o pior caso, não o óbvio: a intenção "Mapa local" vive em `sessionStorage`, que é **herdado quando a aba é duplicada**, então a duplicata boota com a intenção, lê origem remota e apaga o namespace que a aba original está usando. Os dois passam por `clearMountedAtlasIfGranted` (`frontend/src/js/account/open-atlas.service.js`), que é também o módulo dono da pergunta "qual atlas esta aba segura" (`currentAtlasLockKey`), derivada de `syncEngine.atlasId` mais o escopo ativo do store, que é o mesmo par que `frontend/src/js/deep-link/atlas-url-sync.js` lê para a URL. Derivar de outra fonte é como o lock e a barra de endereços passam a discordar sobre a mesma aba.

**A quinta escrita destrutiva NÃO pergunta, e a exceção é o que confirma a regra acima.** `switchToNewLocalAtlas` (o import de `.ebgeo` com um atlas de servidor aberto) monta um slot criado uma linha antes, com UUID e bancos novos, e só então esvazia: nenhum par pode estar segurando aquele endereço, e o `syncAtlasLockKey` que roda entre as duas coisas já soltou o atlas de servidor para as outras abas. Ler a regra como "todo wipe passa pelo lock" faz procurar uma falta de arbitragem onde não há endereço em disputa; a regra é sobre quem mais pode estar escrevendo ali.

## A chave muda em vida, então o protocolo é de N tempos

O atlas troca sem recarregar em quatro fluxos (login com link pendente, "Salvar no servidor", logout com a aba ficando no mapa, e sessão perdida por 401). Um protocolo de dois tempos, do tipo "confere uma vez no boot", não expressa nenhum deles. Daí `setTabLockKey` e `releaseTabLock` serem movimentos de primeira classe, e a retratação (403/404, atlas que não abre) não ser um caso especial de descarregamento de página.

O `?atlasPublico=` merece nota, porque a saída NÃO tomada é instrutiva: o parâmetro é um **token** de link, e o UUID só existe depois que o servidor responde. Reivindicar cedo sob um id provisório erraria duas vezes, colidindo duas abas que abrem links públicos diferentes (colisão falsa) e não colidindo duas abas que abrem o mesmo atlas por rotas diferentes (colisão perdida), e o recarimbo posterior ainda jogaria a aba para o FIM da ordem total, entregando uma reivindicação que ela já tinha. Por isso a reivindicação é **adiada**: resolver o token é leitura, não destrói nada, e a chave é tomada com o UUID real antes do primeiro passo destrutivo.

## Avisar antes de destruir, e por que o aviso NÃO é endereçado por colisão

Tudo acima arbitra quem PODE segurar um atlas. Esta seção é a outra metade: uma aba que vai DESTRUIR bancos contando isso a quem está escrevendo neles. Quem vai destruir chama `announceTeardown` com a lista de `dbSuffix` condenados, o receptor responde por `applyTeardownFreeze` (`frontend/src/js/store/sync/tab-lock-sync-brake.js`), e o emissor só esvazia depois dos acks ou do tempo limite.

**O endereçamento é a parte que não podia ser feita do jeito óbvio**, e é a razão de a mensagem carregar endereços em vez de chave. O caminho pronto era `_handleTakeover`, que sai cedo quando as chaves não colidem; só que o par que o aviso precisa alcançar não colide **por definição da regra do dono**: de um lado quem sai da conta (chave local, ou nenhuma), do outro a irmã segurando um atlas de servidor, e sob a regra uniforme duas abas em atlas de servidor DISTINTOS também não colidem. Um aviso montado sobre `keysCollide` funcionaria na bancada e ficaria mudo exatamente quando passasse a ser necessário. Então TEARDOWN vai para toda aba viva e cada uma decide comparando com o `dbSuffix` que tem MONTADO, que é fato do store e não da chave. O casamento mora no freio, e não no lock, porque o lock não pode importar `@store`.

**A lista anunciada é a lista do expurgo, até a exclusão.** `announceRemoteTeardown` (`frontend/src/js/account/account.control.js`) tira do anúncio todo namespace que um atlas LOCAL reivindica, porque o expurgo também o pula: o slot resgatado guarda o sufixo `remote-<id>`, e anunciar o registro cru condenaria um endereço que ninguém vai tocar, congelando à toa justamente a aba que carrega o trabalho salvo. Avisar sobre uma lista diferente da que vai ser destruída é um aviso que parece certo e erra, nos dois sentidos. Pela mesma lógica o visitante de link público não congela (`applyTeardownFreeze` sai cedo para ele): sem sessão, o logout alheio não é sobre ele, e quem o protege é o lock de montagem.

Três propriedades do desenho que custam dado se forem invertidas: o ack é postado **depois** de o freio terminar (um ack no início da parada é o emissor esvaziando sob uma aba que ainda escreve); o freio **solta o lock de montagem**, senão o aviso seria cortesia e o namespace seguiria poupado até o prazo de 24 h vencer; e o silêncio degrada para o comportamento antigo, porque uma aba que não responde continua montada e o expurgo a poupa. A aba freada **não volta**: ela retrata a chave, mostra o overlay com "Recarregar" e é mantida fora de `onResumed` dos dois lados.

## A regra uniforme foi a ÚLTIMA coisa a entrar, e a ordem era de segurança

A regra uniforme ("mesmo endereço, e nada mais") nem sempre foi verdadeira, e a ordem em que ela se tornou verdadeira é propriedade de segurança, não preferência. Enquanto `openRemoteAtlas` não ativava namespace, dois atlas de servidor eram o MESMO conjunto de dez bancos, e `keysCollide` devolvia `true` para qualquer par deles: não era a regra do dono, era a leitura segura daquele período. A ordem em que a fiação entrou vale registrar porque não se lê no resultado:

1. o resgate (`preserveUnsyncedWorkAsLocal`, `frontend/src/js/account/account.control.js`) PRIMEIRO, porque ele era mina armada: o logout preservava trabalho não sincronizado virando o marcador de origem, o que funcionava enquanto local e remoto dividiam bancos e viraria apagamento no instante em que o namespace passasse a existir;
2. `activateRemoteAtlas` em `openRemoteAtlas` e no caminho de link público, antes da primeira escrita;
3. o boot chamando `initLocalAtlases` com origem e sessão reais (`activateBootAtlasScope`, `frontend/src/js/store/store.js`);
4. só então a retirada da retenção, como mudança própria, depois de cada um dos quatro defeitos que ela cobria ter sido fechado por nome e ter ganho guarda própria (a lista está no comentário de `keysCollide`, e quem afirma que dois atlas de servidor são mesmo dois blocos de bancos é `frontend/tests/integration/namespace-remoto-fiacao.test.js`).

Inverter 1 e 2 apaga trabalho do usuário. Fazer 4 antes de 2 teria sido perda de dado: duas abas em atlas de servidor distintos caindo no mesmo banco, e o apagamento de uma levando o mapa vivo da outra. **A lição de forma vale mais que a cronologia:** enquanto a retenção existiu, o comentário ao lado dela dizia por que ela ENTROU, e a leitura natural (tomá-lo como razão para ela FICAR) manteve viva uma trava cujos quatro motivos já tinham morrido.

## O que este protocolo NÃO garante

Doc que só conta vitória é propaganda, e o lock arbitra menos do que uma primeira leitura sugere. Os furos estão enumerados com reprodução em `frontend/tests/TESTING-BACKLOG.md` (seção "Furos abertos do tab-lock"); os quatro que são do PROTOCOLO têm `it.todo` correspondente em `frontend/tests/unit/tab-lock-refutacao.test.js`, e são estes, que mudam como se deve ler as seções acima:

- **`granted` é concedido por AUSÊNCIA DE PROVA**, e é ele que autoriza o apagamento. Duas abas cujas janelas de settle se sobrepõem recebem as duas `{granted: true}`; uma única mensagem `STATE` perdida faz o mesmo. A ordem total conserta o ESTADO depois, e o apagamento já rodou.
- **Não há fencing.** Uma aba apenas congelada (thread principal ocupada, não morta) para de pulsar, é expirada por TTL, e ao acordar re-anuncia o `claimedAt` antigo, volta a preceder e retoma sem que o próprio `onBlocked` jamais tenha rodado.
- **`pagehide` não olha `persisted`**, então entrar no bfcache posta uma retratação e voltar não re-anuncia até o heartbeat seguinte.
- **Uma aba que cedeu nunca reassume**, e um único `TAKEOVER` encalha TODAS as abas com a chave em colisão, não só a que pediu.

Some-se a isso o que é aberto por fora do lock. **Ninguém lê `degraded`**: sem `BroadcastChannel` e sem `localStorage` o lock desliga e concede, de propósito ("off and audible"), mas o único sinal é um `console.warn`, e nenhum chamador transforma isso em aviso na tela. E o expurgo de logout arbitra por um mecanismo que **não é este**, um Web Lock de montagem ([[namespace-por-atlas]]), justamente porque o roster daqui é relógio: a aba em bfcache posta retratação, o modo degradado o deixa permanentemente vazio, e o expurgo de boot roda antes de o lock existir. Quem for consertar um furo de destruição de dado não deve procurar a solução no roster.

## Fronteiras com outras páginas

- O lock **não é defesa de sessão**. Ele impedia duas abas por acidente de desenho, e esconder uma corrida não é defendê-la: o que separa a sessão do logout global é a serialização de refresh do `ApiClient` mais a janela de graça do servidor. Ver [[refresh-token-rotacao]].
- Ele é premissa de uma outra decisão: o filtro de auto-eco compara a metade de INSTALAÇÃO do `clientId`, e isso só é são porque um navegador nunca tem duas abas no MESMO atlas. Ver [[client-id-estavel]].
- O que o lock arbitra são endereços de banco, e quem define esses endereços é [[namespace-por-atlas]].

Ver também [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]].

## Histórico

- **2026-08-15, mais tarde no mesmo dia.** Esta página tinha uma seção inteira sobre a retenção remoto x remoto de `keysCollide`, escrita no presente, e a retenção saiu do código no mesmo dia. Três afirmações caíram juntas: a linha de resumo ("uma exceção deliberada que ainda está no código"), a seção que a descrevia, e o endereçamento do aviso de desmontagem, que projetava para o futuro ("nem depois que a trava sair") uma propriedade que já era do presente. A seção não virou "a trava saiu": ela sumiu, e ficou o porquê que sobrevive à retirada, que é o aviso ser endereçado por CONJUNTO DE ENDEREÇOS e não por colisão de chave. A mesma passada acrescentou a quinta escrita destrutiva (`switchToNewLocalAtlas`), que é deliberadamente não arbitrada e transformava "todo wipe passa pelo lock" numa regra falsa por generalização. Duas lições de forma, e as duas já estão em [`docs/wiki/wiki-schema.md`](wiki-schema.md): pendência de fase não mora na wiki, e afirmação sobre uma peça em construção se confere contra o código no dia em que se escreve.
