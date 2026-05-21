import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import './Messages.css';

function Messages({ user, onClose, onUnreadChange }) {
  const [contacts, setContacts]   = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages]   = useState([]);
  const [draft, setDraft]         = useState('');
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const bottomRef = useRef(null);

  const loadContacts = useCallback(async () => {
    try {
      const res = await api.getMessageContacts();
      setContacts(res.data);
      if (res.data.length > 0 && !activeContact) {
        setActiveContact(res.data[0]);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [activeContact]);

  const loadMessages = useCallback(async () => {
    if (!activeContact) return;
    try {
      const res = await api.getMessages(activeContact.user_id);
      setMessages(res.data);
      // Refresh unread count in parent
      const uc = await api.getUnreadMessageCount();
      onUnreadChange && onUnreadChange(uc.data.unread_count);
    } catch (e) { console.error(e); }
  }, [activeContact, onUnreadChange]);

  useEffect(() => { loadContacts(); }, []);
  useEffect(() => { loadMessages(); }, [activeContact]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Poll for new messages every 10s while open
  useEffect(() => {
    const t = setInterval(loadMessages, 10000);
    return () => clearInterval(t);
  }, [loadMessages]);

  const handleSend = async () => {
    if (!draft.trim() || !activeContact) return;
    setSending(true);
    try {
      await api.sendMessage({ recipient_id: activeContact.user_id, content: draft.trim() });
      setDraft('');
      await loadMessages();
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="msg-overlay" onClick={onClose}>
      <div className="msg-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="msg-header">
          <div className="msg-header-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Messages
          </div>
          <button className="msg-close" onClick={onClose}>×</button>
        </div>

        <div className="msg-body">
          {/* Contacts list */}
          <div className="msg-contacts">
            {loading ? (
              <div className="msg-loading">Loading…</div>
            ) : contacts.length === 0 ? (
              <div className="msg-empty-contacts">
                <p>No contacts yet.</p>
                <small>
                  {user.role === 'supplier'
                    ? 'Contacts appear once owners send you stock requests.'
                    : 'Contacts appear once you send a stock request to a supplier.'}
                </small>
              </div>
            ) : (
              contacts.map(c => (
                <button
                  key={c.user_id}
                  className={`msg-contact ${activeContact?.user_id === c.user_id ? 'active' : ''}`}
                  onClick={() => setActiveContact(c)}
                >
                  <div className="msg-contact-avatar">{(c.display_name || c.username).charAt(0).toUpperCase()}</div>
                  <div className="msg-contact-info">
                    <div className="msg-contact-name">{c.display_name || c.username}</div>
                    <div className="msg-contact-role">{c.role}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Chat area */}
          <div className="msg-chat">
            {!activeContact ? (
              <div className="msg-no-chat">Select a contact to start chatting</div>
            ) : (
              <>
                <div className="msg-chat-header">
                  <div className="msg-contact-avatar sm">{(activeContact.display_name || activeContact.username).charAt(0).toUpperCase()}</div>
                  <div>
                    <div className="msg-contact-name">{activeContact.display_name || activeContact.username}</div>
                    <div className="msg-contact-role">{activeContact.role}</div>
                  </div>
                </div>

                <div className="msg-messages">
                  {messages.length === 0 && (
                    <div className="msg-no-msgs">No messages yet. Say hello! 👋</div>
                  )}
                  {messages.map(m => {
                    const isMine = m.sender_id !== activeContact.user_id;
                    return (
                      <div key={m.message_id} className={`msg-bubble-wrap ${isMine ? 'mine' : 'theirs'}`}>
                        <div className={`msg-bubble ${isMine ? 'mine' : 'theirs'}`}>
                          {m.content}
                        </div>
                        <div className="msg-time">{formatTime(m.created_at)}</div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                <div className="msg-input-row">
                  <textarea
                    className="msg-input"
                    rows={1}
                    placeholder="Type a message… (Enter to send)"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={handleKey}
                  />
                  <button className="msg-send-btn" onClick={handleSend} disabled={sending || !draft.trim()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Messages;
