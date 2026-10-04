select
    diagnosis,
    sum(patient_count) as total_patients,
    avg(avg_age) as average_age
from {{ ref('int_patient_metrics') }}
group by diagnosis

