import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

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

// Handle 401 errors
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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
