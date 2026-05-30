"""
Demand forecasting: SES (restock policy), Random Forest, and Holt-Winters (comparison).

Performance: one SQL bulk load per request; RF/HW fit once per product for point forecasts
and once for holdout (not per holdout day). SES holdout remains cheap walk-forward.
"""

from __future__ import annotations

import math
import os
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import numpy as np

try:
    from sklearn.ensemble import RandomForestRegressor
except ImportError:  # pragma: no cover
    RandomForestRegressor = None  # type: ignore

try:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
except ImportError:  # pragma: no cover
    ExponentialSmoothing = None  # type: ignore

FORECAST_HISTORY_DAYS = int(os.environ.get('FLECS_FORECAST_HISTORY_DAYS', '90'))
SES_ALPHA = float(os.environ.get('FLECS_SES_ALPHA', '0.35'))
HOLDOUT_DAYS = int(os.environ.get('FLECS_FORECAST_HOLDOUT_DAYS', os.environ.get('FLECS_RF_HOLDOUT_DAYS', '14')))
RF_N_LAGS = int(os.environ.get('FLECS_RF_N_LAGS', '7'))
RF_N_ESTIMATORS = int(os.environ.get('FLECS_RF_N_ESTIMATORS', '30'))
MIN_POINTS_FOR_RF = int(os.environ.get('FLECS_RF_MIN_HISTORY', '21'))
HW_SEASONAL_PERIOD = int(os.environ.get('FLECS_HW_SEASONAL_PERIOD', '7'))
MIN_POINTS_FOR_HW = int(os.environ.get('FLECS_HW_MIN_HISTORY', '28'))
HW_FAST_FIT = os.environ.get('FLECS_HW_FAST_FIT', '1').lower() in ('1', 'true', 'yes')

RF_HOLDOUT_DAYS = HOLDOUT_DAYS

WINNER_BASIS: dict[str, Any] = {
    'metric': 'holdout_rmse',
    'metric_label': 'Root Mean Squared Error (RMSE)',
    'rule': 'lowest_rmse_wins',
    'evaluation': 'single_split_holdout',
    'holdout_days_default': HOLDOUT_DAYS,
    'models_compared': ['ses', 'random_forest', 'holt_winters'],
    'primary_for_restock': 'ses',
    'summary': (
        'A model "wins" for a SKU when its holdout RMSE is the smallest among models that '
        'successfully ran on that product. SES wins in the dashboard count only when '
        'SES_RMSE <= RF_RMSE and SES_RMSE <= HW_RMSE for that item — not because SES is '
        'the default restock model.'
    ),
    'why_ses_often_wins': (
        'Independent retailers often have short, sparse, or noisy daily sales. SES uses a '
        'single smoothed level and tends to generalize well on those series. Random Forest '
        'can overfit when history is thin; Holt-Winters needs at least two full seasonal '
        'cycles (e.g. 14+ days at weekly seasonality) and stable patterns — otherwise it '
        'is skipped or loses on RMSE. When SES wins, it means recent one-step forecasts '
        'were closer to actual daily units sold than the alternatives in the holdout window.'
    ),
    'steps': [
        'Build daily units-sold series for the last N days (default 90).',
        'Reserve the last H days (default 14) as holdout.',
        'SES: one-step forecast each holdout day using only prior days (walk-forward).',
        'RF/HW: fit once on pre-holdout data; score holdout without refitting each day.',
        'Compute RMSE; assign holdout_winner to the lowest RMSE for that SKU.',
    ],
    'performance_note': (
        'Restocking uses bulk sales SQL and at most two RF + two HW fits per product. '
        'Earlier versions retrained RF/HW on every holdout day and were much slower.'
    ),
    'blank_forecast_reasons': {
        'ses': (
            'SES almost always shows a number (including 0.00). Blank only if the API row is missing.'
        ),
        'random_forest': {
            'insufficient_sales': 'No POS sales in the history window — RF cannot learn demand.',
            'insufficient_history': 'Fewer than 21 days or not enough lag rows to train.',
            'sklearn_not_installed': 'Install scikit-learn on the backend server.',
        },
        'holt_winters': {
            'insufficient_sales': 'No POS sales in the history window — HW cannot learn demand.',
            'insufficient_history': 'Fewer than 28 days — need more history for weekly seasonality.',
            'statsmodels_not_installed': 'Install statsmodels on the backend server.',
            'fit_failed': 'Sales history too flat, sparse, or unstable to fit HW/Holt.',
        },
        'holdout_winner': (
            'Blank when the holdout comparison did not run (short history) or no model returned RMSE.'
        ),
    },
}

