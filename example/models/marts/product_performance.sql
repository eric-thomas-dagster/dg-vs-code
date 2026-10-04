{{ config(materialized='table') }}

-- Product performance metrics
-- Analyzes sales performance by product across all regions

with product_metrics as (
    select 
        product,
        count(distinct region) as regions_sold_in,
        sum(sales) as total_revenue,
        avg(sales) as avg_transaction_value,
        count(*) as total_transactions,
        min(date) as first_sale_date,
        max(date) as last_sale_date
    from {{ ref('stg_sales_data') }}
    group by product
),

product_rankings as (
    select 
        *,
        rank() over (order by total_revenue desc) as revenue_rank,
        rank() over (order by total_transactions desc) as volume_rank,
        rank() over (order by avg_transaction_value desc) as avg_value_rank
    from product_metrics
),

final as (
    select 
        product,
        regions_sold_in,
        total_revenue,
        avg_transaction_value,
        total_transactions,
        first_sale_date,
        last_sale_date,
        revenue_rank,
        volume_rank,
        avg_value_rank,
        -- Calculate days between first and last sale
        date_diff('day', first_sale_date, last_sale_date) as days_on_market,
        -- Revenue per day calculation
        case 
            when date_diff('day', first_sale_date, last_sale_date) > 0 
            then total_revenue / date_diff('day', first_sale_date, last_sale_date)
            else total_revenue 
        end as revenue_per_day
    from product_rankings
)

select * from final
order by revenue_rank
