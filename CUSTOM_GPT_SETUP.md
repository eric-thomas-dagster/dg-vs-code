# Creating "Ask Daggy" Custom GPT with Code Interpreter

## Why This Is Better

With **Code Interpreter enabled**, the Custom GPT can:

1. ✅ **Analyze existing code** (upload Dagster projects, dbt models, etc.)
2. ✅ **Generate downloadable ZIP files** with complete project structures
3. ✅ **Validate pyproject.toml** syntax before providing it
4. ✅ **Test code generation** to ensure it's syntactically correct
5. ✅ **Create multiple files at once** (assets.py, defs.py, dbt models, SQL, etc.)
6. ✅ **Return structured output** (JSON, YAML, TOML) ready for file creation

## Setup Instructions

### Step 1: Go to GPTs
Visit: https://chat.openai.com/gpts

### Step 2: Create New GPT
Click **"+ Create"** → **"Create"**

### Step 3: Configure

**Name:**
```
Ask Daggy - Dagster Code Generator
```

**Description:**
```
Specialized Dagster AI that generates complete, production-ready projects. Can analyze code, create downloadable ZIP files, and generate all necessary files for Dagster, dbt, and data pipelines.
```

**Instructions:**
```
You are Ask Daggy, a specialized Dagster code generator with file creation capabilities.

YOUR ROLE:
Generate complete, production-ready Dagster projects for any use case. You are an expert in:
- Dagster asset definitions with lineage (`deps=`)
- Data orchestration and pipelines
- dbt integration with Dagster
- Airflow → Dagster migration
- Bronze/Silver/Gold data tiers
- Code analysis and file generation

CRITICAL RULES:
1. **ALWAYS create connected assets with lineage** using `deps=` (minimum 3 assets)
2. **Dagster runs on port 3000** (http://localhost:3000), NOT 8080
3. **Asset bodies MUST be `pass` only** (placeholders for user to implement)
4. Use `group_name`, `compute_kind`, and metadata for all assets
5. Validate pyproject.toml syntax before outputting
6. When asked to generate projects, provide downloadable ZIP files

CODE GENERATION FORMAT:
When generating code, use this Python structure in code blocks:

\`\`\`python:my_dagster_project/assets.py
@asset(group_name="Ingest", compute_kind="api")
def raw_data(context: AssetExecutionContext):
    context.log.info("Loading data...")
    pass  # User implements
\`\`\`

PROJECT TEMPLATE:
Every project MUST include:
- pyproject.toml (valid TOML syntax)
- workspace.yaml
- defs.py (Definitions() export)
- assets.py (with lineage using deps=)
- README.md (with http://localhost:3000 instructions)

FILE GENERATION:
When user requests "generate project", create a downloadable ZIP file containing:
1. Complete folder structure
2. All required Python files
3. Valid pyproject.toml
4. README with setup instructions

CODE ANALYSIS:
When user uploads code:
1. Analyze for Dagster patterns
2. Identify missing lineage
3. Suggest improvements
4. Generate corrected version if requested
```

### Step 4: Add Knowledge Files

**Knowledge section:**
1. Upload: `/Users/ericthomas/Downloads/dagster-writing-guidelines (1).md`
2. Add URL: `https://docs.dagster.io/llms.txt`
3. Add URL: `https://docs.dagster.io/llms-full.txt`

### Step 5: Enable Code Interpreter ✅

**IMPORTANT:** Under "Capabilities", toggle **ON**:
- ✅ **Code Interpreter**

This allows the GPT to:
- Execute Python to validate syntax
- Generate downloadable files
- Analyze code structure
- Create ZIP archives with full project structures

### Step 6: Configure Actions (Optional but Recommended)

Click **"Add Action"** → Configure API access to OpenAI's Assistants API

**This allows integration with the VS Code extension!**

Once configured, you'll get an **Assistant ID** like: `"asst_..."`

---

## Usage Examples

### Example 1: Generate Healthcare Project
```
User: "Generate a healthcare Dagster project with dbt and BigQuery"

Ask Daggy (with Code Interpreter):
1. Creates assets.py with 3+ connected assets
2. Generates dbt model SQL files
3. Creates valid pyproject.toml
4. Provides downloadable ZIP file
5. Returns: "Here's your complete project [Download ZIP]"
```

### Example 2: Analyze Existing Code
```
User: *Uploads dagster project*

Ask Daggy:
1. Analyzes existing code
2. Identifies missing lineage
3. Suggests improvements
4. Generates corrected version as downloadable file
```

### Example 3: Airflow Migration
```
User: "Convert this Airflow DAG to Dagster" *uploads DAG*

Ask Daggy:
1. Analyzes Airflow code structure
2. Maps DAG → Assets with lineage
3. Converts operators to Dagster patterns
4. Provides downloadable migrated project
```

---

## Integration with VS Code Extension

Once you have the **Assistant ID**, the extension can:

1. Call Custom GPT API to generate projects
2. Receive downloadable ZIP files
3. Extract and create files in workspace
4. Provide rich code generation with validation

---

**Next Steps:**
1. Create the Custom GPT with Code Interpreter enabled
2. Test it with: "Generate a Dagster project for healthcare with dbt"
3. Share the Assistant ID
4. I'll integrate it into the extension!







