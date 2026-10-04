import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ConversionResult {
    success: boolean;
    outputPath?: string;
    message: string;
    assets?: string[];
    warnings?: string[];
}

interface DAGInfo {
    dagId: string;
    folder: string;
    sourceFilename?: string;
    tasks: TaskInfo[];
}

interface TaskInfo {
    taskId: string;
    dependencies: string[];
    isExternal: boolean;
    externalDagId?: string;
    externalTaskId?: string;
}

/**
 * Converts Airflow DAG projects to Dagster using LLM-powered analysis
 */
export class AirflowConverter {
    constructor(
        private readonly llmProvider: (prompt: string) => Promise<string>,
        private readonly guidelinesContext: string
    ) {}

    /**
     * Convert an entire Airflow project to Dagster
     */
    async convertProject(airflowProjectPath: string): Promise<ConversionResult> {
        try {
            // 1. Discover all DAG files
            const dagFiles = await this.discoverDAGFiles(airflowProjectPath);
            
            if (dagFiles.length === 0) {
                return {
                    success: false,
                    message: 'No Airflow DAG files found in the project'
                };
            }

            // 2. Parse each DAG file
            const dagInfos = await Promise.all(
                dagFiles.map(file => this.parseDAGFile(file))
            );

            // 3. Create Dagster project structure
            const outputPath = path.join(path.dirname(airflowProjectPath), 'dagster_project');
            await this.createDagsterProjectStructure(outputPath);

            // 4. Convert each DAG to assets
            const convertedAssets: string[] = [];
            const warnings: string[] = [];

            for (const dagInfo of dagInfos) {
                const result = await this.convertDAGToAssets(dagInfo, outputPath);
                if (result.success) {
                    convertedAssets.push(...(result.assets || []));
                }
                if (result.warnings) {
                    warnings.push(...result.warnings);
                }
            }

            // 5. Generate definitions.py
            await this.generateDefinitionsFile(outputPath, convertedAssets);

            return {
                success: true,
                outputPath,
                message: `✅ Converted ${dagFiles.length} DAG files to ${convertedAssets.length} assets`,
                assets: convertedAssets,
                warnings
            };

        } catch (error) {
            return {
                success: false,
                message: `Conversion failed: ${error}`
            };
        }
    }

