"""
Comprehensive Dagster example showcasing modern features for VS Code extension testing

This example includes:
- Assets with freshness policies and auto-materialization conditions
- Asset checks for data quality validation  
- Schedules and sensors
- Jobs and ops
- Resources and configuration
- DBT integration examples
"""

import pandas as pd
import random
from datetime import datetime, timedelta
from typing import Optional

from dagster import (
    asset, 
    AssetIn, 
    Config, 
    Definitions,
    ScheduleDefinition,
    SensorDefinition,
    SensorEvaluationContext,
    RunRequest,
    SkipReason,
    job,
    op,
    DefaultSensorStatus,
    DailyPartitionsDefinition,
    AutoMaterializePolicy,
    asset_check,
    AssetCheckResult,
    AssetCheckSeverity,
    ConfigurableResource,
    EnvVar,
    MaterializeResult,
    AssetMaterialization,
    MetadataValue,
    get_dagster_logger,
    define_asset_job,
    AssetSelection
)

try:
    from dagster_dbt import DbtCliResource, dbt_assets, build_dbt_asset_selection
    DBT_AVAILABLE = True
except ImportError:
    DBT_AVAILABLE = False
    print("⚠️  dagster-dbt not available. Install with: pip install dagster-dbt")

import os

# =============================================================================
# RESOURCES & CONFIGURATION
# =============================================================================

class DatabaseConfig(ConfigurableResource):
    """Database connection configuration"""
    host: str = "localhost"
    port: int = 5432
    database: str = "sales_db"
    username: str = EnvVar("DB_USERNAME")
    password: str = EnvVar("DB_PASSWORD")
    
    def get_connection_string(self) -> str:
        return f"postgresql://{self.username}:{self.password}@{self.host}:{self.port}/{self.database}"

class SalesAPIConfig(ConfigurableResource):
    """Sales API configuration"""
    base_url: str = "https://api.sales.company.com"
    api_key: str = EnvVar("SALES_API_KEY")
    timeout: int = 30

# =============================================================================
# DBT INTEGRATION
# =============================================================================

# DBT Resource Configuration
if DBT_AVAILABLE:
    dbt_resource = DbtCliResource(
        project_dir=os.path.dirname(__file__),  # Current directory containing dbt_project.yml
        profiles_dir=os.path.dirname(__file__),  # Directory containing profiles.yml
    )
else:
    dbt_resource = None

# =============================================================================
# PARTITIONS & POLICIES  
# =============================================================================

daily_partitions = DailyPartitionsDefinition(start_date="2024-01-01")

# Auto-materialization policy for production assets
eager_auto_materialize = AutoMaterializePolicy.eager()

# Auto-materialization policy includes freshness considerations
# For newer Dagster versions, freshness is handled via auto-materialize policies

# =============================================================================
# SOURCE DATA ASSETS
# =============================================================================

@asset(
    partitions_def=daily_partitions,
    auto_materialize_policy=eager_auto_materialize,
    compute_kind="python",
    metadata={
        "owner": "data-eng-team",
        "tier": "bronze", 
        "source": "sales-api"
    }
)
def raw_sales_data(
    context, 
    sales_api: SalesAPIConfig
) -> pd.DataFrame:
    """
    Raw sales data from external API
    
    Partitioned by day and auto-materialized when upstream data changes.
    Includes freshness policy to ensure data is updated daily.
    """
    logger = get_dagster_logger()
    partition_date = context.partition_key if context.has_partition_key else datetime.now().strftime("%Y-%m-%d")
    
    logger.info(f"Fetching sales data for {partition_date}")
    logger.info(f"API Base URL: {sales_api.base_url}")
    
    # Simulate API call with some realistic data
    num_records = random.randint(50, 200)
    
    data = {
        'date': [partition_date] * num_records,
        'transaction_id': [f"txn_{i:06d}" for i in range(num_records)],
        'product': [random.choice(['Widget A', 'Widget B', 'Widget C', 'Gadget X', 'Gadget Y']) for _ in range(num_records)],
        'sales': [round(random.uniform(50, 500), 2) for _ in range(num_records)],
        'region': [random.choice(['US', 'EU', 'APAC', 'LATAM']) for _ in range(num_records)],
        'customer_id': [f"cust_{random.randint(1000, 9999)}" for _ in range(num_records)],
        'channel': [random.choice(['online', 'retail', 'wholesale']) for _ in range(num_records)]
    }

    df = pd.DataFrame(data)
    
    # Log metadata about the materialization
    context.add_output_metadata({
        "num_records": len(df),
        "partition_date": partition_date,
        "columns": MetadataValue.json(list(df.columns)),
        "total_sales": round(df['sales'].sum(), 2),
        "unique_customers": df['customer_id'].nunique()
    })
    
    return df

