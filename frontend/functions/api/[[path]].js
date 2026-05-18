/**
 * Cloudflare Pages Function — API Proxy
 * Proxies all /api/* requests to atslip-backend Worker
 * รองรับทั้ง HTTP และ WebSocket
 *
 * NOTE: ใช้ workers.dev URL เพื่อหลีกเลี่ยง routing loop
 * (ถ้าใช้ api.atslip.biz และ forward Host header จะเกิด loop กลับมาที่ Pages project)
 */

const BACKEND_URL = 'https://atslip-backend.tyuid003.workers.dev';
const BACKEND_WS_URL = 'wss://atslip-backend.tyuid003.workers.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetPath = url.pathname + url.search;

  // ============================================================
  // WebSocket Proxy
  // ============================================================
  const upgradeHeader = context.request.headers.get('Upgrade');
  if (upgradeHeader === 'websocket') {
    const backendWsUrl = BACKEND_WS_URL + targetPath;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const backendResponse = await fetch(backendWsUrl, {
      headers: { Upgrade: 'websocket' },
    });

    const backendWs = backendResponse.webSocket;
    if (!backendWs) {
      return new Response('WebSocket backend connection failed', { status: 502 });
    }

    backendWs.accept();
    server.accept();

    backendWs.addEventListener('message', (event) => {
      try { server.send(event.data); } catch (e) {}
    });
    server.addEventListener('message', (event) => {
      try { backendWs.send(event.data); } catch (e) {}
    });
    backendWs.addEventListener('close', (event) => {
      try { server.close(event.code, event.reason); } catch (e) {}
    });
    server.addEventListener('close', (event) => {
      try { backendWs.close(event.code, event.reason); } catch (e) {}
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ============================================================
  // HTTP Proxy
  // ============================================================
  const targetUrl = BACKEND_URL + targetPath;

  // สร้าง headers ใหม่ที่สะอาด — ไม่ forward Host หรือ Cloudflare-internal headers
  // เพราะการ forward Host: app.atslip.biz ไปยัง backend จะทำให้ Cloudflare
  // route request กลับมาที่ Pages project แทน Worker (infinite loop)
  const backendHeaders = new Headers();
  const headersToForward = ['content-type', 'x-team-slug', 'authorization', 'accept', 'accept-language', 'accept-encoding'];
  for (const key of headersToForward) {
    const val = context.request.headers.get(key);
    if (val) backendHeaders.set(key, val);
  }

  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers: backendHeaders,
    body: ['GET', 'HEAD'].includes(context.request.method) ? null : context.request.body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
