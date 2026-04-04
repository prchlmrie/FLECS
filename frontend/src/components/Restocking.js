import React, { useState, useEffect } from 'react';
import api from '../api';
import './Restocking.css';

function Restocking() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [poSuccess, setPoSuccess] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [filterPriority, setFilterPriority] = useState('');
  const [showPOModal, setShowPOModal] = useState(false);
  const [poLines, setPoLines] = useState([]);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      const response = await api.getRestockRecommendations();
      setRecommendations(response.data.recommendations);
    } catch (err) {
      setError('Failed to load recommendations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (productId) => {
    if (selectedItems.includes(productId)) {
      setSelectedItems(selectedItems.filter(id => id !== productId));
    } else {
      setSelectedItems([...selectedItems, productId]);
    }
  };

  const selectAll = () => {
    const filtered = getFilteredRecommendations();
    setSelectedItems(filtered.map(r => r.product_id));
  };

  const clearSelection = () => {
    setSelectedItems([]);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'CRITICAL': return 'danger';
      case 'HIGH': return 'warning';
      case 'MEDIUM': return 'secondary';
      default: return 'secondary';
    }
  };

  const getPriorityIcon = (priority) => {
    if (priority === 'CRITICAL') {
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" />
        </svg>
      );
    } else if (priority === 'HIGH') {
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" />
        </svg>
      );
    }
    return null;
  };

  const getFilteredRecommendations = () => {
    if (!filterPriority) return recommendations;
    return recommendations.filter(r => r.priority === filterPriority);
  };

  const calculateSelectedTotal = () => {
    return recommendations
      .filter(r => selectedItems.includes(r.product_id))
      .reduce((sum, r) => sum + r.estimated_cost, 0);
  };

  const getSelectedRows = () =>
    recommendations.filter((r) => selectedItems.includes(r.product_id));

  const handleGeneratePurchaseOrder = () => {
    const rows = getSelectedRows();
    if (rows.length === 0) return;
    setPoLines(rows);
    setShowPOModal(true);
    setPoSuccess('');
  };

  const downloadPurchaseOrderCsv = () => {
    if (poLines.length === 0) return;
    const poNumber = `PO-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).toUpperCase()}`;
    const dateEsc = new Date().toLocaleString().replace(/"/g, '""');
    const header = [`Purchase Order,${poNumber}`, `"Date","${dateEsc}"`].join('\n');
    const tableHeader = [
      'SKU',
      'Product',
      'Supplier',
      'Suggested Qty',
      'Unit Cost (PHP)',
      'Line Total (PHP)',
    ];
    const body = poLines.map((r) =>
      [
        r.sku,
        `"${String(r.name).replace(/"/g, '""')}"`,
        `"${String(r.supplier || '').replace(/"/g, '""')}"`,
        r.suggested_quantity,
        r.cost_price,
        r.estimated_cost,
      ].join(',')
    );
    const total = poLines.reduce((s, r) => s + r.estimated_cost, 0);
    const csv = [header, '', tableHeader.join(','), ...body, '', `TOTAL,,,,,${total}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${poNumber}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    setPoSuccess('Purchase order CSV downloaded.');
    setTimeout(() => setPoSuccess(''), 4000);
  };

  const printPurchaseOrder = () => {
    window.print();
  };

  const closePOModal = () => {
    setShowPOModal(false);
    setPoLines([]);
  };

  const exportToCSV = () => {
    const filtered = getFilteredRecommendations();
    const csvContent = [
      ['Product', 'SKU', 'Priority', 'Current Stock', 'Reorder Point', 'Suggested Qty', 'Cost per Unit', 'Total Cost'],
      ...filtered.map(r => [
        r.name,
        r.sku,
        r.priority,
        r.current_stock,
        r.reorder_point,
        r.suggested_quantity,
        r.cost_price,
        r.estimated_cost
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restocking-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (loading) {
    return <div className="loading">Loading restocking recommendations...</div>;
  }

  const filtered = getFilteredRecommendations();

  return (
    <div className="restocking-page">
      <div className="page-header">
        <div>
          <h1>Restocking Recommendations</h1>
          <p className="page-subtitle">
            Demand-based suggestions (last 30 days of sales + reorder policy). Select lines to build a
            purchase order.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={exportToCSV}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
            </svg>
            Export CSV
          </button>
          <button className="btn btn-primary" onClick={loadRecommendations}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {poSuccess && (
        <div className="alert alert-success">
          {poSuccess}
        </div>
      )}

      {recommendations.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3>All Good! 🎉</h3>
            <p>No restocking needed at this time. All products are well-stocked.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-4 mb-4">
            <div className="stat-card danger">
              <div className="stat-label">Critical Items</div>
              <div className="stat-value">
                {recommendations.filter(r => r.priority === 'CRITICAL').length}
              </div>
            </div>
            <div className="stat-card warning">
              <div className="stat-label">High Priority</div>
              <div className="stat-value">
                {recommendations.filter(r => r.priority === 'HIGH').length}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Items</div>
              <div className="stat-value">{recommendations.length}</div>
            </div>
            <div className="stat-card success">
              <div className="stat-label">Estimated Cost</div>
              <div className="stat-value">
                ₱{recommendations.reduce((sum, r) => sum + r.estimated_cost, 0).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="restock-filters">
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="filter-select"
              >
                <option value="">All Priorities</option>
                <option value="CRITICAL">Critical Only</option>
                <option value="HIGH">High Priority</option>
                <option value="MEDIUM">Medium Priority</option>
              </select>

              <div className="selection-actions">
                {selectedItems.length > 0 && (
                  <span className="selected-count">
                    {selectedItems.length} items selected (₱{calculateSelectedTotal().toLocaleString()})
                  </span>
                )}
                <button className="btn btn-sm btn-secondary" onClick={selectAll}>
                  Select All
                </button>
                {selectedItems.length > 0 && (
                  <button className="btn btn-sm btn-secondary" onClick={clearSelection}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th width="40">
                      <input
                        type="checkbox"
                        checked={selectedItems.length === filtered.length && filtered.length > 0}
                        onChange={() => selectedItems.length === filtered.length ? clearSelection() : selectAll()}
                      />
                    </th>
                    <th>Priority</th>
                    <th>Product</th>
                    <th>Current Stock</th>
                    <th>Reorder Point</th>
                    <th>Avg Daily Sales</th>
                    <th>Suggested Qty</th>
                    <th>Lead Time</th>
                    <th>Est. Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.product_id} className={selectedItems.includes(item.product_id) ? 'selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.product_id)}
                          onChange={() => toggleSelection(item.product_id)}
                        />
                      </td>
                      <td>
                        <div className="priority-cell">
                          {getPriorityIcon(item.priority)}
                          <span className={`badge badge-${getPriorityColor(item.priority)}`}>
                            {item.priority}
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                        <div className="monospace text-small">{item.sku}</div>
                        {item.supplier && (
                          <div className="text-small" style={{ color: 'var(--text-tertiary)' }}>
                            {item.supplier}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={item.current_stock === 0 ? 'text-danger' : ''}>
                          <strong>{item.current_stock}</strong> units
                        </span>
                      </td>
                      <td>{item.reorder_point} units</td>
                      <td>{item.avg_daily_sales} units/day</td>
                      <td>
                        <strong className="text-primary">{item.suggested_quantity}</strong> units
                      </td>
                      <td>{item.lead_time_days} days</td>
                      <td>
                        <strong>₱{item.estimated_cost.toLocaleString()}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedItems.length > 0 && (
            <div className="action-bar">
              <div className="action-summary">
                <strong>{selectedItems.length} items selected</strong>
                <span>Total: ₱{calculateSelectedTotal().toLocaleString()}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={handleGeneratePurchaseOrder}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                  <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z" />
                </svg>
                Generate Purchase Order
              </button>
            </div>
          )}
        </>
      )}

      {showPOModal && poLines.length > 0 && (
        <div className="modal-overlay" onClick={closePOModal}>
          <div className="modal po-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header no-print">
              <h3 className="modal-title">Purchase order preview</h3>
              <button type="button" className="modal-close" onClick={closePOModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body po-print-area">
              <div className="po-letterhead">
                <h2>FLECS — Purchase order</h2>
                <p className="po-meta">
                  Generated {new Date().toLocaleString()}
                  <br />
                  Lines: {poLines.length}
                </p>
              </div>

              <table className="table po-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Supplier</th>
                    <th>Qty</th>
                    <th>Unit cost</th>
                    <th>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {poLines.map((r) => (
                    <tr key={r.product_id}>
                      <td className="monospace">{r.sku}</td>
                      <td>{r.name}</td>
                      <td>{r.supplier || '—'}</td>
                      <td>{r.suggested_quantity}</td>
                      <td>₱{Number(r.cost_price).toFixed(2)}</td>
                      <td>₱{Number(r.estimated_cost).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="po-total">
                <strong>Estimated total:</strong>{' '}
                <strong>
                  ₱
                  {poLines.reduce((s, r) => s + r.estimated_cost, 0).toLocaleString()}
                </strong>
              </div>
            </div>

            <div className="modal-footer no-print">
              <button type="button" className="btn btn-secondary" onClick={closePOModal}>
                Close
              </button>
              <button type="button" className="btn btn-secondary" onClick={downloadPurchaseOrderCsv}>
                Download CSV
              </button>
              <button type="button" className="btn btn-primary" onClick={printPurchaseOrder}>
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Restocking;
