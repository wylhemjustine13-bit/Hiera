import { useState } from 'react';

type Message = { role: 'assistant' | 'user'; content: string };

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Bonjour. Je suis Hiera. Mon espace est prêt : nous pourrons bientôt connecter le modèle IA de ton choix.' },
  ]);
  const [draft, setDraft] = useState('');

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setMessages((current) => [...current, { role: 'user', content }]);
    setDraft('');
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✳</span><span>hiera</span></div>
        <button className="new-chat" onClick={() => setMessages([{ role: 'assistant', content: 'Nouvelle conversation. Que souhaites-tu explorer ?' }])}>＋ Nouvelle conversation</button>
        <div className="side-label">ESPACE</div>
        <div className="side-link active"><span>◉</span> Conversation</div>
        <div className="side-link"><span>◇</span> Bibliothèque <small>Bientôt</small></div>
        <div className="side-link"><span>⚙</span> Paramètres <small>Bientôt</small></div>
        <div className="sidebar-bottom"><span className="status-dot" /> Projet indépendant <span className="version">0.1.0</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="mobile-brand">✳ hiera</div><span className="model-pill"><span className="status-dot" /> Espace de discussion</span><button className="avatar" aria-label="Profil">H</button></header>
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
          </div>
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Écris un message à Hiera…" rows={1} aria-label="Message à Hiera" />
          <div className="composer-footer"><span>Hiera est en préparation · Les réponses IA seront connectées ensuite</span><button type="submit" disabled={!draft.trim()} aria-label="Envoyer le message">↑</button></div>
        </form>
        <p className="disclaimer">Prototype d'interface — aucune réponse IA n'est simulée ou présentée comme réelle.</p>
      </section>
    </main>
  );
}