FORECAST_STATUS_LABELS: dict[str, str] = {
    'insufficient_sales': 'No sales in the last 90 days (POS history empty for this SKU)',
    'insufficient_history': 'Not enough daily history for this model',
    'sklearn_not_installed': 'Random Forest unavailable (scikit-learn not installed on server)',
    'statsmodels_not_installed': 'Holt-Winters unavailable (statsmodels not installed on server)',
    'fit_failed': 'Could not fit Holt-Winters on this sales pattern',
    'ok': 'Forecast available',
}


def _calendar_series(day_map: dict[str, float], horizon_days: int) -> list[float]:
    horizon_days = max(1, int(horizon_days))
    today = date.today()
    return [
        day_map.get((today - timedelta(days=i)).isoformat(), 0.0)
        for i in range(horizon_days - 1, -1, -1)
    ]


def load_daily_sales_bulk(db, product_ids: list[int], horizon_days: int = FORECAST_HISTORY_DAYS) -> dict[int, list[float]]:
    """One query for all products → dict of daily sales series (oldest → newest)."""
    if not product_ids:
        return {}
    horizon_days = max(1, int(horizon_days))
    placeholders = ','.join('?' * len(product_ids))
    rows = db.execute(
        f'''
        SELECT ti.product_id, DATE(t.transaction_date) AS day, SUM(ti.quantity) AS qty
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.transaction_id
        WHERE ti.product_id IN ({placeholders})
          AND DATE(t.transaction_date) >= DATE('now', ?)
          AND t.status = 'completed'
        GROUP BY ti.product_id, day
        ''',
        (*product_ids, f'-{horizon_days} days'),
    ).fetchall()
    day_maps: dict[int, dict[str, float]] = defaultdict(dict)
    for row in rows:
        day_maps[int(row['product_id'])][row['day']] = float(row['qty'] or 0)
    return {pid: _calendar_series(day_maps.get(pid, {}), horizon_days) for pid in product_ids}


def simple_exponential_smoothing_level(series: list[float], alpha: float) -> float:
    if not series:
        return 0.0
    alpha = max(0.01, min(0.99, float(alpha)))
    level = float(series[0])
    for x in series[1:]:
        level = alpha * float(x) + (1.0 - alpha) * level
    return level


def _has_sales(series: list[float]) -> bool:
    return sum(float(x) for x in series) >= 0.5


def _lag_feature_row(series: list[float], index: int, n_lags: int) -> list[float]:
    row = [float(series[index - j]) for j in range(1, n_lags + 1)]
    row.append(float(index % 7))
    row.append(float(np.mean(series[max(0, index - 7) : index])))
    return row


def _build_supervised(series: list[float], n_lags: int) -> tuple[np.ndarray, np.ndarray] | None:
    if len(series) <= n_lags:
        return None
    rows_x, rows_y = [], []
    for i in range(n_lags, len(series)):
        rows_x.append(_lag_feature_row(series, i, n_lags))
        rows_y.append(float(series[i]))
    return np.array(rows_x, dtype=float), np.array(rows_y, dtype=float)


def _fit_random_forest(series: list[float], n_lags: int = RF_N_LAGS):
    if RandomForestRegressor is None:
        return None, 'sklearn_not_installed'
    supervised = _build_supervised(series, n_lags)
    if supervised is None:
        return None, 'insufficient_history'
    x_mat, y_vec = supervised
    if len(y_vec) < 10:
        return None, 'insufficient_history'
    model = RandomForestRegressor(
        n_estimators=RF_N_ESTIMATORS,
        max_depth=8,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=1,
    )
    model.fit(x_mat, y_vec)
    return model, None


