"""
Fits logistic-regression weights for student_risk_scores from historical outcomes, to replace
the hand-set 'v2-hand-weighted-2026-08' weights in risk_model_versions once a school has enough
history to make this meaningful (a rough rule of thumb: at least a few hundred withdrawn/
transferred students with at least one term of prior attendance/exam/payment data each — a
brand-new school won't have this for a while, which is exactly why v2 ships hand-weighted).

NOT run automatically. This is an offline, manual step: an operator runs it periodically
(quarterly, say), reviews the fitted weights against the hand-set ones for sanity, and if they
look reasonable, inserts a new row into risk_model_versions (method='fitted_logistic_regression')
and updates the v_model_version constant in recompute_student_risk_scores(). The schema doesn't
change either way — student_risk_scores.model_version is exactly what makes that swap traceable.

Usage:
    pip install psycopg2-binary scikit-learn pandas
    python fit_risk_weights.py --db-url "$SUPABASE_DB_URL"
"""

import argparse
import json

import pandas as pd
import psycopg2
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

# The label: did this student withdraw/transfer within ~one term of when these factors were
# true? Historical features would need to have been snapshotted at the time (not read from
# today's student_risk_scores, which only holds the current row per student) — in practice this
# means student_risk_scores should grow a lightweight history table before this script is useful
# for anything beyond a sanity-check dry run. Flagged here rather than pretending this query
# already works end-to-end today.
FEATURE_QUERY = """
    select
        srs.factors ->> 'attendance_rate_30d' as attendance_rate_30d,
        srs.factors ->> 'attendance_rate_prior_30d' as attendance_rate_prior_30d,
        srs.factors ->> 'latest_exam_average' as latest_exam_average,
        srs.factors ->> 'prior_exam_average' as prior_exam_average,
        srs.factors ->> 'overdue_days' as overdue_days,
        srs.factors ->> 'open_discipline_cases' as open_discipline_cases,
        (st.status in ('withdrawn', 'transferred')) as withdrew
    from student_risk_scores srs
    join students st on st.id = srs.student_id
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", required=True, help="Postgres connection string (service role)")
    args = parser.parse_args()

    with psycopg2.connect(args.db_url) as conn:
        df = pd.read_sql(FEATURE_QUERY, conn)

    df = df.apply(pd.to_numeric, errors="ignore").fillna(0)
    feature_cols = [
        "attendance_rate_30d",
        "attendance_rate_prior_30d",
        "latest_exam_average",
        "prior_exam_average",
        "overdue_days",
        "open_discipline_cases",
    ]
    X = df[feature_cols]
    y = df["withdrew"].astype(int)

    if y.sum() < 30:
        raise SystemExit(
            f"Only {y.sum()} withdrawn/transferred examples found — too few to fit reliably. "
            "Keep the hand-weighted model until there's more history."
        )

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    model = LogisticRegression(max_iter=1000)
    model.fit(X_scaled, y)

    weights = dict(zip(feature_cols, model.coef_[0].round(4).tolist()))
    print(json.dumps({"weights": weights, "intercept": round(float(model.intercept_[0]), 4)}, indent=2))
    print(
        "\nReview these against the current hand-set weights before using them. "
        "If reasonable, insert a new risk_model_versions row and update recompute_student_risk_scores()."
    )


if __name__ == "__main__":
    main()
