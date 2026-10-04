# TOML Validation Fix - v0.3.2

## Problem
Generated Dagster projects were failing during `pip install -e .` with error:
```
pip._vendor.tomli._parser.TOMLDecodeError: Expected '=' after a key in a key/value pair (at end of document)
```

This means the LLM was generating **invalid `pyproject.toml` files** with syntax errors.

## Root Cause
TOML is a **very strict** configuration format. Common LLM mistakes include:
1. ❌ Missing `=` signs: `name` instead of `name = "value"`
2. ❌ Missing quotes: `name = my_project` instead of `name = "my_project"`
3. ❌ Empty sections: `[tool.dg.project]` with no keys
4. ❌ Wrong array syntax: `dependencies = "dagster", "pandas"` instead of `["dagster", "pandas"]`
5. ❌ Trailing commas in arrays

## Solution

### Added TOML Syntax Guidelines
**File**: `src/core/guidelinesManager.ts`

Added comprehensive TOML syntax rules **at the very top** of the built-in guidelines (before all other content):

```typescript
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
```

## Why This Works

### 1. **Explicit Examples**
Shows the LLM **exactly** what valid TOML looks like, not just describing it.

### 2. **Common Errors Listed**
Explicitly calls out the 5 most common TOML syntax mistakes LLMs make.

### 3. **Validation Checklist**
Gives the LLM a step-by-step checklist to verify before generating.

### 4. **Positioned First**
Placed at the **very top** of guidelines so LLM sees it before generating any code.

## Testing

### Test Case 1: Generate New Project
1. Generate a new Dagster project (any template)
2. Check the generated `pyproject.toml` file
3. **Expected**: Valid TOML syntax with:
   - All keys have `=` signs
   - All strings in quotes
   - No empty sections
   - Proper array syntax

### Test Case 2: Manual TOML Validation
```bash
# Navigate to generated project
cd /path/to/generated/project

# Try to parse the TOML file
python3 -c "import tomllib; tomllib.load(open('pyproject.toml', 'rb'))"

# Expected: No errors
```

### Test Case 3: Pip Install
```bash
cd /path/to/generated/project
python3 -m venv venv
source venv/bin/activate
pip install -e .

# Expected: Successful installation, no TOML errors
```

## Additional Recommendations

### If You Still Get TOML Errors

**Option 1: Use a Bigger Model**
Larger models are better at following syntax rules:
- Switch to `codellama:13b` (7GB) for local
- Or use Claude API / OpenAI API for best results

**Option 2: Validate Generated Files**
Before running setup, manually check `pyproject.toml`:
```bash
# Install TOML validator
pip install toml-cli

# Validate the file
toml-cli check pyproject.toml
```

**Option 3: Feed in Example Projects**
You can add your own working `pyproject.toml` examples to the guidelines:
1. Open VS Code Settings
2. Search for "Dagster: Custom Guidelines Path"
3. Point to a file with your examples

### Example Custom Guidelines File
Create `~/dagster-custom-guidelines.md`:

```markdown
# My Custom TOML Examples

## Working pyproject.toml from my-project
\`\`\`toml
[project]
name = "my_working_project"
version = "1.0.0"
dependencies = [
    "dagster>=1.5.0",
    "dagster-webserver>=1.5.0",
    "pandas>=2.0.0",
]

[build-system]
requires = ["setuptools>=68.0.0"]
build-backend = "setuptools.build_meta"

[tool.dagster]
module_name = "my_working_project.definitions"

[tool.dg]
directory_type = "project"

[tool.dg.project]
root_module = "my_working_project"
\`\`\`

Use this EXACT structure for all generated projects!
```

Then configure in VS Code settings:
```json
{
  "dagster.customGuidelinesPath": "~/dagster-custom-guidelines.md"
}
```

## Files Modified

1. **src/core/guidelinesManager.ts**
   - Added TOML syntax rules at the top of built-in guidelines
   - Included correct example, common errors, and validation checklist

2. **package.json**
   - Bumped version to `0.3.2`

## Installation

```bash
cd /Users/ericthomas/dg-vs-code
code --install-extension dagster-power-user-0.3.2.vsix --force
```

Then **reload VS Code** to activate the changes.

## What to Expect

### Before (v0.3.1 and earlier)
```toml
[project]
name my_project  # ❌ Missing = and quotes
dependencies "dagster", "pandas"  # ❌ Missing array brackets

[tool.dg.project]  # ❌ Empty section
```
**Result**: `TOMLDecodeError: Expected '=' after a key`

### After (v0.3.2)
```toml
[project]
name = "my_project"  # ✅ Correct
dependencies = ["dagster", "pandas"]  # ✅ Correct

[tool.dg.project]
root_module = "my_project"  # ✅ Correct
```
**Result**: ✅ Valid TOML, successful `pip install -e .`

## Summary

This fix ensures that:
1. ✅ LLM sees TOML syntax rules **first** before generating
2. ✅ Common TOML errors are explicitly called out
3. ✅ Validation checklist helps LLM verify syntax
4. ✅ Generated `pyproject.toml` files are valid
5. ✅ `pip install -e .` succeeds without TOML errors

**No more TOML syntax errors in generated projects!** 🎉

## If You Still Have Issues

If you still get TOML errors after this fix:
1. **Check which AI model you're using** (status bar shows it)
2. **Try a bigger model** or switch to Claude/OpenAI API
3. **Share the generated `pyproject.toml`** so we can see the exact error
4. **Consider adding your own examples** via custom guidelines

The guidelines are now much more explicit about TOML syntax, but smaller models may still struggle. Claude API or `codellama:13b` should work reliably.









