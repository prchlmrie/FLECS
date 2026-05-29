import React, { useState } from 'react';
import api from '../api';
import './Inventory.css';

const InventoryChat = () => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      sender: 'bot',
      text: 'Hello! Ask me about your stock (e.g., "Kailan dapat bumili ng Milo?")',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setMessages((prev) => [...prev, { sender: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.chatInventory(userMsg);
      setMessages((prev) => [...prev, { sender: 'bot', text: res.data.reply }]);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        (err.response?.status === 503
          ? 'AI assistant is not configured on the server (missing OPENROUTER_API_KEY).'
          : 'Error connecting to server.');
      setMessages((prev) => [...prev, { sender: 'bot', text: msg }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="inventory-chat-fab"
        onClick={() => setOpen(true)}
        aria-label="Open inventory assistant"
      >
        Ask AI
      </button>
    );
  }

  return (
    <div className="inventory-chat-widget" aria-label="FLECS inventory assistant">
      <div className="inventory-chat-header">
        <span>FLECS Inventory Assistant</span>
        <button
          type="button"
          className="inventory-chat-close"
          onClick={() => setOpen(false)}
          aria-label="Minimize assistant"
        >
          ×
        </button>
      </div>
      <div className="inventory-chat-messages">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`inventory-chat-bubble inventory-chat-bubble-${m.sender}`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="inventory-chat-bubble inventory-chat-bubble-bot">
            Checking inventory…
          </div>
        )}
      </div>
      <form onSubmit={handleSend} className="inventory-chat-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="inventory-chat-input"
          placeholder="Ask something…"
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};

export default InventoryChat;
