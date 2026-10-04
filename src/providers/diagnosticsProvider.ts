import * as vscode from 'vscode';

export class DagsterDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('dagster');
        
        // Register event handlers
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this)),
            vscode.workspace.onDidOpenTextDocument(this.onDocumentOpen.bind(this)),
            vscode.workspace.onDidSaveTextDocument(this.onDocumentSave.bind(this))
        );

        // Validate all open Python files on startup
        vscode.workspace.textDocuments
            .filter(doc => doc.languageId === 'python')
            .forEach(doc => this.validateDocument(doc));
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.languageId === 'python') {
            // Debounce validation to avoid excessive calls
            this.scheduleValidation(event.document);
        }
    }

    private onDocumentOpen(document: vscode.TextDocument): void {
        if (document.languageId === 'python') {
            this.validateDocument(document);
        }
    }

    private onDocumentSave(document: vscode.TextDocument): void {
        if (document.languageId === 'python') {
            this.validateDocument(document);
        }
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
        }, 500); // 500ms debounce

        this.validationTimeouts.set(uri, timeout);
    }

    private validateDocument(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();

        try {
            // 1. Check for Dagster anti-patterns
            this.checkCircularDependencies(document, text, diagnostics);
            this.checkMissingDependencies(document, text, diagnostics);
            this.checkInvalidDecorators(document, text, diagnostics);
            this.checkConfigurationIssues(document, text, diagnostics);
            this.checkImportIssues(document, text, diagnostics);
            this.checkTypingIssues(document, text, diagnostics);

            // 2. Check dagster_cloud.yaml if it's that file
            if (document.fileName.endsWith('dagster_cloud.yaml') || document.fileName.endsWith('dagster_cloud.yml')) {
                this.validateDagsterCloudConfig(document, text, diagnostics);
            }

            // 3. Check pyproject.toml for Dagster dependencies
            if (document.fileName.endsWith('pyproject.toml')) {
                this.validatePyprojectToml(document, text, diagnostics);
            }

            this.diagnosticCollection.set(document.uri, diagnostics);
        } catch (error) {
            console.error('Error validating document:', error);
        }
    }

    private checkCircularDependencies(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        // Find all asset definitions and their dependencies
        const assets = new Map<string, { line: number, deps: string[] }>();
        
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for @asset decorator
            if (line.match(/@(?:\w+\.)?(asset|dg\.asset)/)) {
                // Find the function name
                for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                    const funcMatch = lines[j].match(/def\s+(\w+)\s*\(/);
                    if (funcMatch) {
                        const assetName = funcMatch[1];
                        
                        // Extract dependencies
                        const deps: string[] = [];
                        let decoratorText = '';
                        for (let k = i; k <= j; k++) {
                            decoratorText += lines[k] + '\n';
                        }
                        
                        const depsMatch = decoratorText.match(/deps\s*=\s*\[(.*?)\]/s);
                        if (depsMatch) {
                            const depsContent = depsMatch[1];
                            const assetRefs = depsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
                            if (assetRefs) {
                                deps.push(...assetRefs);
                            }
                        }
                        
                        assets.set(assetName, { line: j, deps });
                        break;
                    }
                }
            }
        }

        // Check for circular dependencies using DFS
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (asset: string, path: string[]): boolean => {
            if (recursionStack.has(asset)) {
                // Found a cycle! Create diagnostic
                const assetInfo = assets.get(asset);
                if (assetInfo) {
                    const range = new vscode.Range(assetInfo.line, 0, assetInfo.line, lines[assetInfo.line].length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Circular dependency detected: ${path.join(' → ')} → ${asset}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'dagster';
                    diagnostic.code = 'circular-dependency';
                    diagnostics.push(diagnostic);
                }
                return true;
            }

            if (visited.has(asset)) {
                return false;
            }

            visited.add(asset);
            recursionStack.add(asset);

            const assetInfo = assets.get(asset);
            if (assetInfo) {
                for (const dep of assetInfo.deps) {
                    if (hasCycle(dep, [...path, asset])) {
                        return true;
                    }
                }
            }

            recursionStack.delete(asset);
            return false;
        };

        for (const assetName of assets.keys()) {
            if (!visited.has(assetName)) {
                hasCycle(assetName, []);
            }
        }
    }

    private checkMissingDependencies(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for deps parameter in decorators
            const depsMatch = line.match(/deps\s*=\s*\[(.*?)\]/);
            if (depsMatch) {
                const depsContent = depsMatch[1];
                const assetRefs = depsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
                
                if (assetRefs) {
                    for (const assetRef of assetRefs) {
                        // Check if this asset is defined in the current file or imported
                        if (!this.isAssetDefined(text, assetRef) && !this.isAssetImported(text, assetRef)) {
                            const range = new vscode.Range(i, line.indexOf(assetRef), i, line.indexOf(assetRef) + assetRef.length);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Asset '${assetRef}' is referenced but not defined or imported`,
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostic.source = 'dagster';
                            diagnostic.code = 'missing-dependency';
                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }
        }
    }

    private checkInvalidDecorators(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for multiple conflicting decorators
            const decorators = line.match(/@(?:\w+\.)?(asset|op|job|schedule|sensor|resource|io_manager)/g);
            if (decorators && decorators.length > 1) {
                const range = new vscode.Range(i, 0, i, line.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Multiple Dagster decorators on the same function: ${decorators.join(', ')}`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = 'dagster';
                diagnostic.code = 'invalid-decorators';
                diagnostics.push(diagnostic);
            }

            // Check for deprecated @solid decorator
            if (line.includes('@solid')) {
                const range = new vscode.Range(i, line.indexOf('@solid'), i, line.indexOf('@solid') + 6);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `@solid is deprecated, use @op instead`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'dagster';
                diagnostic.code = 'deprecated-decorator';
                diagnostics.push(diagnostic);
            }
        }
    }

    private checkConfigurationIssues(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for config_schema issues
            const configMatch = line.match(/config_schema\s*=\s*\{([^}]*)\}/);
            if (configMatch) {
                const configContent = configMatch[1];
                
                // Basic validation - check for common syntax issues
                if (configContent.includes('=') && !configContent.includes(':')) {
                    const range = new vscode.Range(i, line.indexOf(configContent), i, line.indexOf(configContent) + configContent.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Config schema should use ':' not '=' for key-value pairs`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'dagster';
                    diagnostic.code = 'invalid-config';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    private checkImportIssues(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        const imports = new Set<string>();
        const dagsterImports = new Set<string>();
        
        // Collect all imports
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            const importMatch = line.match(/from\s+dagster\s+import\s+(.+)/);
            if (importMatch) {
                const importList = importMatch[1].split(',').map(s => s.trim());
                importList.forEach(imp => {
                    dagsterImports.add(imp.replace(/\s+as\s+\w+/, ''));
                });
            }
        }

        // Check if decorators are used without imports
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            const decoratorMatch = line.match(/@(asset|op|job|schedule|sensor|resource|io_manager|graph|hook|logger)(?:\(|$)/);
            if (decoratorMatch && !line.includes('@dg.') && !line.includes('@dagster.')) {
                const decorator = decoratorMatch[1];
                if (!dagsterImports.has(decorator)) {
                    const range = new vscode.Range(i, line.indexOf('@' + decorator), i, line.indexOf('@' + decorator) + decorator.length + 1);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `'${decorator}' is not imported from dagster`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'dagster';
                    diagnostic.code = 'missing-import';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    private checkTypingIssues(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for common typing issues with asset functions
            if (line.includes('def ') && i > 0 && lines[i-1].includes('@asset')) {
                // Asset functions should have return type annotations for better documentation
                if (!line.includes('->') && !line.includes('None')) {
                    const funcMatch = line.match(/def\s+(\w+)\s*\(/);
                    if (funcMatch) {
                        const range = new vscode.Range(i, 0, i, line.length);
                        const diagnostic = new vscode.Diagnostic(
                            range,
                            `Consider adding return type annotation to asset function '${funcMatch[1]}'`,
                            vscode.DiagnosticSeverity.Information
                        );
                        diagnostic.source = 'dagster';
                        diagnostic.code = 'missing-return-type';
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
    }

    private validateDagsterCloudConfig(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        
        // Basic YAML validation for dagster_cloud.yaml
        let hasLocations = false;
        let hasValidStructure = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('locations:')) {
                hasLocations = true;
            }
            
            if (line.includes('code_location') || line.includes('package_name') || line.includes('module_name')) {
                hasValidStructure = true;
            }
            
            // Check for common configuration issues
            if (line.includes('package_name:') && !line.includes('.')) {
                const range = new vscode.Range(i, 0, i, line.length);
                const diagnostic = new vscode.Diagnostic(
                    range,
                    'package_name should typically be a dot-separated Python package path',
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'dagster';
                diagnostic.code = 'config-warning';
                diagnostics.push(diagnostic);
            }
        }
        
        if (!hasLocations) {
            const range = new vscode.Range(0, 0, 0, 0);
            const diagnostic = new vscode.Diagnostic(
                range,
                'dagster_cloud.yaml should contain a "locations:" section',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'dagster';
            diagnostic.code = 'missing-locations';
            diagnostics.push(diagnostic);
        }
    }

    private validatePyprojectToml(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]): void {
        const lines = text.split('\n');
        let hasDagster = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('dagster') && (line.includes('dependencies') || line.includes('requires'))) {
                hasDagster = true;
                
                // Check for version pinning best practices
                if (line.includes('dagster') && !line.includes('>=') && !line.includes('==') && !line.includes('~=')) {
                    const range = new vscode.Range(i, 0, i, line.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        'Consider pinning Dagster version for reproducible builds',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'dagster';
                    diagnostic.code = 'version-pinning';
                    diagnostics.push(diagnostic);
                }
            }
        }
    }

    private isAssetDefined(text: string, assetName: string): boolean {
        const pattern = new RegExp(`@(?:\\w+\\.)?(asset|dg\\.asset)[\\s\\S]*?def\\s+${assetName}\\s*\\(`, 'g');
        return pattern.test(text);
    }

    private isAssetImported(text: string, assetName: string): boolean {
        const importPattern = new RegExp(`(from\\s+\\S+\\s+import\\s+.*${assetName}|import\\s+.*${assetName})`, 'g');
        return importPattern.test(text);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.disposables.forEach(d => d.dispose());
        
        // Clear all timeouts
        this.validationTimeouts.forEach(timeout => clearTimeout(timeout));
        this.validationTimeouts.clear();
    }
}

