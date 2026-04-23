import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../utils/config';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocket(): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ port: config.wsPort });

  wss.on('connection', (ws) => {
    console.log(`[WS] Client connected. Total: ${clients.size + 1}`);
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err);
      clients.delete(ws);
    });

    // Send initial welcome so client knows connection is ready
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  wss.on('error', (err) => {
    console.error('[WS] Server error:', err);
  });

  console.log(`[WS] WebSocket server running on port ${config.wsPort}`);
  return wss;
}

export function broadcast(message: Record<string, unknown>): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getWebSocketServer(): WebSocketServer | null {
  return wss;
}

export function closeWebSocket(): void {
  if (wss) {
    for (const client of clients) {
      client.terminate();
    }
    clients.clear();
    wss.close(() => {
      wss = null;
    });
  }
}
