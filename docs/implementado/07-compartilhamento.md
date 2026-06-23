# 07 - Compartilhamento

Este documento cobre links públicos, compartilhamento com usuários e acesso público.

---

## Parte 1: Compartilhamento com Usuários

### 1.1 Visão Geral

O owner (ou um co-Gestor com permissão `manage`) de um atlas pode compartilhar com outros usuários, definindo permissões:
- `read` - Somente visualização
- `comment` - Pode comentar (Comentarista)
- `write` - Pode editar
- `manage` - Co-Gestor (pode compartilhar e configurar o atlas)

> **Nota:** `owner` não é concedível por compartilhamento (vem de `atlas.owner_id`; a propriedade muda apenas pela rota de transferência).

### 1.2 Ver Configuração de Compartilhamento

#### Endpoint

`GET /api/v1/atlas/:atlasId/sharing`

#### Permissão

`manage`

#### Response

```json
{
  "data": {
    "isPublic": false,
    "publicLink": null,
    "shares": [
      {
        "userId": "user-uuid-1",
        "username": "cap.silva",
        "nome": "Capitão Silva",
        "permission": "write",
        "addedAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "userId": "user-uuid-2",
        "username": "ten.lima",
        "nome": "Tenente Lima",
        "permission": "read",
        "addedAt": "2024-01-16T14:00:00.000Z"
      }
    ]
  }
}
```

### 1.3 Buscar Usuários

Antes de compartilhar, o owner pode buscar usuários.

#### Endpoint

`GET /api/v1/users/search?q=silva`

#### Permissão

Qualquer usuário autenticado

#### Response

```json
{
  "data": [
    {
      "id": "user-uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx"
    }
  ]
}
```

### 1.4 Compartilhar com Usuário

#### Endpoint

`POST /api/v1/atlas/:atlasId/sharing/users`

#### Permissão

`manage`

#### Request

```json
{
  "userId": "user-uuid",
  "permission": "write"
}
```

#### Response (201)

```json
{
  "data": {
    "id": "share-uuid",
    "atlas_id": "atlas-uuid",
    "user_id": "user-uuid",
    "permission": "write",
    "added_at": "2024-01-17T09:00:00.000Z",
    "added_by": "owner-uuid"
  }
}
```

> **Nota:** A resposta retorna o registro completo da tabela `atlas_shares` (snake_case, formato DB).

### 1.5 Alterar Permissão

#### Endpoint

`PUT /api/v1/atlas/:atlasId/sharing/users/:userId`

#### Permissão

`manage`

#### Request

```json
{
  "permission": "read"
}
```

#### Response (200)

```json
{
  "data": {
    "user_id": "user-uuid",
    "permission": "read"
  }
}
```

### 1.6 Remover Compartilhamento

#### Endpoint

`DELETE /api/v1/atlas/:atlasId/sharing/users/:userId`

#### Permissão

`manage`

#### Response

204 No Content

### 1.7 Fluxo de Compartilhamento

```
Owner                            Backend
   |                                |
   |-- GET /atlas/:id/sharing ----->|  Ver configuração atual
   |                                |
   |<-- 200 -----------------------|
   |   { isPublic: false,            |
   |     publicLink: null,          |
   |     shares: [] }               |
   |                                |
   |-- GET /users/search?q=silva -->|  Buscar usuários
   |                                |
   |<-- 200 -----------------------|
   |   { data: [{ id, nome }...] }  |
   |                                |
   |-- POST /atlas/:id/sharing/users ->|  Adicionar usuário
   |   { userId: 'uuid',            |
   |     permission: 'write' }      |
   |                                |
   |<-- 201 -----------------------|
```

---

## Parte 2: Links Públicos

### 2.1 Habilitar Link Público

#### Endpoint

`POST /api/v1/atlas/:atlasId/sharing/public`

#### Permissão

`manage`

#### Response (200)

```json
{
  "data": {
    "publicLink": "abc123xyz"
  }
}
```

O link público completo seria: `https://app.ebgeo.mil/atlas/public/abc123xyz`

### 2.2 Desabilitar Link Público

#### Endpoint

`DELETE /api/v1/atlas/:atlasId/sharing/public`

#### Permissão

`manage`

#### Response

204 No Content

---

## Parte 3: Acesso Público

### 3.1 Fluxo de Acesso Público

```
1. Usuário acessa: https://app.ebgeo.mil/atlas/public/abc123xyz

2. Frontend extrai o link: "abc123xyz"

3. Frontend chama: GET /api/v1/atlas/public/abc123xyz

4. Recebe atlas + publicToken

5. Usa publicToken para sync e WebSocket
```

### 3.2 Endpoint de Acesso Público

#### Endpoint

`GET /api/v1/atlas/public/:link`

#### Autenticação

Nenhuma necessária

#### Response (200)