    /**
     * Discover all Python files containing DAG definitions
     */
    private async discoverDAGFiles(projectPath: string): Promise<string[]> {
        const dagFiles: string[] = [];
        
        async function searchDirectory(dir: string) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    await searchDirectory(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.py')) {
                    const content = await fs.readFile(fullPath, 'utf-8');
                    // Check if file contains DAG definitions
                    if (content.includes('@dag') || content.includes('DAG(') || content.includes('with DAG')) {
                        dagFiles.push(fullPath);
                    }
                }
            }
        }

        await searchDirectory(projectPath);
        return dagFiles;
    }

    /**
     * Parse a DAG file using LLM
     */
    private async parseDAGFile(filePath: string): Promise<DAGInfo> {
        const content = await fs.readFile(filePath, 'utf-8');
        
        const prompt = `Analyze this Airflow DAG file and extract:
1. DAG ID(s)
2. Task IDs
3. Task dependencies
4. Any ExternalTaskSensor dependencies

File: ${path.basename(filePath)}

\`\`\`python
${content}
\`\`\`

Return JSON format:
{
  "dagId": "dag_name",
  "tasks": [
    {
      "taskId": "task1",
      "dependencies": [],
      "isExternal": false
    }
  ]
}`;

        const response = await this.llmProvider(prompt);
        
        // Parse LLM response (expect JSON)
        try {
            const parsed = JSON.parse(response);
            return {
                ...parsed,
                folder: path.basename(path.dirname(filePath)),
                sourceFilename: path.basename(filePath, '.py')
            };
        } catch {
            // Fallback: basic parsing
            return {
                dagId: this.extractDAGId(content),
                folder: path.basename(path.dirname(filePath)),
                sourceFilename: path.basename(filePath, '.py'),
                tasks: []
            };
        }
    }

    /**
     * Convert DAG to Dagster assets using LLM
     */
    private async convertDAGToAssets(dagInfo: DAGInfo, outputPath: string): Promise<ConversionResult> {
        const warnings: string[] = [];
        const assets: string[] = [];

        // Read original file
        const originalContent = await fs.readFile(
            path.join(dagInfo.folder, `${dagInfo.sourceFilename}.py`),
            'utf-8'
        ).catch(() => '');

        // Use LLM to convert with full context
        const conversionPrompt = `${this.guidelinesContext}

# Airflow to Dagster Conversion Guide

## Your Task
Convert this Airflow DAG to Dagster assets following these patterns:

### Key Principles
1. **@task → @asset**: Each Airflow task becomes a Dagster asset
2. **task dependencies → AssetIn**: Map using AssetKey
3. **DAG grouping**: Use group_name="${dagInfo.dagId}"
4. **Naming**: Use key_prefix=['${dagInfo.folder}', '${dagInfo.dagId}']

### Asset Key Structure
- Single DAG files: ['folder', 'dag_id', 'task_id']
- Multi-DAG files: ['folder', 'source_file', 'dag_id', 'task_id']

### Pattern Examples

#### TaskFlow API
\`\`\`python
# Airflow
@task
def extract_data():
    return {"data": "value"}

# Dagster
@asset(
    key_prefix=['${dagInfo.folder}', '${dagInfo.dagId}'],
    name='extract_data',
    group_name='${dagInfo.dagId}',
    compute_kind='python'
)
def extract_data(context: AssetExecutionContext):
    return {"data": "value"}
\`\`\`

#### Task Dependencies
\`\`\`python
# Airflow
task1 >> task2

# Dagster
@asset(
    key_prefix=['${dagInfo.folder}', '${dagInfo.dagId}'],
    name='task2',
    group_name='${dagInfo.dagId}',
    ins={
        'upstream_data': AssetIn(
            key=AssetKey(['${dagInfo.folder}', '${dagInfo.dagId}', 'task1'])
        )
    }
)
def task2(context: AssetExecutionContext, upstream_data):
    # Use upstream_data from task1
    pass
\`\`\`

#### ExternalTaskSensor
\`\`\`python
# Airflow
ExternalTaskSensor(
    task_id="wait_for_external",
    external_dag_id="other_dag",
    external_task_id="other_task"
)

# Dagster
@asset(
    key_prefix=['${dagInfo.folder}', '${dagInfo.dagId}'],
    name='wait_for_external',
    group_name='${dagInfo.dagId}',
    ins={
        'external_data': AssetIn(
            key=AssetKey(['folder', 'other_dag', 'other_task'])
        )
    }
)
def wait_for_external(context: AssetExecutionContext, external_data):
    return external_data
\`\`\`

## Original Airflow DAG

\`\`\`python
${originalContent}
\`\`\`

## Instructions
1. Convert ALL tasks to @asset functions
2. Include proper imports
3. Map all dependencies correctly
4. Add AssetExecutionContext to each asset
5. Include group_name and compute_kind
6. Follow Dagster best practices
7. Keep original function logic intact

Generate ONLY valid Python code (no markdown, no explanations).`;

        try {
            const convertedCode = await this.llmProvider(conversionPrompt);
            
            // Clean up LLM response (remove markdown if present)
            let cleanCode = convertedCode.trim();
            if (cleanCode.startsWith('```python')) {
                cleanCode = cleanCode.replace(/```python\n?/, '').replace(/```\s*$/, '');
            } else if (cleanCode.startsWith('```')) {
                cleanCode = cleanCode.replace(/```\n?/, '').replace(/```\s*$/, '');
            }

            // Validate it's Python code
            if (!cleanCode.includes('@asset') && !cleanCode.includes('def ')) {
                warnings.push(`⚠️ ${dagInfo.dagId}: Generated code may be incomplete`);
            }

            // Write to file
            const outputFile = path.join(outputPath, 'assets', `${dagInfo.dagId}_assets.py`);
            await fs.writeFile(outputFile, cleanCode, 'utf-8');
            
            assets.push(dagInfo.dagId);

            return {
                success: true,
                message: `✅ Converted ${dagInfo.dagId}`,
                assets,
                warnings
            };

        } catch (error) {
            warnings.push(`❌ Failed to convert ${dagInfo.dagId}: ${error}`);
            return {
                success: false,
                message: `Failed to convert ${dagInfo.dagId}`,
                warnings
            };
        }
    }

    /**
     * Create Dagster project structure
     */
    private async createDagsterProjectStructure(outputPath: string): Promise<void> {
        // Create directories
        await fs.mkdir(outputPath, { recursive: true });
        await fs.mkdir(path.join(outputPath, 'assets'), { recursive: true });

        // Create pyproject.toml
        const pyproject = `[project]
name = "dagster-converted-project"
version = "0.1.0"
dependencies = [
    "dagster",
    "dagster-webserver",
]

[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"
`;
        await fs.writeFile(path.join(outputPath, 'pyproject.toml'), pyproject, 'utf-8');

        // Create __init__.py files
        await fs.writeFile(path.join(outputPath, '__init__.py'), '', 'utf-8');
        await fs.writeFile(path.join(outputPath, 'assets', '__init__.py'), '', 'utf-8');
    }

    /**
     * Generate Dagster definitions file
     */
    private async generateDefinitionsFile(outputPath: string, assetModules: string[]): Promise<void> {
        const imports = assetModules.map(m => `from .assets import ${m}_assets`).join('\n');
        
        const definitions = `# Dagster definitions for converted Airflow project
from dagster import Definitions, load_assets_from_package_module
from . import assets

# Load all assets from the assets package
all_assets = load_assets_from_package_module(assets)

defs = Definitions(
    assets=all_assets,
    jobs=[],
    schedules=[],
    sensors=[],
    resources={},
)
`;
        
        await fs.writeFile(path.join(outputPath, 'definitions.py'), definitions, 'utf-8');
    }

    /**
     * Extract DAG ID from content (fallback)
     */
    private extractDAGId(content: string): string {
        // Try to find @dag decorator
        const dagDecoratorMatch = content.match(/@dag\s*\([^)]*dag_id\s*=\s*["']([^"']+)["']/);
        if (dagDecoratorMatch) {
            return dagDecoratorMatch[1];
        }

        // Try to find DAG() constructor
        const dagConstructorMatch = content.match(/DAG\s*\([^)]*dag_id\s*=\s*["']([^"']+)["']/);
        if (dagConstructorMatch) {
            return dagConstructorMatch[1];
        }

        // Fallback to filename
        return 'unknown_dag';
    }

    /**
     * Sanitize name for Dagster
     */
    private sanitizeName(name: string): string {
        return name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    }
}