@asset(
    auto_materialize_policy=eager_auto_materialize,
    compute_kind="python",
    metadata={
        "owner": "data-eng-team",
        "tier": "bronze",
        "source": "internal-db"
    }
)
def customer_data(database: DatabaseConfig) -> pd.DataFrame:
    """
    Customer master data from internal database
    
    Contains customer demographics and segmentation info.
    """
    logger = get_dagster_logger()
    logger.info(f"Connecting to database: {database.get_connection_string()}")
    
    # Simulate customer data
    customers = [f"cust_{i:04d}" for i in range(1000, 10000, 7)]
    
    data = {
        'customer_id': customers,
        'customer_name': [f"Customer {i}" for i in range(len(customers))],
        'segment': [random.choice(['Enterprise', 'SMB', 'Individual']) for _ in customers],
        'region': [random.choice(['US', 'EU', 'APAC', 'LATAM']) for _ in customers],
        'signup_date': [
            (datetime.now() - timedelta(days=random.randint(30, 1000))).strftime("%Y-%m-%d") 
            for _ in customers
        ],
        'lifetime_value': [round(random.uniform(100, 10000), 2) for _ in customers],
        'churn_risk': [random.choice(['Low', 'Medium', 'High']) for _ in customers]
    }
    
    return pd.DataFrame(data)

# =============================================================================
# TRANSFORMED DATA ASSETS
# =============================================================================

@asset(
    deps=[raw_sales_data],
    auto_materialize_policy=eager_auto_materialize,
    compute_kind="pandas",
    # Freshness managed via auto-materialize policy
    metadata={
        "owner": "data-eng-team", 
        "tier": "silver",
        "sla_minutes": 60
    }
)
def cleaned_sales_data(raw_sales_data: pd.DataFrame) -> pd.DataFrame:
    """
    Cleaned and validated sales data
    
    Applies data quality rules and standardization:
    - Removes null values and duplicates
    - Validates data types
    - Standardizes regional codes
    - Filters out test transactions
    """
    logger = get_dagster_logger()
    original_count = len(raw_sales_data)
    
    # Data cleaning pipeline
    cleaned = raw_sales_data.copy()
    
    # Remove nulls and duplicates
    cleaned = cleaned.dropna()
    cleaned = cleaned.drop_duplicates(subset=['transaction_id'])
    
    # Data type conversions
    cleaned['date'] = pd.to_datetime(cleaned['date'])
    cleaned['sales'] = pd.to_numeric(cleaned['sales'])
    
    # Data validation - remove invalid sales amounts
    cleaned = cleaned[cleaned['sales'] > 0]
    cleaned = cleaned[cleaned['sales'] < 10000]  # Remove unrealistic high values
    
    # Standardize region codes
    region_mapping = {
        'US': 'North America',
        'EU': 'Europe', 
        'APAC': 'Asia Pacific',
        'LATAM': 'Latin America'
    }
    cleaned['region_full'] = cleaned['region'].map(region_mapping)
    
    # Filter out test data
    cleaned = cleaned[~cleaned['customer_id'].str.contains('test', case=False, na=False)]
    
    final_count = len(cleaned)
    logger.info(f"Cleaned {original_count} records down to {final_count} ({100*final_count/original_count:.1f}% retention)")
    
    return cleaned

@asset(
    deps=[cleaned_sales_data, customer_data],
    auto_materialize_policy=eager_auto_materialize,
    metadata={
        "owner": "analytics-team",
        "tier": "silver"
    }
)
def enriched_sales_data(
    cleaned_sales_data: pd.DataFrame, 
    customer_data: pd.DataFrame
) -> pd.DataFrame:
    """
    Sales data enriched with customer information
    
    Joins sales transactions with customer master data to enable
    richer analysis and segmentation.
    """
    # Left join to preserve all sales records
    enriched = cleaned_sales_data.merge(
        customer_data[['customer_id', 'customer_name', 'segment', 'lifetime_value', 'churn_risk']], 
        on='customer_id',
        how='left'
    )
    
    # Calculate additional derived fields
    enriched['sales_per_ltv_ratio'] = enriched['sales'] / enriched['lifetime_value']
    enriched['high_value_transaction'] = enriched['sales'] > enriched['sales'].quantile(0.9)
    
    return enriched

