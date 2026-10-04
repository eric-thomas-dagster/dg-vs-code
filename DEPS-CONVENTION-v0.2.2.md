# ✅ Fixed: Using `deps=` Convention - Version 0.2.2

## What Was Updated

The guidelines were incorrectly using `ins=` and `AssetIn()` for asset dependencies, but your codebase (demo-gen-main) uses **`deps=`** instead!

### Your Convention (from example/dagster_example.py):

```python
@asset(
    deps=[raw_sales_data],  # ✅ This is the pattern you use!
    compute_kind="pandas",
    metadata={"owner": "data-team", "tier": "silver"}
)
def cleaned_sales_data(raw_sales_data: pd.DataFrame) -> pd.DataFrame:
    """Clean and validate sales data"""
    return raw_sales_data[raw_sales_data["sales"] > 0]
```

### What I Fixed

**Updated both guidelines to match your convention:**

1. **`guidelinesManager.ts`** - Built-in guidelines now use:
   - `deps=[upstream_asset]` instead of `ins={"upstream_asset": AssetIn()}`
   - Proper Bronze → Silver → Gold tier pattern
   - `AssetExecutionContext` with logging
   - Type hints (`pd.DataFrame`, `dict`)

2. **`dagster-writing-guidelines.md`** - Your custom guidelines now show:
   - 3-tier pipeline example (raw_data → clean_data → metrics)
   - `deps=` for all dependencies
   - Bronze/Silver/Gold tier metadata

### Example Pattern Now Generated:

```python
from dagster import asset, AssetExecutionContext
import pandas as pd

# Bronze Tier: Ingest
@asset(
    group_name="Ingest",
    compute_kind="api",
    metadata={"owner": "data-team", "tier": "bronze"}
)
def raw_sales_data(context: AssetExecutionContext) -> pd.DataFrame:
    context.log.info("Loading raw sales data...")
    return pd.DataFrame({
        "transaction_id": range(1, 101),
        "amount": [100, 200, 150] * 33 + [100]
    })

# Silver Tier: Transform
@asset(
    deps=[raw_sales_data],  # Creates lineage!
    group_name="Transform",
    compute_kind="pandas",
    metadata={"owner": "data-team", "tier": "silver"}
)
def cleaned_sales_data(context: AssetExecutionContext, raw_sales_data: pd.DataFrame) -> pd.DataFrame:
    context.log.info("Cleaning sales data...")
    return raw_sales_data[raw_sales_data["amount"] > 0].drop_duplicates()

# Gold Tier: Analytics
@asset(
    deps=[cleaned_sales_data],  # Creates lineage!
    group_name="Analytics",
    compute_kind="python",
    metadata={"owner": "analytics-team", "tier": "gold"}
)
def sales_summary(context: AssetExecutionContext, cleaned_sales_data: pd.DataFrame) -> dict:
    context.log.info("Calculating summary metrics...")
    return {
        "total_revenue": cleaned_sales_data["amount"].sum(),
        "transaction_count": len(cleaned_sales_data)
    }
```

**Lineage created:** raw_sales_data → cleaned_sales_data → sales_summary

## Why Both `deps=` and `ins=` Work

- **`deps=[asset1, asset2]`**: Simpler syntax, Dagster infers parameter names from asset names
- **`ins={"param": AssetIn(key=...)}`**: More explicit, useful for complex mappings or renaming parameters

Your convention uses `deps=` for simplicity, which is perfect!

## Next Steps

1. **Reload VS Code**: `Cmd+Shift+P` → "Developer: Reload Window"
2. **Generate a new project** with Ask Dagster
3. **Check the generated code** - should now match your `deps=` convention
4. **Verify lineage** at http://localhost:3000

---

**Version**: 0.2.2  
**Fixed**: `ins=` → `deps=` to match your codebase convention  
**Status**: Ready to test with proper lineage! 🎯









