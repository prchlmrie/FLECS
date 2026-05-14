import axios from 'axios';
import { clearAuthSession } from './authSession';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

function isAuthLoginRequest(config) {
  const url = config?.url || '';
  return /\/auth\/login\/?(\?|$)/.test(url) || url.endsWith('/auth/login');
}

// Add token to all requests
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Expired/invalid JWT (401) → clear session and send user to login.
// Do not treat failed credential checks on POST /auth/login as session expiry (FR-01 vs FR-07).
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

  // Analytics
  getDashboard: () => axios.get(`${API_URL}/analytics/dashboard`),
  getRestockRecommendations: () => axios.get(`${API_URL}/analytics/restock-recommendations`),

  // Reports
  getSalesReport: (params) => axios.get(`${API_URL}/reports/sales`, { params }),
  getInventoryReport: () => axios.get(`${API_URL}/reports/inventory`),
};

export default api;