# =============================================================================
# ANALYTICS ASSETS (GOLD TIER)
# =============================================================================

@asset(
    deps=[enriched_sales_data],
    auto_materialize_policy=eager_auto_materialize,
    metadata={
        "owner": "analytics-team",
        "tier": "gold",
        "dashboard_url": "https://company.com/dashboards/sales-summary"
    }
)
def sales_summary(enriched_sales_data: pd.DataFrame) -> pd.DataFrame:
    """Daily sales summary by region and channel"""
    summary = enriched_sales_data.groupby(['date', 'region', 'channel']).agg({
        'sales': ['sum', 'mean', 'count'],
        'customer_id': 'nunique',
        'transaction_id': 'count'
    }).round(2)
    
    # Flatten column names
    summary.columns = ['total_sales', 'avg_sales', 'num_transactions', 'unique_customers', 'total_transactions']
    summary = summary.reset_index()
    
    # Add growth metrics
    summary['sales_growth'] = summary.groupby(['region', 'channel'])['total_sales'].pct_change()
    
    return summary

@asset(
    deps=[enriched_sales_data],
    auto_materialize_policy=eager_auto_materialize,
    metadata={
        "owner": "product-team",
        "tier": "gold"
    }
)
def product_performance(enriched_sales_data: pd.DataFrame) -> pd.DataFrame:
    """Product performance metrics and trends"""
    performance = enriched_sales_data.groupby(['date', 'product']).agg({
        'sales': ['sum', 'mean', 'count'],
        'customer_id': 'nunique'
    })
    
    # Flatten column names
    performance.columns = ['total_sales', 'avg_sale_amount', 'num_transactions', 'unique_customers']
    performance = performance.reset_index()
    
    # Calculate performance rank by day
    performance['daily_sales_rank'] = performance.groupby('date')['total_sales'].rank(method='dense', ascending=False)
    
    return performance

@asset(
    deps=[enriched_sales_data],
    auto_materialize_policy=eager_auto_materialize,
    metadata={
        "owner": "customer-success-team",
        "tier": "gold"
    }
)
def customer_analytics(enriched_sales_data: pd.DataFrame) -> pd.DataFrame:
    """Customer behavior and segmentation analytics"""
    customer_stats = enriched_sales_data.groupby(['customer_id', 'segment', 'churn_risk']).agg({
        'sales': ['sum', 'mean', 'count'],
        'date': ['min', 'max']
    })
    
    # Flatten column names  
    customer_stats.columns = ['total_purchases', 'avg_purchase', 'num_purchases', 'first_purchase', 'last_purchase']
    customer_stats = customer_stats.reset_index()
    
    # Calculate customer metrics
    customer_stats['days_since_last_purchase'] = (
        pd.Timestamp.now() - pd.to_datetime(customer_stats['last_purchase'])
    ).dt.days
    
    customer_stats['purchase_frequency'] = customer_stats['num_purchases'] / (
        (pd.to_datetime(customer_stats['last_purchase']) - pd.to_datetime(customer_stats['first_purchase'])).dt.days + 1
    )
    
    return customer_stats

# =============================================================================
# ASSET CHECKS (DATA QUALITY)
# =============================================================================

@asset_check(asset=raw_sales_data, description="Ensure raw sales data has sufficient volume")
def check_raw_sales_volume(raw_sales_data: pd.DataFrame) -> AssetCheckResult:
    """Check that we received enough sales records for the day"""
    min_expected_records = 30
    actual_records = len(raw_sales_data)
    
    if actual_records < min_expected_records:
        return AssetCheckResult(
            passed=False,
            description=f"Only {actual_records} records found, expected at least {min_expected_records}",
            severity=AssetCheckSeverity.WARN,
            metadata={
                "actual_records": actual_records,
                "min_expected": min_expected_records
            }
        )
    
    return AssetCheckResult(
        passed=True,
        description=f"✅ Received {actual_records} sales records",
        metadata={"record_count": actual_records}
    )

