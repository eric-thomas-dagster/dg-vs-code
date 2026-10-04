{{ config(materialized='table') }}

-- Comprehensive sales report
-- Combines product and regional performance for executive reporting

with sales_base as (
    select 
        s.region,
        s.month,
        s.total_sales as regional_sales,
        s.month_over_month_growth_pct as regional_growth
    from {{ ref('dbt_sales_summary') }} s
),

product_base as (
    select 
        p.product,
        p.total_revenue,
        p.revenue_rank,
        p.avg_transaction_value,
        p.regions_sold_in
    from {{ ref('dbt_product_performance') }} p
),

cross_analysis as (
    select 
        sd.region,
        sd.product,
        sd.date,
        sd.sales,
        -- Join with aggregated data for context
        sb.regional_sales,
        sb.regional_growth,
        pb.total_revenue as product_total_revenue,
        pb.revenue_rank as product_rank,
        pb.avg_transaction_value as product_avg_value
    from {{ ref('stg_sales_data') }} sd
    left join sales_base sb on (
        sd.region = sb.region 
        and date_trunc('month', sd.date) = sb.month
    )
    left join product_base pb on sd.product = pb.product
),

final as (
    select 
        region,
        product,
        date,
        sales,
        regional_sales,
        regional_growth,
        product_total_revenue,
        product_rank,
        product_avg_value,
        -- Calculate performance vs. product average
        case 
            when product_avg_value > 0 
            then (sales / product_avg_value) * 100
            else null 
        end as performance_vs_product_avg
    from cross_analysis
)

select * from final
order by date desc, region, product_rank
