select
    diagnosis,
    patient_count,
    avg_age
from {{ ref('stg_patient_metrics') }}

