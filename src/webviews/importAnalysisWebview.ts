import * as vscode from 'vscode';

export interface ImportInfo {
    moduleName: string;
    importedItems: string[];
    filePath: string;
    line: number;
    isUsed: boolean;
    isFromDagster: boolean;
    suggestions?: string[];
}

export interface ImportAnalysisResult {
    totalImports: number;
    dagsterImports: number;
    unusedImports: ImportInfo[];
    missingImports: string[];
    optimizationSuggestions: string[];
    importHealthScore: number;
}

export class ImportAnalysisWebview {
    private panel: vscode.WebviewPanel | undefined;
    private readonly extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    public async showAnalysis(): Promise<void> {
        // Create or show webview panel
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'dagsterImportAnalysis',
                '🔍 Dagster Import Analysis',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'fixImport':
                        await this.fixImport(message.filePath, message.line, message.suggestion);
                        break;
                    case 'removeUnusedImport':
                        await this.removeUnusedImport(message.filePath, message.line);
                        break;
                    case 'addMissingImport':
                        await this.addMissingImport(message.filePath, message.importItem);
                        break;
                    case 'refreshAnalysis':
                        await this.updateAnalysis();
                        break;
                    case 'navigateToImport':
                        await this.navigateToImport(message.filePath, message.line);
                        break;
                }
            });
        }

        // Update the webview content
        await this.updateAnalysis();
    }

    private async updateAnalysis(): Promise<void> {
        if (!this.panel) return;

        // Analyze workspace imports
        const analysisResult = await this.analyzeWorkspaceImports();
        
        // Generate HTML content
        const html = this.getWebviewContent(analysisResult);
        this.panel.webview.html = html;
    }

    private async analyzeWorkspaceImports(): Promise<ImportAnalysisResult> {
        const result: ImportAnalysisResult = {
            totalImports: 0,
            dagsterImports: 0,
            unusedImports: [],
            missingImports: [],
            optimizationSuggestions: [],
            importHealthScore: 0
        };

        try {
            // Find all Python files in workspace
            const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 100);
            const allImports: ImportInfo[] = [];
            const usedItems = new Set<string>();

            for (const file of pythonFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    const text = document.getText();
                    const lines = text.split('\n');

                    // Extract imports and usage
                    const fileImports = this.extractImportsFromFile(lines, file.fsPath);
                    const fileUsage = this.extractUsageFromFile(text);

                    allImports.push(...fileImports);
                    fileUsage.forEach(item => usedItems.add(item));
                } catch (error) {
                    console.warn(`Error analyzing imports in ${file.fsPath}:`, error);
                }
            }

            // Analyze import usage
            for (const importInfo of allImports) {
                result.totalImports++;
                if (importInfo.isFromDagster) {
                    result.dagsterImports++;
                }

                // Check if imported items are used
                const unusedItems = importInfo.importedItems.filter(item => !usedItems.has(item));
                if (unusedItems.length > 0) {
                    result.unusedImports.push({
                        ...importInfo,
                        importedItems: unusedItems,
                        isUsed: false
                    });
                }
            }

            // Find missing imports (decorators used without imports)
            result.missingImports = this.findMissingImports(allImports, usedItems);

            // Generate optimization suggestions
            result.optimizationSuggestions = this.generateOptimizationSuggestions(allImports, result.unusedImports);

            // Calculate import health score (0-100)
            result.importHealthScore = this.calculateImportHealthScore(result);

            return result;
        } catch (error) {
            console.error('Error analyzing workspace imports:', error);
            return result;
        }
    }

    private extractImportsFromFile(lines: string[], filePath: string): ImportInfo[] {
        const imports: ImportInfo[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Match: from dagster import asset, op, job
            const fromImportMatch = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/);
            if (fromImportMatch) {
                const moduleName = fromImportMatch[1];
                const importedItemsString = fromImportMatch[2];
                
                // Parse imported items (handle as, parentheses, etc.)
                const importedItems = this.parseImportedItems(importedItemsString);
                
                imports.push({
                    moduleName,
                    importedItems,
                    filePath,
                    line: i,
                    isUsed: true, // Will be determined later
                    isFromDagster: moduleName.includes('dagster'),
                    suggestions: []
                });
            }

            // Match: import dagster
            const directImportMatch = line.match(/^import\s+([a-zA-Z0-9_.]+)(?:\s+as\s+(\w+))?$/);
            if (directImportMatch) {
                const moduleName = directImportMatch[1];
                const alias = directImportMatch[2] || moduleName;
                
                imports.push({
                    moduleName,
                    importedItems: [alias],
                    filePath,
                    line: i,
                    isUsed: true, // Will be determined later
                    isFromDagster: moduleName.includes('dagster'),
                    suggestions: []
                });
            }
        }

        return imports;
    }

    private parseImportedItems(importString: string): string[] {
        // Remove parentheses and split by comma
        const cleaned = importString.replace(/[()]/g, '').trim();
        return cleaned
            .split(',')
            .map(item => {
                // Handle "as" aliases - extract the alias name
                const asMatch = item.trim().match(/(\w+)(?:\s+as\s+(\w+))?/);
                return asMatch ? (asMatch[2] || asMatch[1]) : item.trim();
            })
            .filter(item => item.length > 0);
    }

    private extractUsageFromFile(text: string): string[] {
        const usedItems = new Set<string>();
        
        // Common Dagster decorators and functions
        const dagsterPattern = /@(asset|op|job|schedule|sensor|resource|io_manager|graph|hook|logger|executor)\b/g;
        let match;
        while ((match = dagsterPattern.exec(text)) !== null) {
            usedItems.add(match[1]);
        }

        // Function calls and references
        const functionPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
        while ((match = functionPattern.exec(text)) !== null) {
            usedItems.add(match[1]);
        }

        // Variable references
        const variablePattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        while ((match = variablePattern.exec(text)) !== null) {
            usedItems.add(match[1]);
        }

        return Array.from(usedItems);
    }

    private findMissingImports(allImports: ImportInfo[], usedItems: Set<string>): string[] {
        const importedItems = new Set<string>();
        allImports.forEach(imp => {
            imp.importedItems.forEach(item => importedItems.add(item));
        });

        const dagsterItems = ['asset', 'op', 'job', 'schedule', 'sensor', 'resource', 'io_manager', 'graph', 'hook', 'logger', 'executor', 'Config', 'RunRequest', 'SkipReason', 'AssetMaterialization'];
        
        return dagsterItems.filter(item => usedItems.has(item) && !importedItems.has(item));
    }

    private generateOptimizationSuggestions(allImports: ImportInfo[], unusedImports: ImportInfo[]): string[] {
        const suggestions: string[] = [];

        // Group imports by module for consolidation suggestions
        const importsByModule = new Map<string, ImportInfo[]>();
        allImports.forEach(imp => {
            if (!importsByModule.has(imp.moduleName)) {
                importsByModule.set(imp.moduleName, []);
            }
            importsByModule.get(imp.moduleName)!.push(imp);
        });

        // Suggest consolidating multiple imports from same module
        for (const [moduleName, imports] of importsByModule) {
            if (imports.length > 1 && moduleName.includes('dagster')) {
                suggestions.push(`Consider consolidating ${imports.length} imports from '${moduleName}' into a single import statement`);
            }
        }

        // Suggest removing unused imports
        if (unusedImports.length > 0) {
            suggestions.push(`Remove ${unusedImports.length} unused import${unusedImports.length > 1 ? 's' : ''} to clean up your code`);
        }

        // Suggest using wildcard imports for heavily used modules
        for (const [moduleName, imports] of importsByModule) {
            const totalItems = imports.reduce((sum, imp) => sum + imp.importedItems.length, 0);
            if (totalItems > 5 && moduleName.includes('dagster')) {
                suggestions.push(`Consider using 'import ${moduleName} as dg' for better readability when importing many items`);
            }
        }

        return suggestions;
    }

    private calculateImportHealthScore(result: ImportAnalysisResult): number {
        let score = 100;

        // Deduct points for unused imports
        score -= result.unusedImports.length * 5;

        // Deduct points for missing imports
        score -= result.missingImports.length * 10;

        // Deduct points for too many optimization opportunities
        score -= result.optimizationSuggestions.length * 2;

        return Math.max(0, Math.min(100, score));
    }

    private async fixImport(filePath: string, line: number, suggestion: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const edit = new vscode.WorkspaceEdit();
            
            // Apply the suggested fix
            const lineRange = new vscode.Range(line, 0, line + 1, 0);
            edit.replace(document.uri, lineRange, suggestion + '\n');
            
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Import fixed successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fix import: ${error}`);
        }
    }

    private async removeUnusedImport(filePath: string, line: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const edit = new vscode.WorkspaceEdit();
            
            // Remove the entire line
            const lineRange = new vscode.Range(line, 0, line + 1, 0);
            edit.delete(document.uri, lineRange);
            
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Unused import removed!');
            await this.updateAnalysis(); // Refresh analysis
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to remove import: ${error}`);
        }
    }

    private async addMissingImport(filePath: string, importItem: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const edit = new vscode.WorkspaceEdit();
            
            // Find a good place to add the import (after existing dagster imports or at top)
            let insertLine = 0;
            const lines = document.getText().split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('from dagster import') || lines[i].includes('import dagster')) {
                    insertLine = i + 1;
                }
                if (lines[i].trim() && !lines[i].startsWith('import') && !lines[i].startsWith('from') && !lines[i].startsWith('#')) {
                    break;
                }
            }
            
            const importStatement = `from dagster import ${importItem}\n`;
            const insertPosition = new vscode.Position(insertLine, 0);
            edit.insert(document.uri, insertPosition, importStatement);
            
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`Added missing import: ${importItem}`);
            await this.updateAnalysis(); // Refresh analysis
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add import: ${error}`);
        }
    }

    private async navigateToImport(filePath: string, line: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const position = new vscode.Position(line, 0);
            
            await vscode.window.showTextDocument(document, {
                selection: new vscode.Range(position, position)
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to navigate to import: ${error}`);
        }
    }

    private getWebviewContent(analysis: ImportAnalysisResult): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dagster Import Analysis</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .health-score {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .score-circle {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 18px;
            color: white;
        }
        
        .score-excellent { background-color: #4CAF50; }
        .score-good { background-color: #8BC34A; }
        .score-fair { background-color: #FF9800; }
        .score-poor { background-color: #F44336; }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background-color: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }
        
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        .stat-label {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        
        .section {
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-textLink-foreground);
        }
        
        .import-item {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .import-info {
            flex: 1;
        }
        
        .import-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        
        .import-actions {
            display: flex;
            gap: 10px;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .btn-danger {
            background-color: var(--vscode-errorForeground);
        }
        
        .btn-success {
            background-color: var(--vscode-terminal-ansiGreen);
        }
        
        .suggestion-item {
            background-color: var(--vscode-notifications-background);
            border: 1px solid var(--vscode-notifications-border);
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 10px;
        }
        
        .controls {
            margin-bottom: 20px;
        }
        
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 Dagster Import Analysis</h1>
        <div class="health-score">
            <div class="score-circle ${this.getScoreClass(analysis.importHealthScore)}">
                ${analysis.importHealthScore}
            </div>
            <div>
                <div>Import Health</div>
                <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                    ${this.getScoreDescription(analysis.importHealthScore)}
                </div>
            </div>
        </div>
    </div>
    
    <div class="controls">
        <button onclick="refreshAnalysis()">🔄 Refresh Analysis</button>
    </div>
    
    <div class="stats">
        <div class="stat-card">
            <div class="stat-number">${analysis.totalImports}</div>
            <div class="stat-label">Total Imports</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${analysis.dagsterImports}</div>
            <div class="stat-label">Dagster Imports</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${analysis.unusedImports.length}</div>
            <div class="stat-label">Unused Imports</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${analysis.missingImports.length}</div>
            <div class="stat-label">Missing Imports</div>
        </div>
    </div>
    
    ${analysis.unusedImports.length > 0 ? `
    <div class="section">
        <div class="section-title">🧹 Unused Imports</div>
        ${analysis.unusedImports.map(imp => `
            <div class="import-item">
                <div class="import-info">
                    <div><strong>from ${imp.moduleName} import ${imp.importedItems.join(', ')}</strong></div>
                    <div class="import-path">${imp.filePath}:${imp.line + 1}</div>
                </div>
                <div class="import-actions">
                    <button onclick="navigateToImport('${imp.filePath}', ${imp.line})">📍 Go to</button>
                    <button class="btn-danger" onclick="removeUnusedImport('${imp.filePath}', ${imp.line})">🗑️ Remove</button>
                </div>
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${analysis.missingImports.length > 0 ? `
    <div class="section">
        <div class="section-title">➕ Missing Imports</div>
        ${analysis.missingImports.map(item => `
            <div class="import-item">
                <div class="import-info">
                    <div><strong>${item}</strong> is used but not imported</div>
                    <div class="import-path">Add: from dagster import ${item}</div>
                </div>
                <div class="import-actions">
                    <button class="btn-success" onclick="addMissingImport('${vscode.window.activeTextEditor?.document.uri.fsPath || ''}', '${item}')">➕ Add Import</button>
                </div>
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${analysis.optimizationSuggestions.length > 0 ? `
    <div class="section">
        <div class="section-title">💡 Optimization Suggestions</div>
        ${analysis.optimizationSuggestions.map(suggestion => `
            <div class="suggestion-item">
                ${suggestion}
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${analysis.unusedImports.length === 0 && analysis.missingImports.length === 0 && analysis.optimizationSuggestions.length === 0 ? `
    <div class="empty-state">
        🎉 Your imports look great! No issues found.
    </div>
    ` : ''}
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function refreshAnalysis() {
            vscode.postMessage({ command: 'refreshAnalysis' });
        }
        
        function removeUnusedImport(filePath, line) {
            vscode.postMessage({ 
                command: 'removeUnusedImport', 
                filePath: filePath, 
                line: line 
            });
        }
        
        function addMissingImport(filePath, importItem) {
            vscode.postMessage({ 
                command: 'addMissingImport', 
                filePath: filePath, 
                importItem: importItem 
            });
        }
        
        function navigateToImport(filePath, line) {
            vscode.postMessage({ 
                command: 'navigateToImport', 
                filePath: filePath, 
                line: line 
            });
        }
    </script>
</body>
</html>`;
    }

    private getScoreClass(score: number): string {
        if (score >= 90) return 'score-excellent';
        if (score >= 70) return 'score-good';
        if (score >= 50) return 'score-fair';
        return 'score-poor';
    }

    private getScoreDescription(score: number): string {
        if (score >= 90) return 'Excellent';
        if (score >= 70) return 'Good';
        if (score >= 50) return 'Fair';
        return 'Needs Improvement';
    }

    public dispose(): void {
        this.panel?.dispose();
    }
}

