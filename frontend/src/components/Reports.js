import React, { useState } from 'react';
import api from '../api';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './Reports.css';

function Reports({ user }) {
  const [reportType, setReportType] = useState('sales');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateReport = async () => {
    if (reportType === 'sales' && (!startDate || !endDate)) {
      setError('Please select date range');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let response;
      if (reportType === 'sales') {
        response = await api.getSalesReport({ start_date: startDate, end_date: endDate });
      } else {
        response = await api.getInventoryReport();
      }
      setReportData(response.data);
    } catch (err) {
      setError('Failed to generate report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format) => {
    try {
      let url, filename;
      if (reportType === 'sales') {
        url = `/reports/sales?start_date=${startDate}&end_date=${endDate}&format=${format}`;
        filename = `sales-report-${startDate}-to-${endDate}.${format}`;
      } else {
        url = `/reports/inventory?format=${format}`;
        filename = `inventory-report-${new Date().toISOString().split('T')[0]}.${format}`;
      }

      const response = await api.getSalesReport({ 
        start_date: startDate, 
        end_date: endDate,
        format 
      });

      if (format === 'csv') {
        const csvContent = convertToCSV(response.data);
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = filename;
        link.click();
      }
    } catch (err) {
      setError('Export failed');
    }
  };

  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).join(','));
    return [headers, ...rows].join('\n');
  };

  const calculateTotals = (data) => {
    if (!data || data.length === 0) return { total: 0, transactions: 0, average: 0 };
    
    const total = data.reduce((sum, row) => sum + parseFloat(row.total_sales || 0), 0);
    const transactions = data.reduce((sum, row) => sum + parseInt(row.transaction_count || 0), 0);
    
    return {
      total,
      transactions,
      average: transactions > 0 ? total / transactions : 0
    };
  };

  const renderSalesReport = () => {
    if (!reportData) return null;

    const totals = calculateTotals(reportData);

    return (
      <div className="report-content">
        <div className="grid grid-3 mb-4">
          <div className="stat-card">
            <div className="stat-label">Total Sales</div>
            <div className="stat-value">₱{totals.total.toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Transactions</div>
            <div className="stat-value">{totals.transactions}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Average Transaction</div>
            <div className="stat-value">₱{totals.average.toFixed(2)}</div>
          </div>
        </div>

        <div className="card mb-4">
          <div className="card-header">
            <h3 className="card-title">Sales Trend</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={reportData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip 
                  contentStyle={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: '8px' }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="total_sales" 
                  stroke="#047857" 
                  strokeWidth={3}
                  name="Sales (₱)"
                  dot={{ fill: '#047857', r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Daily Breakdown</h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Transactions</th>
                  <th>Total Sales</th>
                  <th>Avg Transaction</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((row, index) => (
                  <tr key={index}>
                    <td><strong>{row.date}</strong></td>
                    <td>{row.transaction_count}</td>
                    <td>₱{parseFloat(row.total_sales).toLocaleString()}</td>
                    <td>₱{parseFloat(row.avg_transaction).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderInventoryReport = () => {
    if (!reportData) return null;

    const totalValue = reportData.reduce((sum, p) => sum + parseFloat(p.stock_value || 0), 0);
    const lowStock = reportData.filter(p => p.stock_level <= p.reorder_point).length;
    const outOfStock = reportData.filter(p => p.stock_level === 0).length;

    return (
      <div className="report-content">
        <div className="grid grid-4 mb-4">
          <div className="stat-card">
            <div className="stat-label">Total Products</div>
            <div className="stat-value">{reportData.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Value</div>
            <div className="stat-value">₱{totalValue.toLocaleString()}</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-label">Low Stock</div>
            <div className="stat-value">{lowStock}</div>
          </div>
          <div className="stat-card danger">
            <div className="stat-label">Out of Stock</div>
            <div className="stat-value">{outOfStock}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Inventory Details</h3>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Stock Level</th>
                  <th>Cost Price</th>
                  <th>Selling Price</th>
                  <th>Stock Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((product, index) => (
                  <tr key={index}>
                    <td><strong>{product.name}</strong></td>
                    <td className="monospace">{product.sku}</td>
                    <td>{product.category_name || '-'}</td>
                    <td>{product.stock_level} units</td>
                    <td>₱{parseFloat(product.cost_price).toFixed(2)}</td>
                    <td>₱{parseFloat(product.selling_price).toFixed(2)}</td>
                    <td>₱{parseFloat(product.stock_value).toFixed(2)}</td>
                    <td>
                      {product.stock_level === 0 ? (
                        <span className="badge badge-danger">Out of Stock</span>
                      ) : product.stock_level <= product.reorder_point ? (
                        <span className="badge badge-warning">Low Stock</span>
                      ) : (
                        <span className="badge badge-success">In Stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (user.role !== 'administrator') {
    return (
      <div className="page-header">
        <h1>Reports</h1>
        <div className="alert alert-error">
          Access denied. Administrator privileges required.
        </div>
      </div>
    );
  }

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1>Business Reports</h1>
          <p className="page-subtitle">Generate comprehensive reports and analytics</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" />
          </svg>
          {error}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body">
          <div className="report-controls">
            <div className="form-group">
              <label className="form-label">Report Type</label>
              <select
                className="form-select"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option value="sales">Sales Report</option>
                <option value="inventory">Inventory Report</option>
              </select>
            </div>

            {reportType === 'sales' && (
              <>
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">End Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-group" style={{ alignSelf: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={generateReport}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" />
                    </svg>
                    Generate Report
                  </>
                )}
              </button>
            </div>

            {reportData && (
              <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => exportReport('csv')}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
                  </svg>
                  Export CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {reportData && (
        reportType === 'sales' ? renderSalesReport() : renderInventoryReport()
      )}
    </div>
  );
}

export default Reports;
