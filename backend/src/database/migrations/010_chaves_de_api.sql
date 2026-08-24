-- ============================================================================
-- AS TRÊS AMARRAS DA CHAVE DE API: prazo, escopo e revogação individual
-- ============================================================================
--
-- POR QUE ESTA MIGRAÇÃO EXISTE, e por que ela vem ANTES do `location` do nginx.
-- A cláusula 10.7 da constituição decidiu que a chave de API passa a ser a
-- credencial que o nginx valida nas rotas do servidor de tiles (é a saída para o
-- defeito da 10.1, os bytes do tile privado sem gate). Isso muda o peso do que
-- falta: uma credencial que hoje um punhado de integradores carrega passaria a
-- viajar na URL de CADA TILE, para dentro do log de acesso do nginx, do `Referer`
-- de todo recurso que a página carregue depois e de todo cache compartilhado que
-- guarde a URL com query.
--
-- Antes desta migração a chave era o usuário INTEIRO, permanente e revogável só
-- por rotação. Ligar o nginx nesse estado trocaria um vazamento de bytes por uma
-- sessão de administrador sem prazo, que é uma troca pior. Daí a ordem: as três
-- amarras primeiro, o `location` depois.
--
-- O QUE ELA NÃO FAZ, e a ausência é decisão: ela NÃO move nem apaga a chave que
-- vive em `users.api_key`. Aquele slot é o contrato de hoje (a rota de rotação o
-- devolve, integradores o carregam, e há escrita direta nele em fixture de teste),
-- e migração é forward-only. Ele fica onde está e ganha as amarras que consegue
-- carregar (prazo, corte de sessão), enquanto a capacidade NOVA — várias chaves
-- vivas, escopo por chave, revogação de UMA delas — nasce na tabela abaixo.
-- Duas moradas para uma credencial é custo real, e o caminho de saída está escrito
-- no `fileoverview` de `src/modules/users/api-key-terms.js`: quando nenhum
-- integrador depender mais do slot, ele é apagado por migração própria.

-- ----------------------------------------------------------------------------
-- AMARRA 1 (PRAZO) PARA O SLOT LEGADO DE `users`
-- ----------------------------------------------------------------------------
-- Duas colunas e não uma, e a segunda é a que não se adivinha.
--
-- `api_key_expires_at` é o prazo. O DEFAULT é o que faz a coluna nascer PREENCHIDA
-- em toda linha existente (um `ADD COLUMN ... DEFAULT` avalia a expressão uma vez e
-- a grava em todas), de modo que nenhuma chave viva hoje deixa de funcionar por
-- esta migração: ela passa a ter noventa dias contados de agora. A rotação renova o
-- prazo, então quem rotaciona nunca é surpreendido.
--
-- NULL SIGNIFICA VENCIDA, nunca "sem prazo". O DEFAULT torna o NULL inalcançável
-- pelos caminhos que existem, e é justamente por isso que ele precisa falhar
-- FECHADO: a única forma de aparecer um NULL aqui é alguém escrever a coluna à mão,
-- e nesse caso a leitura correta é "esta linha não declarou prazo", não "esta chave
-- é eterna". O predicado está em `FIND_USER_BY_API_KEY`.
--
-- `api_key_created_at` existe para o CORTE DE SESSÃO, e não para relatório. A
-- revogação em massa (detecção de reuso, troca de senha, reset de administrador,
-- desativação) carimba `users.sessions_valid_from`, e o caminho de requisição
-- compara aquele marcador com o `iat` de um JWT — que uma chave não tem. Era por
-- isso que a chave não caía no corte, o que a cláusula 10.7 nomeia como defeito.
-- Comparar com `updated_at` seria errado na direção aberta: qualquer edição de
-- perfil empurraria a chave para depois do corte e a ressuscitaria.
ALTER TABLE users ADD COLUMN api_key_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days');
ALTER TABLE users ADD COLUMN api_key_created_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN users.api_key_expires_at IS
  'Prazo do slot LEGADO de chave de API (users.api_key). NULL lê-se como VENCIDA, '
  'nunca como "sem prazo": o predicado falha fechado.';