@asset_check(asset=cleaned_sales_data, description="Validate data quality after cleaning")
def check_cleaned_data_quality(cleaned_sales_data: pd.DataFrame) -> AssetCheckResult:
    """Comprehensive data quality checks on cleaned sales data"""
    issues = []
    
    # Check for negative sales
    negative_sales = (cleaned_sales_data['sales'] < 0).sum()
    if negative_sales > 0:
        issues.append(f"{negative_sales} records with negative sales")
    
    # Check for future dates
    future_dates = (cleaned_sales_data['date'] > pd.Timestamp.now()).sum()
    if future_dates > 0:
        issues.append(f"{future_dates} records with future dates")
        
    # Check for missing regions
    missing_regions = cleaned_sales_data['region'].isna().sum()
    if missing_regions > 0:
        issues.append(f"{missing_regions} records with missing regions")
    
    # Check sales distribution (outlier detection)
    q99 = cleaned_sales_data['sales'].quantile(0.99)
    outliers = (cleaned_sales_data['sales'] > q99 * 5).sum()  # 5x the 99th percentile
    if outliers > 0:
        issues.append(f"{outliers} potential outlier sales amounts")
    
    passed = len(issues) == 0
    severity = AssetCheckSeverity.ERROR if not passed else AssetCheckSeverity.INFO
    
    description = "✅ All data quality checks passed" if passed else f"⚠️ Issues found: {'; '.join(issues)}"
    
    return AssetCheckResult(
        passed=passed,
        description=description,
        severity=severity,
        metadata={
            "total_records": len(cleaned_sales_data),
            "issues_found": len(issues),
            "negative_sales": negative_sales,
            "future_dates": future_dates,
            "missing_regions": missing_regions,
            "outliers": outliers
        }
    )

@asset_check(asset=sales_summary, description="Validate summary metrics against business rules")
def check_sales_summary_metrics(sales_summary: pd.DataFrame) -> AssetCheckResult:
    """Business logic validation for sales summary"""
    issues = []
    
    # Check for zero-sales regions (might indicate data pipeline issues)
    zero_sales_regions = (sales_summary['total_sales'] == 0).sum()
    if zero_sales_regions > 0:
        issues.append(f"{zero_sales_regions} region/channel combinations with zero sales")
    
    # Check average sales amount (should be reasonable)
    avg_sale_check = sales_summary['avg_sales']
    unreasonable_averages = ((avg_sale_check < 10) | (avg_sale_check > 1000)).sum()
    if unreasonable_averages > 0:
        issues.append(f"{unreasonable_averages} regions with unreasonable average sale amounts")
    
    # Check for missing data
    missing_data = sales_summary.isna().any(axis=1).sum()
    if missing_data > 0:
        issues.append(f"{missing_data} summary records with missing data")
    
    passed = len(issues) == 0
    
    return AssetCheckResult(
        passed=passed,
        description="✅ Summary metrics look good" if passed else f"⚠️ Issues: {'; '.join(issues)}",
        severity=AssetCheckSeverity.WARN if not passed else AssetCheckSeverity.INFO,
        metadata={
            "summary_records": len(sales_summary),
            "total_sales_amount": sales_summary['total_sales'].sum(),
            "avg_transaction_size": sales_summary['avg_sales'].mean()
        }
    )

# =============================================================================
# DBT ASSETS
# =============================================================================

# DBT Assets from the dbt project
if DBT_AVAILABLE and dbt_resource:
    manifest_path = os.path.join(os.path.dirname(__file__), "target", "manifest.json")
    
    @dbt_assets(
        manifest=manifest_path if os.path.exists(manifest_path) else None,
    )
    def dbt_analytics_assets(context, dbt: DbtCliResource):
        """
        DBT assets for analytics and data transformation
        
        This includes all DBT models from the project:
        - Staging models (stg_*)
        - Marts models (sales_summary, product_performance, etc.)
        """
        yield from dbt.cli(["build"], context=context).stream()
else:
    # Placeholder when DBT is not available
    dbt_analytics_assets = None

# =============================================================================
# JOBS & OPS
# =============================================================================

@op
def generate_report_summary(context) -> str:
    """Generate a summary report for daily email"""
    logger = get_dagster_logger()
    logger.info("Generating daily report summary...")
    
    # In real implementation, this would query materialized assets
    # and generate a proper report
    report_content = f"""
    Daily Sales Report - {datetime.now().strftime('%Y-%m-%d')}
    
    Summary:
    - Total Sales: $50,000
    - Regions: 4 active regions
    - Top Product: Widget A
    - Data Quality: All checks passed
    
    Generated at: {datetime.now().isoformat()}
    """
    
    return report_content.strip()

