import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Manages Dagster writing guidelines and best practices
 * Makes them available to LLM context for consistent code generation
 */
export class GuidelinesManager {
    private guidelines: string = '';
    private loaded: boolean = false;

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Load and parse Dagster writing guidelines
     */
    async loadGuidelines(): Promise<void> {
        if (this.loaded) {
            return;
        }

        try {
            // Try to load from workspace first (user's custom guidelines)
            const workspaceGuidelines = await this.loadWorkspaceGuidelines();
            
            // Load built-in guidelines
            const builtInGuidelines = this.getBuiltInGuidelines();
            
            // Combine both
            this.guidelines = workspaceGuidelines 
                ? `${workspaceGuidelines}\n\n---\n\n${builtInGuidelines}`
                : builtInGuidelines;
            
            this.loaded = true;
        } catch (error) {
            console.error('Failed to load guidelines:', error);
            // Fallback to built-in only
            this.guidelines = this.getBuiltInGuidelines();
            this.loaded = true;
        }
    }

    /**
     * Get guidelines formatted for LLM context
     */
    async getGuidelinesContext(): Promise<string> {
        if (!this.loaded) {
            await this.loadGuidelines();
        }

        return `# Dagster Best Practices & Guidelines

You are an expert Dagster developer. Always follow these guidelines when generating code:

${this.guidelines}

Remember:
- Use descriptive names for assets, jobs, and ops
- Always include group_name and compute_kind for assets
- Prefer official Dagster libraries over custom implementations
- Use dg CLI commands for project setup and development
- Write idiomatic, production-ready Dagster code
`;
    }

    /**
     * Try to load custom guidelines from workspace
     */
    private async loadWorkspaceGuidelines(): Promise<string | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        // Look for guidelines files, llms.txt, and documentation
        const possibleFiles = [
            'dagster-guidelines.md',
            'dagster-writing-guidelines.md',
            'rules.md',
            'llms.txt',
            'llm-full.txt',
            'guidelines.txt',
            '.dagster/guidelines.md',
            '.dagster/llms.txt'
        ];

        for (const folder of workspaceFolders) {
            for (const fileName of possibleFiles) {
                try {
                    const filePath = vscode.Uri.joinPath(folder.uri, fileName);
                    const content = await vscode.workspace.fs.readFile(filePath);
                    return content.toString();
                } catch {
                    // File doesn't exist, continue
                }
            }
        }

