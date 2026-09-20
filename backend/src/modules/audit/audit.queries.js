// Path: src/modules/audit/audit.queries.js

export const INSERT_AUDIT = `
  INSERT INTO audit_trail
    (action, actor_id, target_type, target_id, target_name, details, ip, user_agent, target_org_id)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::uuid)
`;

// A listagem, com filtros opcionais + paginação.
//
// O FILTRO POR `target_id` ($4) É O PAGAMENTO DE `audit_trail.target_id` SER TEXT
// (`002_auditoria.sql`), e sem ele a coluna larga seria só uma coluna que ninguém
// consegue interrogar. Enquanto ela foi UUID, metade dos alvos (o slug de catálogo, a
// chave `app_config`) nem cabia nela, então "tudo que já foi feito com o tileset X" não
// era uma pergunta formulável.
//
// ELE TEM ÍNDICE PRÓPRIO, `idx_audit_target_id`, e a frase que morava aqui dizia que a
// pergunta "entra pelo mesmo `idx_audit_target`". Isso ERA verdade no sentido literal e
// falso no sentido que importa: `idx_audit_target` é `(target_type, target_id)`, com a
// coluna que a tela NÃO preenche na liderança, então o planejador percorria o índice
// INTEIRO aplicando o `target_id` como condição na segunda coluna. Custo medido sobre 200
// mil linhas: 2466 contra 152 do índice dedicado, e num plano que não parece errado, o que
// é pior que não ter índice nenhum, porque desliga a suspeita. O índice novo, a medição
// dos dois lados e por que ele é composto estão em
// `src/database/migrations/002_auditoria.sql`.
//
// O FILTRO POR OM ($5) É PARÂMETRO DA CONSULTA, NUNCA CONCATENAÇÃO, e quem o preenche
// é o SERVIÇO a partir do escopo resolvido no banco — nunca a query string do
// chamador. Ele NÃO alcança `target_org_id IS NULL` de propósito: acervo institucional
// (sem OM dona) e alvo sem OM nenhuma (usuário, atlas, configuração) não pertencem a
// OM alguma, e entregá-los a todo produtor daria a cada OM a história das outras.
//
// O PERÍODO ($6/$7) É MEIO-ABERTO, `>= from` e `< to`: a tela manda um dia como
// [00:00 do dia, 00:00 do dia seguinte), e um `<=` faria a linha nascida exatamente na
// virada cair nos dois lados.
//
// O RECORTE DE ACESSO ($8) TEM TRES RAMOS, E O DO MEIO E O QUE EVITA A TELA VAZIA: o
// pedido explicito de uma acao VENCE o recorte. Quem escolhe "Entrada no sistema" no
// seletor de acao esta pedindo LOGIN, e devolver zero linhas porque a caixa esta
// desmarcada seria a tela recusando o que a propria tela ofereceu. Por isso a regra e
// "esconder quando ninguem pediu nada de especifico", e nao "esconder sempre".
//
// ELE VIVE NO `FILTROS` COMPARTILHADO, de proposito: `COUNT_AUDIT` usa o mesmo bloco,
// entao o `total` conta o que a lista mostra. Recortar so a lista faria o rodape dizer
// "1 a 50 de 213" sobre 213 linhas que ninguem consegue alcancar paginando.
//
// CUSTO: `NOT IN` nao e servivel pelo indice `idx_audit_action`, que atende igualdade.
// A leitura da PAGINA nao sofre (a ordenacao entra por `idx_audit_created_act`, que tem
// `action` como segunda coluna, e o LIMIT corta cedo); quem paga e o `COUNT_AUDIT`, sem
// LIMIT, proporcional a janela. Com a janela padrao de sete dias isso e contido; em
// "Tudo" e a tabela inteira, que ja era o caso antes desta linha. NAO MEDIDO: nao ha
// `EXPLAIN` desta consulta sobre tabela grande, e o repositorio tem precedente de
// medicao desse tipo logo acima (2466 contra 152 em 200 mil linhas).
//
// OS DOIS JOIN SÃO `LEFT` E ISSO É CONTRATO, não estilo: `actor_id` não tem FK (ver
// `002_auditoria.sql`) e o ator pode ter sido apagado, `target_org_id` também não tem
// FK e a OM pode ter sumido. Um `INNER` aqui APAGARIA da listagem exatamente as linhas
// cujo contexto se perdeu, que são as que mais importam numa investigação.
//
// POR QUE O NOME DO ATOR VEM NO MESMO SELECT: o produtor não alcança `GET /users`
// (`requireAdmin`), então resolver o nome no cliente é impossível para ele — ou o nome
// desce aqui, ou a tela dele mostra UUID.
const CAMPOS_E_JUNTAS = `
         a.id, a.action, a.actor_id, a.target_type, a.target_id, a.target_name,
         a.details, a.ip, a.user_agent, a.created_at, a.target_org_id,
         u.username AS actor_username, u.nome AS actor_nome,
         o.nome AS target_org_nome, o.sigla AS target_org_sigla
    FROM audit_trail a
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN organizations o ON o.id = a.target_org_id`;

// AS DUAS ACOES DE ACESSO AO SISTEMA, e elas sao exatamente duas. `refresh` nao escreve
// trilha nenhuma e falha de login e impossivel de registrar, porque `actor_id` e NOT NULL
// (as duas coisas estao ditas em `auth.controller.js`). Nao existe familia a excluir: a
// familia `identidade` tem 20+ acoes (contas, papeis, OM, postos, chaves de API), e
// excluir por familia esconderia justamente os atos de administracao que a tela existe
// para mostrar.
const ACOES_DE_ACESSO = `('LOGIN', 'LOGOUT')`;

const FILTROS = `
   WHERE ($1::text IS NULL OR a.action = $1)
     AND ($2::uuid IS NULL OR a.actor_id = $2)
     AND ($3::text IS NULL OR a.target_type = $3)
     AND ($4::text IS NULL OR a.target_id = $4)
     AND ($5::uuid IS NULL OR a.target_org_id = $5)
     AND ($6::timestamptz IS NULL OR a.created_at >= $6)
     AND ($7::timestamptz IS NULL OR a.created_at < $7)
     AND ($8::boolean IS TRUE
          OR $1::text IS NOT NULL
          OR a.action NOT IN ${ACOES_DE_ACESSO})`;

export const LIST_AUDIT = `
  SELECT ${CAMPOS_E_JUNTAS}
  ${FILTROS}
  ORDER BY a.created_at DESC
  LIMIT $9 OFFSET $10
`;

export const COUNT_AUDIT = `
  SELECT COUNT(*)::int AS total
    FROM audit_trail a
  ${FILTROS}
`;
