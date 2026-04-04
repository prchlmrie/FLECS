import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import POS from './components/POS';
import Restocking from './components/Restocking';
import Reports from './components/Reports';
import Settings from './components/Settings';
import Layout from './components/Layout';
import { clearAuthSession, persistSession, readStoredSession } from './authSession';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token, user: storedUser } = readStoredSession();
    if (token && storedUser) {
      setUser(storedUser);
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData, token) => {
    persistSession(userData, token);
    setUser(userData);
  };

  const handleLogout = () => {
    clearAuthSession();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading FLECS...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={
            user ? <Navigate to="/dashboard" /> : <Login onLogin={handleLogin} />
          } 
        />
        
        <Route
          path="/*"
          element={
            user ? (
              <Layout user={user} onLogout={handleLogout}>
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/inventory" element={<Inventory user={user} />} />
                  <Route path="/pos" element={<POS />} />
                  <Route path="/restocking" element={<Restocking />} />
                  <Route path="/reports" element={<Reports user={user} />} />
                  <Route path="/settings" element={<Settings user={user} />} />
                  <Route path="/" element={<Navigate to="/dashboard" />} />
                </Routes>
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