def _rf_predict_at(model, series: list[float], index: int) -> float | None:
    if index < RF_N_LAGS:
        return None
    features = np.array([_lag_feature_row(series, index, RF_N_LAGS)], dtype=float)
    return max(0.0, float(model.predict(features)[0]))


def _rf_forecast_from_model(
    series: list[float], model, train_end: int, holdout: int, fallback: list[float]
) -> list[float]:
    preds = []
    for i in range(holdout):
        t = train_end + i
        val = _rf_predict_at(model, series, t)
        preds.append(val if val is not None else fallback[i])
    return preds


def _fit_holt_winters(train: list[float], seasonal_periods: int = HW_SEASONAL_PERIOD):
    if len(train) < MIN_POINTS_FOR_HW or not _has_sales(train):
        return None, 'insufficient_history' if len(train) < MIN_POINTS_FOR_HW else 'insufficient_sales'
    if ExponentialSmoothing is None:
        return None, 'statsmodels_not_installed'

    arr = np.asarray(train, dtype=float)
    try:
        optimized = not HW_FAST_FIT
        if len(arr) >= seasonal_periods * 2:
            model = ExponentialSmoothing(
                arr,
                trend='add',
                seasonal='add',
                seasonal_periods=seasonal_periods,
            )
        else:
            model = ExponentialSmoothing(arr, trend='add', seasonal=None)
        fit = model.fit(optimized=optimized, use_brute=False)
        return fit, None
    except Exception:
        return None, 'fit_failed'


def _hw_multi_step_forecast(fit, steps: int) -> list[float]:
    fc = fit.forecast(steps)
    return [max(0.0, float(x)) for x in fc]


def random_forest_next_day_forecast(series: list[float]) -> tuple[float | None, str | None]:
    if len(series) < MIN_POINTS_FOR_RF:
        return None, 'insufficient_history'
    if not _has_sales(series):
        return None, 'insufficient_sales'

    model, reason = _fit_random_forest(series)
    if model is None:
        return None, reason
    val = _rf_predict_at(model, series, len(series))
    return val, None


def holt_winters_next_day_forecast(
    series: list[float],
    seasonal_periods: int = HW_SEASONAL_PERIOD,
) -> tuple[float | None, str | None]:
    if len(series) < MIN_POINTS_FOR_HW:
        return None, 'insufficient_history'
    if not _has_sales(series):
        return None, 'insufficient_sales'

    fit, reason = _fit_holt_winters(series, seasonal_periods)
    if fit is None:
        return None, reason
    return _hw_multi_step_forecast(fit, 1)[0], None


def _rmse(actuals: list[float], preds: list[float]) -> float:
    if not actuals:
        return 0.0
    return math.sqrt(sum((a - p) ** 2 for a, p in zip(actuals, preds)) / len(actuals))


def _pick_holdout_winner(rmses: dict[str, float | None]) -> str | None:
    valid = {k: v for k, v in rmses.items() if v is not None}
    if not valid:
        return None
    return min(valid, key=valid.get)


