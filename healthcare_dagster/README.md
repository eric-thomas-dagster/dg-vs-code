# Healthcare Dagster Project

This project implements a healthcare data pipeline using Dagster, DLT for ingestion, BigQuery as the data warehouse, dbt for transformations, and Power BI for dashboards.

## Project Structure

- `healthcare_dagster/`: Contains Dagster assets and definitions.
- `healthcare_dbt/`: Contains dbt models for data transformations.

## Setup Instructions

1. Install Dependencies:
   
```bash
cd healthcare_dagster
poetry install
```

2. Set Up Google Cloud Credentials:
   - Create a service account in GCP with BigQuery access.
   - Download the JSON key file and update the paths in `healthcare_dbt/profiles.yml`.

3. Run Dagster:
   
```bash
dg dev
```

   Access the Dagster UI at http://localhost:3000

4. Run dbt:
   
```bash
cd healthcare_dbt
dbt run
```

5. Connect Power BI:
   - Use the BigQuery dataset created by dbt for your Power BI dashboards.

## Asset Lineage

This project maintains asset lineage through the `deps` parameter, ensuring that data transformations are tracked and managed effectively:

- **Bronze Layer**: `raw_healthcare_data` - Raw ingestion using DLT
- **Silver Layer**: `aggregated_patient_metrics` - Initial aggregation
- **Gold Layer**: `dbt_patient_metrics` - Final dbt transformations

