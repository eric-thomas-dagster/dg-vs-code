# 🐛 Bug Fix: Incorrect Dagster Port in Generated Content

## Issue
The extension was telling users to access Dagster at **http://localhost:8080**, but Dagster actually runs on **http://localhost:3000** by default.

### Where it appeared:
In the UI output:
```
4. Access the dashboard at http://localhost:8080.  ❌ WRONG!

...

🌐 Your Dagster UI will open at: http://localhost:3000  ✅ CORRECT!
```

This was confusing because the same response had two different ports!

## Root Cause
The LLM was generating README content and project instructions with the wrong port number (8080 instead of 3000). This wasn't hardcoded in the extension - it was in the LLM's knowledge.

## Fix Applied

### 1. Updated Built-in Guidelines
**File**: `src/core/guidelinesManager.ts`

Added explicit port instructions:
```typescript
- **IMPORTANT**: Dagster dev server runs on **port 3000** by default (http://localhost:3000)
- Never use port 8080 for Dagster - that's incorrect!
- In all instructions/READMEs, always use http://localhost:3000
```

### 2. Updated User Guidelines
**File**: `dagster-writing-guidelines.md`

Added:
```markdown
- **Dagster runs on port 3000** (http://localhost:3000), NOT 8080!
- In all READMEs/docs, use http://localhost:3000
```

## Result
Now when the LLM generates any content (READMEs, instructions, documentation), it will **always use port 3000** for Dagster.

## Testing
After compiling the extension, generate a new project and verify:
1. README says `http://localhost:3000`
2. Instructions say `http://localhost:3000`
3. No mention of port 8080 anywhere

## Why This Matters
- **User confusion**: Telling users the wrong port wastes their time
- **Failed connections**: Users can't access their Dagster UI
- **Trust**: Inconsistent information makes the tool feel unreliable

Now it's fixed! ✅









