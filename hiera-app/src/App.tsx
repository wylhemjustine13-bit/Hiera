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
  const [settingsPage, setSettingsPage] = useState('home');
  const [appSearch, setAppSearch] = useState('');
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
        theme: 'filled_black', size: 'medium', shape: 'pill', text: 'continue_with', width: '200',
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
    setSettingsPage('home');
  }

  const applications = [
    {name:'Google',slug:'google',desc:'Compte Google et services'},
    {name:'Google Agenda',slug:'googlecalendar',desc:'Événements et rendez-vous'},
    {name:'Gmail',slug:'gmail',desc:'E-mails et boîte de réception'},
    {name:'Google Drive',slug:'googledrive',desc:'Fichiers et documents'},
    {name:'Google Docs',slug:'googledocs',desc:'Documents texte'},
    {name:'Google Sheets',slug:'googlesheets',desc:'Tableurs et données'},
    {name:'Google Meet',slug:'googlemeet',desc:'Réunions et visioconférences'},
    {name:'Google Photos',slug:'googlephotos',desc:'Photothèque'},
    {name:'YouTube',slug:'youtube',desc:'Chaîne et contenus'},
    {name:'GitHub',slug:'github',desc:'Dépôts et projets de code'},
    {name:'Jira',slug:'jira',desc:'Projets et suivi des tâches'},
    {name:'GitLab',slug:'gitlab',desc:'Dépôts et CI/CD'},
    {name:'Bitbucket',slug:'bitbucket',desc:'Dépôts de code'},
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
  ];
  const filteredApplications = applications.filter((app) => (app.name + ' ' + app.desc).toLowerCase().includes(appSearch.toLowerCase()));
  const settingsTitles: Record<string, string> = {home:'Paramètres',account:'Compte Google',apps:'Applications et services',privacy:'Confidentialité',security:'Sécurité',preferences:'Préférences'};

  return (
    <main className={`shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setSidebarOpen((open) => !open)} aria-label="Rétracter ou afficher la barre latérale"><AtomLogo /><div><span>Hiera</span><small>Votre IA, toujours avec vous</small></div></button>
        <button className="new-chat" onClick={newConversation} disabled={busy}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <button className={`side-link ${!settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(false)}><span>◉</span><b>Conversation</b></button>
        <button className={`side-link ${settingsOpen ? "active" : ""}`} onClick={() => { setSettingsOpen(true); setSettingsPage("home"); }}><span>⚙</span><b>Paramètres</b></button>
        <div className="sidebar-account"><div className="account-status"><span className="status-dot" /> {googleUser ? "Google connecté" : "Compte non connecté"}</div><div className="account-provider"><span className="google-g">G</span><span>{googleUser ? googleUser.email : "Gérer dans Paramètres"}</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Afficher ou masquer le menu"><AtomLogo /></button>
          <span className="topbar-title">{settingsOpen ? "Paramètres" : "Conversation"}</span>
        </header>

        {settingsOpen ? (
          <section className="settings-page settings-redesign">
            {settingsPage !== 'home' && <button className="settings-back" onClick={() => setSettingsPage('home')}>← Retour aux paramètres</button>}
            <p className="eyebrow">ESPACE PERSONNEL</p>
            <h1>{settingsTitles[settingsPage] || 'Paramètres'}</h1>
            {settingsPage === 'home' && <>
              <p className="settings-intro">Choisis une rubrique pour gérer ton espace Hiera.</p>
              <div className="settings-home-grid">
                <button className="settings-home-button" onClick={() => setSettingsPage('account')}><span className="settings-home-icon">G</span><strong>Compte Google</strong><small>Connexion et compte utilisé par Hiera</small><b>Ouvrir →</b></button>
                <button className="settings-home-button" onClick={() => setSettingsPage('apps')}><span className="settings-home-icon"><img src="https://cdn.simpleicons.org/googlechrome" alt="" /></span><strong>Applications et services</strong><small>Rechercher et gérer les services</small><b>Ouvrir →</b></button>
                <button className="settings-home-button" onClick={() => setSettingsPage('privacy')}><span className="settings-home-icon">◈</span><strong>Confidentialité</strong><small>Informations et autorisations</small><b>Ouvrir →</b></button>
                <button className="settings-home-button" onClick={() => setSettingsPage('security')}><span className="settings-home-icon">⌑</span><strong>Sécurité</strong><small>Session, déconnexion et secrets</small><b>Ouvrir →</b></button>
                <button className="settings-home-button" onClick={() => setSettingsPage('preferences')}><span className="settings-home-icon">⚙</span><strong>Préférences</strong><small>Apparence et modèle IA</small><b>Ouvrir →</b></button>
              </div>
            </>}
            {settingsPage === 'account' && <div className="settings-detail">
              <p className="settings-description">Ce compte sert à ouvrir ta session Hiera. Il ne donne pas automatiquement accès à Gmail, Drive ou Agenda.</p>
              <div className="settings-feature-card">
                <div className="settings-feature-heading"><span className="google-g">G</span><div><strong>Connexion à Hiera</strong><small>{googleUser ? 'Compte Google connecté' : 'Aucun compte connecté'}</small></div></div>
                {googleUser ? <><div className="settings-account-line"><strong>{googleUser.name || 'Compte Google'}</strong><span>{googleUser.email}</span></div><button className="settings-primary-button" onClick={logoutGoogle}>Se déconnecter</button></> : <><div className="google-login settings-google-login" ref={googleButtonRef} />{!googleClientId && <p className="settings-warning">L'identifiant OAuth Google manque dans Render. Vérifie aussi que <strong>https://hiera.onrender.com</strong> figure dans les origines JavaScript autorisées de ton client Web Google. <a className="settings-text-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Ouvrir Google Cloud Console ↗</a></p>}</>}
                {authError && <p className="settings-warning" role="alert">{authError}</p>}
              </div>
            </div>}
            {settingsPage === 'apps' && <div className="settings-detail">
              <p className="settings-description">Retrouve les services que tu souhaites utiliser avec Hiera. Recherche une application par son nom.</p>
              <label className="app-search-box"><span>⌕</span><input value={appSearch} onChange={(event) => setAppSearch(event.target.value)} placeholder="Rechercher une application..." aria-label="Rechercher une application" /></label>
              <div className="application-directory">
                {filteredApplications.map((app) => <article className="application-card" key={app.slug}>
                  <img className="application-brand-logo" src={`https://cdn.simpleicons.org/${app.slug}`} alt={`Logo ${app.name}`} loading="lazy" onError={(event) => { event.currentTarget.style.opacity='0'; }} />
                  <div className="application-card-copy"><strong>{app.name}</strong><small>{app.desc}</small><em>Connexion non configurée</em></div>
                  <button className="application-connect-button" disabled title="L'autorisation officielle de ce service n'est pas encore configurée">Connecter</button>
                </article>)}
                {filteredApplications.length === 0 && <p className="settings-empty">Aucune application ne correspond à « {appSearch} ».</p>}
              </div>
            </div>}
            {settingsPage === 'privacy' && <div className="settings-detail">
              <p className="settings-description">Quelques règles simples pour garder le contrôle sur tes informations.</p>
              <div className="settings-feature-card"><strong>Données des conversations</strong><p>Évite d'envoyer des informations personnelles ou confidentielles dans tes messages.</p></div>
              <div className="settings-feature-card"><strong>Accès des applications</strong><p>Aucune application tierce n'a actuellement reçu d'autorisation de Hiera.</p></div>
              <div className="settings-feature-card"><strong>Autorisations</strong><p>Une connexion ne sera active qu'après la configuration et l'autorisation officielle du service concerné.</p></div>
            </div>}
            {settingsPage === 'security' && <div className="settings-detail">
              <p className="settings-description">Les contrôles ci-dessous correspondent à ce qui est actuellement disponible dans Hiera.</p>
              <div className="settings-feature-card">
                <div className="settings-feature-heading"><span className="security-feature-icon">◉</span><div><strong>Session Google</strong><small>{googleUser ? 'Session active' : 'Aucune session active'}</small></div></div>
                {googleUser && <button className="settings-primary-button" onClick={logoutGoogle}>Déconnecter le compte Google</button>}
              </div>
              <div className="settings-feature-card"><strong>Clés API et mots de passe</strong><p>Les clés API et mots de passe techniques doivent rester dans les variables privées de Render. Ne les ajoute jamais au code public.</p><a className="settings-text-link" href="https://dashboard.render.com/web/srv-dbunvn6k1f9s73as351g" target="_blank" rel="noreferrer">Ouvrir les paramètres privés Render ↗</a></div>
              <div className="settings-feature-card"><strong>Protection de la session</strong><p>La connexion Google identifie ton compte. Hiera ne dispose pas encore d'un verrouillage par code ni d'une fonction de discussion verrouillée.</p></div>
            </div>}
            {settingsPage === 'preferences' && <div className="settings-detail">
              <div className="settings-feature-card"><strong>Apparence</strong><p>Le thème nuit violet est actuellement utilisé.</p><span className="settings-static-value">Thème nuit</span></div>
              <div className="settings-feature-card"><strong>Modèle d'intelligence artificielle</strong><p>Choisis le modèle utilisé pour tes prochaines conversations.</p><select className="settings-select" value={model} onChange={(event) => setModel(event.target.value)}><option value="groq:openai/gpt-oss-20b">GPT-OSS 20B (Groq)</option><option value="groq:openai/gpt-oss-120b">GPT-OSS 120B (Groq)</option></select></div>
            </div>}
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
