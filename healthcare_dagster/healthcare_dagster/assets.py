from dagster import asset, AssetExecutionContext
import pandas as pd
from dagster_dbt import dbt_assets, DbtCliResource
from pathlib import Path
import os

@asset(
    group_name="Bronze",
    compute_kind="dlt",
    metadata={"tier": "bronze"}
)
def raw_healthcare_data(context: AssetExecutionContext) -> pd.DataFrame:
    """Ingest patient data using DLT into BigQuery."""
    # Simulating DLT ingestion
    context.log.info("Loading raw healthcare data...")
    return pd.DataFrame({
        "patient_id": [1001, 1002, 1003],
        "age": [45, 67, 23],
        "diagnosis": ["Hypertension", "Diabetes", "Flu"],
        "treatment_date": ["2024-01-15", "2024-01-20", "2024-01-25"]
    })

@asset(
    deps=[raw_healthcare_data],
    group_name="Silver",
    compute_kind="dbt",
    metadata={"tier": "silver"}
)
def aggregated_patient_metrics(context: AssetExecutionContext, raw_healthcare_data: pd.DataFrame) -> pd.DataFrame:
    """Transform using dbt models: Calculate patient metrics by diagnosis."""
    context.log.info("Calculating patient metrics...")
    return raw_healthcare_data.groupby("diagnosis").agg({
        "patient_id": "count",
        "age": "mean"
    }).rename(columns={"patient_id": "patient_count", "age": "avg_age"}).reset_index()

# Get the dbt project directory relative to this file
DBT_PROJECT_DIR = Path(__file__).parent.parent / "healthcare_dbt"
manifest_path = DBT_PROJECT_DIR / "target" / "manifest.json"

@dbt_assets(
    manifest=str(manifest_path) if manifest_path.exists() else None,
    project_dir=str(DBT_PROJECT_DIR),
    group_name="Gold",
    metadata={"tier": "gold"}
)
def dbt_patient_metrics(context, dbt: DbtCliResource):
    """dbt models for final patient metrics transformations."""
    yield from dbt.cli(["build"], context=context).stream()