def compare_models_holdout(
    series: list[float],
    alpha: float = SES_ALPHA,
    holdout_days: int = HOLDOUT_DAYS,
) -> dict[str, Any]:
    """
    Single-split holdout: train RF/HW once on pre-holdout data; SES uses cheap walk-forward.
    """
    n = len(series)
    holdout = min(holdout_days, max(3, n // 5))
    if n < MIN_POINTS_FOR_RF or holdout < 3:
        return {
            'holdout_days': 0,
            'ses_holdout_rmse': None,
            'rf_holdout_rmse': None,
            'hw_holdout_rmse': None,
            'holdout_winner': None,
            'rf_status': 'insufficient_history',
            'hw_status': 'insufficient_history',
        }

    train_end = n - holdout
    train = [float(x) for x in series[:train_end]]
    actuals = [float(x) for x in series[train_end:n]]

    ses_preds = [
        simple_exponential_smoothing_level([float(x) for x in series[: train_end + i]], alpha)
        for i in range(holdout)
    ]

    rf_status = 'ok'
    hw_status = 'ok'

    if not _has_sales(series):
        return {
            'holdout_days': holdout,
            'ses_holdout_rmse': round(_rmse(actuals, ses_preds), 4),
            'rf_holdout_rmse': None,
            'hw_holdout_rmse': None,
            'holdout_winner': 'ses',
            'rf_status': 'insufficient_sales',
            'hw_status': 'insufficient_sales',
        }

    rf_model, rf_reason = _fit_random_forest(train)
    if rf_model is None:
        rf_status = rf_reason or 'insufficient_history'
        rf_preds = ses_preds
    else:
        rf_preds = _rf_forecast_from_model(series, rf_model, train_end, holdout, ses_preds)

    hw_fit, hw_reason = _fit_holt_winters(train)
    if hw_fit is None:
        hw_status = hw_reason or 'insufficient_history'
        hw_preds = ses_preds
    else:
        hw_preds = _hw_multi_step_forecast(hw_fit, holdout)

    ses_rmse = round(_rmse(actuals, ses_preds), 4)
    rf_rmse = round(_rmse(actuals, rf_preds), 4) if rf_status == 'ok' else None
    hw_rmse = round(_rmse(actuals, hw_preds), 4) if hw_status == 'ok' else None

    winner = _pick_holdout_winner({
        'ses': ses_rmse,
        'random_forest': rf_rmse,
        'holt_winters': hw_rmse,
    })

    return {
        'holdout_days': holdout,
        'ses_holdout_rmse': ses_rmse,
        'rf_holdout_rmse': rf_rmse,
        'hw_holdout_rmse': hw_rmse,
        'holdout_winner': winner,
        'rf_status': rf_status,
        'hw_status': hw_status,
    }


def build_product_forecasts(series: list[float], alpha: float = SES_ALPHA) -> dict[str, Any]:
    """SES + RF + Holt-Winters forecasts and holdout comparison for one product."""
    ses_daily = simple_exponential_smoothing_level(series, alpha)

    if not _has_sales(series):
        return {
            'ses_units_per_day': round(ses_daily, 4),
            'rf_units_per_day': None,
            'hw_units_per_day': None,
            'difference_units': None,
            'difference_pct': None,
            'rf_status': 'insufficient_sales',
            'hw_status': 'insufficient_sales',
            'holdout_days': 0,
            'ses_holdout_rmse': None,
            'rf_holdout_rmse': None,
            'hw_holdout_rmse': None,
            'holdout_winner': None,
        }

    rf_daily, rf_reason = random_forest_next_day_forecast(series)
    hw_daily, hw_reason = holt_winters_next_day_forecast(series)
    comparison = compare_models_holdout(series, alpha=alpha)

    rf_units = rf_daily if rf_daily is not None else None
    hw_units = hw_daily if hw_daily is not None else None
    diff_units = None
    diff_pct = None
    if rf_units is not None:
        diff_units = round(rf_units - ses_daily, 4)
        if ses_daily > 0:
            diff_pct = round(100.0 * diff_units / ses_daily, 1)

    return {
        'ses_units_per_day': round(ses_daily, 4),
        'rf_units_per_day': round(rf_units, 4) if rf_units is not None else None,
        'hw_units_per_day': round(hw_units, 4) if hw_units is not None else None,
        'difference_units': diff_units,
        'difference_pct': diff_pct,
        'rf_status': rf_reason or comparison.get('rf_status') or 'ok',
        'hw_status': hw_reason or comparison.get('hw_status') or 'ok',
        **comparison,
    }


def compare_ses_vs_random_forest(
    series: list[float],
    alpha: float = SES_ALPHA,
    holdout_days: int = HOLDOUT_DAYS,
) -> dict[str, Any]:
    return compare_models_holdout(series, alpha=alpha, holdout_days=holdout_days)
