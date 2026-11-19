import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    SpeechRecognition?: new () => HieraSpeechRecognition;
    webkitSpeechRecognition?: new () => HieraSpeechRecognition;
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
type HieraSpeechRecognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null;
  onend: (() => void) | null; start: () => void; stop: () => void;
};
type GoogleUser = { email: string; name: string; picture: string };
type Message = { role: 'assistant' | 'user'; content: string; tokensUsed?: number };
type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number; archived?: boolean };
type HieraAttachment = { id: string; name: string; mimeType: string; size: number; dataUrl?: string; text?: string };

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
  const [conversations, setConversations] = useState<Conversation[]>(() => { try { return JSON.parse(localStorage.getItem('hiera-conversations') || '[]'); } catch { return []; } });
  const [currentConversationId, setCurrentConversationId] = useState<string>(() => crypto.randomUUID());
  const [showArchived, setShowArchived] = useState(false);
  const [settingsValues, setSettingsValues] = useState<Record<string, any>>(() => { try { return JSON.parse(localStorage.getItem('hiera-settings') || '{}'); } catch { return {}; } });
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<HieraAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState(() => localStorage.getItem('hiera-model') || 'groq:openai/gpt-oss-20b');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{ plan: string; tokensUsed: number; tokensUsedTotal: number; tokenBudget: number; tokensRemaining: number } | null>(null);
  const [billingSelection, setBillingSelection] = useState<{ name: string; price: string } | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [liveVoice, setLiveVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Mode vocal désactivé');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceTestStatus, setVoiceTestStatus] = useState('');
  const recognitionRef = useRef<HieraSpeechRecognition | null>(null);
  const voiceHeartbeatRef = useRef<number | null>(null);
  const liveVoiceRef = useRef(false);
  const [error, setError] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarNotice, setCalendarNotice] = useState('');
  const [authError, setAuthError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState('home');
  const [wellbeingSection, setWellbeingSection] = useState<'security' | 'privacy'>('security');
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  function updateSetting(key: string, value: any) { setSettingsValues((current) => ({ ...current, [key]: value })); }
  function persistConversation(items: Message[], id = currentConversationId) {
    if (!items.length || settingsValues.saveHistory === false) return;
    const first = items.find((item) => item.role === 'user')?.content || 'Nouvelle conversation';
    setConversations((current) => [{ id, title: first.slice(0, 42), messages: items, updatedAt: Date.now() }, ...current.filter((item) => item.id !== id)].slice(0, 100));
  }
  function openConversation(item: Conversation) { setCurrentConversationId(item.id); setMessages(item.messages); setSettingsOpen(false); setError(''); }
  function archiveConversation(id: string) { setConversations((current) => current.map((item) => item.id === id ? { ...item, archived: !item.archived } : item)); }
  function removeConversation(id: string) { setConversations((current) => current.filter((item) => item.id !== id)); if (id === currentConversationId) { setMessages([]); setCurrentConversationId(crypto.randomUUID()); } }
  useEffect(() => { localStorage.setItem('hiera-conversations', JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { localStorage.setItem('hiera-settings', JSON.stringify(settingsValues)); document.documentElement.dataset.theme = settingsValues.theme || 'dark'; }, [settingsValues]);
  useEffect(() => { localStorage.setItem('hiera-model', model); }, [model]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refreshVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);
  useEffect(() => () => { if (voiceHeartbeatRef.current !== null) window.clearInterval(voiceHeartbeatRef.current); if (liveVoiceRef.current) void fetch('/api/voice/stop', { method: 'POST' }); }, []);

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
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google_calendar');
    if (result === 'connected') setCalendarNotice('Google Agenda est connecté.');
    else if (result === 'cancelled') setCalendarNotice('Connexion Google Agenda annulée.');
    else if (result === 'error') setCalendarNotice('La connexion Google Agenda a échoué. Vérifie les paramètres OAuth Google.');
    if (result) {
      params.delete('google_calendar');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    }
  }, []);

  useEffect(() => {
    if (!googleUser) { setCalendarConnected(false); return; }
    let active = true;
    fetch('/api/integrations/google/status')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'État de Google Agenda indisponible.');
        if (active) setCalendarConnected(data.connected === true);
      })
      .catch((err) => { if (active) setCalendarNotice(err instanceof Error ? err.message : 'État de Google Agenda indisponible.'); });
    return () => { active = false; };
  }, [googleUser]);

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
  }, [googleClientId, settingsOpen, settingsPage]);

  async function redeemRecoveryCode() {
    if (!billingSelection || !['Hiera Plus', 'Hiera Pro', 'Hiera Ultimate'].includes(billingSelection.name)) {
      setRecoveryStatus('Choisis d’abord Plus, Pro ou Ultimate.');
      return;
    }
    setRecoveryBusy(true);
    setRecoveryStatus('');
    try {
      const plan = billingSelection.name.replace('Hiera ', '').toLowerCase();
      const response = await fetch('/api/billing/redeem-recovery-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: recoveryCode, plan }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Activation impossible.');
      setRecoveryStatus(data.message || 'Forfait activé.');
      setRecoveryCode('');
      setBillingSelection(null);
      const usage = await fetch('/api/usage').then((r) => r.ok ? r.json() : null).catch(() => null);
      if (usage) setTokenUsage(usage);
    } catch (err) {
      setRecoveryStatus(err instanceof Error ? err.message : 'Activation impossible.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function submitEmailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const response = await fetch(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: authName, email: authEmail, password: authPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connexion impossible.');
      setGoogleUser(data.user); setAuthPassword('');
    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Connexion impossible.'); }
    finally { setAuthBusy(false); }
  }

  async function logoutGoogle() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.google?.accounts.id.disableAutoSelect();
    setGoogleUser(null); setSettingsOpen(false); setSettingsPage('home');
  }

  async function copyMessage(content: string, index: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageIndex(index);
      window.setTimeout(() => setCopiedMessageIndex((current) => current === index ? null : current), 1600);
    } catch {
      setError("La copie automatique n'est pas disponible sur ce navigateur. Tu peux sélectionner le texte et le copier.");
    }
  }

  function speakText(text: string, voiceKey: 'directVoice' | 'readVoice' = 'readVoice') {
    if (!('speechSynthesis' in window)) {
      setError("La synthèse vocale n'est pas prise en charge par ce navigateur.");
      if (voiceKey === 'readVoice') setVoiceTestStatus('Voix indisponible');
      return;
    }
    const frenchVoices = availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('fr'));
    const savedVoice = settingsValues[voiceKey];
    const selectedVoice = frenchVoices.find((voice) => voice.voiceURI === savedVoice)
      || frenchVoices.find((voice) => voice.default)
      || frenchVoices[0];
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedVoice?.lang || 'fr-FR';
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1;
    utterance.onstart = () => {
      if (voiceKey === 'directVoice') setVoiceStatus('Hiera parle…');
      else setVoiceTestStatus('Lecture en cours…');
    };
    utterance.onend = () => {
      if (voiceKey === 'directVoice') {
        if (liveVoiceRef.current) startVoiceListening();
        else setVoiceStatus('Réponse vocale terminée');
      } else setVoiceTestStatus('Lecture terminée');
    };
    utterance.onerror = () => {
      if (voiceKey === 'directVoice') setVoiceStatus('Lecture vocale indisponible');
      else setVoiceTestStatus('Lecture indisponible');
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function startVoiceListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError("La reconnaissance vocale n'est pas prise en charge par ce navigateur. Essaie Chrome."); setLiveVoice(false); liveVoiceRef.current=false; return; }
    const recognition = new Recognition();
    recognition.lang = settingsValues.language || 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as ArrayLike<any>).map((result: any) => result[0]?.transcript || '').join(' ').trim();
      if (transcript) void sendText(transcript, true);
    };
    recognition.onerror = (event) => { setVoiceStatus(event.error === 'not-allowed' ? "Autorisation du micro refusée" : "Je n'ai pas compris, réessaie"); };
    recognition.onend = () => { recognitionRef.current = null; if (liveVoiceRef.current && !busyRef.current) window.setTimeout(() => { if (liveVoiceRef.current && !busyRef.current && !recognitionRef.current) startVoiceListening(); }, 500); };
    recognitionRef.current = recognition;
    try { recognition.start(); setVoiceStatus("J'écoute…"); }
    catch { setVoiceStatus("Micro indisponible"); }
  }

  function stopLiveVoice() {
    liveVoiceRef.current = false;
    setLiveVoice(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (voiceHeartbeatRef.current !== null) { window.clearInterval(voiceHeartbeatRef.current); voiceHeartbeatRef.current = null; }
    void fetch('/api/voice/stop', { method: 'POST' });
    window.speechSynthesis?.cancel();
    setVoiceStatus('Mode vocal désactivé');
  }

  async function startLiveVoice() {
    if (!('speechSynthesis' in window)) { setError("La lecture vocale n'est pas disponible sur ce navigateur."); return; }
    setError('');
    try {
      const response = await fetch('/api/voice/start', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Quota vocal indisponible.');
      liveVoiceRef.current = true;
      setLiveVoice(true);
      setVoiceStatus('Mode vocal activé');
      voiceHeartbeatRef.current = window.setInterval(async () => {
        try {
          const heartbeat = await fetch('/api/voice/heartbeat', { method: 'POST' });
          const status = await heartbeat.json();
          if (!heartbeat.ok || Number(status.secondsRemaining) <= 0) {
            liveVoiceRef.current = false;
            setLiveVoice(false);
            recognitionRef.current?.stop();
            recognitionRef.current = null;
            if (voiceHeartbeatRef.current !== null) { window.clearInterval(voiceHeartbeatRef.current); voiceHeartbeatRef.current = null; }
            window.speechSynthesis?.cancel();
            setVoiceStatus('Quota vocal atteint');
            setError(status.error || 'Tu as atteint la durée vocale de ton forfait pour cette période de 24 heures.');
          }
        } catch {
          liveVoiceRef.current = false;
          setLiveVoice(false);
          recognitionRef.current?.stop();
          recognitionRef.current = null;
          if (voiceHeartbeatRef.current !== null) { window.clearInterval(voiceHeartbeatRef.current); voiceHeartbeatRef.current = null; }
          setVoiceStatus('Vérification du quota vocal impossible');
          setError('La vérification du quota vocal a échoué. Le mode vocal a été arrêté par sécurité.');
        }
      }, 15000);
      startVoiceListening();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer le mode vocal.');
      setVoiceStatus('Mode vocal indisponible');
    }
  }

  async function addAttachments(fileList: FileList | null) {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    const next: HieraAttachment[] = [];
    for (const file of incoming) {
      if (attachments.length + next.length >= 5) { setError('Tu peux joindre jusqu’à 5 fichiers par message.'); break; }
      if (file.size > 10 * 1024 * 1024) { setError(`${file.name} dépasse la limite de 10 Mo.`); continue; }
      if (file.type.startsWith('image/')) {
        if (attachments.filter((item) => item.dataUrl).length + next.filter((item) => item.dataUrl).length >= 3) { setError('Tu peux joindre jusqu’à 3 images par message.'); continue; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Images acceptées : JPG, PNG et WebP.'); continue; }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
          reader.readAsDataURL(file);
        });
        next.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, dataUrl });
      } else if (['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(file.type) || /\.(txt|md|csv|json)$/i.test(file.name)) {
        const text = await file.text();
        next.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type || 'text/plain', size: file.size, text: text.slice(0, 50000) });
      } else {
        setError(`Format non pris en charge pour l’instant : ${file.name}. Utilise une image, TXT, MD, CSV ou JSON.`);
      }
    }
    if (next.length) { setAttachments((current) => [...current, ...next]); setError(''); }
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  async function sendText(content: string, fromVoice = false, includedAttachments: HieraAttachment[] = []) {
    const clean = content.trim() || (includedAttachments.length ? 'Analyse ces pièces jointes.' : '');
    if (!clean || busyRef.current) return;
    const nextMessages: Message[] = [...messagesRef.current, { role: 'user', content: clean }];
    messagesRef.current = nextMessages;
    busyRef.current = true;
    setMessages(nextMessages);
    persistConversation(nextMessages);
    setDraft('');
    if (includedAttachments.length) setAttachments([]);
    setError('');
    setBusy(true);
    if (fromVoice) setVoiceStatus('Hiera prépare sa réponse…');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'groq', model,
          language: settingsValues.language || 'fr',
          familySafeMode: settingsValues.familySafeMode !== false,
          assistantName: settingsValues.assistantName || 'Hiera',
          replyStyle: settingsValues.replyStyle || 'friendly',
          messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })),
          attachments: includedAttachments.map(({ name, mimeType, dataUrl, text }) => ({ name, mimeType, dataUrl, text })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'La demande a échoué.');
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error("Le service IA n'a pas renvoyé de réponse.");
      if (data.usage && typeof data.usage.tokensUsed === 'number') setTokenUsage(data.usage);
      const updated = [...nextMessages, { role: 'assistant' as const, content: data.reply, tokensUsed: typeof data.usage?.tokensUsed === 'number' ? data.usage.tokensUsed : undefined }];
      messagesRef.current = updated;
      setMessages(updated);
      persistConversation(updated);
      if (fromVoice || liveVoiceRef.current) {
        speakText(data.reply, 'directVoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de joindre Hiera.');
      if (liveVoiceRef.current) setVoiceStatus('Erreur de connexion');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendText(draft, false, attachments);
  }

  function newConversation() {
    if (busy) return;
    if (messages.length) persistConversation(messages);
    setMessages([]);
    setCurrentConversationId(crypto.randomUUID());
    setError('');
    setSettingsOpen(false);
    setSettingsPage('home');
  }

  const settingsItems = [["account","Compte et connexion","Compte Google, session et profil","◉"],["parental","Contrôle parental","Préférences de réponse et ressources familiales","⌂"],["wellbeing","Sécurité et bien-être","Sécurité du compte et protection des données","♡"],["usage","Utilisation","Activité et statistiques locales","▤"],["billing","Facturation","État des achats et abonnements","€"],["general","Général","Langue et comportement de la touche Entrée","⚙"],["theme","Thème","Apparence claire ou sombre","◐"],["notifications","Notifications","Préférences de notification","♢"],["voice","Voix","Lecture vocale des réponses","♫"],["personalization","Personnalisation","Nom et style de Hiera","✧"],["companion","Compagnon","État des fonctions du compagnon","◉"],["history","Chats et archivés","Historique et conversations archivées","▣"],["storage","Stockage et données","Gestion des conversations locales","▤"],["plugins","Plugins","Extensions disponibles","▦"],["preferences","Modèles IA","Choix du modèle de conversation","✧"]];
  const settingsTitles: Record<string, string> = Object.fromEntries([['home','Paramètres'], ...settingsItems.map(([id,title]) => [id,title])]);

  if (!googleUser) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand"><AtomLogo /><span>Hiera</span></div>
          <p className="auth-eyebrow">TON ESPACE PERSONNEL</p>
          <h1>{authMode === 'register' ? 'Créer un compte' : 'Bon retour'}</h1>
          <p className="auth-description">{authMode === 'register' ? 'Inscris-toi pour commencer à utiliser Hiera.' : 'Connecte-toi pour retrouver ton espace Hiera.'}</p>
          <form className="auth-form" onSubmit={submitEmailAuth}>
            {authMode === 'register' && <label>Nom affiché<input autoComplete="name" value={authName} onChange={(e) => setAuthName(e.target.value)} minLength={2} maxLength={80} required placeholder="Ton nom" /></label>}
            <label>Adresse e-mail<input type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} required placeholder="nom@exemple.com" /></label>
            <label>Mot de passe<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} minLength={8} maxLength={128} required placeholder="8 caractères minimum" /></label>
            {authMode === 'register' && <small className="auth-password-hint">Utilise un mot de passe unique d'au moins 8 caractères.</small>}
            {authError && <p className="auth-form-error" role="alert">{authError}</p>}
            <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? 'Patiente…' : authMode === 'register' ? 'Créer mon compte' : 'Se connecter'}</button>
          </form>
          <div className="auth-divider"><span>ou</span></div>
          <div className="google-login auth-google-login" ref={googleButtonRef} />
          {!googleClientId && <p className="auth-form-hint">La connexion Google doit être configurée dans les variables Render.</p>}
          <p className="auth-switch">{authMode === 'register' ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }}>{authMode === 'register' ? 'Se connecter' : 'Créer un compte'}</button></p>
          <p className="auth-legal">Garde ton mot de passe confidentiel et ne le partage avec personne.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setSidebarOpen((open) => !open)} aria-label="Rétracter ou afficher la barre latérale"><AtomLogo /><div><span>Hiera</span><small>Votre IA, toujours avec vous</small></div></button>
        <button className="new-chat" onClick={newConversation} disabled={busy}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <nav className="sidebar-primary-nav" aria-label="Navigation principale"><button className={`side-link ${!settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(false)}><span>◉</span><b>Conversation</b></button><button className={`side-link ${settingsOpen ? "active" : ""}`} onClick={() => { setSettingsOpen(true); setSettingsPage("home"); if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false); }}><span>⚙</span><b>Paramètres</b></button></nav>
        <div className="history-heading">CONVERSATIONS</div><div className="conversation-history">{conversations.filter((item) => !!item.archived === showArchived).slice(0,12).map((item) => <div className="history-row" key={item.id}><button className="history-open" onClick={() => openConversation(item)} title={item.title}>{item.title}</button><button className="history-action" onClick={() => archiveConversation(item.id)} aria-label={item.archived ? "Désarchiver" : "Archiver"}>{item.archived ? "↩" : "▣"}</button></div>)}</div><button className="history-toggle" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Voir les conversations" : "Voir les archivées"}</button>
        <div className="sidebar-account"><div className="account-status"><span className="status-dot" /> {googleUser ? "Google connecté" : "Compte non connecté"}</div><div className="account-provider"><span className="google-g">G</span><span>{googleUser ? googleUser.email : "Gérer dans Paramètres"}</span></div></div>
      </aside>
      {sidebarOpen && <button className="sidebar-dismiss-zone" onClick={() => setSidebarOpen(false)} aria-label="Rétracter la barre latérale" />}

      <section className="workspace" onClick={(event) => { if (sidebarOpen && event.target === event.currentTarget) setSidebarOpen(false); }}>
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
              <div className="settings-home-grid">{settingsItems.map(([id,title,description,icon]) => <button className="settings-home-button" key={id} onClick={() => { setSettingsPage(id); if (id === 'wellbeing') setWellbeingSection('security'); }}><span className="settings-home-icon">{icon}</span><strong>{title}</strong><small>{description}</small></button>)}</div>
            </>}
            {settingsPage === 'account' && <div className="settings-detail">
              <p className="settings-description">Ce compte sert à ouvrir ta session Hiera. Il ne donne pas automatiquement accès à Gmail, Drive ou Agenda.</p>
              <div className="settings-feature-card">
                <div className="settings-feature-heading"><span className="google-g">G</span><div><strong>Connexion à Hiera</strong><small>{googleUser ? 'Compte Google connecté' : 'Aucun compte connecté'}</small></div></div>
                {googleUser ? <><div className="settings-account-line"><strong>{googleUser.name || 'Compte Google'}</strong><span>{googleUser.email}</span></div><button className="settings-primary-button" onClick={logoutGoogle}>Se déconnecter</button></> : <><div className="google-login settings-google-login" ref={googleButtonRef} />{!googleClientId && <p className="settings-warning">L'identifiant OAuth Google manque dans Render. Vérifie aussi que <strong>https://hiera.onrender.com</strong> figure dans les origines JavaScript autorisées de ton client Web Google. <a className="settings-text-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Ouvrir Google Cloud Console ↗</a></p>}</>}
                {authError && <p className="settings-warning" role="alert">{authError}</p>}
              </div>
            </div>}
            {settingsPage === 'parental' && <div className="settings-detail">
              <p className="settings-description">Ces préférences agissent sur les réponses de Hiera. Elles ne remplacent pas les contrôles parentaux du téléphone, de l'ordinateur ou du compte Google.</p>
              <div className="settings-feature-card">
                <strong>Réponses adaptées</strong>
                <label className="settings-check"><input type="checkbox" checked={settingsValues.familySafeMode !== false} onChange={(event) => updateSetting('familySafeMode', event.target.checked)} /> Garder un langage et des explications adaptés à un public adolescent</label>
                <p>Quand cette option est activée, Hiera reçoit une consigne supplémentaire pour privilégier des explications adaptées. Les protections de sécurité de base restent appliquées dans tous les cas.</p>
              </div>
              <div className="settings-feature-card">
                <strong>Contrôles familiaux de l'appareil</strong>
                <p>Les limites de temps, les autorisations d'applications et les restrictions du compte se règlent depuis les paramètres familiaux officiels de l'appareil. Hiera ne peut pas modifier ces réglages à ta place.</p>
                <a className="settings-text-link" href="https://families.google.com/" target="_blank" rel="noreferrer">Ouvrir Google Family Link ↗</a>
              </div>
            </div>}
            {settingsPage === 'wellbeing' && <div className="settings-detail">
              <div className="settings-subnav" role="tablist" aria-label="Sécurité et bien-être">
                <button type="button" role="tab" aria-selected={wellbeingSection === 'security'} className={wellbeingSection === 'security' ? 'active' : ''} onClick={() => setWellbeingSection('security')}>Sécurité du compte</button>
                <button type="button" role="tab" aria-selected={wellbeingSection === 'privacy'} className={wellbeingSection === 'privacy' ? 'active' : ''} onClick={() => setWellbeingSection('privacy')}>Protection des données</button>
              </div>
              {wellbeingSection === 'security' ? <>
                <div className="settings-feature-card">
                  <div className="settings-feature-heading"><span className="security-feature-icon">◉</span><div><strong>Connexion Google</strong><small>{googleUser ? 'Session Hiera active' : 'Aucune session Google active'}</small></div></div>
                  <p>La connexion Google identifie ta session Hiera. Elle n'autorise pas automatiquement Gmail, Drive ou Agenda.</p>
                  {googleUser && <button className="settings-primary-button" onClick={logoutGoogle}>Déconnecter le compte Google</button>}
                  <button className="settings-text-link" onClick={() => { setSettingsPage('account'); }}>Gérer la connexion du compte</button>
                </div>
                <div className="settings-feature-card">
                  <strong>Clés API et revue de code</strong>
                  <p>Les clés API et mots de passe techniques doivent rester dans les variables privées de l'hébergeur. Ne les ajoute jamais au code public.</p>
                  <a className="settings-text-link" href="https://dashboard.render.com/web/srv-dbunvn6k1f9s73as351g" target="_blank" rel="noreferrer">Ouvrir les paramètres privés Render ↗</a>
                  <a className="settings-text-link" href="https://github.com/wylhemjustine13-bit/Hiera" target="_blank" rel="noreferrer">Ouvrir le dépôt pour la revue de code ↗</a>
                </div>
                <div className="settings-feature-card">
                  <strong>Bien-être</strong>
                  <p>Tu peux faire une pause à tout moment. Hiera ne suit pas ton activité en dehors de l'application et ne lit pas les autres fenêtres de ton appareil.</p>
                </div>
              </> : <>
                <div className="settings-feature-card">
                  <strong>Enregistrement des conversations</strong>
                  <label className="settings-check"><input type="checkbox" checked={settingsValues.saveHistory !== false} onChange={(event) => { if (event.target.checked) updateSetting('saveHistory', true); else if (window.confirm('Désactiver l’historique supprimera les conversations sauvegardées sur cet appareil. Continuer ?')) { updateSetting('saveHistory', false); setConversations([]); } }} /> Enregistrer les conversations sur cet appareil</label>
                  <p>Quand cette option est désactivée, les prochaines conversations ne sont plus ajoutées à l'historique local. Les messages de la conversation en cours restent visibles jusqu'à ce que tu quittes ou actualises la page.</p>
                </div>
                <div className="settings-feature-card">
                  <strong>Données enregistrées sur cet appareil</strong>
                  <p>{conversations.length} conversation(s) · {conversations.reduce((total, conversation) => total + conversation.messages.length, 0)} message(s).</p>
                  <button className="settings-primary-button" onClick={() => { const data = new Blob([JSON.stringify(conversations, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = 'hiera-conversations.json'; link.click(); URL.revokeObjectURL(url); }}>Exporter mes conversations</button>
                  <button className="settings-text-link" onClick={() => { if (window.confirm('Supprimer toutes les conversations enregistrées sur cet appareil ?')) { setConversations([]); setMessages([]); setCurrentConversationId(crypto.randomUUID()); } }}>Effacer les conversations enregistrées</button>
                </div>
              </>}
            </div>}
            {settingsPage === 'usage' && <div className="settings-detail"><div className="settings-feature-card"><strong>Utilisation locale</strong><p>{conversations.length} conversation(s) enregistrée(s) sur cet appareil.</p><p>{conversations.reduce((n,c) => n+c.messages.length,0)} messages conservés dans l'historique local.</p></div>{tokenUsage && <div className="settings-feature-card"><strong>Consommation IA — dernière utilisation</strong><p>{tokenUsage.tokensUsed.toLocaleString('fr-FR')} jetons pour le dernier échange.</p><p>{tokenUsage.tokensUsedTotal.toLocaleString('fr-FR')} / {tokenUsage.tokenBudget.toLocaleString('fr-FR')} jetons utilisés sur la période.</p><p>Solde estimé : {tokenUsage.tokensRemaining.toLocaleString('fr-FR')} jetons.</p></div>}</div>}
            {settingsPage === 'billing' && <div className="settings-detail billing-detail">
              <p className="settings-description">Choisis le niveau de Hiera qui correspond à tes besoins. Basic restera gratuit avec un quota strict ; Plus, Pro et Ultimate seront payants, sans période d'essai.</p>
               <div className="billing-checkout-intro"><strong>Choisir un forfait et préparer l'abonnement</strong><p>Sélectionne une offre pour afficher son récapitulatif. Le paiement par carte sera activé uniquement après la configuration d'un prestataire de paiement sécurisé.</p></div>
              <div className="billing-status"><span className="billing-status-dot" /><div><strong>Abonnements en préparation</strong><small>Aucun forfait n'est actuellement souscrit et aucun paiement n'est activé.</small></div></div>
              <div className="billing-plans">
                <article className="billing-plan"><div className="billing-plan-top"><span className="billing-plan-icon">✦</span><span className="billing-plan-label">Essentiel</span></div><h2>Hiera Basic</h2><p className="billing-plan-summary">Pour découvrir Hiera au quotidien.</p><ul><li>100 messages par période de 24 h</li><li>Budget : 50 000 jetons par période de 24 h</li><li>Message simple : environ 100 jetons en moyenne</li><li>Photo, fichier et analyse : consommation réelle selon le contenu</li><li>Mode vocal : 10 min par période de 24 h</li><li>Jusqu'à 10 souvenirs personnalisés (fonction à intégrer)</li><li>Historique conservé 7 jours (fonction à intégrer)</li><li>Personnalisation essentielle</li></ul><span className="billing-price">Gratuit</span><button className="billing-select-button" type="button" onClick={() => setBillingSelection({ name: 'Hiera Basic', price: 'Gratuit' })}>Choisir Basic</button></article>
                <article className="billing-plan"><div className="billing-plan-top"><span className="billing-plan-icon">✧</span><span className="billing-plan-label">Plus</span></div><h2>Hiera Plus</h2><p className="billing-plan-summary">Pour une utilisation plus régulière.</p><ul><li>300 messages par période de 24 h</li><li>Budget : 150 000 jetons par période de 24 h</li><li>Message simple : environ 100 jetons en moyenne</li><li>Photo, fichier et analyse : consommation réelle selon le contenu</li><li>Mode vocal : 45 min par période de 24 h</li><li>Jusqu'à 100 souvenirs personnalisés (fonction à intégrer)</li><li>Historique conservé 30 jours (fonction à intégrer)</li><li>Personnalisation avancée</li></ul><span className="billing-price">7,99 € / mois</span><button className="billing-select-button" type="button" onClick={() => setBillingSelection({ name: 'Hiera Plus', price: '7,99 € / mois' })}>Sélectionner Plus</button></article>
                <article className="billing-plan billing-plan-featured"><div className="billing-plan-top"><span className="billing-plan-icon">◈</span><span className="billing-plan-label">Avancé</span></div><h2>Hiera Pro</h2><p className="billing-plan-summary">Pour profiter de capacités avancées.</p><ul><li>1 200 messages par période de 24 h</li><li>Budget : 500 000 jetons par période de 24 h</li><li>Message simple : environ 100 jetons en moyenne</li><li>Photo, fichier et analyse : consommation réelle selon le contenu</li><li>Mode vocal : 2 h par période de 24 h</li><li>Jusqu'à 500 souvenirs personnalisés (fonction à intégrer)</li><li>Historique conservé 180 jours (fonction à intégrer)</li><li>Outils avancés selon disponibilité</li></ul><span className="billing-price">24,99 € / mois</span><button className="billing-select-button" type="button" onClick={() => setBillingSelection({ name: 'Hiera Pro', price: '24,99 € / mois' })}>Sélectionner Pro</button></article>
                <article className="billing-plan"><div className="billing-plan-top"><span className="billing-plan-icon">✺</span><span className="billing-plan-label">Complet</span></div><h2>Hiera Ultimate</h2><p className="billing-plan-summary">L'offre la plus complète de Hiera.</p><ul><li>3 000 messages par période de 24 h</li><li>Budget : 1 500 000 jetons par période de 24 h</li><li>Message simple : environ 100 jetons en moyenne</li><li>Photo, fichier et analyse : consommation réelle selon le contenu</li><li>Mode vocal : 5 h par période de 24 h</li><li>Souvenirs sans quota fixe (fonction à intégrer)</li><li>Historique sans durée fixe (fonction à intégrer)</li><li>Personnalisation maximale et priorité</li></ul><span className="billing-price">56,99 € / mois</span><button className="billing-select-button" type="button" onClick={() => setBillingSelection({ name: 'Hiera Ultimate', price: '56,99 € / mois' })}>Sélectionner Ultimate</button></article>
              </div>
              <p className="billing-footnote">Les budgets de jetons sont débités selon l'utilisation réelle déclarée par le fournisseur IA : texte d'entrée, réponse, images et analyses. 100 jetons par message simple est une estimation, pas un tarif fixe. Les périodes de quota durent 24 h à partir de la première utilisation. Les abonnements payants sont annoncés mais aucun paiement ni essai gratuit n'est activé. Les limites de mémoire, d'historique et de voix affichées décrivent les offres prévues ; leur contrôle technique sera ajouté avant l'ouverture des abonnements.</p>
               {billingSelection && <div className="billing-checkout-panel"><div><span className="billing-checkout-kicker">RÉCAPITULATIF DU FORFAIT</span><strong>{billingSelection.name}</strong><b>{billingSelection.price}</b></div><p>Pour cette phase de test, tu peux demander l’activation du forfait choisi avec le code de récupération provisoire. Il ne s’agit pas d’un paiement et il est limité à 10 comptes.</p><label className="recovery-code-label">Code de récupération<input className="recovery-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\\D/g, '').slice(0, 6))} placeholder="6 chiffres" /></label><button className="billing-select-button" type="button" disabled={recoveryBusy || recoveryCode.length !== 6} onClick={redeemRecoveryCode}>{recoveryBusy ? 'Vérification…' : 'Activer le forfait choisi'}</button>{recoveryStatus && <p className="recovery-code-status" role="status">{recoveryStatus}</p>}<button className="billing-select-button" type="button" onClick={() => { setBillingSelection(null); setRecoveryStatus(''); setRecoveryCode(''); }}>Fermer le récapitulatif</button></div>}
            </div>}
            {settingsPage === 'general' && <div className="settings-detail">
              <div className="settings-feature-card">
                <strong>Langue des réponses</strong>
                <p>Choisis la langue dans laquelle Hiera doit te répondre. Les menus et les textes de l'interface restent actuellement en français.</p>
                <select className="settings-select" value={settingsValues.language || 'fr'} onChange={(event) => updateSetting('language', event.target.value)}>
                  <option value="fr">Français</option><option value="en">English</option><option value="es">Español</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pt">Português</option><option value="nl">Nederlands</option><option value="pl">Polski</option><option value="ru">Русский</option><option value="uk">Українська</option><option value="ar">العربية</option><option value="zh">中文</option><option value="ja">日本語</option><option value="ko">한국어</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option><option value="tr">Türkçe</option><option value="sv">Svenska</option><option value="no">Norsk</option><option value="da">Dansk</option><option value="fi">Suomi</option><option value="el">Ελληνικά</option><option value="he">עברית</option><option value="th">ไทย</option><option value="vi">Tiếng Việt</option><option value="id">Bahasa Indonesia</option><option value="sw">Kiswahili</option><option value="ro">Română</option><option value="cs">Čeština</option><option value="hu">Magyar</option>
                </select>
              </div>
              <div className="settings-feature-card">
                <strong>Raccourci d'envoi</strong>
                <p>Choisis ce que fait la touche Entrée dans la zone de message. Maj + Entrée insère toujours une nouvelle ligne.</p>
                <select className="settings-select" value={settingsValues.enterBehavior || (settingsValues.enterToSend === false ? 'newline' : 'send')} onChange={(event) => updateSetting('enterBehavior', event.target.value)}>
                  <option value="send">Entrée envoie le message</option>
                  <option value="newline">Entrée insère une nouvelle ligne</option>
                </select>
              </div>
            </div>}
            {settingsPage === 'theme' && <div className="settings-detail"><div className="settings-feature-card"><strong>Apparence</strong><p>Choisis l'apparence de Hiera.</p><select className="settings-select" value={settingsValues.theme || 'dark'} onChange={(e) => updateSetting('theme',e.target.value)}><option value="dark">Sombre violet</option><option value="light">Clair</option></select></div></div>}
            {settingsPage === 'notifications' && <div className="settings-detail"><div className="settings-feature-card"><strong>Notifications du navigateur</strong><p>Autorise ou bloque les notifications de Hiera dans ton navigateur.</p><span className="settings-static-value">État : {typeof Notification === 'undefined' ? 'Non pris en charge' : Notification.permission}</span><button className="settings-primary-button" onClick={async () => { if (typeof Notification === 'undefined') { updateSetting('notificationPermission','unsupported'); return; } const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; updateSetting('notificationPermission',permission); if (permission === 'granted') new Notification('Hiera',{body:'Les notifications du navigateur sont activées.'}); }}>Activer et tester</button></div></div>}
            {settingsPage === 'voice' && <div className="settings-detail">
              {(['directVoice', 'readVoice'] as const).map((voiceKey) => (
                <div className="settings-feature-card" key={voiceKey}>
                  <strong>{voiceKey === 'directVoice' ? 'Voix du mode direct' : 'Voix pour lire les réponses'}</strong>
                  <p>{voiceKey === 'directVoice' ? 'Choisis la voix utilisée pendant les conversations vocales.' : 'Choisis une voix indépendante pour lire les réponses de Hiera.'}</p>
                  <select className="settings-select" value={settingsValues[voiceKey] || ''} onChange={(event) => updateSetting(voiceKey, event.target.value)}>
                    {availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('fr')).length === 0
                      ? <option value="">Aucune voix française détectée sur cet appareil</option>
                      : availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('fr')).map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.default ? ' · par défaut' : ''}</option>
                      ))}
                  </select>
                  <button className="settings-primary-button" onClick={() => speakText(voiceKey === 'directVoice' ? 'Bonjour, je suis Hiera. Comment puis-je t’aider ?' : 'Bonjour, je suis Hiera. Voici un exemple de lecture à haute voix.', voiceKey)}>Écouter cette voix</button>
                  {voiceKey === 'readVoice' && <><button className="settings-text-link" onClick={() => { window.speechSynthesis?.cancel(); setVoiceTestStatus('Lecture arrêtée'); }}>Arrêter la lecture</button>{voiceTestStatus && <small>{voiceTestStatus}</small>}</>}
                </div>
              ))}
              <p className="settings-description">Les voix sont fournies gratuitement par le navigateur ou le système de ton appareil. Leur disponibilité dépend des voix françaises installées sur ton téléphone ou ton ordinateur. Aucun service Google Cloud ni clé API n'est nécessaire.</p>
            </div>}
            {settingsPage === 'personalization' && <div className="settings-detail"><div className="settings-feature-card"><strong>Nom de l'assistant</strong><input className="settings-select" maxLength={40} value={settingsValues.assistantName || 'Hiera'} onChange={(e) => updateSetting('assistantName',e.target.value)} /><p>Le nom choisi est transmis au modèle pour les prochaines réponses.</p></div><div className="settings-feature-card"><strong>Style de réponse</strong><select className="settings-select" value={settingsValues.replyStyle || 'friendly'} onChange={(e) => updateSetting('replyStyle',e.target.value)}><option value="friendly">Naturel et amical</option><option value="concise">Concis</option><option value="detailed">Détaillé</option></select><p>Le style choisi s'applique aux prochaines réponses.</p></div></div>}
            {settingsPage === 'companion' && <div className="settings-detail"><div className="settings-feature-card"><strong>Compagnon Hiera</strong><p>Le robot animé et ses animations ne sont pas encore intégrés à cette version. Cette rubrique restera informative jusqu'à ce que ces fonctions soient disponibles, plutôt que de proposer un interrupteur sans effet.</p></div></div>}

            {settingsPage === 'history' && <div className="settings-detail"><div className="settings-feature-card"><strong>Conversations enregistrées</strong><p>{conversations.length} conversation(s). Les conversations sont conservées dans ce navigateur.</p><button className="settings-primary-button" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Afficher les conversations actives' : 'Afficher les conversations archivées'}</button></div>{conversations.filter((c) => !!c.archived === showArchived).map((c) => <div className="settings-feature-card" key={c.id}><strong>{c.title}</strong><p>{c.messages.length} message(s) · {new Date(c.updatedAt).toLocaleString('fr-FR')}</p><button className="settings-primary-button" onClick={() => openConversation(c)}>Ouvrir</button><button className="settings-text-link" onClick={() => archiveConversation(c.id)}>{c.archived ? 'Désarchiver' : 'Archiver'}</button><button className="settings-text-link" onClick={() => removeConversation(c.id)}>Supprimer</button></div>)}</div>}
            {settingsPage === 'storage' && <div className="settings-detail"><div className="settings-feature-card"><strong>Stockage local</strong><p>{conversations.length} conversation(s) enregistrée(s) dans ce navigateur.</p><button className="settings-primary-button" onClick={() => { if (window.confirm('Supprimer toutes les conversations enregistrées sur cet appareil ?')) { setConversations([]); setMessages([]); setCurrentConversationId(crypto.randomUUID()); } }}>Effacer les conversations locales</button></div><div className="settings-feature-card"><strong>Gestion des données</strong><p>Les préférences et conversations sont conservées dans le stockage local de ce navigateur.</p></div></div>}
            {settingsPage === 'plugins' && <div className="settings-detail"><div className="settings-feature-card"><strong>Plugins</strong><p>Le système de plugins n'est pas encore intégré à cette version de Hiera. Les services externes ne sont donc pas activables ici.</p></div></div>}
            {settingsPage === 'security' && <div className="settings-detail">
              <p className="settings-description">Les contrôles ci-dessous correspondent à ce qui est actuellement disponible dans Hiera.</p>
              <div className="settings-feature-card">
                <div className="settings-feature-heading"><span className="security-feature-icon">◉</span><div><strong>Session Google</strong><small>{googleUser ? 'Session active' : 'Aucune session active'}</small></div></div>
                {googleUser && <button className="settings-primary-button" onClick={logoutGoogle}>Déconnecter le compte Google</button>}
              </div>
              <div className="settings-feature-card"><strong>Clés API et mots de passe</strong><p>Les clés API et mots de passe techniques doivent rester dans les variables privées de Render. Ne les ajoute jamais au code public.</p><a className="settings-text-link" href="https://dashboard.render.com/web/srv-dbunvn6k1f9s73as351g" target="_blank" rel="noreferrer">Ouvrir les paramètres privés Render ↗</a><a className="settings-text-link" href="https://github.com/wylhemjustine13-bit/Hiera" target="_blank" rel="noreferrer">Ouvrir le dépôt pour la revue de code ↗</a></div>
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
              {messages.length === 0 && <div className="welcome compact-welcome"><div className="atom" aria-hidden="true"><span className="orbit"/><span className="orbit orbit-two"/><span className="orbit orbit-three"/><span className="nucleus"/></div><h1>Hiera</h1><p className="subtitle">Que souhaites-tu faire aujourd’hui ?</p><div className="quick-prompts"><button type="button" onClick={() => setDraft('Aide-moi à organiser ma journée.')}><span>✦</span>Organiser ma journée</button><button type="button" onClick={() => setDraft('Explique-moi un sujet simplement.')}><span>◈</span>Apprendre quelque chose</button><button type="button" onClick={() => setDraft('Aide-moi à trouver une idée créative.')}><span>✧</span>Trouver une idée</button><button type="button" onClick={() => setDraft('Aide-moi à résoudre un problème.')}><span>⌘</span>Résoudre un problème</button></div></div>}
              <div className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={index}>
                    {message.role === 'assistant' && <span className="message-mark">✳</span>}
                    <div className="message-body">
                      <p>{message.content}</p>
                      {message.role === 'assistant' && <div className="message-actions"><button className="copy-message" type="button" onClick={() => copyMessage(message.content, index)} aria-label="Copier la réponse" title="Copier la réponse">{copiedMessageIndex === index ? '✓ Copié' : '⧉ Copier'}</button><button className="copy-message" type="button" onClick={() => speakText(message.content, 'readVoice')} aria-label="Lire la réponse à haute voix" title="Lire à haute voix">♫ Lire</button></div>}
                      {message.role === 'assistant' && typeof message.tokensUsed === 'number' && <small className="token-usage-note">≈ {message.tokensUsed.toLocaleString('fr-FR')} jetons utilisés pour cet échange</small>}
                    </div>
                  </article>
                ))}
                {busy && <article className="message assistant"><span className="message-mark">✳</span><p className="typing">Hiera réfléchit…</p></article>}
              </div>
            </div>
            <form className="composer" onSubmit={sendMessage}>
              <input ref={attachmentInputRef} className="attachment-input" type="file" accept="image/jpeg,image/png,image/webp,.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" multiple onChange={(event) => { void addAttachments(event.target.files); }} />
              {attachments.length > 0 && <div className="attachment-list">{attachments.map((item) => <div className="attachment-chip" key={item.id}>{item.dataUrl ? <img src={item.dataUrl} alt={item.name} /> : <span className="attachment-file-icon">▤</span>}<span title={item.name}>{item.name}</span><button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Retirer ${item.name}`}>×</button></div>)}</div>}
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { const enterBehavior = settingsValues.enterBehavior || (settingsValues.enterToSend === false ? 'newline' : 'send'); if (event.key === "Enter" && !event.shiftKey && enterBehavior === 'send') { event.preventDefault(); (event.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }} placeholder="Écris un message à Hiera…" rows={1} aria-label="Message à Hiera" disabled={busy} />
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="composer-footer"><span>Pose ta question à Hiera</span><div className="composer-actions"><button type="button" className="attach-toggle" onClick={() => attachmentInputRef.current?.click()} disabled={busy} aria-label="Joindre une photo ou un fichier" title="Joindre une photo ou un fichier">＋</button><button type="button" className={liveVoice ? 'voice-toggle active' : 'voice-toggle'} onClick={liveVoice ? stopLiveVoice : startLiveVoice} aria-label={liveVoice ? 'Arrêter la conversation vocale' : 'Démarrer la conversation vocale'}>{liveVoice ? '■' : <svg className="voice-mic-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10.5v1.5a7 7 0 0 0 14 0v-1.5M12 19v3M8 22h8"/></svg>}</button><button type="submit" disabled={(!draft.trim() && !attachments.length) || busy} aria-label="Envoyer le message">{busy ? '…' : '↑'}</button></div></div>{liveVoice && <p className="voice-status" role="status">{voiceStatus} · Micro actif uniquement pendant l'écoute. <button type="button" onClick={stopLiveVoice}>Arrêter</button></p>}
              <p className="attachment-hint">Photos JPG, PNG, WebP · fichiers TXT, MD, CSV, JSON · 10 Mo maximum chacun</p>
            </form>
            <p className="disclaimer">Ne partage jamais de données personnelles ou confidentielles dans une conversation.</p>
          </>
        )}
      </section>
    </main>
  );
}
