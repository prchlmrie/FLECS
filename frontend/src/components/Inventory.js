import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import './Inventory.css';

const SEARCH_DEBOUNCE_MS = 320;

function buildProductPayload(formData) {
  const barcodeTrim = (formData.barcode || '').trim();
  return {
    name: formData.name.trim(),
    sku: formData.sku.trim(),
    barcode: barcodeTrim || null,
    category_id: Number(formData.category_id),
    supplier_id: Number(formData.supplier_id),
    cost_price: parseFloat(formData.cost_price),
    selling_price: parseFloat(formData.selling_price),
    stock_level: parseInt(formData.stock_level, 10),
    reorder_point: parseInt(formData.reorder_point, 10),
    lead_time_days: parseInt(formData.lead_time_days, 10),
  };
}

function Inventory({ user }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    loadData();
  }, [debouncedSearch, selectedCategory]);

  const loadData = async () => {
    try {
      if (isFirstLoad.current) {
        setLoading(true);
      }
      const [productsRes, categoriesRes, suppliersRes] = await Promise.all([
        api.getProducts({ search: debouncedSearch, category: selectedCategory }),
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
      isFirstLoad.current = false;
    }
  };

  const validateFormClient = () => {
    if (!formData.name.trim()) return 'Product name is required.';
    if (!formData.sku.trim()) return 'SKU is required.';
    if (!formData.category_id) return 'Please select a category.';
    if (!formData.supplier_id) return 'Please select a supplier.';
    const cost = parseFloat(formData.cost_price);
    const sell = parseFloat(formData.selling_price);
    if (Number.isNaN(cost) || cost < 0) return 'Cost price must be a valid non-negative number.';
    if (Number.isNaN(sell) || sell < 0) return 'Selling price must be a valid non-negative number.';
    const stock = parseInt(formData.stock_level, 10);
    if (Number.isNaN(stock) || stock < 0) return 'Stock level must be zero or greater.';
    const rp = parseInt(formData.reorder_point, 10);
    if (Number.isNaN(rp) || rp < 0) return 'Reorder point must be zero or greater.';
    const lt = parseInt(formData.lead_time_days, 10);
    if (Number.isNaN(lt) || lt < 1) return 'Lead time must be at least 1 day.';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const clientErr = validateFormClient();
    if (clientErr) {
      setError(clientErr);
      return;
    }

    const payload = buildProductPayload(formData);

    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.product_id, payload);
        setSuccess('Product updated successfully!');
      } else {
        await api.createProduct(payload);
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

  const handleDelete = async (product) => {
    const stock = Number(product.stock_level);
    const stockNote =
      stock > 0
        ? `\n\nThis product currently has ${stock} unit(s) in stock. Deletion may still fail if it appears in past sales.`
        : '';
    if (
      !window.confirm(
        `Delete "${product.name}" (SKU: ${product.sku})? This cannot be undone.${stockNote}`
      )
    ) {
      return;
    }

    try {
      await api.deleteProduct(product.product_id);
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
    const level = Number(product.stock_level);
    const threshold = Number(product.reorder_point);
    const tip = `Stock ${level} — low-stock threshold (reorder point) is ${threshold}`;
    if (level === 0) {
      return (
        <span className="badge badge-danger" title={tip}>
          Out of Stock
        </span>
      );
    }
    if (level <= threshold) {
      return (
        <span className="badge badge-warning" title={tip}>
          Low Stock
        </span>
      );
    }
    return (
      <span className="badge badge-success" title={`Stock ${level} — above reorder point (${threshold})`}>
        In Stock
      </span>
    );
  };

  const isLowStockRow = (product) => {
    const level = Number(product.stock_level);
    const threshold = Number(product.reorder_point);
    return level === 0 || level <= threshold;
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
        {suppliers.length === 0 && (
          <div className="alert alert-error inventory-banner">
            No suppliers are defined. Add suppliers under{' '}
            <Link to="/settings">Settings</Link> before creating products, or reload after the server seeds defaults.
          </div>
        )}
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
                <th>Supplier</th>
                <th>Cost Price</th>
                <th>Selling Price</th>
                <th>Stock</th>
                <th>Reorder pt.</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '40px' }}>
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
                  <tr
                    key={product.product_id}
                    className={isLowStockRow(product) ? 'inventory-row-low-stock' : undefined}
                  >
                    <td>
                      <strong>{product.name}</strong>
                      {product.barcode && (
                        <div className="monospace" style={{ fontSize: '0.85rem', color: '#64748b' }}>
                          {product.barcode}
                        </div>
                      )}
                    </td>
                    <td className="monospace">{product.sku}</td>
                    <td>{product.category_name || '—'}</td>
                    <td>{product.supplier_name || '—'}</td>
                    <td>₱{parseFloat(product.cost_price).toFixed(2)}</td>
                    <td>₱{parseFloat(product.selling_price).toFixed(2)}</td>
                    <td>
                      <strong>{product.stock_level}</strong> units
                    </td>
                    <td className="monospace">{product.reorder_point}</td>
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
                            onClick={() => handleDelete(product)}
                            title="Delete product"
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
                    <label className="form-label">Category *</label>
                    <select
                      name="category_id"
                      className="form-select"
                      value={formData.category_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select category</option>
                      {categories.map(cat => (
                        <option key={cat.category_id} value={cat.category_id}>
                          {cat.category_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Supplier *</label>
                    <select
                      name="supplier_id"
                      className="form-select"
                      value={formData.supplier_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select supplier</option>
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
                    <label className="form-label">Reorder point (low-stock threshold) *</label>
                    <input
                      type="number"
                      name="reorder_point"
                      className="form-input"
                      value={formData.reorder_point}
                      onChange={handleChange}
                      required
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
