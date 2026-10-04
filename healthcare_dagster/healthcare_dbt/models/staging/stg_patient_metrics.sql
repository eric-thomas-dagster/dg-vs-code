with aggregated as (
    select
        diagnosis,
        count(patient_id) as patient_count,
        avg(age) as avg_age
    from {{ ref('stg_healthcare_data') }}
    group by diagnosis
)

select * from aggregated

