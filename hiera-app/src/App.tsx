import { useState } from 'react';

type Message = { role: 'assistant' | 'user'; content: string };
const initialMessage: Message = {
  role: 'assistant',
  content: "Bonjour. Je suis Hiera. Je suis maintenant reliée au service IA lorsque le serveur et sa clé API sont configurés. Que souhaites-tu me demander ?",
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        <div className="brand"><span className="brand-mark">✳</span><span>hiera</span></div>
        <button className="new-chat" onClick={newConversation} disabled={busy}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <div className="side-link active"><span>◉</span> Conversation</div>
        <div className="side-link"><span>◇</span> Bibliothèque <small>Bientôt</small></div>
        <div className="side-link"><span>⚙</span> Paramètres <small>Bientôt</small></div>
        <div className="sidebar-bottom"><span className="status-dot" /> Projet indépendant <span className="version">0.2.0</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">✳ hiera</div>
          <label className="model-select-label" htmlFor="model-select">Modèle</label>
          <select id="model-select" className="model-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
            <option value="gpt-4.1-mini">GPT-4.1 mini</option>
            <option value="gpt-4.1">GPT-4.1</option>
          </select>
          <span className="model-pill"><span className="status-dot" /> OpenAI</span>
          <button className="avatar" aria-label="Hiera">H</button>
        </header>
        <div className="conversation">
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
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Écris un message à Hiera…" rows={1} aria-label="Message à Hiera" disabled={busy} />
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="composer-footer"><span>Les réponses sont générées par le modèle OpenAI sélectionné.</span><button type="submit" disabled={!draft.trim() || busy} aria-label="Envoyer le message">{busy ? '…' : '↑'}</button></div>
        </form>
        <p className="disclaimer">Ne partage jamais de données personnelles ou confidentielles dans une conversation.</p>
      </section>
    </main>
  );
}