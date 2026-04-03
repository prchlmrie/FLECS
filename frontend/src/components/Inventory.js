import React, { useState, useEffect } from 'react';
import api from '../api';
import './Inventory.css';

function Inventory({ user }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    category_id: '',
    supplier_id: '',
    cost_price: '',
    selling_price: '',
    stock_level: '',
    reorder_point: 10,
    lead_time_days: 7
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, [searchTerm, selectedCategory]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsRes, categoriesRes, suppliersRes] = await Promise.all([
        api.getProducts({ search: searchTerm, category: selectedCategory }),
        api.getCategories(),
        api.getSuppliers()
      ]);
      setProducts(productsRes.data);
      setCategories(categoriesRes.data);
      setSuppliers(suppliersRes.data);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.product_id, formData);
        setSuccess('Product updated successfully!');
      } else {
        await api.createProduct(formData);
        setSuccess('Product created successfully!');
      }
      
      setShowModal(false);
      resetForm();
      loadData();
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Operation failed');
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      category_id: product.category_id || '',
      supplier_id: product.supplier_id || '',
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      stock_level: product.stock_level,
      reorder_point: product.reorder_point,
      lead_time_days: product.lead_time_days
    });
    setShowModal(true);
  };

  const handleDelete = async (productId, productName) => {
    if (!window.confirm(`Are you sure you want to delete "${productName}"?`)) {
      return;
    }

    try {
      await api.deleteProduct(productId);
      setSuccess('Product deleted successfully!');
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      sku: '',
      barcode: '',
      category_id: '',
      supplier_id: '',
      cost_price: '',
      selling_price: '',
      stock_level: '',
      reorder_point: 10,
      lead_time_days: 7
    });
    setEditingProduct(null);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const getLowStockBadge = (product) => {
    if (product.stock_level === 0) {
      return <span className="badge badge-danger">Out of Stock</span>;
    } else if (product.stock_level <= product.reorder_point) {
      return <span className="badge badge-warning">Low Stock</span>;
    } else {
      return <span className="badge badge-success">In Stock</span>;
    }
  };

  if (loading) {
    return <div className="loading">Loading inventory...</div>;
  }

  return (
    <div className="inventory-page">
      <div className="page-header">
        <div>
          <h1>Inventory Management</h1>
          <p className="page-subtitle">Manage your products, stock levels, and suppliers</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Add Product
        </button>
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

      <div className="card">
        <div className="inventory-filters">
          <div className="search-box">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="filter-select"
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat.category_id} value={cat.category_id}>
                {cat.category_name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Cost Price</th>
                <th>Selling Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px' }}>
                    <div style={{ color: '#94a3b8' }}>
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ margin: '0 auto 16px' }}>
                        <path d="M20 7h-9M14 17h6M9 7H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5" />
                      </svg>
                      <p>No products found. Add your first product to get started!</p>
                    </div>
                  </td>
                </tr>
              ) : (
                products.map(product => (
                  <tr key={product.product_id}>
                    <td>
                      <strong>{product.name}</strong>
                      {product.barcode && (
                        <div className="monospace" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                          {product.barcode}
                        </div>
                      )}
                    </td>
                    <td className="monospace">{product.sku}</td>
                    <td>{product.category_name || '-'}</td>
                    <td>₱{parseFloat(product.cost_price).toFixed(2)}</td>
                    <td>₱{parseFloat(product.selling_price).toFixed(2)}</td>
                    <td>
                      <strong>{product.stock_level}</strong> units
                    </td>
                    <td>{getLowStockBadge(product)}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-icon"
                          onClick={() => handleEdit(product)}
                          title="Edit"
                        >
                          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        {user.role === 'administrator' && (
                          <button
                            className="btn-icon btn-danger"
                            onClick={() => handleDelete(product.product_id, product.name)}
                            title="Delete"
                            disabled={product.stock_level > 0}
                          >
                            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Product Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button className="modal-close" onClick={() => { setShowModal(false); resetForm(); }}>
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="grid grid-2">
                  <div className="form-group">
                    <label className="form-label">Product Name *</label>
                    <input
                      type="text"
                      name="name"
                      className="form-input"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="e.g., Coca-Cola 1.5L"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">SKU *</label>
                    <input
                      type="text"
                      name="sku"
                      className="form-input"
                      value={formData.sku}
                      onChange={handleChange}
                      required
                      placeholder="e.g., COKE-15L"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Barcode</label>
                    <input
                      type="text"
                      name="barcode"
                      className="form-input"
                      value={formData.barcode}
                      onChange={handleChange}
                      placeholder="Optional"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select
                      name="category_id"
                      className="form-select"
                      value={formData.category_id}
                      onChange={handleChange}
                    >
                      <option value="">Select Category</option>
                      {categories.map(cat => (
                        <option key={cat.category_id} value={cat.category_id}>
                          {cat.category_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Supplier</label>
                    <select
                      name="supplier_id"
                      className="form-select"
                      value={formData.supplier_id}
                      onChange={handleChange}
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map(sup => (
                        <option key={sup.supplier_id} value={sup.supplier_id}>
                          {sup.supplier_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Cost Price (₱) *</label>
                    <input
                      type="number"
                      name="cost_price"
                      className="form-input"
                      value={formData.cost_price}
                      onChange={handleChange}
                      required
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Selling Price (₱) *</label>
                    <input
                      type="number"
                      name="selling_price"
                      className="form-input"
                      value={formData.selling_price}
                      onChange={handleChange}
                      required
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Stock Level *</label>
                    <input
                      type="number"
                      name="stock_level"
                      className="form-input"
                      value={formData.stock_level}
                      onChange={handleChange}
                      required
                      min="0"
                      placeholder="0"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Reorder Point</label>
                    <input
                      type="number"
                      name="reorder_point"
                      className="form-input"
                      value={formData.reorder_point}
                      onChange={handleChange}
                      min="0"
                      placeholder="10"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Lead Time (days)</label>
                    <input
                      type="number"
                      name="lead_time_days"
                      className="form-input"
                      value={formData.lead_time_days}
                      onChange={handleChange}
                      min="1"
                      placeholder="7"
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setShowModal(false); resetForm(); }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingProduct ? 'Update Product' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventory;