```json
{
  "data": {
    "id": "atlas-uuid",
    "name": "Operação Alfa",
    "description": "Atlas da operação",
    "settings": { ... },
    "map_order": ["map-1", "map-2"],
    "is_public": true,
    "publicToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### 3.3 Token Público

O `publicToken` é um JWT especial:

```json
{
  "sub": "public-uuid-gerado",
  "atlasId": "atlas-uuid",
  "isPublic": true,
  "permission": "read",
  "nome": "Visitante",
  "iat": 1699999999,
  "exp": 1700003599
}
```

- **Expiração:** 1 hora
- **Permissão:** Somente leitura
- **Identificação:** Usuário aparece como "Visitante"

### 3.4 Usando o Token Público

```javascript
// Usar o publicToken como se fosse um accessToken normal
const publicToken = atlasResponse.data.publicToken;

// Para requisições REST
const headers = {
  'Authorization': `Bearer ${publicToken}`
};

// Para WebSocket
const wsUrl = `ws://host/api/v1/collab?atlasId=${atlasId}&token=${publicToken}`;
```

### 3.5 Limitações do Acesso Público

| Ação | Permitido |
|------|-----------|
| Visualizar atlas | ✅ Sim |
| Ver mapas, features, briefings | ✅ Sim |
| Receber atualizações em tempo real | ✅ Sim |
| Ver cursores de outros usuários | ✅ Sim |
| Criar/editar/deletar | ❌ Não |
| Push de operações | ❌ Não |
| Compartilhar | ❌ Não |

### 3.6 Fluxo Completo: Usuário Público

```
Cliente                          Backend
   |                                |
   |  [Usuário acessa link público] |
   |                                |
   |-- GET /atlas/public/:link ---->|  (1) Obtém atlas + token público
   |                                |
   |<-- 200 -----------------------|
   |   { data: {                    |
   |       id, name, ...,           |
   |       publicToken: 'jwt...'    |  Token temporário (1h, read-only)
   |     }                          |
   |   }                            |
   |                                |
   |-- GET /atlas/:id/sync/0 ------>|  (2) Pull inicial com token público
   |   Authorization: Bearer        |
   |     <publicToken>              |
   |                                |
   |<-- 200 -----------------------|
   |   { snapshot: {...},           |
   |     currentVersion: 150,       |
   |     isSnapshot: true }         |
   |                                |
   [Cliente carrega snapshot]       |
   |                                |
   |-- WS /collab?atlasId=X         |  (3) Conecta WebSocket
   |       &token=<publicToken> --->|
   |                                |
   |<-- WS: connected --------------|
   |   { sessionId,                 |
   |     permission: 'read',        |  Somente leitura
   |     usersOnline: [...] }       |
   |                                |
   [Atlas pronto (visualização)]    |
```

---

## Parte 4: Implementação no Frontend

### 4.1 Detectando Acesso Público

```javascript
// Verificar se a URL é de acesso público
function isPublicAccess() {
  return window.location.pathname.startsWith('/atlas/public/');
}

