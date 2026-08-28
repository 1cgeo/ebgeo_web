// Path: tests/helpers/ws-client.js
// Lightweight WebSocket test client that queues incoming messages
// and provides await-able message receipt.

import WebSocket from 'ws';

/**
 * Creates a test WS client connected to the collab endpoint.
 */
export async function createWsClient(server, atlasId, token, clientId) {
  const addr = server.address();
  const port = typeof addr === 'object' ? addr.port : addr;
  const cid = clientId ? `&clientId=${clientId}` : '';
  const url = `ws://localhost:${port}/api/v1/collab?atlasId=${atlasId}&token=${token}${cid}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);

      // Resolve any pending waiters that match this message type
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,

        /**
         * Sends a message through the WebSocket.
         */
        send(data) {
          ws.send(JSON.stringify(data));
        },

        /**
         * Waits for a message of the given type (with timeout).
         */
        waitForType(type, timeoutMs = 3000) {
          // Check already-received messages first
          const existing = messages.find(m => m.type === type);
          if (existing) return Promise.resolve(existing);

          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`Timeout waiting for "${type}"`));
            }, timeoutMs);

            waiters.push({
              type,
              resolve(msg) {
                clearTimeout(timer);
                res(msg);
              }
            });
          });
        },

        /**
         * Waits for a CURSOR, in whichever shape the server is using.
         *
         * WHY THIS EXISTS. Cursor delivery has two regimes, and `WS_CURSOR_BATCH_MS` picks between
         * them at runtime: zero relays each frame immediately as `cursor`, anything above zero
         * emits one `cursors` batch per room with the last position of each client. A test that
         * waits on a literal frame type is therefore pinned to one regime, and the seven call
         * sites that did exactly that all broke the moment the default flipped.
         *
         * The intent of those tests was never "a frame of type X arrived" — it was "the peer's
         * cursor reached me". This helper says that, and keeps saying it whichever way the server
         * ships it. The dedicated coverage for the batching itself lives in
         * `tests/ws/collab-cursor-agrupado.test.js`; here the shape is deliberately invisible.
         *
         * @param {Object} [opts]
         * @param {string} [opts.doClientId] - Only accept a cursor authored by this client. In a
         *   batch the sender receives its own echo, so a test with more than one participant needs
         *   to say whose cursor it is waiting for.
         * @returns {Promise<Object>} `{ clientId, userId, position, mapId }`.
         */
        async waitForCursor({ doClientId = null, timeoutMs = 3000 } = {}) {
          const combina = (item) => !doClientId || item.clientId === doClientId;
          const doLote = (m) => (m.type === 'cursors' ? (m.lote || []).find(combina) : null);

          for (const m of messages) {
            if (m.type === 'cursor' && combina(m)) return m;
            const achado = doLote(m);
            if (achado) return achado;
          }

          const inicio = Date.now();
          // Sondagem curta em vez de um segundo registro de espera: `waiters` casa por tipo exato,
          // e ensina-lo a casar por predicado mudaria o despacho de todo teste desta pasta por uma
          // razao que e so deste ajudante.
          while (Date.now() - inicio < timeoutMs) {
            await new Promise((r) => setTimeout(r, 25));
            for (const m of messages) {
              if (m.type === 'cursor' && combina(m)) return m;
              const achado = doLote(m);
              if (achado) return achado;
            }
          }
          throw new Error(
            `Timeout esperando cursor${doClientId ? ` de ${doClientId}` : ''}`
          );
        },

        /**
         * Gets all messages of a given type.
         */
        getMessagesOfType(type) {
          return messages.filter(m => m.type === type);
        },

        /**
         * Clears the message buffer.
         */
        clearMessages() {
          messages.length = 0;
        },

        /**
         * Closes the WebSocket connection.
         */
        close() {
          ws.close();
        }
      });
    });

    ws.on('error', (err) => {
      reject(err);
    });

    // Timeout for connection
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 5000);
  });
}
