# 🔗 LINEAGE ENFORCEMENT - v0.2.8

## The Problem

Even with guidelines, LLMs were generating **wrong patterns**:
- ❌ Using `@job` definitions (old Dagster pattern)
- ❌ Creating isolated assets without `deps=`
- ❌ Calling functions inside assets
- ❌ No lineage graph

## The Fix

Added **IMPOSSIBLE-TO-IGNORE lineage instructions** at the top of the prompt:

```
🚨 CRITICAL REQUIREMENT - ASSET LINEAGE IS MANDATORY:
=======================================================
YOU MUST CREATE CONNECTED ASSETS WITH deps= PARAMETER!

CORRECT PATTERN (ALWAYS USE THIS):
```python
@asset(deps=[raw_sales_data])  # ← THIS IS REQUIRED FOR LINEAGE!
def cleaned_sales_data(context, raw_sales_data):
    return raw_sales_data[raw_sales_data["amount"] > 0]
```

WRONG PATTERNS (NEVER USE THESE):
- ❌ Creating @job definitions
- ❌ Assets without deps= parameter
- ❌ Isolated assets with no dependencies

REQUIRED: Minimum 3 connected assets:
Bronze (Ingest) → Silver (Transform) → Gold (Analytics)
```

## What Changed

### Before (v0.2.7):
- Guidelines buried in documentation
- LLM could ignore them
- Generated old patterns (@job, isolated assets)

### After (v0.2.8):
- ✅ **Lineage requirement at TOP of prompt**
- ✅ **Shows CORRECT pattern with example**
- ✅ **Lists WRONG patterns explicitly**
- ✅ **Makes it mandatory with emojis/formatting**
- ✅ **Repeats in multiple places**

## Install & Test

1. **Reload VS Code**:
   ```
   Cmd+Shift+P → "Developer: Reload Window"
   ```

2. **Try with Claude** (recommended):
   ```
   Cmd+Shift+P → "🔄 Switch AI Model" → Claude
   ```
   Enter your API key from: https://console.anthropic.com

3. **Generate again**:
   > "Generate a retail analytics project with Snowflake and Fivetran"

4. **Check the generated code** for:
   - ✅ `deps=[upstream_asset]` on all transform/analytics assets
   - ✅ No `@job` definitions
   - ✅ Connected pipeline structure
   - ✅ Bronze → Silver → Gold tiers

## Expected Output

You should now see assets like:

```python
@asset(
    group_name="Ingest",
    compute_kind="fivetran",
    metadata={"tier": "bronze"}
)
def raw_sales_data(context: AssetExecutionContext) -> pd.DataFrame:
    # Bronze tier ingestion
    return data

@asset(
    deps=[raw_sales_data],  # ✅ LINEAGE!
    group_name="Transform",
    compute_kind="pandas",
    metadata={"tier": "silver"}
)
def cleaned_sales_data(context: AssetExecutionContext, raw_sales_data: pd.DataFrame) -> pd.DataFrame:
    # Silver tier transformation
    return cleaned

@asset(
    deps=[cleaned_sales_data],  # ✅ LINEAGE!
    group_name="Analytics",
    compute_kind="duckdb",
    metadata={"tier": "gold"}
)
def sales_metrics(context: AssetExecutionContext, cleaned_sales_data: pd.DataFrame) -> dict:
    # Gold tier analytics
    return metrics
```

## Why This Will Work

**Prompt engineering principles**:
1. ✅ **Position** - Lineage requirement is at the TOP
2. ✅ **Clarity** - Shows exact pattern with code examples
3. ✅ **Contrast** - Shows wrong patterns explicitly
4. ✅ **Repetition** - Mentioned 3+ times in prompt
5. ✅ **Emphasis** - Uses emojis and formatting to stand out
6. ✅ **Mandate** - Uses words like "MUST", "REQUIRED", "MANDATORY"

## Model Recommendations

**For Best Results**:
- 🥇 **Claude** (recommended) - Always follows instructions
- 🥈 **deepseek-coder:6.7b** (Ollama) - Good balance
- 🥉 **qwen2.5-coder:7b** (Ollama) - Decent quality

**Avoid for Lineage**:
- ⚠️ **qwen2.5-coder:1.5b** - Too small, often ignores complex instructions

---

**Version**: 0.2.8  
**Fixed**: Lineage instructions moved to TOP with impossible-to-ignore formatting  
**Recommended**: Use Claude for 100% reliable lineage  
**Status**: Ready to generate proper Dagster projects! 🎯