        return null;
    }

    /**
     * Built-in Dagster writing guidelines
     */
    private getBuiltInGuidelines(): string {
        return `## CRITICAL: pyproject.toml Syntax Rules
**TOML files are VERY strict. Follow these rules EXACTLY to avoid syntax errors:**

### ✅ CORRECT pyproject.toml Example:
\`\`\`toml
[project]
name = "my_project"
version = "0.1.0"
dependencies = [
    "dagster>=1.5.0",
    "dagster-webserver>=1.5.0",
]

[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"

[tool.dagster]
module_name = "my_project.definitions"

[tool.dg]
directory_type = "project"

[tool.dg.project]
root_module = "my_project"
\`\`\`

### ❌ COMMON TOML ERRORS (NEVER DO THESE):
1. Missing equals: Every key MUST have \`=\` and value
2. Missing quotes: String values need quotes: \`name = "value"\`
3. Empty sections: Every \`[section]\` needs at least one key=value
4. Wrong array syntax: Use \`["item1", "item2"]\` not \`"item1", "item2"\`
5. Trailing commas: No comma after last array item

### 🔍 VALIDATION: Before generating, check:
- Every key has \`=\` sign
- Every string in quotes
- Every section has content
- Arrays use \`[...]\` syntax
- File ends with newline

## General Principles
- Follow official Dagster documentation and best practices
- Use \`create-dagster\` to bootstrap new projects
- Use \`dg\` CLI for development workflow
- Always prefer official Dagster libraries and components
- Use \`group_name\` and \`compute_kind\` for organization
- Emit numeric-only metadata for better UI display
- **IMPORTANT**: Dagster dev server runs on **port 3000** by default (http://localhost:3000)
- Never use port 8080 for Dagster - that's incorrect!
- In all instructions/READMEs, always use http://localhost:3000

## Assets

### CRITICAL: Always Create Connected Assets with Lineage!
**Never create isolated assets!** Always create a pipeline with at least 3 assets that depend on each other using \`deps=\`.

### Good Asset Definition (With Lineage)
\`\`\`python
from dagster import asset, AssetExecutionContext
import pandas as pd

@asset(
    group_name="Ingest",
    compute_kind="api",
    metadata={"owner": "data-team", "tier": "bronze"}
)
def raw_sales_data(context: AssetExecutionContext) -> pd.DataFrame:
    """Step 1: Extract raw data from source"""
    context.log.info("Loading raw sales data...")
    return pd.DataFrame({
        "transaction_id": range(1, 101),
        "amount": [100, 200, 150] * 33 + [100],
        "date": pd.date_range("2024-01-01", periods=100)
    })

@asset(
    deps=[raw_sales_data],  # CREATES LINEAGE!
    group_name="Transform",
    compute_kind="pandas",
    metadata={"owner": "data-team", "tier": "silver"}
)
def cleaned_sales_data(context: AssetExecutionContext, raw_sales_data: pd.DataFrame) -> pd.DataFrame:
    """Step 2: Transform - depends on raw_sales_data"""
    context.log.info("Cleaning sales data...")
    cleaned = raw_sales_data[raw_sales_data["amount"] > 0]
    return cleaned.drop_duplicates()

@asset(
    deps=[cleaned_sales_data],  # CREATES LINEAGE!
    group_name="Analytics",
    compute_kind="python",
    metadata={"owner": "analytics-team", "tier": "gold"}
)
def sales_summary(context: AssetExecutionContext, cleaned_sales_data: pd.DataFrame) -> dict:
    """Step 3: Aggregate - depends on cleaned_sales_data"""
    context.log.info("Calculating summary metrics...")
    return {
        "total_revenue": cleaned_sales_data["amount"].sum(),
        "transaction_count": len(cleaned_sales_data),
        "average_sale": cleaned_sales_data["amount"].mean()
    }
\`\`\`

**This creates a lineage graph:** raw_sales_data → cleaned_sales_data → sales_summary

### Bad Asset Definition (No Lineage)
\`\`\`python
@asset
def data():  # Too generic, no metadata, NO DEPENDENCIES
    ...

@asset
def other_data():  # Isolated, not connected to anything
    ...
\`\`\`

### Asset Checks
Always use asset checks for data quality:

\`\`\`python
from dagster import asset_check

@asset_check(asset="pull_orders")
def check_non_empty(context):
    # Validate data quality
    ...
\`\`\`

### ELT Integration
Use embedded ELT tools, don't reimplement:

\`\`\`python
from dagster_dlt import dlt_assets

@dlt_assets(...)
def my_pipeline():
    # Let dlt handle the heavy lifting
    ...
\`\`\`

Don't write raw API calls when libraries exist.

## Jobs

Use \`@job\` decorator for explicit workflows:

\`\`\`python
from dagster import job

@job
def daily_pipeline():
    clean_data()
    enrich_data()
    generate_report()
\`\`\`

## IO Managers & Resources

Always use named IO managers:

\`\`\`python
@asset(io_manager_key="duckdb_io_manager")
def my_table():
    return df
\`\`\`

Configure in Definitions:

\`\`\`python
from dagster import Definitions, DuckDBIOManager

defs = Definitions(
    assets=[my_table],
    resources={
        "duckdb_io_manager": DuckDBIOManager(database="data.db")
    }
)
\`\`\`

## Components

- Use built-in components for connectors (S3, Snowflake, etc.)
- If no built-in fits, create a \`ComponentDefinition\`
- Don't wrap trivial transforms as components
- Use \`dg component new\` to scaffold properly

## Essential Commands

\`\`\`bash
# Bootstrap new project
create-dagster my-project

# Create new component
dg component new

# Start development server
dg dev

# List definitions
dg list defs

# Check definitions
dg check defs
\`\`\`

## Asset Dependencies & Lineage

### Always Create Multi-Step Pipelines
**RULE**: Generate at least 3 connected assets showing a clear data flow:
1. **Extract/Ingest** (Bronze tier) → Raw data from source
2. **Transform/Clean** (Silver tier) → Depends on step 1
3. **Aggregate/Report** (Gold tier) → Depends on step 2

### Example: Retail Analytics Pipeline
\`\`\`python
from dagster import asset, AssetExecutionContext
import pandas as pd

# Step 1: Ingest (Bronze)
@asset(
    group_name="Ingest",
    compute_kind="api",
    metadata={"owner": "data-team", "tier": "bronze"}
)
def raw_sales(context: AssetExecutionContext) -> pd.DataFrame:
    context.log.info("Loading raw sales...")
    return pd.DataFrame({"product": ["A", "B"], "amount": [100, 200]})

# Step 2: Transform (Silver) - depends on raw_sales
@asset(
    deps=[raw_sales],
    group_name="Transform",
    compute_kind="pandas",
    metadata={"owner": "data-team", "tier": "silver"}
)
def cleaned_sales(context: AssetExecutionContext, raw_sales: pd.DataFrame) -> pd.DataFrame:
    context.log.info("Cleaning sales data...")
    return raw_sales[raw_sales["amount"] > 0]

# Step 3: Aggregate (Gold) - depends on cleaned_sales
@asset(
    deps=[cleaned_sales],
    group_name="Analytics",
    compute_kind="python",
    metadata={"owner": "analytics-team", "tier": "gold"}
)
def sales_summary(context: AssetExecutionContext, cleaned_sales: pd.DataFrame) -> dict:
    context.log.info("Calculating metrics...")
    return {
        "total": cleaned_sales["amount"].sum(),
        "count": len(cleaned_sales)
    }
\`\`\`

### Multiple Dependencies
\`\`\`python
@asset(
    deps=[sales_data, customer_data],
    metadata={"owner": "analytics-team"}
)
def customer_sales_report(
    context: AssetExecutionContext,
    sales_data: pd.DataFrame,
    customer_data: pd.DataFrame
) -> pd.DataFrame:
    # Combine two upstream assets
    return sales_data.merge(customer_data, on="customer_id")
\`\`\`

## Dagster Project Philosophy

### Core Principles
Dagster projects are **software-defined data systems**, not task schedulers. They model data as **assets** — versioned, observable entities that describe how data is produced and consumed.

### Key Ideals

1. **Declarative, Not Imperative**
   - Declare WHAT data exists and HOW it's produced
   - Dependencies are automatic; the DAG is inferred
   - Strong typing, lineage, and orchestration driven from definitions

2. **Definitions Are the Source of Truth**
   - Every project centers on \`defs.py\` exporting a \`Definitions()\` object
   - Think of it as the "manifest" of your data logic
   - Single declarative entrypoint for orchestration

3. **Composability over Configuration**
   - Prefer Python code over YAML configuration
   - Makes projects testable, modular, and IDE-friendly
   - Assets, jobs, sensors are Python objects that compose

4. **Observability as First-Class**
   - Every asset has built-in: metadata, lineage, materialization history, checks
   - Folder layout separates definitions from runtime behavior
   - Maintains traceability across the system

5. **Single Responsibility**
   - Folders map to functional domains
   - \`assets/\` for transformations
   - \`resources/\` for connections
   - \`jobs/\` for orchestration logic
   - Teams can scale independently

6. **Multi-Code-Location Friendly**
   - Large orgs can deploy subdirectories as separate code locations
   - \`workspace.yaml\` lists locations
   - Enables isolated deployments and agent execution boundaries

## Code Organization

### Project Structure
Dagster projects follow a Pythonic, declarative, and modular structure:

\`\`\`
my_dagster_project/
├── pyproject.toml              # Python packaging + dependency metadata
├── workspace.yaml              # Local dev entrypoint; lists code locations
├── dagster.yaml                # (Optional) runtime config for Dagster+ agents
├── my_dagster_project/
│   ├── __init__.py
│   ├── defs.py                 # Central entrypoint exporting Definitions() object
│   ├── assets/                 # Declarative asset definitions (data or ML pipelines)
│   │   ├── __init__.py
│   │   └── data_assets.py
│   ├── jobs/                   # Job definitions (composition of ops/assets)
│   ├── resources/              # I/O integrations (e.g. Snowflake, S3, APIs)
│   ├── schedules/              # Automated recurring triggers for jobs/assets
│   ├── sensors/                # Event-driven triggers (e.g., file arrival, dbt runs)
│   ├── tests/                  # Unit/integration tests
│   └── utils/                  # Shared functions, config, or constants
└── tests/                      # Optional top-level tests for repo-wide validation
\`\`\`

### The Definitions Object (defs.py)
Every Dagster project must have a central \`defs.py\` that exports a \`Definitions\` object:

\`\`\`python
from dagster import Definitions
from .assets import data_assets
from .resources import my_resource

defs = Definitions(
    assets=data_assets,
    resources={"db": my_resource}
)
\`\`\`

This tells Dagster exactly what exists in the project — the single declarative entrypoint.

### Standard Project Structure
\`\`\`
my_project/
├── my_project/
│   ├── __init__.py
│   ├── definitions.py
│   ├── assets/
│   │   ├── __init__.py
│   │   ├── ingestion.py
│   │   └── transformation.py
│   ├── jobs/
│   │   └── __init__.py
│   └── resources/
│       └── __init__.py
├── pyproject.toml
└── README.md
\`\`\`

### Definitions Pattern
\`\`\`python
from dagster import Definitions
from .assets import all_assets
from .jobs import all_jobs
from .resources import all_resources

defs = Definitions(
    assets=all_assets,
    jobs=all_jobs,
    resources=all_resources
)
\`\`\`

## Naming Conventions

- **Assets**: Descriptive nouns (e.g., \`customer_orders\`, \`sales_report\`)
- **Jobs**: Action verbs (e.g., \`refresh_analytics\`, \`daily_ingestion\`)
- **Ops**: Verb phrases (e.g., \`fetch_data\`, \`clean_nulls\`)
- **Resources**: Lowercase with underscores (e.g., \`postgres_db\`, \`s3_client\`)

## Partitioning

Use partitions for incremental processing:

\`\`\`python
from dagster import asset, DailyPartitionsDefinition

@asset(
    partitions_def=DailyPartitionsDefinition(start_date="2024-01-01")
)
def daily_sales(context):
    partition_key = context.partition_key
    # Process only this partition
    ...
\`\`\`

## Testing

Write tests for critical assets:

\`\`\`python
from dagster import materialize

def test_pull_orders():
    result = materialize([pull_orders])
    assert result.success
\`\`\`

## Metadata

Emit meaningful metadata:

\`\`\`python
from dagster import Output, MetadataValue

@asset
def my_asset():
    df = process_data()
    return Output(
        df,
        metadata={
            "num_rows": len(df),  # Numeric only for better display
            "preview": MetadataValue.md(df.head().to_markdown())
        }
    )
\`\`\`

## Error Handling

Be explicit about failures:

\`\`\`python
from dagster import AssetExecutionContext, AssetCheckResult

@asset_check(asset="my_asset")
def validate_my_asset(context: AssetExecutionContext) -> AssetCheckResult:
    # Check condition
    if condition_failed:
        return AssetCheckResult(
            passed=False,
            description="Data quality check failed",
            metadata={"issue": "Found null values"}
        )
    return AssetCheckResult(passed=True)
\`\`\`

## Performance

- Use partitions for large datasets
- Leverage IO managers for efficient data passing
- Use \`group_name\` to organize execution
- Consider \`freshness_policy\` for scheduling

## Documentation

Add docstrings to all assets:

\`\`\`python
@asset
def customer_lifetime_value():
    """
    Calculate customer lifetime value (CLV) based on historical orders.
    
    This asset:
    - Joins order history with customer data
    - Calculates total spend per customer
    - Applies CLV formula: (Average Order Value × Purchase Frequency) × Customer Lifespan
    
    Depends on: customer_orders, customer_profiles
    """
    ...
\`\`\`

## DAGSTER GENERATION WORKFLOW - FOLLOW THIS EXACTLY

### Step 1: Generate Base Definitions
NEVER create assets manually! Always scaffold them first using:

\`\`\`bash
uv run dg scaffold defs project_name.assets assets.py
\`\`\`

This ensures proper structure and metadata.

### Step 2: Customize Demo Assets

Edit the generated \`assets.py\` file to include:

**ALWAYS create 3-5 realistic, connected assets** with:
- Proper dependencies between assets using \`deps=[...]\`
- Descriptive, business-focused names
- **CRITICAL**: \`@asset\` bodies MUST be set to \`pass\` (placeholder only, NO actual implementation code!)
- **CRITICAL**: Set the \`kinds\` argument to a set of strings indicating technologies (e.g., \`kinds={"snowflake", "dbt"}\`)

Example asset structure for a realistic pipeline:

\`\`\`python
@asset(
    group_name="Ingest",
    kinds={"fivetran"}  # ← ALWAYS set kinds!
)
def raw_customer_data(context: AssetExecutionContext) -> pd.DataFrame:
    """Extract raw customer data from source system."""
    # Placeholder only - no implementation
    pass

@asset(
    deps=[raw_customer_data],  # ← ALWAYS set dependencies!
    group_name="Transform",
    kinds={"pandas", "duckdb"}
)
def cleaned_customer_data(context: AssetExecutionContext, raw_customer_data: pd.DataFrame) -> pd.DataFrame:
    """Clean and standardize customer data."""
    # Placeholder only - no implementation
    pass

@asset(
    deps=[cleaned_customer_data],  # ← Lineage continues!
    group_name="Analytics",
    kinds={"pandas", "analytics"}
)
def customer_segments(context: AssetExecutionContext, cleaned_customer_data: pd.DataFrame) -> dict:
    """Segment customers for marketing."""
    # Placeholder only - no implementation  
    pass
\`\`\`

### Step 3: Validate Setup

ALWAYS run validation:

\`\`\`bash
uv run dg check defs
\`\`\`

This ensures the project structure is correct before proceeding.

### Step 4: Use Components When Appropriate

When adding integrations:

1. Check available components first:
   \`\`\`bash
   uv run dg docs integrations --json
   \`\`\`

2. Use official Dagster components (Fivetran, dbt, Snowflake, etc.)
   - Reference: https://docs.dagster.io/llms.txt for titles/descriptions
   - Full details: https://docs.dagster.io/llms-full.txt
   - Available components: Run \`dg docs integrations --json\` to see full list

3. Validate after adding:
   \`\`\`bash
   uv run dg check defs
   uv run dg list defs
   \`\`\`

4. When creating custom components:
   \`\`\`bash
   dg scaffold component ComponentName
   dg scaffold defs my_module.components.ComponentName my_component
   \`\`\`

   Reference: https://docs.dagster.io/guides/build/components/creating-new-components/creating-and-registering-a-component

### Step 5: Asset Organization

**NEVER create isolated assets!** Always structure as:
- **Raw data ingestion asset** (Bronze tier)
- **Data transformation/cleaning asset** (Silver tier)  
- **Business logic/aggregation asset** (Gold tier)
- **ML model or analytics asset** (if applicable)
- **Output/export asset** (Reporting tier)

Every asset MUST have:
- \`deps=[...]\` for lineage
- \`kinds={...}\` to indicate technologies
- \`group_name\` for organization
- \`compute_kind\` for observability
- Descriptive business-focused names

### CRITICAL RULES FOR ALL GENERATIONS:

1. **ALWAYS scaffold first**: Use \`dg scaffold\` commands
2. **ALWAYS create connected assets**: Minimum 3 assets with \`deps=\`
3. **ALWAYS set kinds**: Technologies must be declared in \`kinds\` (e.g., \`kinds={"snowflake", "dbt"}\`)
4. **ALWAYS validate**: Run \`dg check defs\` after changes
5. **NEVER create single assets**: Always build pipelines
6. **NEVER skip deps**: Every asset (except first) must have dependencies
7. **ALWAYS test defs**: Run \`dg list defs\` to verify structure
8. **NEVER write actual code in asset bodies**: Asset bodies MUST be \`pass\` only (placeholders)
9. **NEVER include SQL, Python logic, or implementations**: Keep assets as structure-only with proper signatures
\`\`\``;
    }

    /**
     * Get guidelines for specific topic
     */
    async getTopicGuidelines(topic: 'assets' | 'jobs' | 'resources' | 'components' | 'testing'): Promise<string> {
        await this.loadGuidelines();
        
        const sections = {
            assets: 'Assets',
            jobs: 'Jobs',
            resources: 'IO Managers & Resources',
            components: 'Components',
            testing: 'Testing'
        };

        const lines = this.guidelines.split('\n');
        const startMarker = `## ${sections[topic]}`;
        const startIndex = lines.findIndex(line => line.includes(startMarker));
        
        if (startIndex === -1) {
            return '';
        }

        // Find next section
        const endIndex = lines.findIndex((line, idx) => 
            idx > startIndex && line.startsWith('## ')
        );

        const relevantLines = endIndex === -1 
            ? lines.slice(startIndex)
            : lines.slice(startIndex, endIndex);

        return relevantLines.join('\n');
    }

    /**
     * Validate if code follows guidelines
     */
    async validateCode(code: string, type: 'asset' | 'job' | 'resource'): Promise<ValidationResult> {
        const issues: string[] = [];

        if (type === 'asset') {
            // Check for group_name
            if (!code.includes('group_name=')) {
                issues.push('Missing group_name parameter');
            }
            // Check for compute_kind
            if (!code.includes('compute_kind=')) {
                issues.push('Missing compute_kind parameter');
            }
            // Check for generic names
            if (code.match(/@asset\s*\n\s*def (data|temp|test|foo|bar)\(/)) {
                issues.push('Use descriptive asset names instead of generic ones');
            }
        }

        return {
            valid: issues.length === 0,
            issues,
            suggestions: issues.map(issue => this.getSuggestion(issue))
        };
    }

    private getSuggestion(issue: string): string {
        const suggestions: Record<string, string> = {
            'Missing group_name parameter': 'Add group_name="YourGroup" to organize assets',
            'Missing compute_kind parameter': 'Add compute_kind="python" or the appropriate technology',
            'Use descriptive asset names instead of generic ones': 'Use names like customer_orders, sales_report instead of data'
        };
        return suggestions[issue] || 'See guidelines for more details';
    }
}

interface ValidationResult {
    valid: boolean;
    issues: string[];
    suggestions: string[];
}