@op
def send_daily_report_email(context, report_content: str) -> str:
    """Send daily sales report via email"""
    logger = get_dagster_logger()
    logger.info("Sending daily sales report email...")
    logger.info(f"Report preview: {report_content[:100]}...")
    
    # In real implementation, would use email service
    # email_service.send(
    #     to=["sales-team@company.com"],
    #     subject=f"Daily Sales Report - {datetime.now().strftime('%Y-%m-%d')}",
    #     body=report_content
    # )
    
    return "Email sent successfully"

@op
def create_dashboard_data(context) -> pd.DataFrame:
    """Create sample data for dashboard update"""
    logger = get_dagster_logger()
    logger.info("Creating sample dashboard data...")
    
    # In real implementation, this would query materialized assets
    return pd.DataFrame({
        "metric": ["total_sales", "num_transactions", "avg_sale"],
        "value": [50000, 150, 333.33],
        "updated_at": [datetime.now().isoformat()] * 3
    })

@op  
def update_external_dashboard(context, sales_data: pd.DataFrame) -> str:
    """Update external BI dashboard with latest sales data"""
    logger = get_dagster_logger()
    logger.info(f"Updating dashboard with {len(sales_data)} records...")
    
    # In real implementation, would call dashboard API
    # dashboard_api.update_data(sales_data.to_json())
    
    return f"Dashboard updated with {len(sales_data)} records"

# =============================================================================
# ASSET-BASED JOBS
# =============================================================================

# Job that materializes all analytics assets (Gold tier)
daily_sales_report_job = define_asset_job(
    name="daily_sales_report_job",
    description="Daily job to generate and distribute sales reports - materializes all analytics assets",
    selection=AssetSelection.assets(
        sales_summary,
        product_performance, 
        customer_analytics
    ),
    tags={
        "team": "analytics",
        "tier": "gold",
        "frequency": "daily"
    }
)

# Job that materializes source and cleaned data for quality monitoring
data_quality_monitoring_job = define_asset_job(
    name="data_quality_monitoring_job", 
    description="Job to refresh data and run quality checks - materializes source and silver tier assets",
    selection=AssetSelection.assets(
        raw_sales_data,
        customer_data,
        cleaned_sales_data,
        enriched_sales_data
    ),
    tags={
        "team": "data-eng",
        "tier": "silver", 
        "frequency": "twice_daily"
    }
)

# Job for full pipeline refresh (all assets)
full_pipeline_refresh_job = define_asset_job(
    name="full_pipeline_refresh_job",
    description="Complete pipeline refresh - materializes all assets from bronze to gold",
    selection=AssetSelection.all(),
    tags={
        "team": "data-eng",
        "tier": "all",
        "frequency": "weekly"
    }
)

# Job for just the core transformation pipeline (Bronze -> Silver -> Gold)
core_pipeline_job = define_asset_job(
    name="core_pipeline_job",
    description="Core data transformation pipeline - raw data through to enriched analytics",
    selection=AssetSelection.assets(
        raw_sales_data,
        cleaned_sales_data, 
        enriched_sales_data,
        sales_summary
    ),
    tags={
        "team": "data-eng",
        "tier": "core",
        "frequency": "hourly"
    }
)

# =============================================================================
# TRADITIONAL OP-BASED JOBS (for operations not covered by assets)
# =============================================================================

@job
def notification_and_reporting_job():
    """
    Job for sending notifications and updating external systems
    
    This runs after asset materialization to handle downstream operations
    like sending emails and updating dashboards.
    """
    # Generate report content and dashboard data using ops
    report_summary = generate_report_summary()
    dashboard_data = create_dashboard_data()
    
    # Send notifications and update systems
    send_daily_report_email(report_summary)
    update_external_dashboard(dashboard_data)

# =============================================================================
# SCHEDULES
# =============================================================================

daily_sales_schedule = ScheduleDefinition(
    job=daily_sales_report_job,
    cron_schedule="0 9 * * *",  # 9 AM daily
    description="Generate and send daily sales reports to stakeholders",
    tags={
        "team": "analytics",
        "priority": "high"
    }
)

