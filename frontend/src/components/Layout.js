import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Messages from './Messages';
import api from '../api';
import './Layout.css';

const ROLE_LABELS = { administrator: 'Administrator', owner: 'Store Owner', supplier: 'Supplier' };

const ADMIN_NAV = [
  { name: 'Dashboard', path: '/dashboard', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
  { name: 'Inventory', path: '/inventory', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-9M14 17h6M9 7H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5"/><path d="M3 7l9-4 9 4M12 3v18"/></svg> },
  { name: 'Point of Sale', path: '/pos', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2v4M7 2v4M2 10h20"/></svg> },
  { name: 'Restocking', path: '/restocking', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
  { name: 'Reports', path: '/reports', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17v-6a2 2 0 012-2h2a2 2 0 012 2v6"/><path d="M22 12h-4a2 2 0 00-2 2v6a2 2 0 002 2h4"/><path d="M2 12h4a2 2 0 012 2v6a2 2 0 01-2 2H2"/></svg> },
  { name: 'Settings', path: '/settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6"/><path d="M23 12h-6m-6 0H1"/></svg> },
];
const OWNER_NAV  = ADMIN_NAV.filter(i => !['Reports','Settings'].includes(i.name));
const SUPPLIER_NAV = [
  { name: 'Stock Alerts', path: '/supplier-dashboard', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
];
const navForRole = (role) => role === 'administrator' ? ADMIN_NAV : role === 'owner' ? OWNER_NAV : SUPPLIER_NAV;

function Layout({ children, user, onLogout }) {
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotif, setUnreadNotif]   = useState(0);
  const [unreadMsg, setUnreadMsg]       = useState(0);
  const [showNotif, setShowNotif]       = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const location = useLocation();
  const navigation = navForRole(user.role);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setNotifications(res.data.notifications);
      setUnreadNotif(res.data.unread_count);
    } catch (e) {}
  }, []);

  const fetchUnreadMessages = useCallback(async () => {
    try {
      const res = await api.getUnreadMessageCount();
      setUnreadMsg(res.data.unread_count);
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchUnreadMessages();
    const t = setInterval(() => { fetchNotifications(); fetchUnreadMessages(); }, 30000);
    return () => clearInterval(t);
  }, [fetchNotifications, fetchUnreadMessages]);

  const handleOpenNotif = async () => {
    setShowNotif(v => !v);
    setShowMessages(false);
    if (unreadNotif > 0) {
      await api.markNotificationsRead();
      setUnreadNotif(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    }
  };

  const NOTIF_ICONS = {
    restock_acknowledged: '🚚',
    restock_fulfilled:    '✅',
    restock_cancelled:    '❌',
    message:              '💬',
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)   return 'Just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return d.toLocaleDateString('en-PH', { month:'short', day:'numeric' });
  };

  return (
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
              </svg>
            </div>
            {sidebarOpen && <span className="logo-text">FLECS</span>}
          </div>
        </div>
        <nav className="sidebar-nav">
          {navigation.map(item => (
            <Link key={item.path} to={item.path} className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}>
              <div className="nav-icon">{item.icon}</div>
              {sidebarOpen && <span className="nav-text">{item.name}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item logout-btn" onClick={onLogout}>
            <div className="nav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </div>
            {sidebarOpen && <span className="nav-text">Logout</span>}
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>

          <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:'auto' }}>

            {/* Message icon - ENLARGED UI */}
            <button className="topbar-icon-btn" onClick={() => { setShowMessages(v=>!v); setShowNotif(false); }} title="Messages" style={{ padding: '8px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              {unreadMsg > 0 && <span className="topbar-badge" style={{ fontSize: '13px', width: '22px', height: '22px', right: '-2px', top: '-2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unreadMsg > 9 ? '9+' : unreadMsg}</span>}
            </button>

            {/* Notification bell - ENLARGED UI */}
            <button className="topbar-icon-btn" onClick={handleOpenNotif} title="Notifications" style={{ padding: '8px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              {unreadNotif > 0 && <span className="topbar-badge" style={{ fontSize: '13px', width: '22px', height: '22px', right: '-2px', top: '-2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unreadNotif > 9 ? '9+' : unreadNotif}</span>}
            </button>

            {/* Notification dropdown */}
            {showNotif && (
              <div className="notif-dropdown" onClick={e => e.stopPropagation()}>
                <div className="notif-header">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="notif-empty">No notifications yet</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.notification_id} className={`notif-item ${n.is_read ? 'read' : 'unread'}`}>
                      <span className="notif-icon">{NOTIF_ICONS[n.type] || '🔔'}</span>
                      <div className="notif-content">
                        <div className="notif-title">{n.title}</div>
                        {n.body && <div className="notif-body">{n.body}</div>}
                        <div className="notif-time">{formatTime(n.created_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* User info */}
            <div className="topbar-user">
              <div className="user-avatar">{user.username.charAt(0).toUpperCase()}</div>
              <div className="user-info">
                <div className="user-name">{user.username}</div>
                <div className="user-role">{ROLE_LABELS[user.role] || user.role}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Click outside to close notification dropdown */}
        {showNotif && <div style={{ position:'fixed', inset:0, zIndex:99 }} onClick={() => setShowNotif(false)} />}

        <main className="content">{children}</main>
      </div>

      {/* Messages drawer */}
      {showMessages && (
        <Messages
          user={user}
          onClose={() => setShowMessages(false)}
          onUnreadChange={setUnreadMsg}
        />
      )}
    </div>
  );
}

export default Layout;