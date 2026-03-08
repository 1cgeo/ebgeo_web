// Path: tests/helpers/ws-client.js
// Lightweight WebSocket test client that queues incoming messages
// and provides await-able message receipt.

import WebSocket from 'ws';

/**
 * Creates a test WS client connected to the collab endpoint.
 */
export async function createWsClient(server, atlasId, token) {
  const addr = server.address();
  const port = typeof addr === 'object' ? addr.port : addr;
  const url = `ws://localhost:${port}/api/v1/collab?atlasId=${atlasId}&token=${token}`;

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
