import { createServer } from 'node:http';
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PORT = Number(process.env.PORT || process.env.HIERA_API_PORT || 3001);
const MAX_BODY = 1_000_000;
const allowedModels = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ACCESS_PASSWORD = process.env.HIERA_ACCESS_PASSWORD;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DIST_DIR = resolve(process.cwd(), 'dist');

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function isAuthorized(req) {
  if (!IS_PRODUCTION) return true;
  if (!ACCESS_PASSWORD) return false;
  const supplied = req.headers['x-hiera-access-code'];
  if (typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(ACCESS_PASSWORD);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function serveFrontend(req, res, pathname) {
  if (!existsSync(DIST_DIR)) {
    return send(res, 503, { error: 'Interface non construite. Lance npm run build.' });
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: 'Adresse invalide.' });
  }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const candidate = normalize(resolve(DIST_DIR, relativePath));
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + sep)) {
    return send(res, 403, { error: 'Accès refusé.' });
  }

  let filePath = candidate;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolve(DIST_DIR, 'index.html');
  }
  if (!existsSync(filePath)) return send(res, 404, { error: 'Page introuvable.' });

  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  res.writeHead(200, {
    'Content-Type': types[extname(filePath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
    if (IS_PRODUCTION && !ACCESS_PASSWORD) {
      return send(res, 503, { error: 'HIERA_ACCESS_PASSWORD doit être configuré sur l’hébergeur.' });
    }
    if (!isAuthorized(req)) {
      return send(res, 401, { error: 'Code d’accès incorrect.' });
    }
    if (!GROQ_API_KEY) {
      return send(res, 503, { error: 'Clé Groq manquante. Configure GROQ_API_KEY dans l’environnement du serveur.' });
    }

    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(res, 413, { error: 'Message trop volumineux.' });
      }
      const body = JSON.parse(raw || '{}');
      const model = allowedModels.has(body.model) ? body.model : 'openai/gpt-oss-20b';
      if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 60) {
        return send(res, 400, { error: 'Historique de conversation invalide.' });
      }
      const messages = [{
        role: 'system',
        content: "Tu es Hiera, un assistant IA utile, honnête et bienveillant. Réponds en français sauf si l'utilisateur demande une autre langue. N'invente pas de capacités ou d'actions que tu n'as pas réalisées.",
      }, ...body.messages.map((message) => {
        if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
          throw new Error('Format de message invalide.');
        }
        return { role: message.role, content: message.content.slice(0, 20000) };
      })];

      const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: 1200,
        }),
      });

      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const message = result?.error?.message || 'Le fournisseur IA a refusé la demande.';
        const status = upstream.status === 401 ? 502 : upstream.status === 429 ? 429 : 502;
        return send(res, status, { error: message });
      }

      const reply = result?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        return send(res, 502, { error: 'La réponse du fournisseur était vide.' });
      }
      return send(res, 200, { reply: reply.trim() });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : 'Requête invalide.' });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveFrontend(req, res, url.pathname);
  }
  return send(res, 404, { error: 'Route introuvable.' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hiera est démarrée sur le port ${PORT}`);
});
