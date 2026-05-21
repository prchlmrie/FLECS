# FLECS Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Fixed

- **Restocking page load time** — the recommendations API was slow because, for every low-stock SKU, it ran **14+ separate Random Forest and Holt-Winters fits** (walk-forward holdout retrained models each day). That could mean hundreds of `statsmodels` optimizations per request.
  - **Bulk SQL:** one query loads daily sales for all products instead of one query per SKU.
  - **Fast holdout:** RF and HW are fit **once** on pre-holdout data; holdout is scored without refitting each day. SES still uses lightweight walk-forward (cheap).
  - **Defaults:** Random Forest trees default to **30** (`FLECS_RF_N_ESTIMATORS`); Holt-Winters uses faster fit when `FLECS_HW_FAST_FIT=1` (default).
  - Restart the Flask backend after pulling so the new `forecasting.py` is loaded.

### Added

- **Holt-Winters (triple exponential smoothing)** as a third **comparison-only** demand model on the Restocking page (`backend/forecasting.py`, `statsmodels`).
  - Additive trend + weekly seasonality (`seasonal_periods=7`); falls back to Holt (trend-only) when history is shorter than two full seasons.
  - Per-SKU field: `hw_avg_daily_sales`; holdout metric: `hw_holdout_rmse`.
- **Documented winner basis** (`WINNER_BASIS` in API `forecast_models.winner_basis` and Restocking UI expandable **“Why does SES win?”** section).

### Changed

- Holdout comparison is now **three-way**: SES vs Random Forest vs Holt-Winters (same walk-forward protocol for all).
- `holdout_winner` is the model with the **lowest holdout RMSE** among models that ran successfully for that SKU — not the model used for restock math.
- Summary counts: `ses_wins`, `random_forest_wins`, `holt_winters_wins`, `items_evaluated`.
- Restocking table and CSV export include Holt-Winters forecast and RMSE columns.

### Why “SES wins” — basis (not a default pick)

The **SES wins** count on the dashboard means:

1. **Metric:** Root Mean Squared Error (RMSE) between predicted and **actual daily units sold**.
2. **Window:** The last **H** calendar days of history (default **14**), held out from training.
3. **Method:** **Walk-forward** — for each holdout day *t*, each model is fit only on sales **before** *t*, then predicts day *t*; RMSE is computed over all holdout days.
4. **Rule:** `holdout_winner = argmin(SRMSE, RF_RMSE, HW_RMSE)` for that product. **SES wins** increments only when `SES_RMSE` is the minimum for that SKU.

**SES is not chosen because it powers restock quantities.** Restock suggested qty still uses **SES only** (`primary_for_restock: ses`). A high SES win count means that, on recent history, SES one-step forecasts were **closer to actual daily sales** than Random Forest or Holt-Winters for more low-stock SKUs.

**Why SES often wins in practice:**

- Many SKUs have **short, sparse, or irregular** daily demand; SES’s single smoothed level is stable and hard to overfit.
- **Random Forest** can overfit when there are few non-zero sale days or weak lag structure.
- **Holt-Winters** needs roughly **two seasonal cycles** (default ≥ **28** days at weekly seasonality) and clearer weekly patterns; otherwise it is skipped (`insufficient_history` / `fit_failed`) or loses on RMSE.

### Random Forest (comparison only)

- Lag features (7 days) + day-of-week; holdout RMSE vs SES/HW.
- Dependency: `scikit-learn>=1.4.0`.

### Holt-Winters (comparison only)

- `statsmodels.tsa.holtwinters.ExponentialSmoothing` with `trend='add'`, `seasonal='add'`, `seasonal_periods=7`.
- Dependency: `statsmodels>=0.14.0`.

### Why units/day (or “Holdout winner”) is sometimes blank (—)

The Restocking table shows **expected units sold per day** from each model. A dash (**—**) means the backend did **not** produce a forecast for that model on that SKU — not a display bug.

**How the number is built**

- FLECS loads **daily units sold** from completed POS transactions for the last **90 days** (one value per calendar day; days with no sales are **0**).
- Each model turns that series into a **next-day demand** estimate (units/day). That value is what you see in the column.

**SES (units/day) — almost never blank**

- Simple Exponential Smoothing always runs if there is any history row (even all zeros).
- You may see **`0.00`** — that means “no recent sales signal,” not missing data.
- SES still drives **suggested restock quantity** even when the forecast is 0.

**Random Forest (units/day) — blank when**

| Status (API / hover) | Meaning |
|----------------------|---------|
| `insufficient_sales` | **No sales** in the 90-day window (total units sold under 0.5). Common for newly added products or items never sold through POS. |
| `insufficient_history` | Fewer than **21** days in the series, or fewer than **10** usable training rows after lag features (needs prior days with structure). |
| `sklearn_not_installed` | Server missing `scikit-learn` — run `pip install -r requirements.txt` in `backend`. |

**Holt-Winters (units/day) — blank when**

| Status (API / hover) | Meaning |
|----------------------|---------|
| `insufficient_sales` | Same as RF: **no POS sales** in the 90-day window. |
| `insufficient_history` | Fewer than **28** days of history (needs ~two weekly cycles for full seasonality). |
| `statsmodels_not_installed` | Server missing `statsmodels` — reinstall backend requirements. |
| `fit_failed` | History exists but the optimizer could not fit a stable HW/Holt model (e.g. all zeros, almost flat series, or very noisy sparse data). |

**Holdout winner — blank when**

- The series is too short for a **14-day walk-forward** comparison (needs enough days before holdout; typically under **21** days of data), **or**
- No model produced a valid holdout RMSE for that SKU (e.g. RF/HW never ran and comparison was skipped).

Hover the dash in the UI — the tooltip shows the `rf_status` / `hw_status` code; see the table above for plain language.

**What to do as a store owner**

1. **Sell the item through POS** — after real sales, RF and HW usually get enough signal (often within a few weeks of regular selling).
2. **Wait for history** — HW especially needs about **a month** of daily sales data.
3. **Use SES for restock either way** — suggested qty does not depend on RF/HW being filled in.

### Environment (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLECS_FORECAST_HISTORY_DAYS` | `90` | Days of daily sales history |
| `FLECS_SES_ALPHA` | `0.35` | SES smoothing factor |
| `FLECS_FORECAST_HOLDOUT_DAYS` | `14` | Holdout days for RMSE (alias: `FLECS_RF_HOLDOUT_DAYS`) |
| `FLECS_RF_N_LAGS` | `7` | Random Forest lag features |
| `FLECS_RF_N_ESTIMATORS` | `30` | Trees in the forest (lower = faster) |
| `FLECS_HW_FAST_FIT` | `1` | Faster Holt-Winters fit (`0` = full optimizer) |
| `FLECS_RF_MIN_HISTORY` | `21` | Minimum days before RF runs |
| `FLECS_HW_SEASONAL_PERIOD` | `7` | Weekly season length for Holt-Winters |
| `FLECS_HW_MIN_HISTORY` | `28` | Minimum days before full HW seasonality |

### Setup note

After pulling, reinstall backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Restart the Flask API so `forecasting.py` and `statsmodels` load.

### Earlier (UX / inventory)

- Guided onboarding checklist, tooltips, soft-delete (archived products), simplified stock pills.
- Fixed merge conflict markers in `Inventory.js` and `Restocking.js`.
