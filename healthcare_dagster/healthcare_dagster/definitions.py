from dagster import Definitions
from dagster_dbt import DbtCliResource
from .assets import raw_healthcare_data, aggregated_patient_metrics, dbt_patient_metrics
from .resources import bigquery_resource
from pathlib import Path

# Configure dbt resource
DBT_PROJECT_DIR = Path(__file__).parent.parent / "healthcare_dbt"
dbt_resource = DbtCliResource(
    project_dir=str(DBT_PROJECT_DIR),
    profiles_dir=str(DBT_PROJECT_DIR),
)

defs = Definitions(
    assets=[raw_healthcare_data, aggregated_patient_metrics, dbt_patient_metrics],
    resources={
        "bigquery": bigquery_resource,
        "dbt": dbt_resource,
    }
)

