/**
 * Real-Time WebSocket API
 * Handles WebSocket connections and proxies them to the Durable Object
 */

import type { Env } from '../types';

export const RealtimeAPI = {
  /**
   * GET /api/realtime/ws - WebSocket upgrade endpoint
   * Upgrades HTTP connection to WebSocket and connects to Durable Object broadcast
   */
  async handleWebSocketUpgrade(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 400 });
    }

    console.log('[RealtimeAPI] WebSocket upgrade request received');

    try {
      // Get Durable Object instance (use 'global' to match scan.ts broadcast)
      const doNamespace = env.PENDING_NOTIFICATIONS;
      const doId = doNamespace.idFromName('global');
      const doInstance = doNamespace.get(doId);

      // Forward team_id query param to DO so it can route per-team broadcasts
      const incomingUrl = new URL(request.url);
      const teamId = incomingUrl.searchParams.get('team_id') || '';
      const doUrl = teamId
        ? `https://durable-object/ws?team_id=${encodeURIComponent(teamId)}`
        : 'https://durable-object/ws';

      // Proxy WebSocket to Durable Object
      return await doInstance.fetch(new Request(doUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }));
    } catch (error: any) {
      console.error('[RealtimeAPI] WebSocket upgrade failed:', error);
      return new Response('WebSocket upgrade failed', { status: 500 });
    }
  },

  /**
   * GET /api/realtime/health - Health check endpoint
   */
  async handleHealthCheck(request: Request, env: Env): Promise<Response> {
    try {
      const doNamespace = env.PENDING_NOTIFICATIONS;
      const doId = doNamespace.idFromName('global');
      const doInstance = doNamespace.get(doId);

      const response = await doInstance.fetch('https://durable-object/health');
      return response;
    } catch (error: any) {
      console.error('[RealtimeAPI] Health check failed:', error);
      return new Response(
        JSON.stringify({ status: 'error', message: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
