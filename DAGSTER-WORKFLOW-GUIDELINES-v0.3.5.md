# Dagster Workflow Guidelines Update - v0.3.5

## Summary
Integrated the **exact Dagster generation workflow** from your Claude Code documentation to ensure the extension generates high-quality Dagster projects.

## What Was Added

### New Section in Guidelines
Added a comprehensive "DAGSTER GENERATION WORKFLOW" section that follows your proven Claude Code process:

```markdown
## DAGSTER GENERATION WORKFLOW - FOLLOW THIS EXACTLY

### Step 1: Generate Base Definitions
NEVER create assets manually! Always scaffold them first using:
uv run dg scaffold defs project_name.assets assets.py

### Step 2: Customize Demo Assets
- ALWAYS create 3-5 realistic, connected assets
- Proper dependencies using `deps=[...]`
- **CRITICAL**: Set the `kinds` argument
- Bodies set to `pass` (placeholder)

### Step 3: Validate Setup
ALWAYS run: uv run dg check defs

### Step 4: Use Components When Appropriate
- Check available: dg docs integrations --json
- Reference official docs
- Validate after adding

### Step 5: Asset Organization
- Raw data ingestion asset (Bronze)
- Data transformation (Silver)
- Business logic (Gold)
- ML/analytics (if applicable)
- Output/export (Reporting)

### CRITICAL RULES:
1. ALWAYS scaffold first
2. ALWAYS create connected assets (min 3)
3. ALWAYS set kinds
4. ALWAYS validate
5. NEVER create single assets
6. NEVER skip deps
7. ALWAYS test defs
```

## Key Changes

### 1. Emphasis on Scaffolding
**Before**: LLM would create assets manually with unpredictable structure
**After**: LLM is instructed to **ALWAYS use `dg scaffold`** first, then customize

### 2. Required `kinds` Parameter
**Before**: LLM might omit technology declarations
**After**: **CRITICAL**: Always set `kinds={"technology"}` to indicate what technologies are used

Example:
```python
@asset(
    group_name="Ingest",
    kinds={"fivetran"}  # ← Required!
)
def raw_customer_data() -> pd.DataFrame:
    pass
```

### 3. Connected Asset Structure
**Before**: LLM might create isolated assets
**After**: **NEVER create single assets** - always build pipelines with:
- Bronze tier (Ingest)
- Silver tier (Transform)
- Gold tier (Analytics)
- Plus ML/Reporting if applicable

### 4. Validation Checkpoints
**Before**: No validation guidance
**After**: **ALWAYS run validation**:
- `uv run dg check defs`
- `uv run dg list defs`

### 5. Component Integration
Added workflow for adding Dagster components:
- Check available components first
- Use official components (Fivetran, dbt, Snowflake, etc.)
- Reference LLM docs
- Validate after adding

## Benefits

✅ **Follows Proven Process**: Uses your existing Claude Code workflow
✅ **Consistent Structure**: Always scaffolds first, then customizes
✅ **Better Lineage**: Enforces `deps=[...]` and `kinds={...}`
✅ **Validated Output**: Instructs to run validation commands
✅ **Component-Aware**: Knows how to use official Dagster components

## Testing

Try generating a project with v0.3.5 and you should see:

1. **Scaffolding approach** in the generated code
2. **`kinds` parameters** on all assets
3. **Connected asset pipelines** with proper `deps=`
4. **Validation commands** in the README

## Files Modified

1. **src/core/guidelinesManager.ts**
   - Added "DAGSTER GENERATION WORKFLOW" section
   - Emphasizes scaffolding, kinds, validation, and components
   - Provides exact workflow from Claude Code documentation

2. **package.json**
   - Bumped version to `0.3.5`

## Next Steps

Once packaged and installed, the extension will:
- Use the **exact workflow** from your Claude Code setup
- Generate **scaffolded projects** with proper structure
- Include **kinds declarations** on all assets
- Provide **validation commands** in README

This should result in **much higher quality** Dagster project generation!







