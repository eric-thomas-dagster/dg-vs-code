# 🎯 Dagster Philosophy Added - Version 0.2.3

## What Was Added

Your **Dagster project philosophy** has been integrated into the guidelines! This ensures the LLM understands the fundamental principles behind Dagster's design.

## Key Philosophical Points Now Included

### 1. Software-Defined Data Systems
- Dagster is NOT a task scheduler (like Airflow)
- Models data as **assets** — versioned, observable entities
- Describes how data is produced and consumed

### 2. Six Core Principles

**Declarative, Not Imperative**
- Declare WHAT data exists, not WHEN to run
- Dependencies are automatic; DAG is inferred
- Strong typing and lineage driven from definitions

**Definitions Are the Source of Truth**
- Every project centers on `defs.py` exporting `Definitions()`
- Think of it as the "manifest" of your data logic
- Single declarative entrypoint for orchestration

**Composability over Configuration**
- Python code > YAML configuration
- Testable, modular, IDE-friendly
- Assets, jobs, sensors are composable Python objects

**Observability as First-Class**
- Built-in: metadata, lineage, materialization history, checks
- Folder layout separates definitions from runtime
- Maintains traceability across the system

**Single Responsibility**
- Folders map to functional domains:
  - `assets/` → transformations
  - `resources/` → connections (Snowflake, S3, APIs)
  - `jobs/` → orchestration logic
  - `schedules/` → recurring triggers
  - `sensors/` → event-driven triggers

**Multi-Code-Location Friendly**
- Large orgs can deploy subdirectories separately
- `workspace.yaml` lists code locations
- Enables isolated deployments and agent boundaries

### 3. Standard Project Structure
```
my_dagster_project/
├── pyproject.toml              # Python packaging + dependencies
├── workspace.yaml              # Local dev entrypoint
├── dagster.yaml                # (Optional) runtime config
├── my_dagster_project/
│   ├── __init__.py
│   ├── defs.py                 # Central Definitions() export ⭐
│   ├── assets/                 # Asset definitions
│   ├── jobs/                   # Job definitions
│   ├── resources/              # I/O integrations
│   ├── schedules/              # Recurring triggers
│   ├── sensors/                # Event-driven triggers
│   ├── tests/                  # Unit/integration tests
│   └── utils/                  # Shared functions
└── tests/                      # Top-level validation
```

### 4. The Definitions Object
Every project MUST have a central `defs.py`:

```python
from dagster import Definitions
from .assets import data_assets
from .resources import my_resource

defs = Definitions(
    assets=data_assets,
    resources={"db": my_resource}
)
```

## Why This Matters

The LLM now understands:
- ✅ Dagster projects are **code-first**, not config-first
- ✅ Assets are the core abstraction, not tasks
- ✅ `defs.py` is the single source of truth
- ✅ Folder structure has meaning and purpose
- ✅ Observability and lineage are built-in, not add-ons
- ✅ Projects should be modular, testable, and composable

## What This Enables

When generating projects, the LLM will now:
1. Always create a proper `defs.py` with `Definitions()`
2. Organize code by functional domain (assets/, resources/, jobs/)
3. Generate **declarative** asset definitions with `deps=`
4. Include observability metadata (owner, tier, compute_kind)
5. Follow the principle: "software-defined data systems"
6. Create lineage-connected pipelines (Bronze → Silver → Gold)

## Changes Made

### Updated Files:
1. **`src/core/guidelinesManager.ts`**
   - Added "Dagster Project Philosophy" section
   - Included all 6 core principles
   - Added project structure template
   - Explained the `Definitions()` object

2. **`dagster-writing-guidelines.md`**
   - Added philosophy section at the top
   - Included project structure diagram
   - Emphasized declarative approach

## Next Steps

1. **Reload VS Code**: `Cmd+Shift+P` → "Developer: Reload Window"
2. **Generate a new project** with Ask Dagster
3. **Verify**:
   - Proper `defs.py` with `Definitions()`
   - Organized folder structure (assets/, resources/, etc.)
   - Connected assets with lineage using `deps=`
   - Bronze/Silver/Gold tier metadata
   - Observability metadata (owner, compute_kind)

---

**Version**: 0.2.3  
**Added**: Dagster project philosophy and architectural principles  
**Impact**: LLM now understands Dagster's software-defined data system approach  
**Status**: Ready to generate production-quality Dagster projects! 🎯









