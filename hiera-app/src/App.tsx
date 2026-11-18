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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('groq:openai/gpt-oss-20b');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [authError, setAuthError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
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
  }, [googleClientId, settingsOpen]);

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'groq',
          model,
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'La demande a échoué.');
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error("Le service IA n'a pas renvoyé de réponse.");
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
    setSettingsOpen(false);
  }

  return (
    <main className={`shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setSidebarOpen((open) => !open)} aria-label="Rétracter ou afficher la barre latérale"><AtomLogo /><div><span>Hiera</span><small>Votre IA, toujours avec vous</small></div></button>
        <button className="new-chat" onClick={newConversation} disabled={busy}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <button className={`side-link ${!settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(false)}><span>◉</span><b>Conversation</b></button>
        <button className={`side-link ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(true)}><span>⚙</span><b>Paramètres</b></button>
        <div className="sidebar-account"><div className="account-status"><span className="status-dot" /> {googleUser ? "Google connecté" : "Compte non connecté"}</div><div className="account-provider"><span className="google-g">G</span><span>{googleUser ? googleUser.email : "Gérer dans Paramètres"}</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Afficher ou masquer le menu"><AtomLogo /></button>
          <span className="topbar-title">{settingsOpen ? "Paramètres" : "Conversation"}</span>
        </header>

        {settingsOpen ? (
          <section className="settings-page">
            <p className="eyebrow">ESPACE PERSONNEL</p>
            <h1>Paramètres</h1>
            <p className="settings-intro">Gère ton compte, tes connexions et le fonctionnement de Hiera.</p>
            <nav className="settings-shortcuts" aria-label="Raccourcis des paramètres">
              <button onClick={() => document.getElementById('account-settings')?.scrollIntoView({behavior:'smooth'})}><span>👤</span><strong>Compte Google</strong><small>Connexion à Hiera</small></button>
              <button onClick={() => document.getElementById('apps-settings')?.scrollIntoView({behavior:'smooth'})}><span>▦</span><strong>Applications et services</strong><small>Gérer les connexions</small></button>
              <button onClick={() => document.getElementById('privacy-settings')?.scrollIntoView({behavior:'smooth'})}><span>🔒</span><strong>Confidentialité</strong><small>Données et informations</small></button>
              <button onClick={() => document.getElementById('security-settings')?.scrollIntoView({behavior:'smooth'})}><span>🛡</span><strong>Sécurité</strong><small>Session et protections</small></button>
            </nav>
            <div className="settings-section-heading"><h2>Préférences</h2><p>Personnalise ton expérience Hiera.</p></div>
            <div className="settings-card">
              <div><h2>Apparence</h2><p>Le thème nuit violet est actuellement utilisé.</p></div>
              <span className="settings-note">Thème nuit</span>
            </div>
            <div className="settings-card">
              <div><h2>Modèle d'intelligence artificielle</h2><p>Choisis le modèle utilisé pour tes prochaines conversations.</p></div>
              <select className="settings-select" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="groq:openai/gpt-oss-20b">GPT-OSS 20B (Groq)</option>
                <option value="groq:openai/gpt-oss-120b">GPT-OSS 120B (Groq)</option>
              </select>
            </div>
            <div className="settings-section-heading" id="account-settings"><h2>Compte Google</h2><p>Compte utilisé pour ouvrir ta session Hiera.</p></div>
            <div className="settings-card account-settings-card">
              <div className="settings-card-copy"><h2>Connexion à Hiera</h2><p>Cette connexion identifie ton compte. Elle n'autorise pas encore Hiera à lire tes e-mails ou ton agenda.</p></div>
              <div className="google-settings-control">
                {googleUser ? <><div className="google-account-identity"><span className="google-g">G</span><span><strong>{googleUser.name || "Compte Google"}</strong><small>{googleUser.email}</small></span></div><button className="settings-action" onClick={logoutGoogle}>Se déconnecter</button></> : <><div className="google-login settings-google-login" ref={googleButtonRef} />{!googleClientId && <small className="settings-help">La connexion Google doit être configurée sur Render.</small>}</>}
                {authError && <small className="settings-error" role="alert">{authError}</small>}
              </div>
            </div>
            <div className="settings-section-heading" id="apps-settings"><h2>Applications et services</h2><p>Chaque service possède sa propre autorisation. Les boutons restent indisponibles tant que sa connexion sécurisée n'est pas configurée.</p></div>
            {settingsNotice && <p className="settings-notice" role="status">{settingsNotice}</p>}
            <div className="integration-grid">
              {[
                {name:'Google Agenda',slug:'googlecalendar',desc:'Événements et rendez-vous'},
                {name:'Gmail',slug:'gmail',desc:'E-mails et boîte de réception'},
                {name:'Google Drive',slug:'googledrive',desc:'Fichiers et documents'},
                {name:'Google Docs',slug:'googledocs',desc:'Documents texte'},
                {name:'Google Sheets',slug:'googlesheets',desc:'Tableurs et données'},
                {name:'Google Meet',slug:'googlemeet',desc:'Réunions et visioconférences'},
                {name:'Google Photos',slug:'googlephotos',desc:'Photothèque'},
                {name:'YouTube',slug:'youtube',desc:'Chaîne et contenus'},
                {name:'GitHub',slug:'github',desc:'Dépôts et projets de code'},
                {name:'Discord',slug:'discord',desc:'Communautés et messages'},
                {name:'Slack',slug:'slack',desc:'Espaces de travail'},
                {name:'Notion',slug:'notion',desc:'Notes et espaces de travail'},
                {name:'Dropbox',slug:'dropbox',desc:'Stockage de fichiers'},
                {name:'Microsoft OneDrive',slug:'microsoftonedrive',desc:'Fichiers Microsoft'},
                {name:'Outlook',slug:'microsoftoutlook',desc:'E-mails et calendrier'},
                {name:'Trello',slug:'trello',desc:'Tableaux et tâches'},
                {name:'Spotify',slug:'spotify',desc:'Musique et playlists'},
                {name:'Figma',slug:'figma',desc:'Design et prototypes'},
                {name:'Canva',slug:'canva',desc:'Créations graphiques'},
                {name:'Zoom',slug:'zoom',desc:'Réunions en ligne'},
                {name:'Instagram',slug:'instagram',desc:'Compte et publications'},
                {name:'TikTok',slug:'tiktok',desc:'Compte et contenus'},
                {name:'LinkedIn',slug:'linkedin',desc:'Profil et réseau professionnel'},
                {name:'X',slug:'x',desc:'Compte et publications'},
              ].map((app) => (
                <article className="integration-item" key={app.slug}>
                  <img className="integration-logo" src={`https://cdn.simpleicons.org/${app.slug}`} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility='hidden'; }} />
                  <div className="integration-copy"><strong>{app.name}</strong><small>{app.desc}</small><em>Connexion à configurer</em></div>
                  <button className="integration-connect" disabled title="L'autorisation OAuth de ce service n'est pas encore configurée" onClick={() => setSettingsNotice(`La connexion ${app.name} n'est pas encore activée. Elle nécessite une autorisation officielle et une configuration sécurisée.`)}>Connecter</button>
                </article>
              ))}
            </div>
            <div className="settings-section-heading" id="privacy-settings"><h2>Confidentialité</h2><p>Garde le contrôle sur les informations utilisées dans Hiera.</p></div>
            <div className="settings-card privacy-settings-card">
              <div className="privacy-list">
                <div><strong>Données des conversations</strong><span>Évite d'inclure des informations personnelles, scolaires ou confidentielles dans tes messages.</span></div>
                <div><strong>Accès des applications</strong><span>Aucune application tierce n'a actuellement reçu d'autorisation de Hiera.</span></div>
                <div><strong>Autorisations</strong><span>Les services connectés devront demander uniquement les accès nécessaires, via leur page officielle.</span></div>
                <div><strong>Partage des données</strong><span>Ne transmets pas de données privées à un service externe sans vérifier les autorisations demandées.</span></div>
              </div>
            </div>
            <div className="settings-section-heading" id="security-settings"><h2>Sécurité</h2><p>État de ta session et bonnes pratiques de protection.</p></div>
            <div className="settings-card privacy-settings-card">
              <div className="privacy-list">
                <div><strong>Session Google</strong><span>{googleUser ? "Compte connecté à Hiera." : "Aucune session Google active."}</span></div>
                <div><strong>Déconnexion</strong><span>{googleUser ? "Tu peux fermer ta session avec le bouton ci-dessous." : "Aucune session Google active à fermer."}</span></div>
                <div><strong>Clés API et mots de passe</strong><span>Garde-les dans les variables privées de Render. Ne les colle jamais dans le code public ni dans une conversation.</span></div>
                <div><strong>Protection de la session</strong><span>Utilise un mot de passe fiable pour ton compte Google et déconnecte-toi sur un appareil partagé.</span></div>
              </div>
              {googleUser && <button className="settings-action security-logout" onClick={logoutGoogle}>Déconnecter le compte Google</button>}
            </div>
          </section>        ) : (
          <>
            <div className="conversation">
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              {!googleClientId && <p className="auth-hint">Connexion Google : configuration à terminer sur Render.</p>}
              {messages.length === 0 && <div className="welcome compact-welcome"><h1>Hiera</h1><p className="subtitle">Que souhaites-tu faire aujourd’hui ?</p></div>}
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
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Écris un message à Hiera…" rows={1} aria-label="Message à Hiera" disabled={busy} />
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="composer-footer"><span>Pose ta question à Hiera</span><button type="submit" disabled={!draft.trim() || busy} aria-label="Envoyer le message">{busy ? '…' : '↑'}</button></div>
            </form>
            <p className="disclaimer">Ne partage jamais de données personnelles ou confidentielles dans une conversation.</p>
          </>
        )}
      </section>
    </main>
  );
}
