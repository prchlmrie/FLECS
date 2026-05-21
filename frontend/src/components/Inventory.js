import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import HelpTooltip from './HelpTooltip';
import { markProductAdded } from '../onboardingStorage';
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
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [restoreSubmittingId, setRestoreSubmittingId] = useState(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    loadData();
  }, [debouncedSearch, selectedCategory, showArchived]);

  const loadData = async () => {
    try {
      if (isFirstLoad.current) {
        setLoading(true);
      }
      const [productsRes, categoriesRes, suppliersRes] = await Promise.all([
        api.getProducts({
          search: debouncedSearch,
          category: selectedCategory,
          ...(showArchived ? { archived: 1 } : {}),
        }),
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
        markProductAdded();
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

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiveSubmitting(true);
    setError('');
    try {
      await api.deleteProduct(archiveTarget.product_id);
      setArchiveTarget(null);
      setSuccess('Item removed from the shelf. You can bring it back anytime from Archived products.');
      loadData();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this item');
    } finally {
      setArchiveSubmitting(false);
    }
  };

  const handleRestoreProduct = async (product) => {
    setRestoreSubmittingId(product.product_id);
    setError('');
    try {
      await api.restoreProduct(product.product_id);
      setSuccess(`"${product.name}" is back on the shelf.`);
      loadData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Restore failed');
    } finally {
      setRestoreSubmittingId(null);
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

  const getStockStatus = (product) => {
    const level = Number(product.stock_level);
    const threshold = Number(product.reorder_point);
    const highLine =
      threshold > 0 && level >= threshold * 5
        ? 'You have a lot more on hand than your usual reorder level — that is fine if you expect strong sales.'
        : null;

    if (level === 0) {
      return {
        kind: 'out',
        label: 'None left',
        title: 'You have sold out. Restock when you can.',
      };
    }
    if (level <= threshold) {
      return {
        kind: 'low',
        label: 'Running low',
        title: `You have ${level} left. We nudge you when you reach ${threshold} (your reorder point).`,
      };
    }
    if (highLine) {
      return {
        kind: 'high',
        label: 'Plenty on hand',
        title: highLine,
      };
    }
    return {
      kind: 'ok',
      label: 'Looks fine',
      title: `About ${level} on hand — above your alert level of ${threshold}.`,
    };
  };

  const renderStockStatus = (product) => {
    const s = getStockStatus(product);
    const pillClass =
      s.kind === 'out'
        ? 'stock-pill stock-pill-out'
        : s.kind === 'low'
          ? 'stock-pill stock-pill-low'
          : s.kind === 'high'
            ? 'stock-pill stock-pill-high'
            : 'stock-pill stock-pill-ok';
    return (
      <span className={pillClass} title={s.title}>
        {s.label}
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
        {!showArchived && (
          <button className="btn btn-primary" type="button" onClick={() => setShowModal(true)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
            </svg>
            Add Product
          </button>
        )}
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
        <div className="inventory-shelf-tabs" role="tablist" aria-label="Product shelf">
          <button
            type="button"
            role="tab"
            aria-selected={!showArchived}
            className={`inventory-shelf-tab ${!showArchived ? 'is-active' : ''}`}
            onClick={() => setShowArchived(false)}
          >
            On the shelf
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showArchived}
            className={`inventory-shelf-tab ${showArchived ? 'is-active' : ''}`}
            onClick={() => setShowArchived(true)}
          >
            Archived products
          </button>
        </div>

        {suppliers.length === 0 && !showArchived && (
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
                <th className="th-with-help">
                  <span className="label-with-help">
                    SKU
                    <HelpTooltip text="Your own internal code for this item." />
                  </span>
                </th>
                <th>Category</th>
                <th>Supplier</th>
                <th>Cost Price</th>
                <th>Selling Price</th>
                <th>Stock</th>
                <th className="th-with-help">
                  <span className="label-with-help">
                    Reorder point
                    <HelpTooltip text="We will alert you when stock falls to this number." />
                  </span>
                </th>
                <th>Quick read</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan="10">
                    <div className="inventory-empty">
                      {showArchived ? (
                        <>
                          <h3 className="inventory-empty-title">Nothing archived yet</h3>
                          <p className="inventory-empty-text">
                            When you remove an item from the shelf, it appears here. Past sales stay intact — you can
                            always put an item back on the shelf.
                          </p>
                        </>
                      ) : (
                        <>
                          <h3 className="inventory-empty-title">You have not added any products yet</h3>
                          <p className="inventory-empty-text">
                            Click the big green button below to add your first product. If you have not set up
                            categories or suppliers yet, visit Settings first — the checklist on your Dashboard can walk
                            you through it.
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary inventory-empty-cta"
                            onClick={() => setShowModal(true)}
                          >
                            Add your first product
                          </button>
                          <p className="inventory-empty-links">
                            <Link to="/settings">Open Settings</Link>
                            {' · '}
                            <Link to="/dashboard">Back to Dashboard</Link>
                          </p>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                products.map(product => (
                  <tr
                    key={product.product_id}
                    className={
                      [
                        !showArchived && isLowStockRow(product) ? 'inventory-row-low-stock' : '',
                        showArchived ? 'inventory-row-archived' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
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
                    <td>{renderStockStatus(product)}</td>
                    <td>
                      <div className="inventory-actions">
                        {showArchived ? (
                          user.role === 'administrator' ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={restoreSubmittingId === product.product_id}
                              onClick={() => handleRestoreProduct(product)}
                            >
                              {restoreSubmittingId === product.product_id ? 'Restoring…' : 'Put back on shelf'}
                            </button>
                          ) : (
                            <span className="inventory-muted">Admin can restore</span>
                          )
                        ) : (
                          <>
                            <button
                              type="button"
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
                                type="button"
                                className="btn btn-outline-danger btn-sm inventory-remove-shelf"
                                onClick={() => setArchiveTarget(product)}
                              >
                                Remove from shelf
                              </button>
                            )}
                          </>
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
                    <label className="form-label label-with-help">
                      SKU *
                      <HelpTooltip text="Your own internal code for this item." />
                    </label>
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
                    <label className="form-label label-with-help">
                      Reorder point *
                      <HelpTooltip text="We will alert you when stock falls to this number." />
                    </label>
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
                    <label className="form-label label-with-help">
                      Lead time (days)
                      <HelpTooltip text="How many days it usually takes for your supplier to deliver this." />
                    </label>
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

      {archiveTarget && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-modal-title"
          onClick={() => !archiveSubmitting && setArchiveTarget(null)}
        >
          <div className="modal modal-confirm-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="archive-modal-title" className="modal-title">
                Wait — remove this from the shelf?
              </h3>
              <button
                type="button"
                className="modal-close"
                disabled={archiveSubmitting}
                onClick={() => setArchiveTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="archive-modal-lead">
                You are about to stop selling <strong>{archiveTarget.name}</strong>
                {archiveTarget.sku ? (
                  <>
                    {' '}
                    (<span className="monospace">{archiveTarget.sku}</span>)
                  </>
                ) : null}
                . It disappears from the till and inventory lists, but{' '}
                <strong>nothing is permanently deleted</strong>.
              </p>
              <p className="archive-modal-lead">
                You can always find it again under <strong>Archived products</strong> and put it back on the shelf when
                you are ready.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={archiveSubmitting}
                onClick={() => setArchiveTarget(null)}
              >
                Keep selling this item
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={archiveSubmitting}
                onClick={handleConfirmArchive}
              >
                {archiveSubmitting ? 'Working…' : 'Yes, remove from shelf'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventory;
