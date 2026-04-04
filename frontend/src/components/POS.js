import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import './POS.css';

const SEARCH_DEBOUNCE_MS = 320;

function POS() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastTransaction, setLastTransaction] = useState(null);
  const isFirstProductLoad = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    loadProducts();
  }, [debouncedSearch]);

  const loadProducts = async () => {
    try {
      if (isFirstProductLoad.current) {
        setProductsLoading(true);
      }
      const response = await api.getProducts({ search: debouncedSearch });
      setProducts(response.data);
    } catch (err) {
      console.error('Failed to load products', err);
    } finally {
      setProductsLoading(false);
      isFirstProductLoad.current = false;
    }
  };

  const cartTotals = useMemo(() => {
    const lineCount = cart.reduce((n, item) => n + item.quantity, 0);
    const subtotal = cart.reduce(
      (sum, item) => sum + Number(item.selling_price) * item.quantity,
      0
    );
    return {
      lineCount,
      subtotal,
      total: subtotal,
    };
  }, [cart]);

  const addToCart = (product) => {
    const stock = Number(product.stock_level);
    if (stock < 1) {
      setError('This product is out of stock.');
      return;
    }

    const existingItem = cart.find((item) => item.product_id === product.product_id);

    if (existingItem) {
      if (existingItem.quantity >= stock) {
        setError(`Only ${stock} unit(s) available for "${product.name}".`);
        return;
      }
      setCart(
        cart.map((item) =>
          item.product_id === product.product_id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          product_id: product.product_id,
          name: product.name,
          sku: product.sku,
          selling_price: product.selling_price,
          stock_level: stock,
          quantity: 1,
        },
      ]);
    }
    setError('');
  };

  const updateQuantity = (productId, newQuantity) => {
    const item = cart.find((i) => i.product_id === productId);
    if (!item) return;

    const qty = Number(newQuantity);
    if (Number.isNaN(qty)) return;

    if (qty > item.stock_level) {
      setError(`Only ${item.stock_level} unit(s) available for "${item.name}".`);
      return;
    }

    if (qty < 1) {
      removeFromCart(productId);
      return;
    }

    setError('');
    setCart(
      cart.map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i))
    );
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter((item) => item.product_id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setError('');
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setError('Cart is empty. Add products before completing the sale.');
      return;
    }

    setCheckoutLoading(true);
    setError('');
    setSuccess('');

    try {
      const transactionData = {
        items: cart.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
        })),
      };

      const response = await api.createTransaction(transactionData);
      const { transaction_id, total_amount, items: serverItems } = response.data;

      setLastTransaction({
        transaction_id,
        total_amount,
        items: serverItems || [],
      });
      setSuccess('Transaction completed successfully.');
      setShowReceipt(true);
      setCart([]);
      loadProducts();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        'Transaction could not be completed. Your cart is unchanged — adjust quantities and try again.';
      setError(msg);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const printReceipt = () => {
    window.print();
  };

  return (
    <div className="pos-page">
      <div className="page-header">
        <div>
          <h1>Point of Sale</h1>
          <p className="page-subtitle">
            Search by name, SKU, or barcode — totals update as you build the cart
          </p>
        </div>
      </div>

      {success && (
        <div className="alert alert-success">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            />
          </svg>
          {success}
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            />
          </svg>
          {error}
        </div>
      )}

      <div className="pos-container">
        <div className="pos-products">
          <div className="search-box">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
              autoFocus
            />
            {productsLoading && <span className="pos-search-hint">Searching…</span>}
          </div>

          <div className="product-grid">
            {products.length === 0 && !productsLoading ? (
              <div className="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <p>No products match your search</p>
              </div>
            ) : (
              products.map((product) => {
                const stock = Number(product.stock_level);
                const out = stock < 1;
                return (
                  <div
                    key={product.product_id}
                    className={`product-card ${out ? 'product-card-disabled' : ''}`}
                    onClick={() => !out && addToCart(product)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!out && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        addToCart(product);
                      }
                    }}
                    aria-disabled={out}
                  >
                    <div className="product-info">
                      <h4>{product.name}</h4>
                      <p className="product-sku monospace">{product.sku}</p>
                      {product.barcode && (
                        <p className="product-barcode monospace">{product.barcode}</p>
                      )}
                      <div className="product-footer">
                        <span className="product-price">
                          ₱{parseFloat(product.selling_price).toFixed(2)}
                        </span>
                        <span className={out ? 'product-stock product-stock-out' : 'product-stock'}>
                          {out ? 'Out of stock' : `${stock} in stock`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="pos-cart">
          <div className="cart-header">
            <h3>Current sale</h3>
            {cart.length > 0 && (
              <button type="button" className="btn-text" onClick={clearCart}>
                Clear all
              </button>
            )}
          </div>

          <div className="cart-items">
            {cart.length === 0 ? (
              <div className="empty-cart">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
                </svg>
                <p>Cart is empty</p>
                <p className="text-small">Add products to start a transaction</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.product_id} className="cart-item">
                  <div className="item-details">
                    <h4>{item.name}</h4>
                    <p className="monospace">{item.sku}</p>
                  </div>

                  <div className="item-controls">
                    <div className="quantity-control">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                        className="qty-btn"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => {
                          const t = e.target.value;
                          if (t === '') return;
                          const v = parseInt(t, 10);
                          if (Number.isNaN(v)) return;
                          updateQuantity(item.product_id, v);
                        }}
                        className="qty-input"
                        min={1}
                        max={item.stock_level}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                        className="qty-btn"
                      >
                        +
                      </button>
                    </div>

                    <div className="item-price">
                      ₱{(Number(item.selling_price) * item.quantity).toFixed(2)}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product_id)}
                      className="btn-remove"
                      aria-label="Remove from cart"
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart-summary">
            <div className="summary-row">
              <span>Line items</span>
              <span>{cartTotals.lineCount}</span>
            </div>
            <div className="summary-row">
              <span>Subtotal</span>
              <span>₱{cartTotals.subtotal.toFixed(2)}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span>₱{cartTotals.total.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg w-full"
            onClick={handleCheckout}
            disabled={cart.length === 0 || checkoutLoading}
          >
            {checkoutLoading ? (
              <>
                <div className="spinner" />
                Processing…
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  />
                </svg>
                Complete sale
              </>
            )}
          </button>
        </div>
      </div>

      {showReceipt && lastTransaction && (
        <div className="modal-overlay" onClick={() => setShowReceipt(false)}>
          <div className="modal receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Transaction receipt</h3>
              <button type="button" className="modal-close" onClick={() => setShowReceipt(false)}>
                ×
              </button>
            </div>

            <div className="modal-body receipt-content">
              <div className="receipt-header">
                <h2>FLECS Store</h2>
                <p>Thank you for your purchase!</p>
              </div>

              <div className="receipt-info">
                <p>
                  <strong>Transaction ID:</strong> {lastTransaction.transaction_id}
                </p>
                <p>
                  <strong>Date:</strong> {new Date().toLocaleString()}
                </p>
              </div>

              <table className="receipt-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lastTransaction.items.map((item, index) => (
                    <tr key={`${item.product_id}-${index}`}>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>₱{Number(item.unit_price).toFixed(2)}</td>
                      <td>₱{Number(item.subtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="receipt-total">
                <strong>TOTAL:</strong>
                <strong>₱{Number(lastTransaction.total_amount).toFixed(2)}</strong>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowReceipt(false)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={printReceipt}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z"
                  />
                </svg>
                Print receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default POS;
