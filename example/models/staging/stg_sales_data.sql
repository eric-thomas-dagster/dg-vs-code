{{ config(materialized='view') }}

-- Staging model for raw sales data
-- This would typically clean and standardize the raw data

with source_data as (
    select 
        date,
        product,
        sales,
        region,
        -- Add some basic transformations
        upper(trim(product)) as product_clean,
        upper(trim(region)) as region_clean,
        sales::decimal(10,2) as sales_amount
    from {{ ref('dbt_raw_sales_data') }}
    where sales > 0
)

select 
    date,
    product_clean as product,
    sales_amount as sales,
    region_clean as region,
    current_timestamp as _loaded_at
from source_data
