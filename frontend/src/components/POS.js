import React, { useState, useEffect } from 'react';
import api from '../api';
import './POS.css';

function POS() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastTransaction, setLastTransaction] = useState(null);

  useEffect(() => {
    loadProducts();
  }, [searchTerm]);

  const loadProducts = async () => {
    try {
      const response = await api.getProducts({ search: searchTerm });
      setProducts(response.data.filter(p => p.stock_level > 0));
    } catch (err) {
      console.error('Failed to load products', err);
    }
  };

  const addToCart = (product) => {
    const existingItem = cart.find(item => item.product_id === product.product_id);
    
    if (existingItem) {
      if (existingItem.quantity >= product.stock_level) {
        setError(`Only ${product.stock_level} units available`);
        setTimeout(() => setError(''), 3000);
        return;
      }
      setCart(cart.map(item =>
        item.product_id === product.product_id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, {
        product_id: product.product_id,
        name: product.name,
        sku: product.sku,
        selling_price: product.selling_price,
        stock_level: product.stock_level,
        quantity: 1
      }]);
    }
  };

  const updateQuantity = (productId, newQuantity) => {
    const item = cart.find(i => i.product_id === productId);
    
    if (newQuantity > item.stock_level) {
      setError(`Only ${item.stock_level} units available`);
      setTimeout(() => setError(''), 3000);
      return;
    }

    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCart(cart.map(item =>
      item.product_id === productId
        ? { ...item, quantity: newQuantity }
        : item
    ));
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter(item => item.product_id !== productId));
  };

  const clearCart = () => {
    setCart([]);
  };

  const calculateTotal = () => {
    return cart.reduce((sum, item) => sum + (item.selling_price * item.quantity), 0);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) {
      setError('Cart is empty');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const transactionData = {
        items: cart.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity
        }))
      };

      const response = await api.createTransaction(transactionData);
      
      setLastTransaction({
        ...response.data,
        items: cart
      });
      
      setSuccess('Transaction completed successfully!');
      setShowReceipt(true);
      setCart([]);
      loadProducts(); // Reload to update stock levels
      
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.error || 'Transaction failed');
    } finally {
      setLoading(false);
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
          <p className="page-subtitle">Process sales transactions quickly and efficiently</p>
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

      <div className="pos-container">
        {/* Products Section */}
        <div className="pos-products">
          <div className="search-box">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
            </svg>
            <input
              type="text"
              placeholder="Search products by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
              autoFocus
            />
          </div>

          <div className="product-grid">
            {products.length === 0 ? (
              <div className="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="M21 21l-4.35-4.35"/>
                </svg>
                <p>No products found</p>
              </div>
            ) : (
              products.map(product => (
                <div
                  key={product.product_id}
                  className="product-card"
                  onClick={() => addToCart(product)}
                >
                  <div className="product-info">
                    <h4>{product.name}</h4>
                    <p className="product-sku monospace">{product.sku}</p>
                    <div className="product-footer">
                      <span className="product-price">₱{parseFloat(product.selling_price).toFixed(2)}</span>
                      <span className="product-stock">{product.stock_level} in stock</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Cart Section */}
        <div className="pos-cart">
          <div className="cart-header">
            <h3>Current Sale</h3>
            {cart.length > 0 && (
              <button className="btn-text" onClick={clearCart}>
                Clear All
              </button>
            )}
          </div>

          <div className="cart-items">
            {cart.length === 0 ? (
              <div className="empty-cart">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="9" cy="21" r="1"/>
                  <circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
                </svg>
                <p>Cart is empty</p>
                <p className="text-small">Add products to start a transaction</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.product_id} className="cart-item">
                  <div className="item-details">
                    <h4>{item.name}</h4>
                    <p className="monospace">{item.sku}</p>
                  </div>
                  
                  <div className="item-controls">
                    <div className="quantity-control">
                      <button
                        onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                        className="qty-btn"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.product_id, parseInt(e.target.value) || 0)}
                        className="qty-input"
                        min="1"
                        max={item.stock_level}
                      />
                      <button
                        onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                        className="qty-btn"
                      >
                        +
                      </button>
                    </div>
                    
                    <div className="item-price">
                      ₱{(item.selling_price * item.quantity).toFixed(2)}
                    </div>
                    
                    <button
                      onClick={() => removeFromCart(item.product_id)}
                      className="btn-remove"
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart-summary">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>₱{calculateTotal().toFixed(2)}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span>₱{calculateTotal().toFixed(2)}</span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg w-full"
            onClick={handleCheckout}
            disabled={cart.length === 0 || loading}
          >
            {loading ? (
              <>
                <div className="spinner"></div>
                Processing...
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                </svg>
                Complete Sale
              </>
            )}
          </button>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastTransaction && (
        <div className="modal-overlay" onClick={() => setShowReceipt(false)}>
          <div className="modal receipt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Transaction Receipt</h3>
              <button className="modal-close" onClick={() => setShowReceipt(false)}>×</button>
            </div>

            <div className="modal-body receipt-content">
              <div className="receipt-header">
                <h2>FLECS Store</h2>
                <p>Thank you for your purchase!</p>
              </div>

              <div className="receipt-info">
                <p><strong>Transaction ID:</strong> {lastTransaction.transaction_id}</p>
                <p><strong>Date:</strong> {new Date().toLocaleString()}</p>
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
                    <tr key={index}>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>₱{item.selling_price.toFixed(2)}</td>
                      <td>₱{(item.selling_price * item.quantity).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="receipt-total">
                <strong>TOTAL:</strong>
                <strong>₱{lastTransaction.total_amount.toFixed(2)}</strong>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowReceipt(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={printReceipt}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" />
                </svg>
                Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default POS;
