import axios from 'axios';
import { clearAuthSession } from './authSession';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function isAuthLoginRequest(config) {
  const url = config?.url || '';
  return /\/auth\/login\/?(\\?|$)/.test(url) || url.endsWith('/auth/login');
}

// Attach JWT to every request
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Expired/invalid JWT → clear session and redirect to login
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const cfg = error.config || {};
    if (status === 401 && !isAuthLoginRequest(cfg)) {
      clearAuthSession();
      window.location.assign(`${window.location.origin}/login`);
    }
    return Promise.reject(error);
  }
);

const api = {
  // Auth
  login: (credentials) => axios.post(`${API_URL}/auth/login`, credentials),
  register: (userData) => axios.post(`${API_URL}/auth/register`, userData),

  // Products
  getProducts: (params) => axios.get(`${API_URL}/products`, { params }),
  getProduct: (id) => axios.get(`${API_URL}/products/${id}`),
  createProduct: (data) => axios.post(`${API_URL}/products`, data),
  updateProduct: (id, data) => axios.put(`${API_URL}/products/${id}`, data),
  deleteProduct: (id) => axios.delete(`${API_URL}/products/${id}`),
  restoreProduct: (id) => axios.post(`${API_URL}/products/${id}/restore`),

  // Categories
  getCategories: () => axios.get(`${API_URL}/categories`),
  createCategory: (data) => axios.post(`${API_URL}/categories`, data),

  // Suppliers
  getSuppliers: () => axios.get(`${API_URL}/suppliers`),
  createSupplier: (data) => axios.post(`${API_URL}/suppliers`, data),

  // Transactions
  createTransaction: (data) => axios.post(`${API_URL}/transactions`, data),
  getTransactions: (params) => axios.get(`${API_URL}/transactions`, { params }),
  getTransaction: (id) => axios.get(`${API_URL}/transactions/${id}`),

  // Analytics (admin + owner)
  getDashboard: () => axios.get(`${API_URL}/analytics/dashboard`),
  getRestockRecommendations: () => axios.get(`${API_URL}/analytics/restock-recommendations`),

  // Inventory assistant (admin + owner)
  chatInventory: (message) => axios.post(`${API_URL}/chat/inventory`, { message }),

  // Reports (admin only)
  getSalesReport: (params) => axios.get(`${API_URL}/reports/sales`, { params }),
  getInventoryReport: () => axios.get(`${API_URL}/reports/inventory`),

  // Stock Requests (owner/admin creates, supplier acts)
  createStockRequest: (data) => axios.post(`${API_URL}/stock-requests`, data),
  getStockRequests: (params) => axios.get(`${API_URL}/stock-requests`, { params }),

  // Notifications
  getNotifications: () => axios.get(`${API_URL}/notifications`),
  markNotificationsRead: () => axios.put(`${API_URL}/notifications/read`),
  // Messages
  getMessageContacts: () => axios.get(`${API_URL}/messages/contacts`),
  getMessages: (userId) => axios.get(`${API_URL}/messages/${userId}`),
  sendMessage: (data) => axios.post(`${API_URL}/messages`, data),
  getUnreadMessageCount: () => axios.get(`${API_URL}/messages/unread-count`),
  // Supplier Portal
  getSupplierDashboard: () => axios.get(`${API_URL}/supplier/dashboard`),
  getSupplierLowStock: () => axios.get(`${API_URL}/supplier/low-stock`),
  getSupplierStockRequests: (params) => axios.get(`${API_URL}/supplier/stock-requests`, { params }),
  updateSupplierStockRequest: (id, data) => axios.put(`${API_URL}/supplier/stock-requests/${id}`, data),
};

export default api;

// Notifications
export const getNotifications = () => axios.get(`${API_URL}/notifications`);
export const markNotificationsRead = () => axios.put(`${API_URL}/notifications/read`);

// Messages
export const getMessageContacts = () => axios.get(`${API_URL}/messages/contacts`);
export const getMessages = (userId) => axios.get(`${API_URL}/messages/${userId}`);
export const sendMessage = (data) => axios.post(`${API_URL}/messages`, data);
export const getUnreadMessageCount = () => axios.get(`${API_URL}/messages/unread-count`);