// Extrair link público da URL
function extractPublicLink() {
  const match = window.location.pathname.match(/\/atlas\/public\/([^/]+)/);
  return match ? match[1] : null;
}
```

### 4.2 Inicializando Acesso Público

```javascript
async function initPublicAccess() {
  const publicLink = extractPublicLink();
  if (!publicLink) {
    throw new Error('Link público inválido');
  }

  // 1. Obter atlas e token público
  const response = await fetch(`/api/v1/atlas/public/${publicLink}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Atlas não encontrado ou link expirado');
    }
    throw new Error('Erro ao acessar atlas');
  }

  const result = await response.json();
  const { id: atlasId, publicToken, ...atlasData } = result.data;

  // 2. Configurar token para requisições
  setAccessToken(publicToken);

  // 3. Carregar dados do atlas
  const syncManager = new SyncManager(atlasId, publicToken);
  await syncManager.initialSync();

  // 4. Conectar WebSocket (somente leitura)
  const ws = new CollabWebSocket(atlasId, publicToken);
  ws.connect();

  // 5. Desabilitar edição na UI
  setReadOnlyMode(true);

  return { atlasId, atlasData, syncManager, ws };
}
```

### 4.3 UI para Modo Público

```javascript
function setReadOnlyMode(enabled) {
  if (enabled) {
    // Desabilitar ferramentas de edição
    document.querySelectorAll('.edit-tool').forEach(el => {
      el.classList.add('disabled');
      el.setAttribute('disabled', 'true');
    });

    // Mostrar indicador de modo público
    showPublicModeIndicator();

    // Ocultar botões de compartilhamento
    document.querySelector('.share-button')?.classList.add('hidden');
  }
}

function showPublicModeIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'public-mode-indicator';
  indicator.innerHTML = `
    <span class="icon">👁</span>
    <span class="text">Modo visualização</span>
  `;
  document.querySelector('.header').appendChild(indicator);
}
```

### 4.4 Renovação de Token Público

```javascript
class PublicTokenManager {
  constructor(publicLink) {
    this.publicLink = publicLink;
    this.token = null;
    this.refreshTimer = null;
  }

  async getToken() {
    if (!this.token || this.isExpiringSoon()) {
      await this.refreshToken();
    }
    return this.token;
  }

  isExpiringSoon() {
    if (!this.token) return true;

    // Decodificar JWT para verificar expiração
    const payload = JSON.parse(atob(this.token.split('.')[1]));
    const expiresAt = payload.exp * 1000;
    const fiveMinutes = 5 * 60 * 1000;

    return Date.now() > expiresAt - fiveMinutes;
  }

  async refreshToken() {
    const response = await fetch(`/api/v1/atlas/public/${this.publicLink}`);
    const result = await response.json();
    this.token = result.data.publicToken;

    // Agendar próxima renovação
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Renovar 5 minutos antes de expirar
    const refreshIn = 55 * 60 * 1000; // 55 minutos
    this.refreshTimer = setTimeout(() => this.refreshToken(), refreshIn);
  }
}
```

---

## Parte 5: Gerenciamento de Compartilhamento

### 5.1 Componente de Compartilhamento

```javascript
class SharingManager {
  constructor(atlasId, accessToken) {
    this.atlasId = atlasId;
    this.token = accessToken;
  }

  async getSharing() {
    const response = await fetch(`/api/v1/atlas/${this.atlasId}/sharing`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    return response.json();
  }

  async searchUsers(query) {
    const response = await fetch(`/api/v1/users/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    return response.json();
  }

  async shareWithUser(userId, permission) {
    const response = await fetch(`/api/v1/atlas/${this.atlasId}/sharing/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, permission })
    });
    return response.json();
  }

  async updatePermission(userId, permission) {
    const response = await fetch(
      `/api/v1/atlas/${this.atlasId}/sharing/users/${userId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ permission })
      }
    );
    return response.json();
  }

  async removeShare(userId) {
    await fetch(`/api/v1/atlas/${this.atlasId}/sharing/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
  }

  async enablePublicLink() {
    const response = await fetch(`/api/v1/atlas/${this.atlasId}/sharing/public`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    return response.json();
  }

  async disablePublicLink() {
    await fetch(`/api/v1/atlas/${this.atlasId}/sharing/public`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
  }
}
```

### 5.2 Modal de Compartilhamento

```javascript
async function renderSharingModal(atlasId) {
  const sharing = new SharingManager(atlasId, accessToken);
  const data = await sharing.getSharing();

  return `
    <div class="sharing-modal">
      <h2>Compartilhamento</h2>

      <!-- Link Público -->
      <section class="public-link-section">
        <h3>Link Público</h3>
        ${data.data.is_public ? `
          <div class="public-link-active">
            <input type="text" readonly value="${getPublicUrl(data.data.public_link)}" />
            <button onclick="copyPublicLink()">Copiar</button>
            <button onclick="disablePublicLink()">Desativar</button>
          </div>
        ` : `
          <p>Qualquer pessoa com o link poderá visualizar este atlas.</p>
          <button onclick="enablePublicLink()">Gerar Link Público</button>
        `}
      </section>

      <!-- Compartilhar com Usuários -->
      <section class="user-sharing-section">
        <h3>Compartilhar com Usuários</h3>

        <div class="user-search">
          <input type="text" placeholder="Buscar usuário..." onInput="searchUsers(this.value)" />
          <div class="search-results"></div>
        </div>

        <div class="shared-users">
          ${data.data.shares.map(share => `
            <div class="shared-user">
              <span>${share.nome}</span>
              <select onchange="updatePermission('${share.user_id}', this.value)">
                <option value="read" ${share.permission === 'read' ? 'selected' : ''}>Visualizar</option>
                <option value="write" ${share.permission === 'write' ? 'selected' : ''}>Editar</option>
              </select>
              <button onclick="removeShare('${share.user_id}')">Remover</button>
            </div>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}
```

---

## Checklist de Implementação

### Compartilhamento com Usuários
- [ ] Visualização de compartilhamentos atuais
- [ ] Busca de usuários para compartilhar
- [ ] Adição de usuário com permissão
- [ ] Alteração de permissão
- [ ] Remoção de acesso

### Links Públicos
- [ ] Habilitar/desabilitar link público
- [ ] Copiar link público
- [ ] Exibir status do link público

### Acesso Público
- [ ] Detecção de URL de link público
- [ ] Chamada ao endpoint `/atlas/public/:link`
- [ ] Armazenamento do publicToken
- [ ] UI de somente leitura para usuários públicos
- [ ] Indicação visual de modo público
- [ ] Renovação automática do token público

---

## Próximo Documento

[08 - Offline e Import](./08-offline-import.md) - Modo offline e upload de atlas local
