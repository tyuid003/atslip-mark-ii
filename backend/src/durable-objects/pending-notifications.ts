/**
 * Durable Object for Real-Time Pending Transactions
 * Manages WebSocket connections and broadcasts new pending items to all connected clients
 */

export class PendingNotificationsDO {
  private clients: WebSocket[] = [];
  private env: any;
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  /**
   * Handle incoming requests (WebSocket or HTTP)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // WebSocket upgrade endpoint: /ws
    if (request.headers.get('Upgrade') === 'websocket' && path === '/ws') {
      return this.handleWebSocket(request);
    }

    // Broadcast endpoint: POST /broadcast
    if (request.method === 'POST' && path === '/broadcast') {
      return this.handleBroadcast(request);
    }

    // Health check
    if (request.method === 'GET' && path === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        clients: this.clients.length 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle WebSocket connection
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();

    server.accept();
    this.clients.push(server);

    console.log(`[PendingNotificationsDO] Client connected. Total: ${this.clients.length}`);

    // Send connection confirmation as JSON
    try {
      server.send(JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
        message: 'Connected to real-time notifications',
      }));
    } catch (error) {
      console.error(`[PendingNotificationsDO] Failed to send connection confirmation:`, error);
    }

    // Handle incoming messages from client
    server.addEventListener('message', (event: any) => {
      console.log(`[PendingNotificationsDO] Received from client:`, event.data);
    });

    // Handle disconnect
    server.addEventListener('close', () => {
      this.clients = this.clients.filter((c) => c !== server);
      console.log(`[PendingNotificationsDO] Client disconnected. Total: ${this.clients.length}`);
    });

    // Handle errors
    server.addEventListener('error', (error: any) => {
      console.error(`[PendingNotificationsDO] Error:`, error);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle broadcast from backend
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    try {
      const incomingData = await request.json() as any;

      console.log(`[PendingNotificationsDO] Broadcasting to ${this.clients.length} clients. Incoming:`, JSON.stringify(incomingData).substring(0, 200));

      // Send incoming data directly as message (already formatted by backend)
      let successCount = 0;
      for (const client of this.clients) {
        try {
          client.send(JSON.stringify(incomingData));
          successCount++;
        } catch (error) {
          console.error(`[PendingNotificationsDO] Failed to send to client:`, error);
        }
      }

      console.log(`[PendingNotificationsDO] Broadcast complete. Sent to ${successCount}/${this.clients.length} clients`);

      return new Response(
        JSON.stringify({
          success: true,
          sent: successCount,
          total: this.clients.length,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error(`[PendingNotificationsDO] Broadcast error:`, error);
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
}
