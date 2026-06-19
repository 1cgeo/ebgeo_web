# 01 - Autenticação

Este documento cobre a implementação da autenticação no frontend.

---

## Visão Geral

O backend usa JWT (JSON Web Tokens) para autenticação:
- **Access Token**: Curta duração (15 minutos)
- **Refresh Token**: Longa duração (7 dias)

---

## 1. Login

### Endpoint

`POST /api/v1/auth/login`

### Request

```json
{
  "username": "cap.silva",
  "password": "test123"
}
```

### Response (200)

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "550e8400-e29b-41d4-a716-446655440000-abc123...",
    "user": {
      "id": "uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx",
      "role": "user"
    }
  }
}
```

### Fluxo

```
Cliente                          Backend
   |                                |
   |-- POST /auth/login ----------->|
   |   { username, password }       |
   |                                |
   |<-- 200 -----------------------|
   |   { accessToken, refreshToken, |
   |     user: { id, nome, role } } |
   |                                |
   [Cliente armazena tokens]        |
```

---

## 2. Payload do JWT

```json
{
  "sub": "user-uuid",
  "username": "cap.silva",
  "nome": "Capitão Silva",
  "posto": "Cap",
  "role": "user",
  "iat": 1699999999,
  "exp": 1700000899
}
```

---

## 3. Armazenamento de Tokens

```javascript
const tokenStorage = {
  // Access token: memória ou sessionStorage (curta duração)
  accessToken: null,

  // Refresh token: localStorage ou httpOnly cookie (longa duração)
  setRefreshToken(token) {
    localStorage.setItem('refreshToken', token);
  },

  getRefreshToken() {
    return localStorage.getItem('refreshToken');
  },

  clearRefreshToken() {
    localStorage.removeItem('refreshToken');
  }
};
```

---

## 4. Enviando Token nas Requisições

```javascript
// Header de autorização
const headers = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};

// Exemplo com fetch
const response = await fetch('/api/v1/atlas', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

---

## 5. Refresh Token

Quando o access token expira (resposta 401), renovar automaticamente.

### Endpoint

`POST /api/v1/auth/refresh`

### Request

```json
{
  "refreshToken": "550e8400-e29b-41d4-a716-446655440000-abc123..."
}
```

### Response (200)

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "novo-refresh-token..."
  }
}
```

> **Importante:** O refresh token é rotacionado - sempre salve o novo token retornado.

### Fluxo

```
Cliente                          Backend
   |                                |
   |-- POST /auth/refresh --------->|
   |   { refreshToken }             |
   |                                |
   |<-- 200 -----------------------|
   |   { accessToken, refreshToken }|
```

---

## 6. Renovação Automática de Token

```javascript
async function fetchWithAuth(url, options = {}) {
  let response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  // Token expirado
  if (response.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      // Tentar novamente com novo token
      response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${accessToken}`
        }
      });
    } else {
      // Refresh falhou - redirecionar para login
      redirectToLogin();
    }
  }

  return response;
}

async function refreshTokens() {
  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: tokenStorage.getRefreshToken()
      })
    });

    if (response.ok) {
      const data = await response.json();
      accessToken = data.data.accessToken;
      tokenStorage.setRefreshToken(data.data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
```

---

## 7. Logout

### Endpoint

`POST /api/v1/auth/logout`

### Headers

`Authorization: Bearer <accessToken>`

### Request

```json
{
  "refreshToken": "550e8400-e29b-41d4-a716-446655440000-abc123..."
}
```

### Response

204 No Content

### Implementação

```javascript
async function logout() {
  await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshToken: tokenStorage.getRefreshToken()
    })
  });

  // Limpar tokens locais
  accessToken = null;
  tokenStorage.clearRefreshToken();
}
```

### Fluxo

```
Cliente                          Backend
   |                                |
   |-- POST /auth/logout ---------->|
   |   Authorization: Bearer token  |
   |                                |
   |<-- 204 -----------------------|
   |                                |
   [Cliente limpa tokens]           |
```

---

## 8. Obter Usuário Atual

### Endpoint

`GET /api/v1/auth/me`

### Response

```json
{
  "data": {
    "id": "uuid",
    "username": "cap.silva",
    "nome": "Capitão Silva",
    "posto_graduacao": "Cap",
    "organizacao_militar": "CIGEx",
    "role": "user"
  }
}
```

---

## 9. Auto-cadastro (Registro)

Como o sistema é para uso interno em rede militar, usuários podem se auto-cadastrar.

### Endpoint

`POST /api/v1/auth/register`

### Request

```json
{
  "username": "ten.oliveira",
  "password": "MinhaSenh@123",
  "nome": "Tenente Oliveira",
  "posto_graduacao": "Ten",
  "organizacao_militar": "CIGEx"
}
```

### Response (201)

```json
{
  "data": {
    "id": "uuid",
    "username": "ten.oliveira",
    "nome": "Tenente Oliveira",
    "posto_graduacao": "Ten",
    "organizacao_militar": "CIGEx",
    "role": "user",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### Validações

- `username`: 3-100 caracteres, apenas letras, números, `.`, `_`, `-`
- `password`: 6-100 caracteres
- `nome`: obrigatório, max 255 caracteres

### Erros

- `409 Conflict`: Username já existe

### Fluxo

```
Cliente                          Backend
   |                                |
   |-- POST /auth/register -------->|
   |   { username, password,        |
   |     nome, posto_graduacao,     |
   |     organizacao_militar }      |
   |                                |
   |                                |  [Valida username único]
   |                                |  [Hash da senha]
   |                                |  [Cria usuário com role='user']
   |                                |
   |<-- 201 -----------------------|
   |   { id, username, nome,        |
   |     role: 'user', created_at } |
   |                                |
   [Cliente pode fazer login]       |
```

> **Nota:** Novos usuários sempre recebem role `user`. Apenas admins podem criar usuários com role `admin`.

---

## 10. Fluxo de Decisão na Inicialização

```
┌─────────────────┐
│  App Iniciado   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐    NÃO    ┌──────────────────┐
│  Backend disponível?    │──────────►│   Modo Offline   │
└────────┬────────────────┘           └──────────────────┘
         │ SIM
         ▼
┌─────────────────────────┐    NÃO    ┌──────────────────┐
│  Usuário tem token?     │──────────►│  Tela de Login   │
└────────┬────────────────┘           └──────────────────┘
         │ SIM
         ▼
┌─────────────────────────┐    NÃO    ┌──────────────────┐
│  Token ainda válido?    │──────────►│  Refresh Token   │
└────────┬────────────────┘           └──────────────────┘
         │ SIM
         ▼
┌──────────────────┐
│ Modo Autenticado │
└──────────────────┘
```

---

## Checklist de Implementação

- [ ] Formulário de login
- [ ] Formulário de registro (auto-cadastro)
- [ ] Armazenamento seguro de tokens
- [ ] Envio de Authorization header em todas requisições
- [ ] Refresh automático de token em 401
- [ ] Logout com revogação de refresh token
- [ ] Exibição de dados do usuário logado

---

## Credenciais de Teste

Após rodar o seed (`npm run db:seed`):

| Usuário | Senha | Role |
|---------|-------|------|
| `admin` | `admin123` | admin |
| `cap.silva` | `test123` | user |

---

## Próximo Documento

[02 - Atlas Básico](./02-atlas-basico.md) - CRUD de Atlas
