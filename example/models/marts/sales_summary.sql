{{ config(materialized='table') }}

-- Sales summary by region
-- Aggregates daily sales data by region for reporting

with regional_sales as (
    select 
        region,
        date_trunc('month', date) as month,
        sum(sales) as total_sales,
        avg(sales) as avg_sales,
        count(*) as num_transactions
    from {{ ref('stg_sales_data') }}
    group by region, date_trunc('month', date)
),

final as (
    select 
        region,
        month,
        total_sales,
        avg_sales,
        num_transactions,
        -- Calculate month-over-month growth
        lag(total_sales) over (partition by region order by month) as prev_month_sales,
        case 
            when lag(total_sales) over (partition by region order by month) > 0 
            then ((total_sales - lag(total_sales) over (partition by region order by month)) 
                  / lag(total_sales) over (partition by region order by month)) * 100
            else null 
        end as month_over_month_growth_pct
    from regional_sales
)

select * from final
order by region, month
