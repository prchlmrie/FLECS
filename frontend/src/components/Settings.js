import React, { useState, useEffect } from 'react';
import api from '../api';
import './Settings.css';

function Settings({ user }) {
  const [activeTab, setActiveTab] = useState('users');
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [newCategory, setNewCategory] = useState('');
  const [newSupplier, setNewSupplier] = useState({
    supplier_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  });
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    role: 'clerk'
  });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [categoriesRes, suppliersRes] = await Promise.all([
        api.getCategories(),
        api.getSuppliers()
      ]);
      setCategories(categoriesRes.data);
      setSuppliers(suppliersRes.data);
    } catch (err) {
      console.error('Failed to load data', err);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return;

    try {
      await api.createCategory({ category_name: newCategory });
      setSuccess('Category added successfully!');
      setNewCategory('');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add category');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleAddSupplier = async (e) => {
    e.preventDefault();

    try {
      await api.createSupplier(newSupplier);
      setSuccess('Supplier added successfully!');
      setNewSupplier({
        supplier_name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      });
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add supplier');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();

    try {
      await api.register(newUser);
      setSuccess('User created successfully!');
      setNewUser({
        username: '',
        password: '',
        role: 'clerk'
      });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
      setTimeout(() => setError(''), 3000);
    }
  };

  if (user.role !== 'administrator') {
    return (
      <div className="page-header">
        <h1>Settings</h1>
        <div className="alert alert-error">
          Access denied. Administrator privileges required.
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Manage system configuration and master data</p>
        </div>
      </div>

      {success && (
        <div className="alert alert-success">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
          </svg>
          {success}
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" />
          </svg>
          {error}
        </div>
      )}

      <div className="settings-tabs">
        <button
          className={`tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
          </svg>
          User Management
        </button>
        <button
          className={`tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          Categories
        </button>
        <button
          className={`tab ${activeTab === 'suppliers' ? 'active' : ''}`}
          onClick={() => setActiveTab('suppliers')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" />
          </svg>
          Suppliers
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'users' && (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Add New User</h3>
              </div>
              <div className="card-body">
                <form onSubmit={handleAddUser}>
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newUser.username}
                      onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      type="password"
                      className="form-input"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      required
                      minLength="6"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select
                      className="form-select"
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    >
                      <option value="clerk">Clerk</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </div>

                  <button type="submit" className="btn btn-primary w-full">
                    Create User
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">User Information</h3>
              </div>
              <div className="card-body">
                <div className="info-section">
                  <h4>Role Descriptions</h4>
                  <div className="role-info">
                    <strong>Administrator:</strong>
                    <ul>
                      <li>Full system access</li>
                      <li>User management</li>
                      <li>Delete operations</li>
                      <li>View reports</li>
                      <li>System settings</li>
                    </ul>
                  </div>
                  <div className="role-info">
                    <strong>Clerk:</strong>
                    <ul>
                      <li>View inventory</li>
                      <li>Process sales</li>
                      <li>Add/edit products</li>
                      <li>Basic operations</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Add New Category</h3>
              </div>
              <div className="card-body">
                <form onSubmit={handleAddCategory}>
                  <div className="form-group">
                    <label className="form-label">Category Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="e.g., Beverages, Snacks, Dairy"
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary w-full">
                    Add Category
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Existing Categories</h3>
              </div>
              <div className="card-body">
                <div className="category-list">
                  {categories.map((cat) => (
                    <div key={cat.category_id} className="category-item">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      {cat.category_name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'suppliers' && (
          <div className="grid grid-2">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Add New Supplier</h3>
              </div>
              <div className="card-body">
                <form onSubmit={handleAddSupplier}>
                  <div className="form-group">
                    <label className="form-label">Supplier Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newSupplier.supplier_name}
                      onChange={(e) => setNewSupplier({ ...newSupplier, supplier_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Contact Person</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newSupplier.contact_person}
                      onChange={(e) => setNewSupplier({ ...newSupplier, contact_person: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Phone</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={newSupplier.phone}
                      onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={newSupplier.email}
                      onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Address</label>
                    <textarea
                      className="form-textarea"
                      value={newSupplier.address}
                      onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                      rows="3"
                    ></textarea>
                  </div>

                  <button type="submit" className="btn btn-primary w-full">
                    Add Supplier
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Existing Suppliers</h3>
              </div>
              <div className="card-body">
                <div className="supplier-list">
                  {suppliers.map((sup) => (
                    <div key={sup.supplier_id} className="supplier-item">
                      <div className="supplier-header">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4z" />
                        </svg>
                        <strong>{sup.supplier_name}</strong>
                      </div>
                      {sup.contact_person && <p>Contact: {sup.contact_person}</p>}
                      {sup.phone && <p>Phone: {sup.phone}</p>}
                      {sup.email && <p>Email: {sup.email}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Settings;
