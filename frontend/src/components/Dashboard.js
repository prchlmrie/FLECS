import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../api';
import './Dashboard.css';

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const response = await api.getDashboard();
      setData(response.data);
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  const { summary, top_products, sales_trend } = data;

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">Welcome back! Here's your store overview</p>
      </div>

      <div className="grid grid-4">
        <div className="stat-card">
          <div className="stat-label">Total Products</div>
          <div className="stat-value">{summary.total_products}</div>
        </div>
        
        <div className="stat-card warning">
          <div className="stat-label">Low Stock Items</div>
          <div className="stat-value">{summary.low_stock_count}</div>
        </div>
        
        <div className="stat-card success">
          <div className="stat-label">Today's Sales</div>
          <div className="stat-value">₱{summary.today_sales.toLocaleString()}</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-label">Stock Value</div>
          <div className="stat-value">₱{summary.stock_value.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-2 mt-4">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Sales Trend (7 Days)</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sales_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip 
                  contentStyle={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: '8px' }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="total" 
                  stroke="#047857" 
                  strokeWidth={3}
                  name="Sales (₱)"
                  dot={{ fill: '#047857', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Top Selling Products</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={top_products.slice(0, 5)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#64748b" angle={-45} textAnchor="end" height={80} />
                <YAxis stroke="#64748b" />
                <Tooltip 
                  contentStyle={{ background: '#fff', border: '2px solid #e2e8f0', borderRadius: '8px' }}
                />
                <Bar dataKey="total_sold" fill="#047857" name="Units Sold" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h3 className="card-title">Best Performers (Last 30 Days)</h3>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Units Sold</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {top_products.map((product, index) => (
                <tr key={index}>
                  <td><strong>{product.name}</strong></td>
                  <td className="monospace">{product.sku}</td>
                  <td>{product.total_sold}</td>
                  <td>₱{parseFloat(product.revenue).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
