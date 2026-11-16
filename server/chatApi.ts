import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin} from 'vite';

const UPSTREAM_CHAT_URL =
  'https://api.reflection.ai/openai/v1/chat/completions';
const DEFAULT_MODEL = 'Beam-1.0-501B-A23B';

type ChatMessage = {role: 'system' | 'user' | 'assistant'; content: string};

type ChatPayload = {
  messages?: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  // Status endpoint — lets the UI show "live" vs "local demo" without
  // ever seeing the token itself.
  if (req.method === 'GET') {
    sendJson(res, 200, {
      provider: 'Reflection AI',
      model: process.env.REFLECTION_MODEL || DEFAULT_MODEL,
      configured: Boolean(process.env.REFLECTION_API_KEY?.trim()),
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {error: 'Method not allowed.'});
    return;
  }

  // The key stays on the server. It is loaded from .env in vite.config.ts or
  // from the process environment — it is never sent to the browser.
  const apiKey = process.env.REFLECTION_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 503, {
      error:
        'REFLECTION_API_KEY is not set. Add it to .env or export it, then restart the dev server.',
    });
    return;
  }

  let payload: ChatPayload;
  try {
    payload = JSON.parse(await readBody(req)) as ChatPayload;
  } catch {
    sendJson(res, 400, {error: 'Invalid JSON body.'});
    return;
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) {
    sendJson(res, 400, {error: 'messages must be a non-empty array.'});
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.REFLECTION_MODEL || DEFAULT_MODEL,
        messages,
        temperature: payload.temperature ?? 0.7,
        top_p: payload.top_p ?? 0.9,
        max_tokens: payload.max_tokens ?? 16000,
        stream: true,
      }),
    });
  } catch (error) {
    sendJson(res, 502, {error: `Could not reach Reflection AI: ${String(error)}`});
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    sendJson(res, upstream.status, {
      error: `Reflection API error (${upstream.status}): ${detail.slice(0, 1000)}`,
    });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done || closed) break;
      res.write(value);
    }
  } catch {
    // Either the client or the upstream disconnected mid-stream.
  } finally {
    reader.releaseLock();
  }
  if (!closed) res.end();
}

export function chatApiPlugin(): Plugin {
  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if ((req.url ?? '').split('?')[0] !== '/api/chat') {
      next();
      return;
    }
    handleChat(req, res).catch(error => {
      if (!res.headersSent) {
        sendJson(res, 500, {error: `Chat proxy error: ${String(error)}`});
      } else {
        res.end();
      }
    });
  };

  return {
    name: 'reflection-chat-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
