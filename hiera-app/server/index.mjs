import { createServer } from 'node:http';
import { readFileSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname, normalize, sep } from 'node:path';
import { timingSafeEqual, createHmac, randomBytes, createCipheriv, createDecipheriv, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

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
const MAX_BODY = 48 * 1024 * 1024;
const groqModels = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ACCESS_PASSWORD = process.env.HIERA_ACCESS_PASSWORD;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const HIERA_SESSION_SECRET = process.env.HIERA_SESSION_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = 'https://hiera.onrender.com/api/integrations/google/callback';
const INTEGRATION_ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY;
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } }) : null;
let integrationTableReady = false;
let usageTableReady = false;
const authAttempts = new Map();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
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

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', HIERA_SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readSession(req) {
  if (!HIERA_SESSION_SECRET) return null;
  const cookie = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('hiera_session='));
  if (!cookie) return null;
  let value;
  try { value = decodeURIComponent(cookie.slice('hiera_session='.length)); } catch { return null; }
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', HIERA_SESSION_SECRET).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
  } catch { return null; }
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('Requête trop volumineuse.');
  }
  return JSON.parse(raw || '{}');
}

function isAuthorized(req) {
  if (!IS_PRODUCTION) return true;
  if (readSession(req)) return true;
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
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID || '' });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return send(res, 200, { user: readSession(req) });
  }

  if (req.method === 'GET' && url.pathname === '/api/usage') {
    const usageUser = readSession(req);
    if (!usageUser) return send(res, 401, { error: 'Connecte-toi pour consulter ton forfait.' });
    try {
      await ensureUsageTable();
      if (await saveUserProfile(usageUser)) return send(res, 403, { error: 'Ce compte est suspendu. Contacte le support Hiera.' });
      await pool.query(
        'INSERT INTO hiera_usage (user_id, plan, period_started_at, message_count, token_count) VALUES ($1, \'basic\', NOW(), 0, 0) ON CONFLICT (user_id) DO NOTHING',
        [usageUser.sub],
      );
      const result = await pool.query(
        'SELECT plan, token_count FROM hiera_usage WHERE user_id = $1',
        [usageUser.sub],
      );
      const row = result.rows[0] || { plan: 'basic', token_count: 0 };
      const plan = ['basic', 'plus', 'pro', 'ultimate'].includes(row.plan) ? row.plan : 'basic';
      const budgets = { basic: 50000, plus: 150000, pro: 500000, ultimate: 1500000 };
      const tokensUsedTotal = Number(row.token_count || 0);
      return send(res, 200, {
        plan,
        tokensUsed: 0,
        tokensUsedTotal,
        tokenBudget: budgets[plan],
        tokensRemaining: Math.max(0, budgets[plan] - tokensUsedTotal),
      });
    } catch (usageError) {
      console.error('Usage lookup failed:', usageError instanceof Error ? usageError.message : 'unknown error');
      return send(res, 500, { error: 'Impossible de charger le forfait.' });
    }
  }

  if (req.method === 'POST' && (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login')) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const attempt = authAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (attempt.resetAt <= now) { attempt.count = 0; attempt.resetAt = now + 15 * 60 * 1000; }
    if (attempt.count >= 8) return send(res, 429, { error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
    try {
      const body = await readJson(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { error: 'Adresse e-mail invalide.' });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'Le mot de passe doit contenir entre 8 et 128 caractères.' });
      if (!pool) return send(res, 503, { error: 'La base de données des comptes doit être configurée sur Render.' });
      await pool.query("CREATE TABLE IF NOT EXISTS hiera_accounts (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      let account;
      if (url.pathname === '/api/auth/register') {
        if (name.length < 2) return send(res, 400, { error: 'Indique un nom de 2 caractères minimum.' });
        const salt = randomBytes(16).toString('hex');
        const derived = await scrypt(password, salt, 64);
        const passwordHash = 'scrypt' + '$' + salt + '$' + Buffer.from(derived).toString('hex');
        try {
          const result = await pool.query('INSERT INTO hiera_accounts (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name', [email, name, passwordHash]);
          account = result.rows[0];
        } catch (error) {
          if (error?.code === '23505') return send(res, 409, { error: 'Un compte existe déjà avec cette adresse e-mail.' });
          throw error;
        }
      } else {
        const result = await pool.query('SELECT id, email, display_name, password_hash FROM hiera_accounts WHERE email = $1', [email]);
        account = result.rows[0];
        const parts = String(account?.password_hash || '').split('$');
        let valid = false;
        if (account && parts.length === 3 && parts[0] === 'scrypt') {
          const derived = await scrypt(password, parts[1], 64);
          const expected = Buffer.from(parts[2], 'hex');
          const supplied = Buffer.from(derived);
          valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);
        }
        if (!valid) {
          attempt.count += 1; authAttempts.set(ip, attempt);
          return send(res, 401, { error: 'Adresse e-mail ou mot de passe incorrect.' });
        }
      }
      authAttempts.delete(ip);
      const accountUser = { sub: 'email:' + account.id, email: account.email, name: account.display_name || '' };
      if (await saveUserProfile(accountUser)) return send(res, 403, { error: 'Ce compte est suspendu. Contacte le support Hiera.' });
      const session = signSession({ sub: accountUser.sub, email: accountUser.email, name: accountUser.name, picture: '', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 });
      res.setHeader('Set-Cookie', 'hiera_session=' + encodeURIComponent(session) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800');
      return send(res, 200, { user: { email: account.email, name: account.display_name || '', picture: '' } });
    } catch (error) {
      console.error('Email authentication failed:', error instanceof Error ? error.message : 'unknown error');
      return send(res, 500, { error: 'Impossible de traiter la demande. Réessaie plus tard.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
    try {
      const body = await readJson(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) {
        return send(res, 400, { error: 'Adresse e-mail invalide.' });
      }
      await ensureAdminTables();
      await pool.query('INSERT INTO hiera_password_reset_requests (email) VALUES ($1)', [email]);
      return send(res, 200, { ok: true, message: 'Si cette adresse correspond à un compte, la demande a été transmise à l’équipe Hiera.' });
    } catch (error) {
      console.error('Password reset request failed:', error instanceof Error ? error.message : 'unknown error');
      return send(res, 503, { error: 'La demande ne peut pas être enregistrée pour le moment.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/google') {
    if (!GOOGLE_CLIENT_ID || !HIERA_SESSION_SECRET) {
      return send(res, 503, { error: 'La connexion Google doit être configurée sur Render.' });
    }
    try {
      const body = await readJson(req);
      if (typeof body.credential !== 'string' || body.credential.length > 10000) {
        return send(res, 400, { error: 'Identifiant Google invalide.' });
      }
      const ticket = await googleClient.verifyIdToken({ idToken: body.credential, audience: GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || profile.email_verified !== true) {
        return send(res, 401, { error: 'Le compte Google n’a pas pu être vérifié.' });
      }
      const googleUser = { sub: profile.sub, email: profile.email, name: profile.name || '' };
      if (await saveUserProfile(googleUser)) return send(res, 403, { error: 'Ce compte est suspendu. Contacte le support Hiera.' });
      const session = signSession({
        sub: profile.sub, email: profile.email, name: profile.name || '',
        picture: profile.picture || '', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });
      res.setHeader('Set-Cookie', `hiera_session=${encodeURIComponent(session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
      return send(res, 200, { user: { email: profile.email, name: profile.name || '', picture: profile.picture || '' } });
    } catch {
      return send(res, 401, { error: 'La vérification Google a échoué. Réessaie.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    res.setHeader('Set-Cookie', 'hiera_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }


  if (req.method === 'POST' && url.pathname === '/api/billing/stripe-webhook') {
    if (!STRIPE_WEBHOOK_SECRET) return send(res, 503, { error: 'Le paiement sécurisé n’est pas encore configuré.' });
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) return send(res, 413, { error: 'Événement de paiement trop volumineux.' });
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);
      const signatureHeader = String(req.headers['stripe-signature'] || '');
      const parts = signatureHeader.split(',').map((part) => part.split('='));
      const timestamp = parts.find(([key]) => key === 't')?.[1];
      const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
      if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        return send(res, 400, { error: 'Signature de paiement invalide ou expirée.' });
      }
      const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(timestamp + '.' + rawBody.toString('utf8')).digest();
      const valid = signatures.some((signature) => {
        try {
          const supplied = Buffer.from(signature, 'hex');
          return supplied.length === expected.length && timingSafeEqual(supplied, expected);
        } catch { return false; }
      });
      if (!valid) return send(res, 400, { error: 'Signature de paiement invalide.' });
      const event = JSON.parse(rawBody.toString('utf8'));
      if (!event.id || !event.type || !event.data?.object) return send(res, 400, { error: 'Événement de paiement incomplet.' });
      await ensureUsageTable();
      await pool.query(`CREATE TABLE IF NOT EXISTS hiera_billing_events (
        event_id TEXT PRIMARY KEY,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      const alreadyHandled = await pool.query('SELECT event_id FROM hiera_billing_events WHERE event_id = $1', [event.id]);
      if (alreadyHandled.rowCount) return send(res, 200, { received: true, duplicate: true });
      const object = event.data.object;
      let userId = object.metadata?.hiera_user_id || object.client_reference_id || null;
      let plan = object.metadata?.hiera_plan || null;
      let nextPlan = null;
      if (event.type === 'checkout.session.completed') {
        if (object.mode === 'subscription' && object.payment_status === 'paid' && userId && ['plus', 'pro', 'ultimate'].includes(plan)) nextPlan = plan;
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        if (userId && ['plus', 'pro', 'ultimate'].includes(plan)) {
          nextPlan = event.type === 'customer.subscription.deleted' || !['active', 'trialing'].includes(object.status) ? 'basic' : plan;
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO hiera_billing_events (event_id) VALUES ($1)', [event.id]);
        if (userId && nextPlan) {
          await client.query(
            `INSERT INTO hiera_usage (user_id, plan, period_started_at, message_count, token_count, voice_seconds)
             VALUES ($1, $2, NOW(), 0, 0, 0)
             ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan`,
            [userId, nextPlan],
          );
        }
        await client.query('COMMIT');
      } catch (dbError) {
        await client.query('ROLLBACK');
        if (dbError?.code === '23505') return send(res, 200, { received: true, duplicate: true });
        throw dbError;
      } finally {
        client.release();
      }
      return send(res, 200, { received: true });
    } catch (billingError) {
      console.error('Stripe webhook failed:', billingError instanceof Error ? billingError.message : 'unknown error');
      return send(res, 500, { error: 'Impossible de traiter cet événement de paiement.' });
    }
  }

  async function ensureUsageTable() {
    if (!pool) throw new Error('La base de données des quotas doit être configurée (DATABASE_URL).');
    if (usageTableReady) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_usage (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'basic',
      period_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message_count INTEGER NOT NULL DEFAULT 0,
      token_count BIGINT NOT NULL DEFAULT 0,
      voice_seconds INTEGER NOT NULL DEFAULT 0,
      voice_last_ping_at TIMESTAMPTZ
    )`);
    await pool.query('ALTER TABLE hiera_usage ADD COLUMN IF NOT EXISTS token_count BIGINT NOT NULL DEFAULT 0');
    await pool.query('ALTER TABLE hiera_usage ADD COLUMN IF NOT EXISTS voice_seconds INTEGER NOT NULL DEFAULT 0');
    await pool.query('ALTER TABLE hiera_usage ADD COLUMN IF NOT EXISTS voice_last_ping_at TIMESTAMPTZ');
    usageTableReady = true;
  }

  async function ensureAdminTables() {
    if (!pool) throw new Error('La base de données Hiera est indisponible.');
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_user_profiles (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      banned BOOLEAN NOT NULL DEFAULT FALSE,
      ban_reason TEXT NOT NULL DEFAULT ''
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_password_reset_requests (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'pending'
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_help_requests (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, shared_messages JSONB,
      viewed_at TIMESTAMPTZ, closed_at TIMESTAMPTZ
    )
    `);
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_safety_flags (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
      category TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'review',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
    )
    `);
    await pool.query("UPDATE hiera_help_requests SET shared_messages = NULL, status = 'expired' WHERE expires_at <= NOW() AND shared_messages IS NOT NULL AND status = 'approved'");
  }

  async function recordSafetySignal(user, message) {
    const text = String(message || '').slice(0, 12000).toLocaleLowerCase('fr');
    const checks = [
      { category: 'menace_directe', patterns: [/\bje vais (?:te|le|la|les) tuer\b/i, /\bje vais (?:te|le|la) frapper\b/i, /\bje vais lui faire du mal\b/i] },
      { category: 'harcelement_cible', patterns: [/\bje vais (?:la|le|les) harceler\b/i, /\bje vais publier (?:son|sa|ses) (?:photos?|adresse|numero)\b/i, /\bje vais (?:le|la) faire chanter\b/i] },
      { category: 'donnees_sensibles', patterns: [/\b(?:donne|envoie|obtiens) moi (?:ton|son) mot de passe\b/i, /\b(?:numero|code) de carte bancaire\b/i] },
    ];
    const match = checks.find((check) => check.patterns.some((pattern) => pattern.test(text)));
    if (!match) return;
    await ensureAdminTables();
    await pool.query(
      `INSERT INTO hiera_safety_flags (user_id, email, category)
       SELECT $1, $2, $3 WHERE NOT EXISTS (
         SELECT 1 FROM hiera_safety_flags WHERE user_id = $1 AND category = $3
         AND created_at > NOW() - INTERVAL '15 minutes'
       )`,
      [user.sub, String(user.email || '').toLowerCase(), match.category],
    );
  }

  async function saveUserProfile(user) {
    await ensureAdminTables();
    await pool.query(
      `INSERT INTO hiera_user_profiles (user_id, email, display_name, created_at, last_seen_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email,
         display_name = EXCLUDED.display_name, last_seen_at = NOW()`,
      [user.sub, String(user.email || '').toLowerCase(), user.name || ''],
    );
    const result = await pool.query('SELECT banned FROM hiera_user_profiles WHERE user_id = $1', [user.sub]);
    return result.rows[0]?.banned === true;
  }

  async function ensureIntegrationTable() {
    if (!pool) throw new Error('La base de données des connexions doit être configurée (DATABASE_URL).');
    if (integrationTableReady) return;
    await pool.query(`CREATE TABLE IF NOT EXISTS hiera_integrations (
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      encrypted_tokens TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, provider)
    )`);
    integrationTableReady = true;
  }

  function integrationKey() {
    if (!INTEGRATION_ENCRYPTION_KEY) throw new Error('La clé de chiffrement des intégrations manque dans Render.');
    const key = /^[a-f0-9]{64}$/i.test(INTEGRATION_ENCRYPTION_KEY)
      ? Buffer.from(INTEGRATION_ENCRYPTION_KEY, 'hex')
      : Buffer.from(INTEGRATION_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('La clé de chiffrement doit contenir 32 octets.');
    return key;
  }

  function encryptIntegration(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', integrationKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  function decryptIntegration(value) {
    const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', integrationKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  }

  function getCookie(req, name) {
    const item = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='));
    if (!item) return '';
    try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
  }

  function googleOAuthClient() {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) throw new Error('Configure GOOGLE_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET dans Render.');
    return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations/google/status') {
    const user = readSession(req);
    if (!user) return send(res, 401, { error: 'Connecte-toi à Hiera avant de connecter Google.' });
    try {
      await ensureIntegrationTable();
      const result = await pool.query('SELECT provider FROM hiera_integrations WHERE user_id = $1 AND provider = $2', [user.sub, 'google_calendar']);
      return send(res, 200, { connected: result.rowCount > 0 });
    } catch (error) {
      return send(res, 503, { error: error instanceof Error ? error.message : 'État de connexion indisponible.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations/google/start') {
    const user = readSession(req);
    if (!user) return send(res, 401, { error: 'Connecte-toi à Hiera avant de connecter Google.' });
    try {
      const state = randomBytes(32).toString('base64url');
      const client = googleOAuthClient();
      const authorizationUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: ['https://www.googleapis.com/auth/calendar.events'],
        state,
      });
      res.setHeader('Set-Cookie', `hiera_google_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/integrations/google; Max-Age=600`);
      res.writeHead(302, { Location: authorizationUrl, 'Cache-Control': 'no-store' });
      return res.end();
    } catch (error) {
      return send(res, 503, { error: error instanceof Error ? error.message : 'Impossible de démarrer la connexion Google.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/integrations/google/callback') {
    const user = readSession(req);
    const suppliedState = url.searchParams.get('state') || '';
    const savedState = getCookie(req, 'hiera_google_oauth_state');
    res.setHeader('Set-Cookie', 'hiera_google_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/integrations/google; Max-Age=0');
    if (!user) return send(res, 401, { error: 'Session Hiera expirée. Reconnecte-toi puis réessaie.' });
    if (!suppliedState || !savedState || suppliedState.length !== savedState.length || !timingSafeEqual(Buffer.from(suppliedState), Buffer.from(savedState))) {
      return send(res, 400, { error: 'Vérification de sécurité OAuth échouée. Recommence la connexion.' });
    }
    if (url.searchParams.has('error')) {
      res.writeHead(302, { Location: '/?google_calendar=cancelled', 'Cache-Control': 'no-store' });
      return res.end();
    }
    try {
      const code = url.searchParams.get('code');
      if (!code) return send(res, 400, { error: 'Code de validation Google manquant.' });
      const client = googleOAuthClient();
      const { tokens } = await client.getToken(code);
      await ensureIntegrationTable();
      const existing = await pool.query('SELECT encrypted_tokens FROM hiera_integrations WHERE user_id = $1 AND provider = $2', [user.sub, 'google_calendar']);
      if (!tokens.refresh_token && !existing.rowCount) throw new Error('Google n’a pas fourni de jeton de renouvellement. Réessaie après avoir retiré l’accès Hiera dans ton compte Google.');
      const previousTokens = existing.rowCount ? decryptIntegration(existing.rows[0].encrypted_tokens) : {};
      const savedTokens = { refresh_token: tokens.refresh_token || previousTokens.refresh_token, scope: tokens.scope || previousTokens.scope || '' };
      await pool.query(
        `INSERT INTO hiera_integrations (user_id, provider, encrypted_tokens, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_tokens = EXCLUDED.encrypted_tokens, updated_at = NOW()`,
        [user.sub, 'google_calendar', encryptIntegration(savedTokens)],
      );
      res.writeHead(302, { Location: '/?google_calendar=connected', 'Cache-Control': 'no-store' });
      return res.end();
    } catch (error) {
      console.error('Google Calendar OAuth callback failed:', error instanceof Error ? error.message : 'unknown error');
      res.writeHead(302, { Location: '/?google_calendar=error', 'Cache-Control': 'no-store' });
      return res.end();
    }
  }


  async function getCalendarAccessToken(userId) {
    await ensureIntegrationTable();
    const result = await pool.query('SELECT encrypted_tokens FROM hiera_integrations WHERE user_id = $1 AND provider = $2', [userId, 'google_calendar']);
    if (!result.rowCount) throw new Error('Google Agenda n’est pas connecté.');
    const tokens = decryptIntegration(result.rows[0].encrypted_tokens);
    const client = googleOAuthClient();
    client.setCredentials({ refresh_token: tokens.refresh_token });
    const refreshed = await client.getAccessToken();
    if (!refreshed.token) throw new Error('Impossible de renouveler la connexion Google. Reconnecte Google Agenda.');
    return refreshed.token;
  }

  async function calendarRequest(userId, endpoint, method = 'GET', payload) {
    const accessToken = await getCalendarAccessToken(userId);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Google Agenda a refusé la demande.');
    return data;
  }

  if (url.pathname.startsWith('/api/integrations/google/events')) {
    const user = readSession(req);
    if (!user) return send(res, 401, { error: 'Connecte-toi à Hiera pour accéder à ton agenda.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/integrations/google/events') {
        const timeMin = url.searchParams.get('timeMin') || new Date().toISOString();
        const timeMax = url.searchParams.get('timeMax') || new Date(Date.now() + 30 * 86400000).toISOString();
        const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
        const data = await calendarRequest(user.sub, `calendars/primary/events?${params}`);
        return send(res, 200, { events: data.items || [] });
      }
      if (req.method === 'POST' && url.pathname === '/api/integrations/google/events') {
        const body = await readJson(req);
        if (body.confirmed !== true) return send(res, 428, { error: 'Confirmation requise avant de créer ce rendez-vous.' });
        if (typeof body.summary !== 'string' || !body.summary.trim() || !body.start || !body.end) return send(res, 400, { error: 'Titre, début et fin sont obligatoires.' });
        return send(res, 201, { event: await calendarRequest(user.sub, 'calendars/primary/events', 'POST', {
          summary: body.summary.trim().slice(0, 200),
          description: typeof body.description === 'string' ? body.description.slice(0, 4000) : undefined,
          start: body.start, end: body.end,
        }) });
      }
      const eventMatch = url.pathname.match(/^\/api\/integrations\/google\/events\/([A-Za-z0-9_-]+)$/);
      if (eventMatch && req.method === 'PATCH') {
        const body = await readJson(req);
        if (body.confirmed !== true) return send(res, 428, { error: 'Confirmation requise avant de modifier ce rendez-vous.' });
        const patch = {};
        for (const key of ['summary', 'description', 'location', 'start', 'end']) {
          if (body[key] !== undefined) patch[key] = typeof body[key] === 'string' ? body[key].slice(0, key === 'description' ? 4000 : 500) : body[key];
        }
        if (!Object.keys(patch).length) return send(res, 400, { error: 'Aucune modification fournie.' });
        return send(res, 200, { event: await calendarRequest(user.sub, `calendars/primary/events/${encodeURIComponent(eventMatch[1])}`, 'PATCH', patch) });
      }
      if (eventMatch && req.method === 'DELETE') {
        const body = await readJson(req);
        if (body.confirmed !== true) return send(res, 428, { error: 'Confirmation requise avant de supprimer ce rendez-vous.' });
        await calendarRequest(user.sub, `calendars/primary/events/${encodeURIComponent(eventMatch[1])}`, 'DELETE');
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Méthode non autorisée.' });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : 'Opération Google Agenda impossible.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/integrations/google/disconnect') {
    const user = readSession(req);
    if (!user) return send(res, 401, { error: 'Connecte-toi à Hiera pour gérer tes connexions.' });
    try {
      await ensureIntegrationTable();
      await pool.query('DELETE FROM hiera_integrations WHERE user_id = $1 AND provider = $2', [user.sub, 'google_calendar']);
      return send(res, 200, { ok: true, connected: false });
    } catch (error) {
      return send(res, 503, { error: error instanceof Error ? error.message : 'Déconnexion impossible.' });
    }
  }


  if (url.pathname.startsWith('/api/voice/')) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
    if (!isAuthorized(req)) return send(res, 401, { error: 'Code d’accès incorrect.' });
    const voiceUser = readSession(req);
    if (!voiceUser) return send(res, 401, { error: 'Connecte-toi avec Google pour utiliser le quota vocal.' });
    try {
      await ensureUsageTable();
      const limits = { basic: 600, plus: 2700, pro: 7200, ultimate: 18000 };
      const action = url.pathname.split('/').pop();
      if (action === 'start') {
        const result = await pool.query(
          `INSERT INTO hiera_usage (user_id, plan, period_started_at, message_count, token_count, voice_seconds, voice_last_ping_at)
           VALUES ($1, 'basic', NOW(), 0, 0, 0, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             period_started_at = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN NOW() ELSE hiera_usage.period_started_at END,
             message_count = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.message_count END,
             token_count = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.token_count END,
             voice_seconds = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.voice_seconds END
           RETURNING plan, voice_seconds`,
          [voiceUser.sub],
        );
        const row = result.rows[0];
        const plan = limits[row.plan] ? row.plan : 'basic';
        const limit = limits[plan];
        const used = Number(row.voice_seconds || 0);
        if (used >= limit) return send(res, 429, { error: 'Tu as atteint la durée vocale autorisée pour cette période de 24 heures.', secondsRemaining: 0 });
        await pool.query('UPDATE hiera_usage SET voice_last_ping_at = NOW() WHERE user_id = $1', [voiceUser.sub]);
        return send(res, 200, { ok: true, plan, secondsRemaining: limit - used });
      }
      if (action === 'heartbeat' || action === 'stop') {
        const result = await pool.query(
          `UPDATE hiera_usage SET
             voice_seconds = voice_seconds + LEAST(GREATEST(0, $2 - voice_seconds), LEAST(30, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(voice_last_ping_at, NOW()))))::INTEGER))),
             voice_last_ping_at = CASE WHEN $3 THEN NULL ELSE NOW() END
           WHERE user_id = $1 AND voice_last_ping_at IS NOT NULL AND voice_last_ping_at >= NOW() - INTERVAL '45 seconds'
           RETURNING plan, voice_seconds`,
          [voiceUser.sub, 18000, action === 'stop'],
        );
        if (!result.rowCount) return send(res, 409, { error: 'La session vocale a expiré. Relance le mode vocal.' });
        const row = result.rows[0];
        const plan = limits[row.plan] ? row.plan : 'basic';
        const remaining = Math.max(0, limits[plan] - Number(row.voice_seconds || 0));
        if (action === 'heartbeat' && remaining === 0) await pool.query('UPDATE hiera_usage SET voice_last_ping_at = NULL WHERE user_id = $1', [voiceUser.sub]);
        return send(res, 200, { ok: true, plan, secondsRemaining: remaining });
      }
      return send(res, 404, { error: 'Action vocale inconnue.' });
    } catch (voiceError) {
      console.error('Hiera voice quota failed:', voiceError instanceof Error ? voiceError.message : 'unknown error');
      return send(res, 503, { error: 'Impossible de vérifier le quota vocal. Réessaie plus tard.' });
    }
  }

  if (url.pathname === '/api/chat') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
    if (IS_PRODUCTION && !ACCESS_PASSWORD && !readSession(req)) {
      return send(res, 503, { error: 'HIERA_ACCESS_PASSWORD doit être configuré sur l’hébergeur.' });
    }
    if (!isAuthorized(req)) {
      return send(res, 401, { error: 'Code d’accès incorrect.' });
    }
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(res, 413, { error: 'Message trop volumineux.' });
      }
      const body = JSON.parse(raw || '{}');
      const requestedModel = groqModels.has(body.model) ? body.model : 'openai/gpt-oss-20b';
      const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
      const imageAttachments = attachments.filter((item) => typeof item?.dataUrl === 'string');
      if (imageAttachments.length > 3) return send(res, 400, { error: 'Tu peux joindre au maximum 3 images par message.' });
      for (const item of imageAttachments) {
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl) || item.dataUrl.length > 14_000_000) {
          return send(res, 400, { error: 'Image invalide ou trop volumineuse. Limite : 10 Mo par image, en JPG, PNG ou WebP.' });
        }
      }
      const model = imageAttachments.length ? 'qwen/qwen3.8-27b' : requestedModel;
      const apiKey = GROQ_API_KEY;
      if (!apiKey) {
        return send(res, 503, { error: 'Clé Groq manquante. Configure GROQ_API_KEY dans Render.' });
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 60) {
        return send(res, 400, { error: 'Historique de conversation invalide.' });
      }
      const supportedLanguages = {
        fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien',
        pt: 'portugais', nl: 'néerlandais', pl: 'polonais', ru: 'russe', uk: 'ukrainien',
        ar: 'arabe', zh: 'chinois', ja: 'japonais', ko: 'coréen', hi: 'hindi', bn: 'bengali',
        tr: 'turc', sv: 'suédois', no: 'norvégien', da: 'danois', fi: 'finnois',
        el: 'grec', he: 'hébreu', th: 'thaï', vi: 'vietnamien', id: 'indonésien',
        sw: 'swahili', ro: 'roumain', cs: 'tchèque', hu: 'hongrois',
      };
      const responseLanguage = supportedLanguages[body.language] || 'français';
      const assistantName = typeof body.assistantName === 'string'
        ? body.assistantName.replace(/[^\\p{L}\\p{N} _-]/gu, '').trim().slice(0, 32) || 'Hiera'
        : 'Hiera';
      const responseStyles = {
        friendly: 'Adopte un ton naturel, chaleureux et facile à comprendre.',
        concise: 'Privilégie des réponses courtes et directes, sans omettre les informations utiles.',
        detailed: 'Donne des explications structurées et détaillées, avec des exemples lorsque cela aide.',
      };
      const responseStyle = responseStyles[body.replyStyle] || responseStyles.friendly;
      const familyStyle = body.familySafeMode === false
        ? ''
        : 'Privilégie des explications claires, respectueuses et adaptées à un public adolescent.';
      const chatUser = readSession(req);
      if (!chatUser) {
        return send(res, 401, { error: 'Connecte-toi avec Google pour que Hiera puisse appliquer ton quota personnel.' });
      }
      if (await saveUserProfile(chatUser)) return send(res, 403, { error: 'Ce compte est suspendu. Contacte le support Hiera.' });
      const latestUserMessage = [...body.messages].reverse().find((message) => message?.role === 'user' && typeof message.content === 'string');
      if (latestUserMessage) await recordSafetySignal(chatUser, latestUserMessage.content);
      let tokenBudget = 50000;
      let tokensAlreadyUsed = 0;
      try {
        await ensureUsageTable();
        const messageLimits = { basic: 100, plus: 300, pro: 1200, ultimate: 3000 };
        const tokenBudgets = { basic: 50000, plus: 150000, pro: 500000, ultimate: 1500000 };
        const usage = await pool.query(
          `INSERT INTO hiera_usage (user_id, plan, period_started_at, message_count, token_count)
           VALUES ($1, 'basic', NOW(), 1, 0)
           ON CONFLICT (user_id) DO UPDATE SET
             period_started_at = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN NOW() ELSE hiera_usage.period_started_at END,
             message_count = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 1 ELSE hiera_usage.message_count + 1 END,
             token_count = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.token_count END,
             voice_seconds = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.voice_seconds END,
             voice_last_ping_at = CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN NULL ELSE hiera_usage.voice_last_ping_at END
           WHERE
             (CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.message_count END) <
               CASE hiera_usage.plan WHEN 'plus' THEN 300 WHEN 'pro' THEN 1200 WHEN 'ultimate' THEN 3000 ELSE 100 END
             AND
             (CASE WHEN NOW() >= hiera_usage.period_started_at + INTERVAL '24 hours' THEN 0 ELSE hiera_usage.token_count END) <
               CASE hiera_usage.plan WHEN 'plus' THEN 150000 WHEN 'pro' THEN 500000 WHEN 'ultimate' THEN 1500000 ELSE 50000 END
           RETURNING message_count, period_started_at, token_count, plan`,
          [chatUser.sub],
        );
        if (!usage.rowCount) {
          const current = await pool.query('SELECT plan, period_started_at, message_count, token_count FROM hiera_usage WHERE user_id = $1', [chatUser.sub]);
          const row = current.rows[0] || { plan: 'basic', message_count: 0, token_count: 0 };
          const activePlan = messageLimits[row.plan] ? row.plan : 'basic';
          const resetAt = row.period_started_at ? new Date(new Date(row.period_started_at).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
          if (Number(row.token_count || 0) >= tokenBudgets[activePlan]) return send(res, 429, { error: `Tu as atteint le budget de ${tokenBudgets[activePlan].toLocaleString('fr-FR')} jetons de Hiera ${activePlan}.`, plan: activePlan, tokenBudget: tokenBudgets[activePlan], tokensUsed: Number(row.token_count || 0), tokensRemaining: 0, resetAt });
          return send(res, 429, { error: `Tu as atteint la limite de ${messageLimits[activePlan].toLocaleString('fr-FR')} messages de Hiera ${activePlan}.`, resetAt, plan: activePlan, limit: messageLimits[activePlan] });
        }
        const activeUsage = usage.rows[0];
        const activePlan = tokenBudgets[activeUsage.plan] ? activeUsage.plan : 'basic';
        tokenBudget = tokenBudgets[activePlan];
        tokensAlreadyUsed = Number(activeUsage.token_count || 0);
      } catch (quotaError) {
        console.error('Hiera usage quota failed:', quotaError instanceof Error ? quotaError.message : 'unknown error');
        return send(res, 503, { error: 'Impossible de vérifier ton quota. Vérifie la base de données de Hiera puis réessaie.' });
      }
      const documentNotes = attachments
        .filter((item) => typeof item?.text === 'string')
        .map((item) => {
          const name = typeof item.name === 'string' ? item.name.slice(0, 120) : 'fichier texte';
          return `\\n\\n[Contenu du fichier ${name}]\\n${item.text.slice(0, 50000)}`;
        }).join('');
      const userMessages = body.messages.map((message) => {
        if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') {
          throw new Error('Format de message invalide.');
        }
        return { role: message.role, content: message.content.slice(0, 20000) };
      });
      const lastUserIndex = userMessages.map((message) => message.role).lastIndexOf('user');
      if (lastUserIndex < 0) return send(res, 400, { error: 'Aucun message utilisateur trouvé.' });
      userMessages[lastUserIndex].content += documentNotes;
      if (imageAttachments.length) {
        const promptText = userMessages[lastUserIndex].content || 'Analyse cette image et réponds à ma question.';
        userMessages[lastUserIndex].content = [
          { type: 'text', text: promptText },
          ...imageAttachments.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } })),
        ];
      }
      const messages = [{
        role: 'system',
        content: `Tu es ${assistantName}, un assistant IA utile, honnête et bienveillant. Réponds toujours en ${responseLanguage}, sauf si l'utilisateur demande explicitement une autre langue. ${responseStyle} ${familyStyle} Utilise parfois un ou deux émojis pertinents pour rendre tes réponses expressives, mais reste naturel et n'en ajoute pas à chaque phrase. Tu contrôles aussi la présentation écrite de tes réponses : utilise des paragraphes aérés, des titres Markdown (#, ##, ###), des listes et des citations lorsque cela améliore la lisibilité. Mets en gras les idées importantes, en italique les nuances, et utilise ==texte== pour le surlignage et <u>texte</u> pour souligner. Tu peux choisir ponctuellement une police et une taille avec la syntaxe <font face="Georgia" size="20">texte</font>. Polices autorisées : Arial, Georgia, Verdana, Times New Roman, Courier New, Trebuchet MS ; taille de 12 à 32. Reste sobre et adapte la présentation au contenu. Pour un texte à copier, fournis un bloc autonome bien structuré. N'invente pas de capacités ou d'actions que tu n'as pas réalisées. Respecte les règles de sécurité et refuse les demandes dangereuses. Si l'utilisateur joint une image, analyse uniquement ce qui est réellement visible et signale toute incertitude. Si l'utilisateur joint le contenu d'un fichier, base ton analyse sur le texte fourni et indique si le document semble incomplet. Respecte les règles de sécurité et refuse les demandes dangereuses. Si l'outil Google Agenda est disponible, utilise-le pour répondre aux questions sur les rendez-vous. Ne prétends jamais avoir consulté l'agenda sans avoir réellement appelé l'outil. Pour toute création, modification ou suppression, demande d'abord une confirmation explicite et n'effectue aucune modification sans confirmation.`,
      }, ...userMessages];

      const calendarUserMessage = [...body.messages].reverse().find((message) => message?.role === 'user' && typeof message.content === 'string')?.content || '';
      const asksCalendar = /agenda|calendrier|rendez[- ]?vous|événements?|planning|mon emploi du temps|mes horaires/i.test(calendarUserMessage);

      // Réponse déterministe pour les questions d'agenda : le modèle ne peut pas ignorer les données.
      if (asksCalendar) {
        if (!chatUser) {
          return send(res, 401, { error: 'Reconnecte-toi à ton compte Google dans les paramètres de Hiera pour consulter ton agenda.' });
        }
        try {
          const days = /semaine|7 jours/i.test(calendarUserMessage) ? 7 : 30;
          const timeMin = new Date().toISOString();
          const timeMax = new Date(Date.now() + days * 86400000).toISOString();
          const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
          const calendarData = await calendarRequest(chatUser.sub, `calendars/primary/events?${params}`);
          const events = (calendarData.items || []).filter((event) => event.status !== 'cancelled');
          const lines = events.map((event) => {
            const when = event.start?.dateTime || event.start?.date || 'Date non précisée';
            const where = event.location ? ` — ${event.location}` : '';
            return `• ${event.summary || 'Sans titre'} — ${when}${where}`;
          });
          const reply = events.length
            ? `Voici tes ${events.length} prochain(s) rendez-vous dans les ${days} prochains jours :\\n\\n${lines.join('\\n')}`
            : `J’ai consulté ton Google Agenda : aucun rendez-vous trouvé dans les ${days} prochains jours.`;
          return send(res, 200, { reply });
        } catch (error) {
          console.error('Google Calendar chat read failed:', error instanceof Error ? error.message : 'unknown error');
          return send(res, 502, { error: `La lecture de Google Agenda a échoué : ${error instanceof Error ? error.message : 'erreur inconnue'}` });
        }
      }


      const calendarTools = [{
        type: 'function',
        function: {
          name: 'list_calendar_events',
          description: 'Consulter les rendez-vous Google Agenda de l’utilisateur sur les prochains jours.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'integer', minimum: 1, maximum: 90, description: 'Nombre de jours à consulter.' },
            },
            required: ['days'],
            additionalProperties: false,
          },
        },
      }];

      let requestTokensUsed = 0;
      async function askGroq(chatMessages, includeTools = true) {
        const estimatedInputTokens = Math.ceil(JSON.stringify(chatMessages).length / 3);
        const remainingForResponse = tokenBudget - tokensAlreadyUsed - requestTokensUsed - estimatedInputTokens;
        if (remainingForResponse < 1) throw Object.assign(new Error('Le budget de jetons restant est insuffisant pour cette demande.'), { status: 429 });
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: chatMessages,
            ...(includeTools && calendarTools ? { tools: calendarTools, tool_choice: asksCalendar ? 'required' : 'auto' } : {}),
            max_completion_tokens: Math.max(1, Math.min(model === 'qwen/qwen3.8-27b' ? 800 : 1200, remainingForResponse)),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data?.error?.message || 'Le fournisseur IA a refusé la demande.';
          const status = response.status === 401 ? 502 : response.status === 429 ? 429 : 502;
          throw Object.assign(new Error(message), { status });
        }
        return {
          message: data?.choices?.[0]?.message,
          usage: data?.usage || {},
        };
      }

      const firstCompletion = await askGroq(messages);
      let assistantMessage = firstCompletion.message;
      let totalPromptTokens = Number(firstCompletion.usage.prompt_tokens || 0);
      let totalCompletionTokens = Number(firstCompletion.usage.completion_tokens || 0);
      requestTokensUsed = totalPromptTokens + totalCompletionTokens;
      if (Array.isArray(assistantMessage?.tool_calls) && assistantMessage.tool_calls.length) {
        messages.push(assistantMessage);
        for (const toolCall of assistantMessage.tool_calls.slice(0, 2)) {
          const functionName = toolCall?.function?.name;
          let toolResult;
          if (functionName === 'list_calendar_events' && chatUser) {
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              const days = Number.isInteger(args.days) ? Math.min(90, Math.max(1, args.days)) : 30;
              const timeMin = new Date().toISOString();
              const timeMax = new Date(Date.now() + days * 86400000).toISOString();
              const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
              const calendarData = await calendarRequest(chatUser.sub, `calendars/primary/events?${params}`);
              const events = (calendarData.items || []).map((event) => ({
                title: event.summary || 'Sans titre',
                start: event.start?.dateTime || event.start?.date || '',
                end: event.end?.dateTime || event.end?.date || '',
                location: event.location || '',
                status: event.status || '',
              }));
              toolResult = { success: true, count: events.length, events };
            } catch (error) {
              toolResult = { success: false, error: error instanceof Error ? error.message : 'Impossible de consulter Google Agenda.' };
            }
          } else {
            toolResult = { success: false, error: 'Outil de calendrier indisponible.' };
          }
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
        const finalCompletion = await askGroq(messages, false);
        assistantMessage = finalCompletion.message;
        totalPromptTokens += Number(finalCompletion.usage.prompt_tokens || 0);
        totalCompletionTokens += Number(finalCompletion.usage.completion_tokens || 0);
        requestTokensUsed = totalPromptTokens + totalCompletionTokens;
      }

      const reply = assistantMessage?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        return send(res, 502, { error: 'La réponse du fournisseur était vide.' });
      }
      const tokensUsed = totalPromptTokens + totalCompletionTokens;
      const savedUsage = await pool.query(
        `UPDATE hiera_usage
         SET token_count = token_count + $2
         WHERE user_id = $1
         RETURNING token_count, plan, period_started_at`,
        [chatUser.sub, tokensUsed],
      );
      const finalUsage = savedUsage.rows[0];
      const finalPlan = finalUsage?.plan || 'basic';
      const finalBudget = ({ basic: 50000, plus: 150000, pro: 500000, ultimate: 1500000 })[finalPlan] || 50000;
      const tokensUsedTotal = Number(finalUsage?.token_count || tokensUsed);
      return send(res, 200, {
        reply: reply.trim(),
        usage: {
          plan: finalPlan,
          tokensUsed,
          tokensUsedTotal,
          tokenBudget: finalBudget,
          tokensRemaining: Math.max(0, finalBudget - tokensUsedTotal),
          resetAt: finalUsage?.period_started_at ? new Date(new Date(finalUsage.period_started_at).getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
        },
      });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : 'Requête invalide.' });
    }
  }


  if (url.pathname === '/api/help/pending' || url.pathname === '/api/help/respond') {
    const helpUser = readSession(req);
    if (!helpUser) return send(res, 401, { error: 'Connecte-toi pour gérer une demande d’aide.' });
    try {
      await ensureAdminTables();
      if (req.method === 'GET' && url.pathname === '/api/help/pending') {
        const result = await pool.query(
          `SELECT id, email, created_at AS "createdAt", expires_at AS "expiresAt"
           FROM hiera_help_requests WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
           ORDER BY created_at DESC LIMIT 1`, [helpUser.sub],
        );
        return send(res, 200, { request: result.rows[0] || null });
      }
      if (req.method === 'POST' && url.pathname === '/api/help/respond') {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0 || typeof body.approved !== 'boolean') return send(res, 400, { error: 'Réponse invalide.' });
        let sharedMessages = null;
        if (body.approved) {
          if (!Array.isArray(body.messages) || body.messages.length > 30) return send(res, 400, { error: 'La conversation partagée est invalide.' });
          sharedMessages = body.messages.filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string')
            .slice(-30).map((item) => ({ role: item.role, content: item.content.slice(0, 12000) }));
        }
        const result = await pool.query(
          `UPDATE hiera_help_requests SET status = $3, responded_at = NOW(),
             shared_messages = $4::jsonb,
             expires_at = CASE WHEN $3 = 'approved' THEN NOW() + INTERVAL '20 minutes' ELSE expires_at END
           WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > NOW() RETURNING id`,
          [id, helpUser.sub, body.approved ? 'approved' : 'declined', sharedMessages ? JSON.stringify(sharedMessages) : null],
        );
        if (!result.rowCount) return send(res, 409, { error: 'Cette demande a expiré ou a déjà été traitée.' });
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Méthode non autorisée.' });
    } catch (helpError) {
      console.error('Hiera help consent failed:', helpError instanceof Error ? helpError.message : 'unknown error');
      return send(res, 503, { error: 'Le service d’aide est temporairement indisponible.' });
    }
  }

  const adminUser = readSession(req);
  const adminPaths = ['/api/admin/me', '/api/admin/overview', '/api/admin/account', '/api/admin/reset-request/resolve', '/api/admin/help/request', '/api/admin/help/view', '/api/admin/help/close', '/api/admin/safety/review'];
  if (adminPaths.includes(url.pathname)) {
    if (!adminUser) return send(res, 401, { error: 'Connecte-toi pour accéder à Hiera Control.' });
    const allowedAdmins = (process.env.HIERA_ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!adminUser.email || !allowedAdmins.includes(String(adminUser.email).toLowerCase())) {
      return send(res, 403, { error: 'Ce compte ne possède pas les droits administrateur.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/me') return send(res, 200, { isAdmin: true, email: adminUser.email });
    try {
      if (!pool) throw new Error('La base de données Hiera est indisponible.');
      await ensureUsageTable();
      await ensureAdminTables();
      await pool.query("CREATE TABLE IF NOT EXISTS hiera_accounts (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query(
        `INSERT INTO hiera_user_profiles (user_id, email, display_name, created_at, last_seen_at)
         SELECT 'email:' || id::text, email, display_name, created_at, created_at FROM hiera_accounts
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name`
      );
      if (req.method === 'POST' && url.pathname === '/api/admin/account') {
        const body = await readJson(req);
        const userId = typeof body.userId === 'string' ? body.userId.slice(0, 300) : '';
        const plan = typeof body.plan === 'string' ? body.plan.toLowerCase() : '';
        const banned = typeof body.banned === 'boolean' ? body.banned : null;
        if (!userId || (!['basic', 'plus', 'pro', 'ultimate'].includes(plan) && banned === null)) {
          return send(res, 400, { error: 'Modification de compte invalide.' });
        }
        const profile = await pool.query('SELECT user_id FROM hiera_user_profiles WHERE user_id = $1', [userId]);
        if (!profile.rowCount) return send(res, 404, { error: 'Compte introuvable.' });
        if (plan) {
          await pool.query(
            `INSERT INTO hiera_usage (user_id, plan, period_started_at, message_count, token_count)
             VALUES ($1, $2, NOW(), 0, 0)
             ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan`,
            [userId, plan],
          );
        }
        if (banned !== null) await pool.query('UPDATE hiera_user_profiles SET banned = $2 WHERE user_id = $1', [userId, banned]);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/reset-request/resolve') {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: 'Demande invalide.' });
        await pool.query("UPDATE hiera_password_reset_requests SET status = 'resolved' WHERE id = $1", [id]);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/help/request') {
        const body = await readJson(req);
        const userId = typeof body.userId === 'string' ? body.userId.slice(0, 300) : '';
        if (!userId) return send(res, 400, { error: 'Compte invalide.' });
        const profile = await pool.query('SELECT user_id, email FROM hiera_user_profiles WHERE user_id = $1', [userId]);
        if (!profile.rowCount) return send(res, 404, { error: 'Compte introuvable.' });
        const pending = await pool.query("SELECT id FROM hiera_help_requests WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1", [userId]);
        if (pending.rowCount) return send(res, 200, { ok: true, id: pending.rows[0].id, existing: true });
        const created = await pool.query(
          `INSERT INTO hiera_help_requests (user_id, email, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes') RETURNING id`,
          [userId, profile.rows[0].email],
        );
        return send(res, 200, { ok: true, id: created.rows[0].id });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/help/view') {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: 'Demande invalide.' });
        const viewed = await pool.query(
          `UPDATE hiera_help_requests SET viewed_at = NOW()
           WHERE id = $1 AND status = 'approved' AND viewed_at IS NULL AND expires_at > NOW()
           RETURNING email, shared_messages AS messages, expires_at AS "expiresAt"`,
          [id],
        );
        if (!viewed.rowCount) return send(res, 409, { error: 'Autorisation expirée ou déjà utilisée.' });
        return send(res, 200, { email: viewed.rows[0].email, messages: viewed.rows[0].messages || [], expiresAt: viewed.rows[0].expiresAt });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/help/close') {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: 'Demande invalide.' });
        await pool.query("UPDATE hiera_help_requests SET status = 'closed', shared_messages = NULL, closed_at = NOW() WHERE id = $1 AND status IN ('approved','declined','pending')", [id]);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/safety/review') {
        const body = await readJson(req);
        const id = Number(body.id);
        if (!Number.isSafeInteger(id) || id <= 0) return send(res, 400, { error: 'Signalement invalide.' });
        await pool.query('UPDATE hiera_safety_flags SET reviewed_at = NOW() WHERE id = $1 AND reviewed_at IS NULL', [id]);
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'GET' || url.pathname !== '/api/admin/overview') return send(res, 405, { error: 'Méthode non autorisée.' });
      const [accounts, usage, plans, requests, flags] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM hiera_user_profiles`),
        pool.query("SELECT COUNT(*)::int AS total FROM hiera_user_profiles WHERE last_seen_at >= NOW() - INTERVAL '30 days'"),
        pool.query("SELECT COALESCE(u.plan, 'basic') AS plan, COUNT(*)::int AS users, COALESCE(SUM(u.token_count), 0)::text AS tokens FROM hiera_user_profiles p LEFT JOIN hiera_usage u ON u.user_id = p.user_id GROUP BY COALESCE(u.plan, 'basic') ORDER BY plan"),
        pool.query("SELECT id, email, requested_at, status FROM hiera_password_reset_requests WHERE status = 'pending' ORDER BY requested_at DESC LIMIT 50"),
        pool.query('SELECT id, user_id AS "userId", email, category, created_at AS "createdAt" FROM hiera_safety_flags WHERE reviewed_at IS NULL ORDER BY created_at DESC LIMIT 100'),
      ]);
      const userRows = await pool.query(
        `SELECT p.user_id AS "userId", p.email, p.display_name AS name, p.created_at AS "createdAt",
                p.last_seen_at AS "lastSeenAt", p.banned, COALESCE(u.plan, 'basic') AS plan,
                COALESCE(u.token_count, 0)::text AS tokens,
                (SELECT COUNT(*)::int FROM hiera_safety_flags f WHERE f.user_id = p.user_id AND f.reviewed_at IS NULL) AS "safetyFlagCount",
                (SELECT MAX(f.created_at) FROM hiera_safety_flags f WHERE f.user_id = p.user_id AND f.reviewed_at IS NULL) AS "safetyFlagLatest",
                (SELECT h.status FROM hiera_help_requests h WHERE h.user_id = p.user_id AND h.status IN ('pending','approved') AND h.expires_at > NOW() ORDER BY h.created_at DESC LIMIT 1) AS "helpStatus",
                (SELECT h.id FROM hiera_help_requests h WHERE h.user_id = p.user_id AND h.status IN ('pending','approved') AND h.expires_at > NOW() ORDER BY h.created_at DESC LIMIT 1) AS "helpRequestId"
         FROM hiera_user_profiles p LEFT JOIN hiera_usage u ON u.user_id = p.user_id
         ORDER BY p.last_seen_at DESC NULLS LAST LIMIT 500`
      );
      return send(res, 200, { isAdmin: true, email: adminUser.email, stats: {
        emailAccounts: Number(accounts.rows[0]?.total || 0),
        activeUsageProfiles30d: Number(usage.rows[0]?.total || 0),
        planBreakdown: plans.rows.map((row) => ({ plan: row.plan, users: Number(row.users), tokens: Number(row.tokens) })),
        recentAccounts: userRows.rows.slice(0, 8).map((row) => ({ email: row.email, name: row.name, createdAt: row.createdAt })),
      }, users: userRows.rows, resetRequests: requests.rows, safetyFlags: flags.rows });
    } catch (adminError) {
      console.error('Hiera admin request failed:', adminError instanceof Error ? adminError.message : 'unknown error');
      return send(res, 503, { error: 'Les données administrateur sont temporairement indisponibles.' });
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
