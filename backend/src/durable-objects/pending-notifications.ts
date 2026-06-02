/**
 * Durable Object for Real-Time Pending Transactions
 * Manages WebSocket connections and broadcasts new pending items to all connected clients
 */

interface ClientEntry {
  ws: WebSocket;
  teamId: string | null;
}

export class PendingNotificationsDO {
  private clients: ClientEntry[] = [];
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

    // Extract team_id from query string so we can route per-team broadcasts
    const reqUrl = new URL(request.url);
    const teamId = reqUrl.searchParams.get('team_id') || null;
    const entry: ClientEntry = { ws: server, teamId };
    this.clients.push(entry);

    console.log(`[PendingNotificationsDO] Client connected (team=${teamId || 'all'}). Total: ${this.clients.length}`);

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
      this.clients = this.clients.filter((c) => c.ws !== server);
      console.log(`[PendingNotificationsDO] Client disconnected. Total: ${this.clients.length}`);
    });

    // Handle errors — also remove from clients to avoid broadcasting to dead sockets
    server.addEventListener('error', (error: any) => {
      console.error(`[PendingNotificationsDO] Error:`, error);
      this.clients = this.clients.filter((c) => c.ws !== server);
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

      // Determine target team_id from payload (data.team_id). Clients connected without team_id
      // (legacy frontend) still receive everything for backward compatibility.
      const targetTeamId: string | null =
        (incomingData && incomingData.data && incomingData.data.team_id != null)
          ? String(incomingData.data.team_id)
          : null;

      const recipients = targetTeamId
        ? this.clients.filter((c) => !c.teamId || c.teamId === targetTeamId)
        : this.clients;

      console.log(`[PendingNotificationsDO] Broadcasting to ${recipients.length}/${this.clients.length} clients (team=${targetTeamId || 'all'}).`);

      // Send incoming data directly as message (already formatted by backend)
      let successCount = 0;
      const dead: WebSocket[] = [];
      for (const c of recipients) {
        try {
          c.ws.send(JSON.stringify(incomingData));
          successCount++;
        } catch (error) {
          console.error(`[PendingNotificationsDO] Failed to send to client:`, error);
          dead.push(c.ws);
        }
      }
      // Cleanup dead sockets so the next broadcast doesn't attempt them again
      if (dead.length > 0) {
        this.clients = this.clients.filter((c) => !dead.includes(c.ws));
      }

      console.log(`[PendingNotificationsDO] Broadcast complete. Sent to ${successCount}/${recipients.length} clients`);

      return new Response(
        JSON.stringify({
          success: true,
          sent: successCount,
          total: recipients.length,
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
