import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';

export interface ConfigValidationResult {
    isValid: boolean;
    errors: ConfigError[];
    warnings: ConfigWarning[];
    suggestions: ConfigSuggestion[];
    configType: 'dagster_cloud' | 'dagster' | 'pyproject' | 'unknown';
}

export interface ConfigError {
    message: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    fix?: string;
}

export interface ConfigWarning {
    message: string;
    line: number;
    suggestion: string;
}

export interface ConfigSuggestion {
    message: string;
    action: string;
    line?: number;
}

export class ConfigValidationProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('dagster-config');
        
        // Register event handlers
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            vscode.workspace.onDidOpenTextDocument(this.onDocumentOpen.bind(this)),
            vscode.workspace.onDidSaveTextDocument(this.onDocumentSave.bind(this)),
            
            // Register hover provider for config files
            vscode.languages.registerHoverProvider(
                [
                    { pattern: '**/dagster_cloud.yaml' },
                    { pattern: '**/dagster_cloud.yml' },
                    { pattern: '**/dagster.yaml' },
                    { pattern: '**/dagster.yml' },
                    { pattern: '**/pyproject.toml' }
                ],
                this
            ),

            // Register code actions provider for quick fixes
            vscode.languages.registerCodeActionsProvider(
                [
                    { pattern: '**/dagster_cloud.yaml' },
                    { pattern: '**/dagster_cloud.yml' },
                    { pattern: '**/dagster.yaml' },
                    { pattern: '**/dagster.yml' },
                    { pattern: '**/pyproject.toml' }
                ],
                this
            )
        );

        // Validate all open config files on startup
        vscode.workspace.textDocuments
            .filter(doc => this.isConfigFile(doc))
            .forEach(doc => this.validateDocument(doc));
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (this.isConfigFile(event.document)) {
            this.scheduleValidation(event.document);
        }
    }

    private onDocumentOpen(document: vscode.TextDocument): void {
        if (this.isConfigFile(document)) {
            this.validateDocument(document);
        }
    }

    private onDocumentSave(document: vscode.TextDocument): void {
        if (this.isConfigFile(document)) {
            this.validateDocument(document);
        }
    }

    private isConfigFile(document: vscode.TextDocument): boolean {
        const fileName = path.basename(document.fileName);
        return fileName.includes('dagster_cloud.yaml') ||
               fileName.includes('dagster_cloud.yml') ||
               fileName.includes('dagster.yaml') ||
               fileName.includes('dagster.yml') ||
               fileName.includes('pyproject.toml');
    }

    private validationTimeouts = new Map<string, NodeJS.Timeout>();

    private scheduleValidation(document: vscode.TextDocument): void {
        const uri = document.uri.toString();
        
        // Clear existing timeout
        const existingTimeout = this.validationTimeouts.get(uri);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Schedule new validation
        const timeout = setTimeout(() => {
            this.validateDocument(document);
            this.validationTimeouts.delete(uri);
        }, 300); // 300ms debounce for faster feedback

        this.validationTimeouts.set(uri, timeout);
    }

    private validateDocument(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        
        try {
            const result = this.validateConfig(document);
            
            // Convert errors to diagnostics
            result.errors.forEach(error => {
                const range = new vscode.Range(
                    error.line, 
                    error.column, 
                    error.line, 
                    error.column + 10
                );
                
                const severity = error.severity === 'error' ? vscode.DiagnosticSeverity.Error :
                               error.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
                               vscode.DiagnosticSeverity.Information;
                
                const diagnostic = new vscode.Diagnostic(range, error.message, severity);
                diagnostic.source = 'dagster-config';
                diagnostic.code = `${result.configType}-validation`;
                diagnostics.push(diagnostic);
            });

            // Convert warnings to diagnostics
            result.warnings.forEach(warning => {
                const range = new vscode.Range(warning.line, 0, warning.line, 999);
                const diagnostic = new vscode.Diagnostic(range, warning.message, vscode.DiagnosticSeverity.Warning);
                diagnostic.source = 'dagster-config';
                diagnostics.push(diagnostic);
            });

            this.diagnosticCollection.set(document.uri, diagnostics);
        } catch (error) {
            console.error('Error validating config document:', error);
        }
    }

    private validateConfig(document: vscode.TextDocument): ConfigValidationResult {
        const fileName = path.basename(document.fileName);
        const text = document.getText();
        
        if (fileName.includes('dagster_cloud.y')) {
            return this.validateDagsterCloudConfig(text);
        } else if (fileName.includes('dagster.y')) {
            return this.validateDagsterConfig(text);
        } else if (fileName.includes('pyproject.toml')) {
            return this.validatePyprojectToml(text);
        }
        
        return {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: [],
            configType: 'unknown'
        };
    }

    private validateDagsterCloudConfig(text: string): ConfigValidationResult {
        const result: ConfigValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: [],
            configType: 'dagster_cloud'
        };

        try {
            const config = yaml.load(text) as any;
            const lines = text.split('\n');

            // Check for required top-level structure
            if (!config.locations) {
                result.errors.push({
                    message: 'Missing required "locations:" section',
                    line: 0,
                    column: 0,
                    severity: 'error',
                    fix: 'Add "locations:" section at the top level'
                });
                result.isValid = false;
            } else {
                // Validate each location
                Object.keys(config.locations).forEach((locationName, index) => {
                    const location = config.locations[locationName];
                    const locationLine = this.findLineContaining(lines, locationName);

                    // Check for required location fields
                    if (!location.code_location) {
                        result.errors.push({
                            message: `Location "${locationName}" missing "code_location" field`,
                            line: locationLine,
                            column: 0,
                            severity: 'error',
                            fix: 'Add "code_location:" field with package_name or module_name'
                        });
                        result.isValid = false;
                    } else {
                        const codeLocation = location.code_location;
                        
                        // Check for package_name or module_name
                        if (!codeLocation.package_name && !codeLocation.module_name) {
                            result.errors.push({
                                message: `Code location must specify either "package_name" or "module_name"`,
                                line: locationLine + 1,
                                column: 0,
                                severity: 'error'
                            });
                            result.isValid = false;
                        }

                        // Validate package_name format
                        if (codeLocation.package_name && !codeLocation.package_name.includes('.')) {
                            result.warnings.push({
                                message: 'Package name should typically be a dot-separated Python package path',
                                line: this.findLineContaining(lines, 'package_name'),
                                suggestion: 'Use format like "my_project.definitions"'
                            });
                        }

                        // Check for build configuration
                        if (!codeLocation.build) {
                            result.suggestions.push({
                                message: `Consider adding build configuration for location "${locationName}"`,
                                action: 'Add build section with registry and tag',
                                line: locationLine + 2
                            });
                        }
                    }

                    // Validate environment variables
                    if (location.environment_variables) {
                        Object.keys(location.environment_variables).forEach(envVar => {
                            if (!envVar.toUpperCase().includes('DAGSTER') && !envVar.includes('DATABASE') && !envVar.includes('API')) {
                                result.warnings.push({
                                    message: `Environment variable "${envVar}" might not follow naming conventions`,
                                    line: this.findLineContaining(lines, envVar),
                                    suggestion: 'Use descriptive names like DATABASE_URL, API_KEY, etc.'
                                });
                            }
                        });
                    }
                });
            }

            // Check for deployment settings
            if (config.deployment && config.deployment.registry) {
                const registry = config.deployment.registry;
                if (!registry.includes('docker.io') && !registry.includes('gcr.io') && !registry.includes('ecr')) {
                    result.warnings.push({
                        message: 'Registry might not be a recognized container registry',
                        line: this.findLineContaining(lines, 'registry'),
                        suggestion: 'Ensure registry URL is correct for your cloud provider'
                    });
                }
            }

        } catch (yamlError) {
            result.errors.push({
                message: `YAML syntax error: ${yamlError}`,
                line: 0,
                column: 0,
                severity: 'error'
            });
            result.isValid = false;
        }

        return result;
    }

    private validateDagsterConfig(text: string): ConfigValidationResult {
        const result: ConfigValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: [],
            configType: 'dagster'
        };

        try {
            const config = yaml.load(text) as any;
            const lines = text.split('\n');

            // Validate common Dagster configuration sections
            if (config.storage) {
                if (!config.storage.sqlite && !config.storage.postgres && !config.storage.mysql) {
                    result.warnings.push({
                        message: 'No storage backend configured, will use default in-memory storage',
                        line: this.findLineContaining(lines, 'storage'),
                        suggestion: 'Configure postgres, mysql, or sqlite for persistent storage'
                    });
                }
            }

            if (config.run_launcher) {
                if (config.run_launcher.module === 'dagster.core.launcher.sync_in_process_run_launcher') {
                    result.warnings.push({
                        message: 'Using synchronous run launcher - consider async for production',
                        line: this.findLineContaining(lines, 'run_launcher'),
                        suggestion: 'Use DockerRunLauncher or K8sRunLauncher for production workloads'
                    });
                }
            } else {
                result.suggestions.push({
                    message: 'Consider configuring a run launcher for better execution control',
                    action: 'Add run_launcher configuration',
                    line: lines.length
                });
            }

            // Check for telemetry settings
            if (config.telemetry && config.telemetry.enabled === undefined) {
                result.suggestions.push({
                    message: 'Explicitly set telemetry preferences',
                    action: 'Add "enabled: true/false" under telemetry section'
                });
            }

        } catch (yamlError) {
            result.errors.push({
                message: `YAML syntax error: ${yamlError}`,
                line: 0,
                column: 0,
                severity: 'error'
            });
            result.isValid = false;
        }

        return result;
    }

    private validatePyprojectToml(text: string): ConfigValidationResult {
        const result: ConfigValidationResult = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: [],
            configType: 'pyproject'
        };

        const lines = text.split('\n');
        let hasDagster = false;
        let hasVersionPinning = false;

        // Check for Dagster dependencies
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('dagster') && (line.includes('dependencies') || line.includes('requires'))) {
                hasDagster = true;
                
                // Check for version pinning
                if (line.includes('>=') || line.includes('==') || line.includes('~=') || line.includes('^')) {
                    hasVersionPinning = true;
                } else {
                    result.warnings.push({
                        message: 'Consider pinning Dagster version for reproducible builds',
                        line: i,
                        suggestion: 'Use "dagster>=1.5.0" or "dagster==1.5.7" for version pinning'
                    });
                }

                // Check for common missing dependencies
                const commonDeps = ['dagster-webserver', 'dagster-postgres', 'dagster-docker'];
                commonDeps.forEach(dep => {
                    if (!text.includes(dep)) {
                        result.suggestions.push({
                            message: `Consider adding ${dep} if you need its functionality`,
                            action: `Add "${dep}" to dependencies`,
                            line: i + 1
                        });
                    }
                });
            }

            // Check for build system
            if (line.includes('[build-system]')) {
                if (!text.includes('setuptools') && !text.includes('poetry') && !text.includes('hatch')) {
                    result.warnings.push({
                        message: 'No recognized build backend specified',
                        line: i,
                        suggestion: 'Specify build-backend like "setuptools.build_meta" or "poetry.core.masonry.api"'
                    });
                }
            }

            // Check for project metadata
            if (line.includes('[project]') || line.includes('[tool.poetry]')) {
                const nextFewLines = lines.slice(i, i + 10).join('\n');
                if (!nextFewLines.includes('name') || !nextFewLines.includes('version')) {
                    result.warnings.push({
                        message: 'Project metadata incomplete',
                        line: i,
                        suggestion: 'Add name, version, and description fields'
                    });
                }
            }
        }

        if (!hasDagster) {
            result.suggestions.push({
                message: 'No Dagster dependencies found',
                action: 'Add dagster to your dependencies if this is a Dagster project'
            });
        }

        return result;
    }

    private findLineContaining(lines: string[], searchText: string): number {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(searchText)) {
                return i;
            }
        }
        return 0;
    }

    // Implement hover provider
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line);
        const fileName = path.basename(document.fileName);
        
        // Provide contextual help for config fields
        if (fileName.includes('dagster_cloud.y')) {
            return this.provideDagsterCloudHover(line.text, position);
        } else if (fileName.includes('dagster.y')) {
            return this.provideDagsterConfigHover(line.text, position);
        } else if (fileName.includes('pyproject.toml')) {
            return this.providePyprojectHover(line.text, position);
        }
        
        return null;
    }

    private provideDagsterCloudHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        const hoverContent = new vscode.MarkdownString();
        hoverContent.isTrusted = true;

        if (lineText.includes('locations:')) {
            hoverContent.appendMarkdown(`### 📍 Locations\n\nDefines code locations for your Dagster deployment.\n\n**Structure:**\n\`\`\`yaml\nlocations:\n  my_location:\n    code_location:\n      package_name: my_package.definitions\n\`\`\``);
        } else if (lineText.includes('package_name:')) {
            hoverContent.appendMarkdown(`### 📦 Package Name\n\nSpecifies the Python package containing your Dagster definitions.\n\n**Example:** \`my_project.definitions\`\n\n**Alternative:** Use \`module_name\` for a single module.`);
        } else if (lineText.includes('build:')) {
            hoverContent.appendMarkdown(`### 🔨 Build Configuration\n\nConfigures how your code is built and deployed.\n\n**Example:**\n\`\`\`yaml\nbuild:\n  registry: my-registry.com\n  tag: latest\n\`\`\``);
        } else if (lineText.includes('environment_variables:')) {
            hoverContent.appendMarkdown(`### 🌍 Environment Variables\n\nSets environment variables for your deployment.\n\n**Best Practices:**\n- Use descriptive names\n- Keep secrets in secure storage\n- Document required variables`);
        } else {
            return null;
        }

        return new vscode.Hover(hoverContent);
    }

    private provideDagsterConfigHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        const hoverContent = new vscode.MarkdownString();
        hoverContent.isTrusted = true;

        if (lineText.includes('storage:')) {
            hoverContent.appendMarkdown(`### 💾 Storage Configuration\n\nConfigures how Dagster stores run history and event logs.\n\n**Options:**\n- \`sqlite\`: Local development\n- \`postgres\`: Production recommended\n- \`mysql\`: Alternative production option`);
        } else if (lineText.includes('run_launcher:')) {
            hoverContent.appendMarkdown(`### 🚀 Run Launcher\n\nControls how Dagster executes runs.\n\n**Options:**\n- \`SyncInProcessRunLauncher\`: Development\n- \`DockerRunLauncher\`: Containerized execution\n- \`K8sRunLauncher\`: Kubernetes execution`);
        } else if (lineText.includes('compute_logs:')) {
            hoverContent.appendMarkdown(`### 📋 Compute Logs\n\nConfigures where stdout/stderr from ops are stored.\n\n**Local Example:**\n\`\`\`yaml\ncompute_logs:\n  module: dagster.core.storage.local_compute_log_manager\n  class: LocalComputeLogManager\n\`\`\``);
        } else {
            return null;
        }

        return new vscode.Hover(hoverContent);
    }

    private providePyprojectHover(lineText: string, position: vscode.Position): vscode.Hover | null {
        const hoverContent = new vscode.MarkdownString();
        hoverContent.isTrusted = true;

        if (lineText.includes('dagster')) {
            hoverContent.appendMarkdown(`### ⚡ Dagster Dependency\n\nCore Dagster package for building data pipelines.\n\n**Version Pinning:**\n- \`dagster>=1.5.0\`: Minimum version\n- \`dagster==1.5.7\`: Exact version\n- \`dagster~=1.5.0\`: Compatible version`);
        } else if (lineText.includes('[build-system]')) {
            hoverContent.appendMarkdown(`### 🔧 Build System\n\nSpecifies how your package should be built.\n\n**Common Options:**\n- \`setuptools.build_meta\`: Traditional setuptools\n- \`poetry.core.masonry.api\`: Poetry\n- \`hatchling.build\`: Hatch`);
        } else if (lineText.includes('[project]')) {
            hoverContent.appendMarkdown(`### 📋 Project Metadata\n\nDefines your project's basic information.\n\n**Required Fields:**\n- \`name\`: Project name\n- \`version\`: Current version\n- \`description\`: Brief description`);
        } else {
            return null;
        }

        return new vscode.Hover(hoverContent);
    }

    // Implement code actions provider for quick fixes
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];
        const diagnostics = this.diagnosticCollection.get(document.uri) || [];
        
        // Find diagnostics that overlap with the current range
        const relevantDiagnostics = diagnostics.filter(diagnostic => 
            diagnostic.range.intersection(range)
        );

        relevantDiagnostics.forEach(diagnostic => {
            if (diagnostic.message.includes('Missing required "locations:"')) {
                const action = new vscode.CodeAction('Add locations section', vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.insert(document.uri, new vscode.Position(0, 0), 'locations:\n  my_location:\n    code_location:\n      package_name: my_package.definitions\n\n');
                actions.push(action);
            }
            
            if (diagnostic.message.includes('missing "code_location"')) {
                const action = new vscode.CodeAction('Add code_location field', vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                const insertPosition = new vscode.Position(diagnostic.range.start.line + 1, 0);
                action.edit.insert(document.uri, insertPosition, '    code_location:\n      package_name: my_package.definitions\n');
                actions.push(action);
            }
        });

        return actions;
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.disposables.forEach(d => d.dispose());
        
        // Clear all timeouts
        this.validationTimeouts.forEach(timeout => clearTimeout(timeout));
        this.validationTimeouts.clear();
    }
}

