import React, { useState } from 'react';
import api from '../api'; // Your existing Axios/Fetch wrapper
import './Inventory.css'; // Or a dedicated CSS file

const InventoryAssistant = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        // Add user message to UI
        const newMessages = [...messages, { role: 'user', text: input }];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            // Hit your new Flask endpoint
            const response = await api.chatInventory(input.trim());
            
            // Add bot response to UI
            setMessages([...newMessages, { role: 'bot', text: response.data.reply }]);
        } catch (error) {
            console.error("Chat error:", error);
            setMessages([...newMessages, { role: 'bot', text: "Error connecting to backend." }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="chat-container">
            <div className="chat-history">
                {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`}>
                        {msg.text}
                    </div>
                ))}
                {isLoading && <div className="message bot typing">Checking inventory...</div>}
            </div>
            
            <form onSubmit={handleSendMessage} className="chat-input-form">
                <input 
                    type="text" 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder="E.g., Kailan dapat bumili ng Milo?" 
                />
                <button type="submit" disabled={isLoading}>Send</button>
            </form>
        </div>
    );
};

export default InventoryAssistant;