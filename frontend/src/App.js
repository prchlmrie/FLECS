import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import POS from './components/POS';
import Restocking from './components/Restocking';
import Reports from './components/Reports';
import Settings from './components/Settings';
import SupplierDashboard from './components/SupplierDashboard';
import Layout from './components/Layout';
import { clearAuthSession, persistSession, readStoredSession } from './authSession';
import './App.css';

/** Return the default landing path for a given role */
function defaultPathForRole(role) {
  if (role === 'supplier') return '/supplier-dashboard';
  return '/dashboard';
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token, user: storedUser } = readStoredSession();
    if (token && storedUser) setUser(storedUser);
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
        {/* Login page */}
        <Route
          path="/login"
          element={
            user
              ? <Navigate to={defaultPathForRole(user.role)} />
              : <Login onLogin={handleLogin} />
          }
        />

        {/* All authenticated routes */}
        <Route
          path="/*"
          element={
            user ? (
              <Layout user={user} onLogout={handleLogout}>
                <Routes>
                  {/* ── Supplier-only routes ── */}
                  {user.role === 'supplier' && (
                    <>
                      <Route path="/supplier-dashboard" element={<SupplierDashboard user={user} />} />
                      <Route path="/" element={<Navigate to="/supplier-dashboard" />} />
                      {/* Catch-all for supplier: redirect to their dashboard */}
                      <Route path="*" element={<Navigate to="/supplier-dashboard" />} />
                    </>
                  )}

                  {/* ── Admin + Owner routes ── */}
                  {(user.role === 'administrator' || user.role === 'owner') && (
                    <>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/inventory" element={<Inventory user={user} />} />
                      <Route path="/pos" element={<POS />} />
                      <Route path="/restocking" element={<Restocking />} />
                      <Route path="/" element={<Navigate to="/dashboard" />} />

                      {/* Admin-only routes */}
                      {user.role === 'administrator' && (
                        <>
                          <Route path="/reports" element={<Reports user={user} />} />
                          <Route path="/settings" element={<Settings user={user} />} />
                        </>
                      )}

                      {/* Redirect non-admin trying to access admin pages */}
                      {user.role === 'owner' && (
                        <>
                          <Route path="/reports" element={<Navigate to="/dashboard" />} />
                          <Route path="/settings" element={<Navigate to="/dashboard" />} />
                        </>
                      )}

                      <Route path="*" element={<Navigate to="/dashboard" />} />
                    </>
                  )}
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
