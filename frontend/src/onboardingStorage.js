const KEYS = {
  category: 'flecs_onboarding_category',
  supplier: 'flecs_onboarding_supplier',
  product: 'flecs_onboarding_product',
  firstSale: 'flecs_onboarding_first_sale',
  dashboardDismissed: 'flecs_dashboard_onboarding_dismissed',
};

function notify() {
  window.dispatchEvent(new CustomEvent('flecs-onboarding'));
}

export function markCategoryAdded() {
  localStorage.setItem(KEYS.category, '1');
  notify();
}

export function markSupplierAdded() {
  localStorage.setItem(KEYS.supplier, '1');
  notify();
}

export function markProductAdded() {
  localStorage.setItem(KEYS.product, '1');
  notify();
}

export function markFirstSale() {
  localStorage.setItem(KEYS.firstSale, '1');
  notify();
}

export function toggleCategoryAdded() {
  localStorage.getItem(KEYS.category) === '1' ? localStorage.removeItem(KEYS.category) : localStorage.setItem(KEYS.category, '1');
  notify();
}

export function toggleSupplierAdded() {
  localStorage.getItem(KEYS.supplier) === '1' ? localStorage.removeItem(KEYS.supplier) : localStorage.setItem(KEYS.supplier, '1');
  notify();
}

export function toggleProductAdded() {
  localStorage.getItem(KEYS.product) === '1' ? localStorage.removeItem(KEYS.product) : localStorage.setItem(KEYS.product, '1');
  notify();
}

export function toggleFirstSale() {
  localStorage.getItem(KEYS.firstSale) === '1' ? localStorage.removeItem(KEYS.firstSale) : localStorage.setItem(KEYS.firstSale, '1');
  notify();
}

export function readOnboardingProgress() {
  return {
    category: localStorage.getItem(KEYS.category) === '1',
    supplier: localStorage.getItem(KEYS.supplier) === '1',
    product: localStorage.getItem(KEYS.product) === '1',
    firstSale: localStorage.getItem(KEYS.firstSale) === '1',
    dashboardDismissed: localStorage.getItem(KEYS.dashboardDismissed) === '1',
  };
}

export function dismissDashboardOnboarding() {
  localStorage.setItem(KEYS.dashboardDismissed, '1');
  notify();
}

export function restoreDashboardOnboarding() {
  localStorage.removeItem(KEYS.dashboardDismissed);
  notify();
}
