# Documentação EBGeo Backend

Guia de integração frontend-backend para o EBGeo.

---

## Ordem de Implementação

Os documentos estão organizados em ordem de implementação recomendada:

| # | Documento | Descrição | Linhas |
|---|-----------|-----------|--------|
| 01 | [Autenticação](./01-autenticacao.md) | Login, registro, refresh token, logout | ~300 |
| 02 | [Atlas Básico](./02-atlas-basico.md) | CRUD de atlas, permissões | ~350 |
| 03 | [Sync Inicial](./03-sync-inicial.md) | Pull inicial, snapshot, carregamento | ~400 |
| 04 | [WebSocket Colaboração](./04-websocket-collab.md) | Conexão WS, mensagens, presença | ~450 |
| 05 | [Sync CRDT](./05-sync-crdt.md) | Operações CRDT, push/pull HTTP | ~500 |
| 06 | [Presença e Imagens](./06-presenca-imagens.md) | Cursores, seleção, upload de imagens | ~400 |
| 07 | [Compartilhamento](./07-compartilhamento.md) | Links públicos, sharing com usuários | ~450 |
| 08 | [Offline e Import](./08-offline-import.md) | Modo offline, reconexão, upload de atlas | ~500 |
| 09 | [Administração](./09-admin.md) | Gerenciamento de usuários e resources | ~550 |

---

## Visão Geral

### Constraint Fundamental

> A aplicação DEVE funcionar identicamente para usuários não autenticados. O backend é aditivo.

O frontend deve continuar funcionando completamente offline, usando IndexedDB local. O backend adiciona:
- Persistência centralizada
- Colaboração em tempo real
- Compartilhamento entre usuários

### Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  IndexedDB   │  │  REST Client │  │  WebSocket Client  │    │
│  │  (offline)   │  │  (metadata)  │  │  (real-time sync)  │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  REST API    │  │  Sync API    │  │  WebSocket Server  │    │
│  │  (atlas,     │  │  (CRDT ops)  │  │  (collab, presence)│    │
│  │   sharing)   │  │              │  │                    │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
│                              │                                  │
│                       ┌──────────────┐                         │
│                       │  PostgreSQL  │                         │
│                       └──────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Divisão de Responsabilidades

| Tipo de Dado | API | Observação |
|--------------|-----|------------|
| Atlas metadata | REST | Nome, descrição, configurações |
| Compartilhamento | REST | Links públicos, permissões |
| Imagens | REST | Upload/download de arquivos |
| Features, Layers, Groups | **Sync/WebSocket** | Dados colaborativos |
| Maps, Briefings, Slides | **Sync/WebSocket** | Dados colaborativos |

---

## Modos de Operação

1. **Modo Offline** - Sem backend, dados locais no IndexedDB
2. **Modo Autenticado** - Login, sync com servidor, colaboração
3. **Modo Público** - Link público, somente leitura, token temporário

---

## Credenciais de Teste

Após rodar `npm run db:seed`:

| Usuário | Senha | Role |
|---------|-------|------|
| `admin` | `admin123` | admin |
| `cap.silva` | `test123` | user |

---

## Variáveis de Ambiente

```javascript
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const WS_BASE_URL = process.env.WS_URL || 'ws://localhost:3000';
```

---

## Checklist Geral de Implementação

### Fase 1: Autenticação
- [ ] Formulário de login
- [ ] Formulário de registro
- [ ] Armazenamento de tokens
- [ ] Refresh automático
- [ ] Logout

### Fase 2: Atlas Básico
- [ ] Listagem de atlas
- [ ] Criação de atlas
- [ ] Edição/deleção

### Fase 3: Sync e WebSocket
- [ ] Pull inicial (snapshot)
- [ ] Conexão WebSocket
- [ ] Envio/recebimento de operações

### Fase 4: Colaboração
- [ ] Cursores remotos
- [ ] Seleção de features
- [ ] Lista de usuários online

### Fase 5: Upload de Imagens
- [ ] Upload de imagem
- [ ] Feature de imagem
- [ ] Download/cache

### Fase 6: Compartilhamento
- [ ] Links públicos
- [ ] Compartilhar com usuários
- [ ] Modo somente leitura

### Fase 7: Offline/Import
- [ ] Operações pendentes
- [ ] Reconexão
- [ ] Upload de atlas offline

### Fase 8: Administração
- [ ] Gerenciamento de usuários
- [ ] Gerenciamento de resources

---

## Gaps Conhecidos do Backend

Os seguintes gaps foram identificados ao cruzar as ações da interface do frontend com o backend atual. Veja detalhes completos no `CLAUDE.md` (seção "Limitações Conhecidas e Gaps para Multiusuário").

### Resumo

| Prioridade | Gap | Status |
|-----------|-----|--------|
| **P0** | Atlas delete não desconecta clientes WS | Pendente |
| **P0** | Mutações REST (settings, map_order, sharing) sem broadcast WS | Pendente |
| **P1** | Mover feição entre mapas via sync (`map_id` update) | Pendente |
| **P1** | Duplicar mapa individual (endpoint dedicado) | Pendente |
| **P1** | Map reorder broadcast via WS | Pendente |
| **P2** | Awareness de briefing (edit started/ended) | Pendente |
| **P3** | Sub-canais WS por mapa (otimização de tráfego) | Pendente |
| **P3** | Combinar mapas / merge endpoint | Pendente |
| N/A | Undo/Redo | Frontend (backend já suporta as operações inversas) |

**~85% das funcionalidades multiusuário já estão implementadas no backend.** Os gaps P0 são necessários para garantir consistência em real-time.
