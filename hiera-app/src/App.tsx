import { useEffect, useRef, useState } from 'react';
import './redesign.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import FormattedMessage from './FormattedMessage';
import Companion3D from './Companion3D';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

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
type HieraAttachment = { id: string; name: string; mimeType: string; size: number; dataUrl?: string; text?: string; previewUrl?: string };

function CompanionBust({ id, name, compact = false }: { id: string; name: string; compact?: boolean }) {
  return <div className={"companion-bust companion-" + id + (compact ? " is-compact" : "")} role="img" aria-label={"Compagnon 3D animé " + name}>
    <div className="bust-3d-model">
      <div className="bust-3d-back"/><div className="bust-3d-shoulders"/>
      <div className="bust-3d-neck"/>
      <div className="bust-3d-head"><div className="bust-3d-hair"/><div className="bust-3d-eyes"><i/><i/></div><div className="bust-3d-mouth"/></div>
      <div className="bust-3d-chest"><span className="bust-3d-emblem"/></div>
      <div className="bust-3d-side left"/><div className="bust-3d-side right"/>
      <div className="bust-3d-light"/>
    </div>
  </div>;
}

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
  const [privateMode, setPrivateMode] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(() => { try { return JSON.parse(localStorage.getItem('hiera-conversations') || '[]'); } catch { return []; } });
  const [currentConversationId, setCurrentConversationId] = useState<string>(() => crypto.randomUUID());
  const [showArchived, setShowArchived] = useState(false);
  const [settingsValues, setSettingsValues] = useState<Record<string, any>>(() => { try { return JSON.parse(localStorage.getItem('hiera-settings') || '{}'); } catch { return {}; } });
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<HieraAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<HieraAttachment | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentMenuPosition, setAttachmentMenuPosition] = useState({ left: 16, top: 16 });
  const attachmentMenuWrapRef = useRef<HTMLDivElement>(null);
  function toggleAttachmentMenu() {
    if (attachmentMenuOpen) { setAttachmentMenuOpen(false); return; }
    const rect = attachmentMenuWrapRef.current?.getBoundingClientRect();
    if (rect) setAttachmentMenuPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)), top: Math.max(12, rect.top - 122) });
    setAttachmentMenuOpen(true);
  }
  const [model, setModel] = useState(() => localStorage.getItem('hiera-model') || 'groq:openai/gpt-oss-20b');
  const companions = [{ id: 'hiera', name: 'Hiera', emoji: '✦', role: 'Polyvalent', description: 'Pour discuter, réfléchir et t’aider au quotidien.' }, { id: 'willy', name: 'Willy', emoji: '🤖', role: 'Compagnon', description: 'Un compagnon curieux, encourageant et créatif.' }, { id: 'nova', name: 'Nova', emoji: '🔭', role: 'Sciences', description: 'Pour comprendre les sciences et les idées complexes.' }, { id: 'pixel', name: 'Pixel', emoji: '💻', role: 'Technologie', description: 'Pour apprendre la programmation et résoudre des problèmes techniques.' }, { id: 'luna', name: 'Luna', emoji: '🌙', role: 'Organisation', description: 'Pour organiser tes projets, tes idées et tes journées.' }, { id: 'atlas', name: 'Atlas', emoji: '🌍', role: 'Culture générale', description: 'Pour explorer l’histoire, la géographie et la culture générale.' }];
  const [activeCompanionId, setActiveCompanionId] = useState(() => localStorage.getItem('hiera-companion') || 'hiera');
  const activeCompanion = companions.find((item) => item.id === activeCompanionId) || companions[0];
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const [speechActive, setSpeechActive] = useState(false);
  const [writingOpen, setWritingOpen] = useState(false);
  const [writingSource, setWritingSource] = useState('');
  const writingEditorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [tokenUsage, setTokenUsage] = useState<{ plan: string; tokensUsed: number; tokensUsedTotal: number; tokenBudget: number; tokensRemaining: number } | null>(null);
  const [billingSelection, setBillingSelection] = useState<{ name: string; price: string } | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [adminActionStatus, setAdminActionStatus] = useState('');
  const [adminNotificationsEnabled, setAdminNotificationsEnabled] = useState(false);
  const adminSeenRequestsRef = useRef<Set<number>>(new Set());
  const adminNotificationsRef = useRef(false);
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPanel, setAdminPanel] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminData, setAdminData] = useState<any>(null);
  const [pendingHelpRequest, setPendingHelpRequest] = useState<any>(null);
  const [helpConsentBusy, setHelpConsentBusy] = useState(false);
  const [sharedHelp, setSharedHelp] = useState<any>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [learningTopic, setLearningTopic] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [learningChecklist, setLearningChecklist] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('hiera-learning-checklist') || '[]'); } catch { return []; } });
  const learningSteps = ['Choisir un sujet à apprendre', 'Lire ou écouter une explication', 'Répondre à un petit questionnaire', 'Revoir les réponses et les erreurs'];
  const demoQuiz = [
    { id: 'q1', question: 'Quelle civilisation a construit les pyramides de Gizeh ?', options: ['Les Égyptiens de l’Antiquité', 'Les Romains', 'Les Grecs'], answer: 'Les Égyptiens de l’Antiquité', explanation: 'Les pyramides de Gizeh ont été construites dans l’Égypte antique.' },
    { id: 'q2', question: 'Quelle planète est surnommée la planète rouge ?', options: ['Vénus', 'Mars', 'Jupiter'], answer: 'Mars', explanation: 'Mars doit sa couleur rougeâtre à des minéraux riches en oxyde de fer.' },
    { id: 'q3', question: 'Combien y a-t-il de côtés dans un triangle ?', options: ['Trois', 'Quatre', 'Cinq'], answer: 'Trois', explanation: 'Un triangle est un polygone qui possède trois côtés et trois angles.' }
  ];
  const quizScore = demoQuiz.filter((question) => quizAnswers[question.id] === question.answer).length;
  useEffect(() => { localStorage.setItem('hiera-learning-checklist', JSON.stringify(learningChecklist)); }, [learningChecklist]);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setError('Le mode plein écran n’est pas pris en charge par ce navigateur.');
    } catch {
      setError('Le navigateur a refusé le mode plein écran. Essaie depuis Chrome ou installe Hiera sur l’écran d’accueil.');
    }
  }
  const [settingsPage, setSettingsPage] = useState('home');
  const [wellbeingSection, setWellbeingSection] = useState<'security' | 'privacy'>('security');
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  function updateSetting(key: string, value: any) { setSettingsValues((current) => ({ ...current, [key]: value })); }
  function persistConversation(items: Message[], id = currentConversationId) {
    if (privateMode || !items.length || settingsValues.saveHistory === false) return;
    const first = items.find((item) => item.role === 'user')?.content || 'Nouvelle conversation';
    setConversations((current) => [{ id, title: first.slice(0, 42), messages: items, updatedAt: Date.now() }, ...current.filter((item) => item.id !== id)].slice(0, 100));
  }
  function openConversation(item: Conversation) { if (privateMode) return; setCurrentConversationId(item.id); setMessages(item.messages); setSettingsOpen(false); setError(''); }
  function togglePrivateMode() {
    const next = !privateMode;
    if (next && messagesRef.current.length && !privateMode) persistConversation(messagesRef.current);
    attachments.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    setPrivateMode(next);
    setMessages([]); messagesRef.current = []; setCurrentConversationId(crypto.randomUUID());
    setDraft(''); setAttachments([]); setPreviewAttachment(null); setAttachmentMenuOpen(false);
    setSettingsOpen(false); setError('');
  }
  function archiveConversation(id: string) { setConversations((current) => current.map((item) => item.id === id ? { ...item, archived: !item.archived } : item)); }
  function removeConversation(id: string) { setConversations((current) => current.filter((item) => item.id !== id)); if (id === currentConversationId) { setMessages([]); setCurrentConversationId(crypto.randomUUID()); } }
  useEffect(() => { localStorage.setItem('hiera-conversations', JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { localStorage.setItem('hiera-settings', JSON.stringify(settingsValues)); document.documentElement.dataset.theme = settingsValues.theme || 'dark'; }, [settingsValues]);
  useEffect(() => { localStorage.setItem('hiera-model', model); }, [model]);
  useEffect(() => { localStorage.setItem('hiera-companion', activeCompanionId); }, [activeCompanionId]);
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
    if (!googleUser) { setIsAdmin(false); setAdminData(null); setAdminPanel(false); return; }
    let active = true;
    fetch('/api/admin/me').then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setIsAdmin(data?.isAdmin === true); })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, [googleUser]);

  async function openAdminPanel() {
    setAdminLoading(true);
    try {
      const data = await refreshAdminData(true);
      if (!data) throw new Error('Accès administrateur refusé ou données indisponibles.');
      setAdminPanel(true);
    } catch (adminError) { setError(adminError instanceof Error ? adminError.message : 'Impossible de charger Hiera Control.'); }
    finally { setAdminLoading(false); }
  }

  useEffect(() => {
    if (!googleUser) { setPendingHelpRequest(null); return; }
    let active = true;
    const pollHelpRequest = async () => {
      try {
        const response = await fetch('/api/help/pending', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (active) setPendingHelpRequest((current: any) => {
          if (!data.request) return null;
          return current?.id === data.request.id ? current : data.request;
        });
      } catch { /* Nouvelle tentative automatique. */ }
    };
    void pollHelpRequest();
    const timer = window.setInterval(pollHelpRequest, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [googleUser?.email]);

  useEffect(() => {
    if (!adminPanel || !isAdmin) return;
    let active = true;
    let firstPoll = true;
    const poll = async () => {
      try {
        const response = await fetch('/api/admin/overview', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        const requests = Array.isArray(data.resetRequests) ? data.resetRequests : [];
        if (firstPoll) {
          requests.forEach((item: any) => adminSeenRequestsRef.current.add(Number(item.id)));
          firstPoll = false;
        } else {
          for (const item of requests) {
            const id = Number(item.id);
            if (!adminSeenRequestsRef.current.has(id)) {
              adminSeenRequestsRef.current.add(id);
              if (adminNotificationsRef.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Demande Hiera', { body: 'Mot de passe oublié : ' + item.email });
            }
          }
        }
        setAdminData(data);
      } catch { /* La prochaine actualisation réessaiera. */ }
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [adminPanel, isAdmin]);

  useEffect(() => {
    if (!googleUser) { setTokenUsage(null); setPendingHelpRequest(null); return; }
    let active = true;
    fetch('/api/usage')
      .then(async (response) => {
        if (!response.ok) throw new Error('Forfait indisponible.');
        return response.json();
      })
      .then((usage) => { if (active) setTokenUsage(usage); })
      .catch(() => { if (active) setTokenUsage(null); });
    return () => { active = false; };
  }, [googleUser]);

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

  async function requestPasswordReset() {
    setAuthError(''); setAuthNotice('');
    const email = authEmail.trim();
    if (!email) { setAuthError('Indique ton adresse e-mail pour demander la réinitialisation.'); return; }
    setAuthBusy(true);
    try {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Demande impossible.');
      setAuthNotice(data.message || 'Demande transmise à Hiera.');
    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Demande impossible.'); }
    finally { setAuthBusy(false); }
  }

  async function refreshAdminData(showErrors = false) {
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible d’actualiser Hiera Control.');
      setAdminData(data); setIsAdmin(true); return data;
    } catch (err) {
      if (showErrors) setAdminActionStatus(err instanceof Error ? err.message : 'Actualisation impossible.');
      return null;
    }
  }

  async function updateAdminAccount(userId: string, changes: { plan?: string; banned?: boolean }) {
    setAdminActionStatus('');
    try {
      const response = await fetch('/api/admin/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, ...changes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Modification impossible.');
      setAdminActionStatus('Compte mis à jour.'); await refreshAdminData();
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Modification impossible.'); }
  }

  async function resolveResetRequest(id: number) {
    try {
      const response = await fetch('/api/admin/reset-request/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de traiter la demande.');
      await refreshAdminData();
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Impossible de traiter la demande.'); }
  }

  async function requestHelpAccess(userId: string) {
    setAdminActionStatus('');
    try {
      const response = await fetch('/api/admin/help/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de demander l’autorisation.');
      setAdminActionStatus(data.existing ? 'Une demande est déjà en attente.' : 'Demande envoyée. L’utilisateur doit donner son accord.');
      await refreshAdminData();
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Demande impossible.'); }
  }

  async function openSharedHelp(id: number) {
    try {
      const response = await fetch('/api/admin/help/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Accès non autorisé ou déjà utilisé.');
      setSharedHelp({ id, email: data.email, messages: data.messages || [], expiresAt: data.expiresAt });
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Impossible d’ouvrir la session d’aide.'); }
  }

  async function closeSharedHelp() {
    if (!sharedHelp) return;
    try {
      const response = await fetch('/api/admin/help/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sharedHelp.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de fermer la session.');
      setSharedHelp(null); await refreshAdminData();
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Impossible de fermer la session.'); }
  }

  async function reviewSafetyFlag(id: number) {
    try {
      const response = await fetch('/api/admin/safety/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de traiter le signalement.');
      await refreshAdminData();
    } catch (err) { setAdminActionStatus(err instanceof Error ? err.message : 'Impossible de traiter le signalement.'); }
  }

  async function respondToHelpRequest(approved: boolean) {
    if (!pendingHelpRequest) return;
    setHelpConsentBusy(true);
    try {
      const response = await fetch('/api/help/respond', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pendingHelpRequest.id, approved,
          messages: approved && !privateMode ? messagesRef.current.slice(-30).map(({ role, content }) => ({ role, content })) : [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible d’envoyer ta réponse.');
      setPendingHelpRequest(null);
    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Impossible d’envoyer ta réponse.'); }
    finally { setHelpConsentBusy(false); }
  }

  async function enableAdminNotifications() {
    if (typeof Notification === 'undefined') { setAdminActionStatus('Notifications non prises en charge par ce navigateur.'); return; }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission === 'granted') {
      adminNotificationsRef.current = true; setAdminNotificationsEnabled(true);
      setAdminActionStatus('Notifications activées sur cet appareil tant que Hiera Control reste ouvert.');
      new Notification('Hiera Control', { body: 'Les nouvelles demandes seront signalées.' });
    } else setAdminActionStatus('Autorisation de notification refusée dans le navigateur.');
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

  function stopSpeech() {
    window.speechSynthesis?.cancel();
    setSpeechActive(false);
    setVoiceTestStatus('Lecture arrêtée');
    if (liveVoiceRef.current) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setVoiceStatus('Lecture arrêtée');
    }
  }

  function stopGeneration() {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setError('Arrêt de la recherche en cours…');
  }

  function openWritingEditor(content = '') {
    setWritingSource(content);
    setWritingOpen(true);
  }

  function formatWriting(command: string, value?: string) {
    writingEditorRef.current?.focus();
    document.execCommand(command, false, value);
  }

  async function copyWriting() {
    const text = writingEditorRef.current?.innerText || '';
    try { await navigator.clipboard.writeText(text); setVoiceTestStatus('Texte copié'); }
    catch { setError('La copie est indisponible sur ce navigateur.'); }
  }

  useEffect(() => {
    if (writingOpen && writingEditorRef.current) writingEditorRef.current.innerText = writingSource;
  }, [writingOpen, writingSource]);

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
      setSpeechActive(true);
      if (voiceKey === 'directVoice') setVoiceStatus('Hiera parle…');
      else setVoiceTestStatus('Lecture en cours…');
    };
    utterance.onend = () => {
      setSpeechActive(false);
      if (voiceKey === 'directVoice') {
        if (liveVoiceRef.current) startVoiceListening();
        else setVoiceStatus('Réponse vocale terminée');
      } else setVoiceTestStatus('Lecture terminée');
    };
    utterance.onerror = () => {
      setSpeechActive(false);
      if (voiceKey === 'directVoice') setVoiceStatus('Lecture vocale indisponible');
      else setVoiceTestStatus('Lecture indisponible');
    };
    window.speechSynthesis.cancel();
    setSpeechActive(true);
    window.speechSynthesis.speak(utterance);
  }

  function startVoiceListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("La dictée vocale n'est pas disponible dans ce navigateur. Utilise Google Chrome et vérifie les autorisations du micro.");
      setVoiceStatus('Reconnaissance vocale indisponible');
      setLiveVoice(false);
      liveVoiceRef.current = false;
      return;
    }
    const recognition = new Recognition();
    const initialDraft = draft.trim();
    recognition.lang = settingsValues.language || 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results as ArrayLike<any>)
        .map((result: any) => result[0]?.transcript || '')
        .join(' ').trim();
      if (transcript) {
        setDraft([initialDraft, transcript].filter(Boolean).join(initialDraft ? ' ' : ''));
        setVoiceStatus('Texte reconnu — tu peux le modifier avant de l’envoyer');
      }
    };
    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? "Autorise l'accès au micro dans Chrome (icône à gauche de l'adresse)."
        : event.error === 'no-speech' ? "Je n'ai rien entendu. Réessaie en parlant près du micro."
        : event.error === 'audio-capture' ? "Aucun micro n'a été détecté sur cet appareil."
        : "La reconnaissance vocale a échoué. Réessaie.";
      setError(message);
      setVoiceStatus('Micro : ' + event.error);
      liveVoiceRef.current = false;
      setLiveVoice(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      liveVoiceRef.current = false;
      setLiveVoice(false);
      setVoiceStatus((current) => current === "J'écoute…" ? "Écoute terminée" : current);
    };
    recognitionRef.current = recognition;
    liveVoiceRef.current = true;
    setLiveVoice(true);
    try {
      recognition.start();
      setVoiceStatus("J'écoute… parle maintenant");
    } catch {
      recognitionRef.current = null;
      liveVoiceRef.current = false;
      setLiveVoice(false);
      setVoiceStatus('Micro indisponible');
      setError("Impossible de démarrer le micro. Vérifie qu'aucune autre application ne l'utilise.");
    }
  }

  function stopLiveVoice() {
    liveVoiceRef.current = false;
    setLiveVoice(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (voiceHeartbeatRef.current !== null) { window.clearInterval(voiceHeartbeatRef.current); voiceHeartbeatRef.current = null; }
    setVoiceStatus('Écoute arrêtée');
  }

  async function startLiveVoice() {
    setError('');
    if (!window.isSecureContext) {
      setError('Le micro nécessite une connexion sécurisée HTTPS.');
      setVoiceStatus('Connexion non sécurisée');
      return;
    }
    startVoiceListening();
  }

  async function addAttachments(fileList: FileList | null) {
    if (!fileList?.length) return;
    const next: HieraAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (attachments.length + next.length >= 5) { setError('Tu peux joindre jusqu’à 5 fichiers par message.'); break; }
      if (file.size > 10 * 1024 * 1024) { setError(`${file.name} dépasse la limite de 10 Mo.`); continue; }
      const id = crypto.randomUUID();
      try {
        if (file.type.startsWith('image/')) {
          if (attachments.filter((item) => item.dataUrl).length + next.filter((item) => item.dataUrl).length >= 3) { setError('Tu peux joindre jusqu’à 3 images par message.'); continue; }
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Images acceptées : JPG, PNG et WebP.'); continue; }
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
            reader.readAsDataURL(file);
          });
          next.push({ id, name: file.name, mimeType: file.type, size: file.size, dataUrl });
        } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          const buffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
          const pages: string[] = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pages.push(content.items.map((item: any) => 'str' in item ? item.str : '').join(' '));
          }
          next.push({ id, name: file.name, mimeType: 'application/pdf', size: file.size, text: pages.join('\n\n').slice(0, 50000), previewUrl: URL.createObjectURL(file) });
        } else if (/\.docx$/i.test(file.name)) {
          const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          next.push({ id, name: file.name, mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: file.size, text: result.value.slice(0, 50000) });
        } else if (/\.(xlsx|xls)$/i.test(file.name)) {
          const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
          const sheets = workbook.SheetNames.map((name) => `[Feuille : ${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`);
          next.push({ id, name: file.name, mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: file.size, text: sheets.join('\n\n').slice(0, 50000) });
        } else if (/\.pptx$/i.test(file.name)) {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort();
          const slides = await Promise.all(slideNames.map(async (name, index) => {
            const xml = await zip.files[name].async('text');
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            return `[Diapositive ${index + 1}] ${Array.from(doc.getElementsByTagNameNS("*", "t")).map((node) => node.textContent || "").join(" ")}`;
          }));
          next.push({ id, name: file.name, mimeType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: file.size, text: slides.join('\n\n').slice(0, 50000) });
        } else if (['text/plain', 'text/markdown', 'text/csv', 'application/json'].includes(file.type) || /\.(txt|md|csv|json)$/i.test(file.name)) {
          next.push({ id, name: file.name, mimeType: file.type || 'text/plain', size: file.size, text: (await file.text()).slice(0, 50000) });
        } else {
          setError(`Format non pris en charge : ${file.name}. Formats acceptés : PDF, DOCX, XLSX, XLS, PPTX, TXT, MD, CSV, JSON et images JPG/PNG/WebP.`);
        }
      } catch (err) {
        setError(`Impossible de lire ${file.name} : ${err instanceof Error ? err.message : "fichier invalide"}.`);
      }
    }
    if (next.length) { setAttachments((current) => [...current, ...next]); setError(''); }
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  function removeAttachment(id: string) {
    const item = attachments.find((entry) => entry.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (previewAttachment?.id === id) setPreviewAttachment(null);
    setAttachments((current) => current.filter((entry) => entry.id !== id));
  }

  async function sendText(content: string, fromVoice = false, includedAttachments: HieraAttachment[] = []) {
    const clean = content.trim() || (includedAttachments.length ? 'Analyse ces pièces jointes.' : '');
    // Intercepter le déclencheur dans le chemin commun (clavier, vocal et autres appels).
    // Les droits restent contrôlés par /api/admin/overview côté serveur.
    if (clean && isAdminTrigger(clean)) {
      setDraft(''); setAttachments([]);
      await openAdminPanel();
      return;
    }
    if (!clean || busyRef.current) return;
    const nextMessages: Message[] = [...messagesRef.current, { role: 'user', content: clean }];
    messagesRef.current = nextMessages;
    busyRef.current = true;
    setMessages(nextMessages);
    if (!privateMode) persistConversation(nextMessages);
    setDraft('');
    if (includedAttachments.length) { includedAttachments.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); }); setAttachments([]); setPreviewAttachment(null); }
    setError('');
    setBusy(true);
    setAnalyzing(includedAttachments.length > 0);
    if (fromVoice) setVoiceStatus('Hiera prépare sa réponse…');
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const response = await fetch('/api/chat', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'groq', model,
          language: settingsValues.language || 'fr',
          familySafeMode: settingsValues.familySafeMode !== false,
          assistantName: activeCompanion.id === 'hiera' ? (settingsValues.assistantName || 'Hiera') : activeCompanion.name,
          companionId: activeCompanion.id,
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
      if (!privateMode) persistConversation(updated);
      if (fromVoice || liveVoiceRef.current) {
        speakText(data.reply, 'directVoice');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Recherche arrêtée.');
      } else {
        setError(err instanceof Error ? err.message : 'Impossible de joindre Hiera.');
        if (liveVoiceRef.current) setVoiceStatus('Erreur de connexion');
      }
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setAnalyzing(false);
    }
  }

  function isAdminTrigger(value: string) {
    // Le clavier mobile peut retirer les underscores ou ajouter des espaces.
    // La phrase ne donne jamais les droits : l'API vérifie toujours la session et l'e-mail autorisé.
    const normalized = value.normalize('NFKC').toLocaleLowerCase('fr')
      .replace(/[\\s\\p{P}\\p{S}]/gu, '');
    return normalized === 'diamant09';
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAdminTrigger(draft)) {
      setDraft(''); setAttachments([]);
      await openAdminPanel();
      return;
    }
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

  function clearAllHistory() {
    if (busy) return;
    const confirmed = window.confirm("Supprimer définitivement toutes les conversations enregistrées, y compris les conversations archivées ? Cette action est irréversible.");
    if (!confirmed) return;
    setConversations([]);
    setMessages([]);
    messagesRef.current = [];
    setCurrentConversationId(crypto.randomUUID());
    setShowArchived(false);
    setError('');
    localStorage.removeItem('hiera-conversations');
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
          {authMode === 'login' && <button className="auth-forgot-button" type="button" onClick={requestPasswordReset} disabled={authBusy}>J’ai oublié mon mot de passe</button>}
          {authNotice && <p className="auth-form-hint" role="status">{authNotice}</p>}
          <div className="auth-divider"><span>ou</span></div>
          <div className="google-login auth-google-login" ref={googleButtonRef} />
          {!googleClientId && <p className="auth-form-hint">La connexion Google doit être configurée dans les variables Render.</p>}
          <p className="auth-switch">{authMode === 'register' ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }}>{authMode === 'register' ? 'Se connecter' : 'Créer un compte'}</button></p>
          <p className="auth-legal">Garde ton mot de passe confidentiel et ne le partage avec personne.</p>
        </section>
        <section className="public-seo-content" aria-labelledby="hiera-public-title">
          <p className="public-seo-eyebrow">ASSISTANT INTELLIGENT EN LIGNE</p>
          <h1 id="hiera-public-title">Hiera, votre assistant IA pour discuter, créer et apprendre</h1>
          <p className="public-seo-lead">Hiera est un assistant d’intelligence artificielle accessible en ligne. Posez vos questions, échangez avec un compagnon IA et avancez dans vos idées depuis une interface simple.</p>
          <div className="public-seo-grid">
            <article><span aria-hidden="true">✦</span><h2>Discutez avec une IA</h2><p>Obtenez de l’aide pour comprendre un sujet, réfléchir à un problème, trouver des idées ou organiser vos projets.</p></article>
            <article><span aria-hidden="true">🤖</span><h2>Choisissez votre compagnon</h2><p>Retrouvez Hiera, Willy, Nova, Pixel, Luna et Atlas, avec des rôles adaptés à différents sujets et usages.</p></article>
            <article><span aria-hidden="true">▤</span><h2>Travaillez avec vos fichiers</h2><p>Ajoutez des documents compatibles, comme des PDF, des fichiers Word ou Excel, pour en consulter le contenu avec l’assistant.</p></article>
            <article><span aria-hidden="true">✎</span><h2>Écrivez et apprenez</h2><p>Préparez et mettez en forme vos textes, demandez des explications et créez des questionnaires pour réviser un sujet.</p></article>
          </div>
          <p className="public-seo-footer">Découvrez Hiera et connectez-vous pour commencer une conversation.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <aside className="sidebar">
        <div className="sidebar-top"><button className="brand" onClick={() => setSidebarOpen((open) => !open)} aria-label="Rétracter ou afficher la barre latérale"><AtomLogo /><div><span>Hiera</span><small>Votre IA, toujours avec vous</small></div></button>
        <button className="new-chat" onClick={newConversation} disabled={busy}><span aria-hidden="true">＋</span> Nouvelle conversation</button></div>
        <div className="sidebar-navigation">
        <div className="sidebar-nav-group">
          <div className="side-label">ESPACE DE TRAVAIL</div>
          <nav className="sidebar-primary-nav" aria-label="Espace de travail">
            <button type="button" className={`side-link ${!settingsOpen && !learningOpen ? "active" : ""}`} onClick={() => { setSettingsOpen(false); setLearningOpen(false); }}><span>◉</span><b>Discuter</b></button>
          </nav>
        </div>
        <div className="sidebar-nav-group">
          <div className="side-label">PERSONNALISER</div>
          <nav className="sidebar-primary-nav" aria-label="Personnalisation">
            <button type="button" className={`side-link ${settingsOpen && settingsPage === "companion" ? "active" : ""}`} onClick={() => { setLearningOpen(false); setSettingsOpen(true); setSettingsPage("companion"); if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false); }}><span>✧</span><b>Compagnons</b></button>
            <button type="button" className={`side-link ${settingsOpen && settingsPage !== "companion" && settingsPage !== "history" ? "active" : ""}`} onClick={() => { setLearningOpen(false); setSettingsOpen(true); setSettingsPage("home"); if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false); }}><span>⚙</span><b>Paramètres</b></button>
          </nav>
        </div>
        <div className="sidebar-nav-group">
          <div className="side-label">BIBLIOTHÈQUE</div>
          <nav className="sidebar-primary-nav" aria-label="Bibliothèque">
            <button type="button" className={`side-link ${settingsOpen && settingsPage === "history" ? "active" : ""}`} onClick={() => { setLearningOpen(false); setSettingsOpen(true); setSettingsPage("history"); if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false); }}><span>▣</span><b>Historique</b></button>
          </nav>
        </div>
        {!privateMode && <><div className="history-heading">CONVERSATIONS</div><div className="conversation-history">{conversations.filter((item) => !!item.archived === showArchived).slice(0,12).map((item) => <div className="history-row" key={item.id}><button className="history-open" onClick={() => openConversation(item)} title={item.title}>{item.title}</button><button className="history-action" onClick={() => archiveConversation(item.id)} aria-label={item.archived ? "Désarchiver" : "Archiver"}>{item.archived ? "↩" : "▣"}</button></div>)}</div><button className="history-toggle" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Voir les conversations" : "Voir les archivées"}</button><button className="history-clear" onClick={clearAllHistory} disabled={busy || conversations.length === 0}>⌫ Supprimer tout l’historique</button></>}</div>
        <div className="sidebar-bottom"><div className="sidebar-account"><div className="account-status"><span className="status-dot" /> {googleUser ? "Google connecté" : "Compte non connecté"}</div><div className="account-provider"><span className="google-g">G</span><span>{googleUser ? googleUser.email : "Gérer dans Paramètres"}</span></div></div></div>
      </aside>
      {sidebarOpen && <button className="sidebar-dismiss-zone" onClick={() => setSidebarOpen(false)} aria-label="Rétracter la barre latérale" />}

      <section className="workspace" onClick={(event) => { if (sidebarOpen && event.target === event.currentTarget) setSidebarOpen(false); }}>
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Afficher ou masquer le menu"><AtomLogo /></button>
          <span className="topbar-title">{learningOpen ? "Apprendre avec Hiera" : settingsOpen ? (settingsTitles[settingsPage] || "Paramètres") : "Conversation"}</span>
          {!settingsOpen && !learningOpen && <label className="companion-picker"><span>Compagnon</span><select aria-label="Choisir un compagnon" value={activeCompanionId} onChange={(event) => setActiveCompanionId(event.target.value)}>{companions.map((item) => <option key={item.id} value={item.id}>{item.emoji} {item.name}</option>)}</select></label>}
          {isAdmin && <button type="button" className="admin-open-button" onClick={openAdminPanel} disabled={adminLoading}>{adminLoading ? 'Chargement…' : '◆ Hiera Control'}</button>}
          {googleUser && <span className={`plan-badge plan-${tokenUsage?.plan || 'basic'}`} title="Forfait associé à ton compte">{({ basic: 'Basic', plus: 'Plus', pro: 'Pro', ultimate: 'Ultime' } as Record<string, string>)[tokenUsage?.plan || 'basic'] || 'Basic'}</span>}
          <button type="button" className={`private-toggle ${privateMode ? 'active' : ''}`} onClick={togglePrivateMode} title={privateMode ? 'Quitter la navigation privée' : 'Activer la navigation privée'} aria-pressed={privateMode}>{privateMode ? '◉ Privé' : '◌ Privé'}</button>
          <button type="button" className="fullscreen-toggle" onClick={toggleFullscreen} aria-label={isFullscreen ? "Quitter le plein écran" : "Passer en plein écran"} title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}>{isFullscreen ? "⤢" : "⛶"}<span>{isFullscreen ? "Quitter" : "Plein écran"}</span></button>
        </header>

        <div className="workspace-content">
        {adminPanel && adminData && <div className="admin-overlay" role="dialog" aria-modal="true" aria-label="Hiera Control">
          <section className="admin-panel">
            <header className="admin-panel-header"><div><span className="admin-kicker">ESPACE ADMINISTRATEUR</span><h2>Hiera Control</h2><small>Connecté : {adminData.email} · Actualisation automatique</small></div><button type="button" onClick={() => setAdminPanel(false)} aria-label="Fermer Hiera Control">×</button></header>
            <div className="admin-stats"><article><span>Comptes</span><strong>{adminData.stats.emailAccounts}</strong></article><article><span>Actifs (30 j)</span><strong>{adminData.stats.activeUsageProfiles30d}</strong></article><article><span>Demandes oubli</span><strong>{(adminData.resetRequests || []).length}</strong></article></div>
            <div className="admin-tools-row"><span>Actualisation silencieuse : 1 seconde</span><button type="button" onClick={enableAdminNotifications}>{adminNotificationsEnabled ? '✓ Notifications activées' : 'Activer les notifications'}</button></div>
            {adminActionStatus && <p className="admin-action-status" role="status">{adminActionStatus}</p>}
            <section className="admin-section"><h3>Comptes Hiera</h3><div className="admin-user-list">
              {(adminData.users || []).map((item: any) => <article className={item.safetyFlagCount > 0 ? 'admin-user-row admin-user-alert' : 'admin-user-row'} key={item.userId}>
                <div className="admin-user-identity"><strong>{item.name || 'Sans nom'} {item.safetyFlagCount > 0 && <span className="admin-alert-pill">À vérifier · {item.safetyFlagCount}</span>}</strong><small>{item.email}</small><time>Activité : {item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString('fr-FR') : 'Non disponible'}</time></div>
                <div className="admin-user-controls"><select aria-label={'Forfait de ' + item.email} value={item.plan || 'basic'} onChange={(event) => updateAdminAccount(item.userId, { plan: event.target.value })}><option value="basic">Basic</option><option value="plus">Plus</option><option value="pro">Pro</option><option value="ultimate">Ultime</option></select>
                  <button type="button" className="admin-help-button" onClick={() => item.helpStatus === 'approved' ? openSharedHelp(Number(item.helpRequestId)) : requestHelpAccess(item.userId)} disabled={item.helpStatus === 'pending'}>{item.helpStatus === 'pending' ? 'Demande envoyée' : item.helpStatus === 'approved' ? 'Voir l’aide' : 'Aide'}</button>
                  <button type="button" className={item.banned ? 'admin-reactivate' : 'admin-ban'} onClick={() => updateAdminAccount(item.userId, { banned: !item.banned })}>{item.banned ? 'Réactiver' : 'Suspendre'}</button><span className={item.banned ? 'admin-status-banned' : 'admin-status-active'}>{item.banned ? 'Suspendu' : 'Actif'}</span></div>
              </article>)}
              {!(adminData.users || []).length && <p>Aucun compte enregistré pour le moment.</p>}
            </div></section>
            <section className="admin-section"><h3>Alertes de sécurité à vérifier</h3>
              {(adminData.safetyFlags || []).length ? <div className="admin-reset-list">{adminData.safetyFlags.map((item: any) => <article key={item.id}><div><strong>{item.email}</strong><time>{({menace_directe:'Menace directe',harcelement_cible:'Harcèlement ciblé',donnees_sensibles:'Demande de données sensibles',menace_cyber:'Menace de cyberattaque'} as Record<string,string>)[item.category] || 'Signal à vérifier'} · {new Date(item.createdAt).toLocaleString('fr-FR')}</time><small>Hiera n’a conservé ni le message ni la conversation. Vérifie le contexte avant toute décision.</small></div><button type="button" onClick={() => reviewSafetyFlag(Number(item.id))}>Marquer vérifié</button></article>)}</div> : <p>Aucune alerte en attente.</p>}
            </section>
            <section className="admin-section"><h3>Demandes « mot de passe oublié »</h3>
              {(adminData.resetRequests || []).length ? <div className="admin-reset-list">{adminData.resetRequests.map((item: any) => <article key={item.id}><div><strong>{item.email}</strong><time>{new Date(item.requested_at).toLocaleString('fr-FR')}</time></div><button type="button" onClick={() => resolveResetRequest(Number(item.id))}>Marquer comme traitée</button></article>)}</div> : <p>Aucune demande en attente.</p>}
            </section>
            <section className="admin-section"><h3>Répartition des forfaits</h3>{adminData.stats.planBreakdown.length ? <div className="admin-plan-list">{adminData.stats.planBreakdown.map((item: any) => <div key={item.plan}><span>{({basic:'Basic',plus:'Plus',pro:'Pro',ultimate:'Ultime'} as Record<string,string>)[item.plan] || item.plan}</span><b>{item.users} compte(s)</b><small>{Number(item.tokens).toLocaleString('fr-FR')} jetons cumulés</small></div>)}</div> : <p>Aucune donnée de forfait disponible.</p>}</section>
            <footer className="admin-panel-footer"><span>Les conversations et mots de passe ne sont pas accessibles ici.</span><button type="button" onClick={() => void refreshAdminData(true)} disabled={adminLoading}>↻ Actualiser</button></footer>
          </section>
        </div>}

        {pendingHelpRequest && <div className="help-consent-overlay" role="dialog" aria-modal="true" aria-label="Demande d’aide Hiera"><section className="help-consent-card"><span className="admin-kicker">DEMANDE D’AIDE</span><h2>Un administrateur souhaite t’aider</h2><p>Autorises-tu une consultation unique de ton adresse e-mail et des 30 derniers messages visibles de cette conversation ? Les pièces jointes et les autres conversations ne seront pas partagées.{privateMode ? ' Le mode privé est actif : aucun message ne sera transmis.' : ''}</p><p className="help-consent-expiry">Cette demande expire automatiquement. Tu peux refuser sans conséquence sur ton compte.</p><div><button type="button" className="admin-reactivate" disabled={helpConsentBusy} onClick={() => void respondToHelpRequest(false)}>Refuser</button><button type="button" className="admin-help-button" disabled={helpConsentBusy} onClick={() => void respondToHelpRequest(true)}>{helpConsentBusy ? 'Envoi…' : 'Autoriser une fois'}</button></div></section></div>}
        {sharedHelp && <div className="help-consent-overlay" role="dialog" aria-modal="true" aria-label="Session d’aide autorisée"><section className="help-consent-card shared-help-card"><span className="admin-kicker">ACCÈS AUTORISÉ UNE FOIS</span><h2>Session d’aide · {sharedHelp.email}</h2><p>Seule la conversation choisie par l’utilisateur est visible. Ferme la session après consultation.</p><div className="shared-help-messages">{sharedHelp.messages.map((item: any, index: number) => <article key={index}><b>{item.role === 'user' ? 'Utilisateur' : 'Hiera'}</b><p>{item.content}</p></article>)}</div><button type="button" className="admin-ban" onClick={() => void closeSharedHelp()}>Fermer et supprimer l’accès</button></section></div>}

        {learningOpen ? (
          <section className="settings-page learning-page page-surface">
            <p className="eyebrow">ESPACE PÉDAGOGIQUE</p><h1>Apprendre avec Hiera</h1>
            <p className="settings-intro">Entraîne-toi à ton rythme, vérifie ce que tu as compris et découvre de nouveaux sujets.</p>
            <div className="learning-layout">
              <section className="settings-feature-card learning-create-card"><span className="learning-icon">✦</span><strong>Créer un questionnaire personnalisé</strong><p>Choisis un sujet : Hiera préparera un petit quiz, puis pourra corriger tes réponses et t’expliquer les notions.</p>
                <form onSubmit={(event) => { event.preventDefault(); const topic = learningTopic.trim(); if (!topic || busy) return; setLearningOpen(false); void sendText('Crée-moi un questionnaire de 5 questions sur « ' + topic + ' ». Présente les questions une par une avec des choix A, B, C et D. Attends mes réponses avant de donner la correction, puis explique simplement mes erreurs.'); }}>
                  <input className="settings-select" value={learningTopic} onChange={(event) => setLearningTopic(event.target.value)} placeholder="Ex. : l’Empire romain, les fractions, les volcans…" maxLength={120} />
                  <button className="settings-primary-button" type="submit" disabled={!learningTopic.trim() || busy}>✧ Demander un quiz à Hiera</button>
                </form>
              </section>
              <section className="settings-feature-card learning-checklist-card"><strong>Mon parcours d’apprentissage</strong><p>Coche les étapes au fur et à mesure. Ta progression est enregistrée sur cet appareil.</p>
                <div className="learning-progress"><span style={{ width: String(Math.round(learningChecklist.length / learningSteps.length * 100)) + '%' }} /></div><small>{learningChecklist.length} étape(s) sur {learningSteps.length} terminée(s)</small>
                {learningSteps.map((step) => <label className="learning-check-row" key={step}><input type="checkbox" checked={learningChecklist.includes(step)} onChange={(event) => setLearningChecklist((current) => event.target.checked ? [...current, step] : current.filter((item) => item !== step))} /><span>{step}</span></label>)}
                <button className="settings-text-link" type="button" onClick={() => setLearningChecklist([])}>Réinitialiser ma progression</button>
              </section>
            </div>
            <section className="settings-feature-card learning-demo-card"><div className="learning-demo-heading"><div><span className="eyebrow">POUR COMMENCER</span><strong>Mini-quiz de découverte</strong><p>Trois questions pour essayer le questionnaire.</p></div><span className="learning-quiz-count">3 questions</span></div>
              {demoQuiz.map((question, index) => <fieldset className="learning-question" key={question.id} disabled={quizSubmitted}><legend>{index + 1}. {question.question}</legend>
                {question.options.map((option) => <label className={quizSubmitted && option === question.answer ? 'learning-option learning-option-correct' : 'learning-option'} key={option}><input type="radio" name={question.id} value={option} checked={quizAnswers[question.id] === option} onChange={() => setQuizAnswers((current) => ({ ...current, [question.id]: option }))} />{option}</label>)}
                {quizSubmitted && <p className="learning-feedback">{quizAnswers[question.id] === question.answer ? '✓ Bonne réponse. ' : 'Réponse attendue : ' + question.answer + '. '}{question.explanation}</p>}
              </fieldset>)}
              {!quizSubmitted ? <button className="settings-primary-button" type="button" disabled={Object.keys(quizAnswers).length !== demoQuiz.length} onClick={() => setQuizSubmitted(true)}>Corriger mes réponses</button> : <div className="learning-result"><strong>Ton résultat : {quizScore} / {demoQuiz.length}</strong><p>{quizScore === demoQuiz.length ? 'Excellent travail !' : 'Bien joué, relis les explications et réessaie pour progresser.'}</p><button className="settings-primary-button" type="button" onClick={() => { setQuizAnswers({}); setQuizSubmitted(false); }}>Recommencer le quiz</button></div>}
            </section>
          </section>
        ) : settingsOpen ? (
          <section className="settings-page settings-redesign page-surface">
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
               {billingSelection && <div className="billing-checkout-panel"><div><span className="billing-checkout-kicker">FORFAIT SÉLECTIONNÉ</span><strong>{billingSelection.name}</strong><b>{billingSelection.price}</b></div><p>Les forfaits de test sont attribués directement par l’administrateur dans Hiera Control. Aucun code à six chiffres n’est nécessaire. Les paiements ne sont pas encore activés.</p><button className="billing-select-button" type="button" onClick={() => setBillingSelection(null)}>Fermer</button></div>}
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
            {settingsPage === 'companion' && <div className="settings-detail"><div className="settings-feature-card"><strong>Choisir un compagnon</strong><p>Sélectionne un compagnon pour tes prochaines réponses. Chacun possède une spécialité et un style de discussion, mais tous utilisent le même service d’intelligence artificielle.</p><div className="companions-grid">{companions.map((item) => <button type="button" key={item.id} className={`companion-card ${activeCompanionId === item.id ? 'selected' : ''}`} onClick={() => setActiveCompanionId(item.id)}><CompanionBust id={item.id} name={item.name} /><strong>{item.name}</strong><small>{item.role}</small><p>{item.description}</p><span className="companion-select-label">{activeCompanionId === item.id ? '✓ Sélectionné' : 'Choisir'}</span></button>)}</div><small>Le choix est enregistré sur cet appareil. Il s’applique aux nouveaux messages.</small></div></div>}

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
            <div className="chat-layout"><div className="chat-column">
            <div className="conversation">
              {privateMode && <div className="private-notice">◉ Navigation privée activée · Cette conversation ne sera pas enregistrée dans ton historique.</div>}
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              {!googleClientId && <p className="auth-hint">Connexion Google : configuration à terminer sur Render.</p>}
              {messages.length === 0 && <div className="welcome compact-welcome"><div className="atom" aria-hidden="true"><span className="orbit"/><span className="orbit orbit-two"/><span className="orbit orbit-three"/><span className="nucleus"/></div><h1>{activeCompanion.name}</h1><p className="subtitle">{activeCompanion.description}</p><div className="quick-prompts"><button type="button" onClick={() => setDraft('Aide-moi à organiser ma journée.')}><span>✦</span>Organiser ma journée</button><button type="button" onClick={() => setDraft('Explique-moi un sujet simplement.')}><span>◈</span>Apprendre quelque chose</button><button type="button" onClick={() => setDraft('Aide-moi à trouver une idée créative.')}><span>✧</span>Trouver une idée</button><button type="button" onClick={() => setDraft('Aide-moi à résoudre un problème.')}><span>⌘</span>Résoudre un problème</button></div></div>}
              <div className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={index}>
                    {message.role === 'assistant' && <span className="message-mark">{activeCompanion.emoji}</span>}
                    <div className="message-body">
                      <FormattedMessage content={message.content} />
                      {message.role === 'assistant' && <div className="message-actions"><button className="copy-message" type="button" onClick={() => copyMessage(message.content, index)} aria-label="Copier la réponse" title="Copier la réponse">{copiedMessageIndex === index ? '✓ Copié' : '⧉ Copier'}</button><button className="copy-message" type="button" onClick={() => speakText(message.content, 'readVoice')} aria-label="Lire la réponse à haute voix" title="Lire à haute voix">♫ Lire</button><button className="copy-message" type="button" onClick={() => openWritingEditor(message.content)}>✎ Modifier</button></div>}
                    </div>
                  </article>
                ))}
                {busy && <article className="message assistant"><span className="message-mark">{activeCompanion.emoji}</span><p className="typing">{activeCompanion.name} réfléchit…</p></article>}
              </div>
            </div>
            <form className="composer" onSubmit={sendMessage}>
              <input ref={attachmentInputRef} className="attachment-input" type="file" accept=".pdf,.docx,.xlsx,.xls,.pptx,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json" multiple onChange={(event) => { void addAttachments(event.target.files); event.currentTarget.value = ''; }} />
              <input ref={photoInputRef} className="attachment-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addAttachments(event.target.files); event.currentTarget.value = ''; }} />
              {attachments.length > 0 && <div className="attachment-list">{attachments.map((item) => <div className="attachment-chip" key={item.id}>{item.dataUrl ? <img src={item.dataUrl} alt={item.name} /> : <button type="button" className="attachment-open" onClick={() => setPreviewAttachment(item)} title={`Ouvrir ${item.name}`}><span className="attachment-file-icon">▤</span><span title={item.name}>{item.name}</span></button>}<button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Retirer ${item.name}`}>×</button></div>)}</div>}
              <div className="composer-companion-stage"><Companion3D id={activeCompanion.id} name={activeCompanion.name} activity={speechActive ? 'speaking' : liveVoice ? 'listening' : analyzing ? 'analyzing' : busy ? 'thinking' : draft.trim() ? 'typing' : 'idle'} /></div>
              <div className="composer-input-row">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { const enterBehavior = settingsValues.enterBehavior || (settingsValues.enterToSend === false ? 'newline' : 'send'); if (event.key === "Enter" && !event.shiftKey && enterBehavior === 'send') { event.preventDefault(); (event.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }} placeholder={`Écris un message à ${activeCompanion.name}…`} rows={1} aria-label="Message à Hiera" disabled={busy} />
                <div className="composer-actions">{busy && <button type="button" className="copy-message stop-generation" onClick={stopGeneration}>■ Arrêter Hiera</button>}{speechActive && <button type="button" className="copy-message stop-generation" onClick={stopSpeech}>■ Arrêter le vocal</button>}<div className="attachment-menu-wrap" ref={attachmentMenuWrapRef}><button type="button" className="attach-toggle" onClick={toggleAttachmentMenu} disabled={busy} aria-label="Ouvrir les pièces jointes" aria-expanded={attachmentMenuOpen} title="Ajouter une pièce jointe">＋</button>{attachmentMenuOpen && <div className="attachment-menu" role="menu" style={{ left: attachmentMenuPosition.left, top: attachmentMenuPosition.top }}><button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); photoInputRef.current?.click(); }}><span className="attachment-menu-icon">▧</span><span><strong>Photo</strong><small>JPG, PNG, WebP</small></span></button><button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); attachmentInputRef.current?.click(); }}><span className="attachment-menu-icon">▤</span><span><strong>Fichier</strong><small>PDF, Word, Excel, PowerPoint, TXT…</small></span></button></div>}</div><button type="button" className={liveVoice ? 'voice-toggle active' : 'voice-toggle'} onClick={liveVoice ? stopLiveVoice : startLiveVoice} aria-label={liveVoice ? 'Arrêter la conversation vocale' : 'Démarrer la conversation vocale'}>{liveVoice ? '■' : <svg className="voice-mic-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10.5v1.5a7 7 0 0 0 14 0v-1.5M12 19v3M8 22h8"/></svg>}</button><button type="submit" disabled={(!draft.trim() && !attachments.length) || busy} aria-label="Envoyer le message">{busy ? '…' : '↑'}</button></div>
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              {voiceStatus !== 'Mode vocal désactivé' && <p className="voice-status" role="status">{voiceStatus}{liveVoice && <> · <button type="button" onClick={stopLiveVoice}>Arrêter</button></>}</p>}

            </form>
            {previewAttachment && <div className="document-overlay" role="dialog" aria-modal="true" aria-label={`Aperçu de ${previewAttachment.name}`}><section className="document-panel"><header className="document-header"><div><strong>{previewAttachment.name}</strong><small>{previewAttachment.mimeType === 'application/pdf' ? 'Lecteur PDF' : 'Aperçu du contenu extrait'}</small></div><button type="button" onClick={() => setPreviewAttachment(null)} aria-label="Fermer l’aperçu">×</button></header>{previewAttachment.previewUrl ? <iframe className="pdf-viewer" src={previewAttachment.previewUrl} title={previewAttachment.name} /> : <pre className="document-text">{previewAttachment.text || 'Aucun texte lisible trouvé dans ce fichier.'}</pre>}</section></div>}
            <p className="disclaimer">Ne partage jamais de données personnelles ou confidentielles dans une conversation.</p>
            </div></div>
            {writingOpen && <div className="writing-overlay" role="dialog" aria-modal="true" aria-label="Espace d’écriture"><section className="writing-panel"><header className="writing-header"><div><strong>Espace d’écriture</strong><small>Modifie et mets en forme ton texte</small></div><button type="button" onClick={() => setWritingOpen(false)} aria-label="Fermer l’espace d’écriture">×</button></header><div className="writing-toolbar"><button type="button" onClick={() => formatWriting('bold')}><b>G</b></button><button type="button" onClick={() => formatWriting('italic')}><i>I</i></button><button type="button" onClick={() => formatWriting('underline')}><u>S</u></button><button type="button" onClick={() => formatWriting('hiliteColor','#fff29a')} title="Surligner">🖍</button><button type="button" onClick={() => formatWriting('insertParagraph')} title="Nouveau paragraphe">¶</button><select aria-label="Police" defaultValue="Arial" onChange={(e) => formatWriting('fontName',e.target.value)}><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option><option value="Times New Roman">Times New Roman</option><option value="Courier New">Courier New</option><option value="Trebuchet MS">Trebuchet MS</option></select><select aria-label="Taille du texte" defaultValue="3" onChange={(e) => formatWriting('fontSize',e.target.value)}><option value="2">Petit</option><option value="3">Normal</option><option value="4">Grand</option><option value="5">Très grand</option><option value="6">Titre</option></select></div><div ref={writingEditorRef} className="writing-editable" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder="Écris ou colle ton texte ici…" /><footer className="writing-footer"><button type="button" onClick={copyWriting}>⧉ Copier le texte</button><button type="button" onClick={() => { setDraft(writingEditorRef.current?.innerText || ''); setWritingOpen(false); }}>Utiliser dans le message</button><button type="button" onClick={() => setWritingOpen(false)}>Terminer</button></footer></section></div>}
          </>
        )}
        </div>
      </section>
    </main>
  );
}
