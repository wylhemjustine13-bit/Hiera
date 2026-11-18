import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
type GoogleUser = { email: string; name: string; picture: string };

type Message = { role: 'assistant' | 'user'; content: string };
function AtomLogo() {
  return <svg className="atom-logo" viewBox="0 0 64 64" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="2.7">
      <ellipse cx="32" cy="32" rx="27" ry="10" />
      <ellipse cx="32" cy="32" rx="27" ry="10" transform="rotate(60 32 32)" opacity=".8" />
      <ellipse cx="32" cy="32" rx="27" ry="10" transform="rotate(-60 32 32)" opacity=".95" />
    </g>
    <circle cx="32" cy="32" r="5.4" fill="#e4caff" />
  </svg>;
}
const initialMessage: Message = {
  role: 'assistant',
  content: "Bonjour. Je suis Hiera. Je suis maintenant reliée au service IA lorsque le serveur et sa clé Groq sont configurés. Que souhaites-tu me demander ?",
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('openai/gpt-oss-20b');
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [authError, setAuthError] = useState('');
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([config, session]) => {
      if (!active) return;
      setGoogleClientId(config.googleClientId || '');
      setGoogleUser(session.user || null);
    }).catch(() => setAuthError('Impossible de charger la connexion Google.'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;
    let active = true;
    const renderGoogleButton = () => {
      if (!active || !window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setAuthError('');
          try {
            const response = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Connexion Google impossible.');
            setGoogleUser(data.user);
          } catch (err) {
            setAuthError(err instanceof Error ? err.message : 'Connexion Google impossible.');
          }
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: '220',
      });
    };
    if (window.google) renderGoogleButton();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = 'true';
        script.onload = renderGoogleButton;
        document.head.appendChild(script);
      } else script.addEventListener('load', renderGoogleButton, { once: true });
    }
    return () => { active = false; };
  }, [googleClientId]);

  async function logoutGoogle() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.google?.accounts.id.disableAutoSelect();
    setGoogleUser(null);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;

    const nextMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hiera-access-code': accessCode,
        },
        body: JSON.stringify({
          model,
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'La demande a échoué.');
      if (typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error("Le service IA n'a pas renvoyé de réponse.");
      }
      setMessages((current) => [...current, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de joindre Hiera.');
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    if (busy) return;
    setMessages([]);
    setError('');
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><AtomLogo /><span>hiera</span></div>
        <button className="new-chat" onClick={newConversation} disabled={busy}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <div className="side-link active"><span>◉</span> Conversation</div>
        <div className="side-link"><span>◇</span> Bibliothèque <small>Bientôt</small></div>
        <div className="side-link"><span>⚙</span> Paramètres <small>Bientôt</small></div>
        <div className="sidebar-bottom"><span className="status-dot" /> Projet indépendant <span className="version">0.3.0</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><AtomLogo /><span>hiera</span></div>
          <label className="model-select-label" htmlFor="model-select">Modèle</label>
          <select id="model-select" className="model-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
            <option value="openai/gpt-oss-20b">GPT-OSS 20B</option>
            <option value="openai/gpt-oss-120b">GPT-OSS 120B</option>
          </select>
          <span className="model-pill"><span className="status-dot" /> Groq</span>
          {googleUser ? <button className="google-user" onClick={logoutGoogle} title="Se déconnecter">{googleUser.picture && <img src={googleUser.picture} alt="" />} {googleUser.name || googleUser.email} · Déconnexion</button> : <div className="google-login" ref={googleButtonRef} />}
          {!googleUser && <button className="avatar" aria-label="Hiera">H</button>}
        </header>
        <div className="conversation">
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          {!googleClientId && <p className="auth-hint">Connexion Google : configuration à terminer sur Render.</p>}
          <div className="welcome">
            <div className="atom" aria-hidden="true"><span className="nucleus" /><i className="orbit orbit-one" /><i className="orbit orbit-two" /><i className="orbit orbit-three" /></div>
            <p className="eyebrow">TON ESPACE IA</p>
            <h1>Bonjour, bienvenue<br /><em>dans Hiera.</em></h1>
            <p className="subtitle">Un nouvel espace pour réfléchir, apprendre et créer.</p>
          </div>
          <div className="messages" aria-live="polite">
            {messages.map((message, index) => (
              <article className={`message ${message.role}`} key={index}>
                {message.role === 'assistant' && <span className="message-mark">✳</span>}
                <p>{message.content}</p>
              </article>
            ))}
            {busy && <article className="message assistant"><span className="message-mark">✳</span><p className="typing">Hiera réfléchit…</p></article>}
          </div>
        </div>
        <form className="composer" onSubmit={sendMessage}>
          {!googleUser && <><label className="composer-access-label" htmlFor="access-code">Code privé Hiera</label>
          <input id="access-code" className="composer-access-input" type="password" autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Saisis ton code privé ici" aria-label="Code d'accès privé Hiera" /></>}
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Écris un message à Hiera…" rows={1} aria-label="Message à Hiera" disabled={busy} />
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="composer-footer"><span>Les réponses sont générées par les modèles Groq sélectionnés.</span><button type="submit" disabled={!draft.trim() || busy} aria-label="Envoyer le message">{busy ? '…' : '↑'}</button></div>
        </form>
        <p className="disclaimer">Ne partage jamais de données personnelles ou confidentielles dans une conversation.</p>
      </section>
    </main>
  );
}