data_quality_schedule = ScheduleDefinition(
    job=data_quality_monitoring_job, 
    cron_schedule="0 6,18 * * *",  # 6 AM and 6 PM daily
    description="Run data quality checks twice daily",
    tags={
        "team": "data-eng",
        "priority": "critical"
    }
)

# Schedule for core pipeline (more frequent)
core_pipeline_schedule = ScheduleDefinition(
    job=core_pipeline_job,
    cron_schedule="0 */4 * * *",  # Every 4 hours
    description="Run core data transformation pipeline every 4 hours",
    tags={
        "team": "data-eng", 
        "priority": "medium"
    }
)

# Schedule for full pipeline refresh (weekly)
weekly_full_refresh_schedule = ScheduleDefinition(
    job=full_pipeline_refresh_job,
    cron_schedule="0 2 * * 0",  # 2 AM every Sunday
    description="Weekly full pipeline refresh - all assets from bronze to gold",
    tags={
        "team": "data-eng",
        "priority": "low"
    }
)

# Schedule for notifications (runs after daily sales report)
notification_schedule = ScheduleDefinition(
    job=notification_and_reporting_job,
    cron_schedule="30 9 * * *",  # 9:30 AM daily (30 min after sales report)
    description="Send notifications and update external systems after daily reports",
    tags={
        "team": "analytics",
        "priority": "medium"
    }
)

# =============================================================================
# SENSORS  
# =============================================================================

def sales_api_sensor(context: SensorEvaluationContext):
    """
    Sensor that triggers data refresh when new sales data is available
    
    In a real implementation, this would check an API, file system,
    or database for new data.
    """
    # Simulate checking for new data
    current_hour = datetime.now().hour
    
    # Trigger runs between 6 AM and 6 PM every hour
    if 6 <= current_hour <= 18:
        return RunRequest(
            run_key=f"sales_data_refresh_{datetime.now().strftime('%Y%m%d_%H')}",
            tags={
                "source": "sales_api_sensor",
                "trigger_time": datetime.now().isoformat()
            }
        )
    else:
        return SkipReason("Outside business hours - no data refresh needed")

sales_data_sensor = SensorDefinition(
    name="sales_api_sensor",
    evaluation_fn=sales_api_sensor,
    default_status=DefaultSensorStatus.STOPPED,  # Start manually
    description="Monitors sales API for new data and triggers refresh"
)

def data_quality_alert_sensor(context: SensorEvaluationContext):
    """
    Sensor that monitors asset check results and triggers alerts
    
    Would integrate with PagerDuty, Slack, or other alerting systems
    for critical data quality issues.
    """
    # In real implementation, would query asset check results
    # and trigger alerts for failures
    
    return SkipReason("No critical data quality issues detected")

quality_alert_sensor = SensorDefinition(
    name="data_quality_alert_sensor", 
    evaluation_fn=data_quality_alert_sensor,
    default_status=DefaultSensorStatus.RUNNING,
    description="Monitors data quality checks and sends alerts for critical issues"
)

# =============================================================================
# DEFINITIONS
# =============================================================================

defs = Definitions(
    assets=[
        # Source data
        raw_sales_data,
        customer_data,
        
        # Transformed data  
        cleaned_sales_data,
        enriched_sales_data,
        
        # Analytics assets
        sales_summary,
        product_performance, 
        customer_analytics,
        
        # DBT assets (when available)
        *([dbt_analytics_assets] if DBT_AVAILABLE and dbt_analytics_assets else []),
    ],
    
    asset_checks=[
        check_raw_sales_volume,
        check_cleaned_data_quality,
        check_sales_summary_metrics,
    ],
    
    jobs=[
        # Asset-based jobs
        daily_sales_report_job,
        data_quality_monitoring_job,
        full_pipeline_refresh_job,
        core_pipeline_job,
        
        # Op-based jobs  
        notification_and_reporting_job,
    ],
    
    schedules=[
        daily_sales_schedule,
        data_quality_schedule,
        core_pipeline_schedule,
        weekly_full_refresh_schedule,
        notification_schedule,
    ],
    
    sensors=[
        sales_data_sensor,
        quality_alert_sensor,
    ],
    
    resources={
        "database": DatabaseConfig(),
        "sales_api": SalesAPIConfig(),
        **({"dbt": dbt_resource} if DBT_AVAILABLE and dbt_resource else {}),
    },
)