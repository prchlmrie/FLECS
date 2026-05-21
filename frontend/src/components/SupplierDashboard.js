import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import './SupplierDashboard.css';

const PRIORITY_CONFIG = {
  CRITICAL: { label: 'Critical – Out of Stock', color: '#dc2626', bg: '#fef2f2', dot: '#dc2626' },
  HIGH:     { label: 'High',                    color: '#ea580c', bg: '#fff7ed', dot: '#ea580c' },
  MEDIUM:   { label: 'Medium',                  color: '#ca8a04', bg: '#fefce8', dot: '#ca8a04' },
};

const STATUS_CONFIG = {
  pending:      { label: 'Pending',      color: '#6366f1', bg: '#eef2ff' },
  acknowledged: { label: 'Acknowledged', color: '#0891b2', bg: '#ecfeff' },
  fulfilled:    { label: 'Fulfilled',    color: '#16a34a', bg: '#f0fdf4' },
  cancelled:    { label: 'Cancelled',    color: '#9ca3af', bg: '#f9fafb' },
};

function Badge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      color: cfg.color,
      background: cfg.bg,
    }}>
      {cfg.label}
    </span>
  );
}

function SummaryCard({ label, value, sub, accent }) {
  return (
    <div className="sd-summary-card" style={{ borderTop: `4px solid ${accent}` }}>
      <div className="sd-summary-value" style={{ color: accent }}>{value}</div>
      <div className="sd-summary-label">{label}</div>
      {sub && <div className="sd-summary-sub">{sub}</div>}
    </div>
  );
}

