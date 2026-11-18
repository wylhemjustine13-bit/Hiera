import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PORT = Number(process.env.HIERA_API_PORT || 3001);
const MAX_BODY = 1_000_000;
const allowedModels = new Set(['gpt-4.1-mini', 'gpt-4.1']);

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') {
    return send(res, 200, { ok: true, configured: Boolean(process.env.OPENAI_API_KEY) });
  }
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return send(res, 404, { error: 'Route introuvable.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return send(res, 503, { error: 'Clé API manquante. Configure OPENAI_API_KEY dans le fichier .env du serveur.' });
  }

  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(res, 413, { error: 'Message trop volumineux.' });
    }
    const body = JSON.parse(raw || '{}');
    const model = allowedModels.has(body.model) ? body.model : 'gpt-4.1-mini';
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 60) {
      return send(res, 400, { error: 'Historique de conversation invalide.' });
    }
    const input = body.messages.map((message) => {
      if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
        throw new Error('Format de message invalide.');
      }
      return { role: message.role, content: message.content.slice(0, 20000) };
    });

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: "Tu es Hiera, un assistant IA utile, honnête et bienveillant. Réponds en français sauf si l'utilisateur demande une autre langue. N'invente pas de capacités ou d'actions que tu n'as pas réalisées.",
        input,
        max_output_tokens: 1200,
      }),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = result?.error?.message || 'Le fournisseur IA a refusé la demande.';
      const status = upstream.status === 401 ? 502 : upstream.status === 429 ? 429 : 502;
      return send(res, status, { error: message });
    }

    const reply = typeof result.output_text === 'string'
      ? result.output_text
      : (result.output || []).flatMap((item) => item.content || [])
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text)
          .join('\n')
          .trim();

    if (!reply) return send(res, 502, { error: "La réponse du fournisseur était vide." });
    return send(res, 200, { reply });
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : 'Requête invalide.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hiera API disponible sur http://127.0.0.1:${PORT}`);
});