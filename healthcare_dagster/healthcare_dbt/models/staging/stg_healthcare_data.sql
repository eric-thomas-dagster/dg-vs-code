with raw_data as (
    select * from `your-gcp-project-id.healthcare.raw_healthcare_data`
)

select
    patient_id,
    age,
    diagnosis,
    treatment_date
from raw_data