function SupplierDashboard({ user }) {
  const [summary, setSummary]       = useState(null);
  const [lowStock, setLowStock]     = useState([]);
  const [requests, setRequests]     = useState([]);
  const [activeTab, setActiveTab]   = useState('alerts');   // 'alerts' | 'requests'
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [toast, setToast]           = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summRes, stockRes, reqRes] = await Promise.all([
        api.getSupplierDashboard(),
        api.getSupplierLowStock(),
        api.getSupplierStockRequests(),
      ]);
      setSummary(summRes.data);
      setLowStock(stockRes.data.low_stock_items || []);
      setRequests(reqRes.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load supplier data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUpdateRequest = async (requestId, newStatus) => {
    setActionLoading(prev => ({ ...prev, [requestId]: true }));
    try {
      await api.updateSupplierStockRequest(requestId, { status: newStatus });
      showToast(`Request marked as ${newStatus}.`);
      await fetchAll();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not update request.');
    } finally {
      setActionLoading(prev => ({ ...prev, [requestId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="sd-loading">
        <div className="sd-spinner" />
        <p>Loading supplier portal…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sd-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>{error}</p>
        <button className="sd-btn-primary" onClick={fetchAll}>Retry</button>
      </div>
    );
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const acknowledgedCount = requests.filter(r => r.status === 'acknowledged').length;

  return (
    <div className="sd-root">
      {toast && <div className="sd-toast">{toast}</div>}

      {/* Header */}
      <div className="sd-header">
        <div>
          <h1 className="sd-title">Supplier Portal</h1>
          {summary?.supplier?.supplier_name && (
            <p className="sd-subtitle">{summary.supplier.supplier_name}</p>
          )}
        </div>
        <button className="sd-btn-outline" onClick={fetchAll}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="sd-summary-grid">
        <SummaryCard
          label="Your Products"
          value={summary?.total_products ?? '—'}
          accent="#6366f1"
        />
        <SummaryCard
          label="Low Stock Alerts"
          value={summary?.low_stock_count ?? '—'}
          sub="At or below reorder point"
          accent="#ea580c"
        />
        <SummaryCard
          label="Critical (Out of Stock)"
          value={summary?.critical_count ?? '—'}
          sub="Needs immediate action"
          accent="#dc2626"
        />
        <SummaryCard
          label="Pending Requests"
          value={summary?.pending_requests ?? '—'}
          sub={acknowledgedCount > 0 ? `${acknowledgedCount} acknowledged` : undefined}
          accent="#0891b2"
        />
      </div>

      {/* Tabs */}
      <div className="sd-tabs">
        <button
          className={`sd-tab ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          Stock Alerts
          {lowStock.length > 0 && <span className="sd-tab-badge">{lowStock.length}</span>}
        </button>
        <button
          className={`sd-tab ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Restock Requests
          {pendingCount > 0 && <span className="sd-tab-badge sd-tab-badge--urgent">{pendingCount}</span>}
        </button>
      </div>

      {/* ── TAB: Stock Alerts ── */}
      {activeTab === 'alerts' && (
        <div className="sd-panel">
          {lowStock.length === 0 ? (
            <div className="sd-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#86efac" strokeWidth="1.5">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p>All your products are well-stocked. Nice!</p>
            </div>
          ) : (
            <div className="sd-table-wrap">
              <table className="sd-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Current Stock</th>
                    <th>Reorder Point</th>
                    <th>Priority</th>
                    <th>Pending Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map(item => {
                    const cfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.MEDIUM;
                    return (
                      <tr key={item.product_id} style={{ background: cfg.bg }}>
                        <td className="sd-product-name">{item.name}</td>
                        <td className="sd-mono">{item.sku}</td>
                        <td>{item.category_name}</td>
                        <td>
                          <span className="sd-stock-num" style={{ color: cfg.color }}>
                            {item.stock_level}
                          </span>
                        </td>
                        <td>{item.reorder_point}</td>
                        <td>
                          <span className="sd-priority-badge" style={{ color: cfg.color, background: 'white', border: `1px solid ${cfg.color}` }}>
                            <span className="sd-priority-dot" style={{ background: cfg.dot }} />
                            {item.priority}
                          </span>
                        </td>
                        <td>
                          {item.stock_requests && item.stock_requests.length > 0 ? (
                            <div className="sd-inline-requests">
                              {item.stock_requests.map(req => (
                                <span key={req.request_id} className="sd-inline-req">
                                  Qty {req.requested_quantity} — <Badge status={req.status} />
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="sd-none">None yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Restock Requests ── */}
      {activeTab === 'requests' && (
        <div className="sd-panel">
          {requests.length === 0 ? (
            <div className="sd-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="1.5">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
              <p>No restock requests from the store yet.</p>
            </div>
          ) : (
            <div className="sd-table-wrap">
              <table className="sd-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Qty Requested</th>
                    <th>Current Stock</th>
                    <th>Requested By</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(req => {
                    const isLoading = actionLoading[req.request_id];
                    return (
                      <tr key={req.request_id}>
                        <td className="sd-mono">#{req.request_id}</td>
                        <td className="sd-product-name">{req.product_name}</td>
                        <td className="sd-mono">{req.sku}</td>
                        <td><strong>{req.requested_quantity}</strong></td>
                        <td>{req.stock_level}</td>
                        <td>{req.requested_by_username}</td>
                        <td className="sd-date">
                          {new Date(req.requested_at).toLocaleDateString('en-PH', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </td>
                        <td><Badge status={req.status} /></td>
                        <td>
                          <div className="sd-action-group">
                            {req.status === 'pending' && (
                              <button
                                className="sd-btn-action sd-btn-acknowledge"
                                disabled={isLoading}
                                onClick={() => handleUpdateRequest(req.request_id, 'acknowledged')}
                              >
                                {isLoading ? '…' : 'Acknowledge'}
                              </button>
                            )}
                            {req.status === 'acknowledged' && (
                              <button
                                className="sd-btn-action sd-btn-fulfill"
                                disabled={isLoading}
                                onClick={() => handleUpdateRequest(req.request_id, 'fulfilled')}
                              >
                                {isLoading ? '…' : 'Mark Fulfilled'}
                              </button>
                            )}
                            {(req.status === 'pending' || req.status === 'acknowledged') && (
                              <button
                                className="sd-btn-action sd-btn-cancel"
                                disabled={isLoading}
                                onClick={() => handleUpdateRequest(req.request_id, 'cancelled')}
                              >
                                {isLoading ? '…' : 'Cancel'}
                              </button>
                            )}
                            {(req.status === 'fulfilled' || req.status === 'cancelled') && (
                              <span className="sd-done">Done</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SupplierDashboard;
