import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  readOnboardingProgress,
  dismissDashboardOnboarding,
  restoreDashboardOnboarding,
  toggleCategoryAdded,
  toggleSupplierAdded,
  toggleProductAdded,
  toggleFirstSale,
} from '../onboardingStorage';
import './DashboardOnboarding.css';

function StepRow({ done, onToggle, children }) {
  return (
    <li className={`dashboard-onboarding-step ${done ? 'is-done' : ''}`}>
      <button 
        type="button"
        className="dashboard-onboarding-check" 
        onClick={onToggle}
        aria-label={done ? "Mark as incomplete" : "Mark as complete"}
      >
        {done ? '✓' : '○'}
      </button>
      <span className="dashboard-onboarding-step-body">{children}</span>
    </li>
  );
}

function DashboardOnboarding() {
  const [progress, setProgress] = useState(readOnboardingProgress);

  const refresh = useCallback(() => {
    setProgress(readOnboardingProgress());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('flecs-onboarding', refresh);
    return () => window.removeEventListener('flecs-onboarding', refresh);
  }, [refresh]);

  if (progress.dashboardDismissed) {
    return (
      <div className="dashboard-onboarding-wrap" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            restoreDashboardOnboarding();
            refresh();
          }}
        >
          Show quick guide
        </button>
      </div>
    );
  }

  const setupDone =
    progress.category && progress.supplier && progress.product;
  const pathDone = progress.supplier && progress.product && progress.firstSale;

  return (
    <div className="dashboard-onboarding-wrap">
      <section className="card dashboard-onboarding-card" aria-labelledby="flecs-getting-started-title">
        <div className="dashboard-onboarding-card-head">
          <div>
            <h2 id="flecs-getting-started-title" className="dashboard-onboarding-title">
              Getting started
            </h2>
            <p className="dashboard-onboarding-lead">
              New here? Tick these off in order — each link opens the right screen.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm dashboard-onboarding-dismiss"
            onClick={() => {
              dismissDashboardOnboarding();
              refresh();
            }}
          >
            Dismiss guides
          </button>
        </div>
        <ol className="dashboard-onboarding-list">
          <StepRow done={progress.category} onToggle={() => { toggleCategoryAdded(); refresh(); }}>
            <strong>Add your first category</strong> (for example Beverages or Snacks).{' '}
            <Link to="/settings">Open Settings → Categories</Link>
          </StepRow>
          <StepRow done={progress.supplier} onToggle={() => { toggleSupplierAdded(); refresh(); }}>
            <strong>Add your first supplier</strong> (who delivers to you).{' '}
            <Link to="/settings">Open Settings → Suppliers</Link>
          </StepRow>
          <StepRow done={progress.product} onToggle={() => { toggleProductAdded(); refresh(); }}>
            <strong>Add your first product</strong> to the shelf.{' '}
            <Link to="/inventory">Open Inventory</Link>
          </StepRow>
        </ol>
        {setupDone && (
          <p className="dashboard-onboarding-nice">Nice work — your catalog is ready.</p>
        )}
      </section>

      <section className="card dashboard-onboarding-card dashboard-onboarding-card-alt" aria-labelledby="flecs-first-steps-title">
        <h2 id="flecs-first-steps-title" className="dashboard-onboarding-title">
          3 steps to get your store running
        </h2>
        <p className="dashboard-onboarding-lead">
          A simple path from setup to your first sale. We check these off when you complete each action in FLECS.
        </p>
        <ol className="dashboard-onboarding-list">
          <StepRow done={progress.supplier} onToggle={() => { toggleSupplierAdded(); refresh(); }}>
            <strong>Add your first supplier</strong> (for example &quot;Local Bakery&quot;).{' '}
            <Link to="/settings">Settings → Suppliers</Link>
          </StepRow>
          <StepRow done={progress.product} onToggle={() => { toggleProductAdded(); refresh(); }}>
            <strong>Add your first product</strong> (for example &quot;Sourdough Bread&quot;).{' '}
            <Link to="/inventory">Inventory → Add Product</Link>
          </StepRow>
          <StepRow done={progress.firstSale} onToggle={() => { toggleFirstSale(); refresh(); }}>
            <strong>Make your first sale</strong> in the POS.{' '}
            <Link to="/pos">Open Point of Sale</Link>
          </StepRow>
        </ol>
        {pathDone && (
          <p className="dashboard-onboarding-nice">You&apos;re rolling — keep using POS for day-to-day sales.</p>
        )}
      </section>
    </div>
  );
}

export default DashboardOnboarding;