COMMENT ON COLUMN users.api_key_created_at IS
  'Nascimento do slot LEGADO de chave de API, comparado com users.sessions_valid_from '
  'para que a revogação em massa alcance a chave (ela não tem `iat` para comparar).';

-- ----------------------------------------------------------------------------
-- AS CHAVES NOMEADAS: prazo, escopo e revogação individual
-- ----------------------------------------------------------------------------
-- UMA LINHA POR CHAVE VIVA, que é o que "revogar uma sem derrubar as outras" pede.
-- Com um slot único por pessoa, revogar é rotacionar, e rotacionar derruba junto
-- toda integração daquela conta — o terceiro item da lista da cláusula 10.7.
--
-- `api_key_history` NÃO É esta tabela e continua sendo o que era: o arquivo das
-- rotações do slot legado. Ela não tem prazo, não tem escopo e a sua linha nasce já
-- revogada. Fundir as duas faria a consulta de autenticação varrer histórico morto.
CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),

    -- A chave em si. UUID como o slot legado, e não um segredo mais longo com
    -- guarda de hash: `middleware/flexible-auth.js` testa a FORMA de UUID antes de
    -- ir ao banco, e essa peneira é o que impede que qualquer `?api_key=` de
    -- passante vire uma consulta. Trocar o formato aqui custaria aquela peneira e o
    -- caminho de migração das chaves vivas ao mesmo tempo. O armazenamento em claro
    -- é limite conhecido, declarado no relatório da fase.
    api_key     UUID NOT NULL UNIQUE,

    -- Para quem lê a lista e precisa saber qual chave desligar. NOT NULL porque uma
    -- lista de cinco chaves anônimas não é revogação individual utilizável: quem não
    -- sabe qual é qual acaba rotacionando tudo, que é o defeito de partida.
    label       VARCHAR(100) NOT NULL,

    -- AMARRA 2 (ESCOPO). Vocabulário FECHADO e pequeno de propósito, espelhado em
    -- `src/modules/users/api-key-terms.js`, que é onde o alcance de cada valor é
    -- declarado como TABELA e lido pelos gates. `tiles` é o escopo da decisão de
    -- 10.7: serve para buscar bytes por rota não bloqueante e mais nada. `full` é o
    -- comportamento histórico do slot legado, MENOS administração do sistema —
    -- nenhum escopo alcança administração, e isso é propriedade da tabela de
    -- alcance, não um valor que falta aqui.
    scope       VARCHAR(20) NOT NULL DEFAULT 'tiles'
                  CHECK (scope IN ('tiles', 'full')),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID REFERENCES users(id),

    -- AMARRA 1 (PRAZO), aqui obrigatória em vez de defaultada: uma chave nomeada
    -- nasce por rota, e a rota tem onde perguntar. O teto de um ano copia
    -- `resource_grants_expires_at_check` de propósito, inclusive na âncora: as duas
    -- pontas medem a partir de `created_at`, e não de `NOW()`, senão prorrogar uma
    -- linha antiga em pequenos saltos daria prazo ilimitado por soma.
    expires_at  TIMESTAMPTZ NOT NULL,

    -- AMARRA 3 (REVOGAÇÃO INDIVIDUAL). Nulo = viva. Soft, como todo o resto do
    -- sistema: apagar a linha apagaria junto a resposta para "esta chave chegou a
    -- existir?", que é a primeira pergunta de qualquer investigação de vazamento.
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id),

    CONSTRAINT api_keys_expires_at_check
      CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '1 year')
);

-- A listagem por pessoa (a tela de gerência) e a contagem de chaves vivas do teto.
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

COMMENT ON TABLE api_keys IS
  'Chaves de API NOMEADAS: uma linha por chave viva, com prazo (teto de um ano), '
  'escopo e revogação individual. O slot legado users.api_key continua existindo e '
  'é lido pelo mesmo predicado de autenticação.';
