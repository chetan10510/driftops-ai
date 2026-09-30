"""Reproducible baseline model with MLflow lineage and drift-ready features."""

from __future__ import annotations

import json
from pathlib import Path

import mlflow
import mlflow.sklearn
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


rng = np.random.default_rng(42)
rows = 2500
event_count = rng.poisson(18, rows)
revenue = rng.gamma(2.4, 34, rows)
days_inactive = rng.integers(0, 90, rows)
plan = rng.choice(["free", "team", "business"], rows, p=[0.38, 0.44, 0.18])
logit = -2.4 + days_inactive * 0.045 - event_count * 0.035 + (plan == "free") * 0.7
churned = rng.binomial(1, 1 / (1 + np.exp(-logit)))

X = np.column_stack([event_count, revenue, days_inactive, plan])
transform = ColumnTransformer([
    ("numeric", StandardScaler(), [0, 1, 2]),
    ("plan", OneHotEncoder(handle_unknown="ignore"), [3]),
])
pipeline = Pipeline([("features", transform), ("model", RandomForestClassifier(n_estimators=160, max_depth=8, random_state=42, class_weight="balanced"))])

with mlflow.start_run(run_name="churn-rf-v7"):
    pipeline.fit(X, churned)
    probabilities = pipeline.predict_proba(X)[:, 1]
    predictions = probabilities >= 0.5
    metrics = {
        "roc_auc": roc_auc_score(churned, probabilities),
        "precision": precision_score(churned, predictions),
        "recall": recall_score(churned, predictions),
    }
    mlflow.log_params({"rows": rows, "seed": 42, "estimators": 160, "feature_contract": "customer-features-v3"})
    mlflow.log_metrics(metrics)
    mlflow.sklearn.log_model(pipeline, "model")
    Path("artifacts").mkdir(exist_ok=True)
    Path("artifacts/metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
