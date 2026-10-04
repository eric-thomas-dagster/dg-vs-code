import * as vscode from 'vscode';

export interface AssetMetadata {
    name: string;
    description?: string;
    group?: string;
    computeKind?: string;
    tags: Record<string, string>;
    dependencies: string[];
    dependents: string[];
    partitionsDefinition?: string;
    retryPolicy?: string;
    freshnessPolicyMinutes?: number;
    autoMaterializePolicy?: string;
    codeOwners: string[];
    filePath: string;
    line: number;
    lastModified?: Date;
    complexity: 'Low' | 'Medium' | 'High';
    health: 'Good' | 'Warning' | 'Critical';
    documentation: DocumentationInfo[];
}

export interface DocumentationInfo {
    type: 'docstring' | 'inline_comment' | 'todo' | 'fixme' | 'warning';
    content: string;
    line: number;
}

export class AssetMetadataWebview {
    private panel: vscode.WebviewPanel | undefined;
    private readonly extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    public async showAssetCatalog(): Promise<void> {
        // Create or show webview panel
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'dagsterAssetCatalog',
                '📚 Dagster Asset Catalog',
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
                    case 'navigateToAsset':
                        await this.navigateToAsset(message.assetName);
                        break;
                    case 'showAssetDetails':
                        await this.showAssetDetails(message.assetName);
                        break;
                    case 'refreshCatalog':
                        await this.updateCatalog();
                        break;
                    case 'filterAssets':
                        await this.updateCatalog(message.filter);
                        break;
                    case 'exportDocumentation':
                        await this.exportDocumentation();
                        break;
                }
            });
        }

        // Update the webview content
        await this.updateCatalog();
    }

    private async updateCatalog(filter?: any): Promise<void> {
        if (!this.panel) return;

        // Analyze workspace for asset metadata
        const assets = await this.extractAllAssetMetadata();
        
        // Apply filters if provided
        let filteredAssets = assets;
        if (filter) {
            filteredAssets = this.applyFilters(assets, filter);
        }

        // Generate HTML content
        const html = this.getWebviewContent(filteredAssets);
        this.panel.webview.html = html;
    }

    private async extractAllAssetMetadata(): Promise<AssetMetadata[]> {
        const assets: AssetMetadata[] = [];

        try {
            // Find all Python files in workspace
            const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 100);

            for (const file of pythonFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    const fileAssets = await this.extractAssetMetadataFromFile(document);
                    assets.push(...fileAssets);
                } catch (error) {
                    console.warn(`Error extracting metadata from ${file.fsPath}:`, error);
                }
            }

            return assets;
        } catch (error) {
            console.error('Error extracting asset metadata:', error);
            return [];
        }
    }

    private async extractAssetMetadataFromFile(document: vscode.TextDocument): Promise<AssetMetadata[]> {
        const assets: AssetMetadata[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Look for @asset decorators
            const decoratorMatch = line.match(/@(?:\w+\.)?(asset|dg\.asset)/);
            if (decoratorMatch) {
                const asset = await this.parseAssetFromDecorator(document, lines, i);
                if (asset) {
                    assets.push(asset);
                }
            }
        }

        return assets;
    }

    private async parseAssetFromDecorator(document: vscode.TextDocument, lines: string[], decoratorLine: number): Promise<AssetMetadata | null> {
        try {
            // Find function name
            let functionName: string | undefined;
            let functionLine = decoratorLine;

            for (let i = decoratorLine + 1; i < Math.min(decoratorLine + 15, lines.length); i++) {
                const funcMatch = lines[i].match(/def\s+(\w+)\s*\(/);
                if (funcMatch) {
                    functionName = funcMatch[1];
                    functionLine = i;
                    break;
                }
            }

            if (!functionName) return null;

            // Extract decorator parameters
            const decoratorInfo = this.extractDecoratorInfo(lines, decoratorLine);
            
            // Extract documentation
            const documentation = this.extractDocumentation(lines, functionLine);

            // Calculate complexity and health
            const complexity = this.calculateComplexity(lines, functionLine, decoratorInfo);
            const health = this.assessHealth(decoratorInfo, documentation);

            // Extract code owners from comments or git blame (simplified)
            const codeOwners = this.extractCodeOwners(lines, decoratorLine, functionLine);

            // Get file stats
            const stats = await vscode.workspace.fs.stat(document.uri);

            const asset: AssetMetadata = {
                name: functionName,
                description: decoratorInfo.description || documentation.find(d => d.type === 'docstring')?.content,
                group: decoratorInfo.group,
                computeKind: decoratorInfo.computeKind,
                tags: decoratorInfo.tags || {},
                dependencies: decoratorInfo.dependencies || [],
                dependents: [], // Will be populated separately
                partitionsDefinition: decoratorInfo.partitionsDefinition,
                retryPolicy: decoratorInfo.retryPolicy,
                freshnessPolicyMinutes: decoratorInfo.freshnessPolicyMinutes,
                autoMaterializePolicy: decoratorInfo.autoMaterializePolicy,
                codeOwners,
                filePath: document.uri.fsPath,
                line: functionLine,
                lastModified: new Date(stats.mtime),
                complexity,
                health,
                documentation
            };

            return asset;
        } catch (error) {
            console.error('Error parsing asset from decorator:', error);
            return null;
        }
    }

    private extractDecoratorInfo(lines: string[], startLine: number): any {
        const info: any = {};
        let decoratorText = '';
        let parenCount = 0;
        let foundOpenParen = false;

        // Collect the full decorator
        for (let i = startLine; i < Math.min(startLine + 15, lines.length); i++) {
            const line = lines[i];
            decoratorText += line + '\n';

            for (const char of line) {
                if (char === '(') {
                    foundOpenParen = true;
                    parenCount++;
                } else if (char === ')') {
                    parenCount--;
                }
            }

            if (foundOpenParen && parenCount === 0) {
                break;
            }
        }

        // Parse common parameters
        this.parseParameter(decoratorText, 'deps', info, 'dependencies');
        this.parseParameter(decoratorText, 'group_name', info, 'group');
        this.parseParameter(decoratorText, 'compute_kind', info, 'computeKind');
        this.parseParameter(decoratorText, 'description', info, 'description');
        this.parseParameter(decoratorText, 'partitions_def', info, 'partitionsDefinition');
        this.parseParameter(decoratorText, 'retry_policy', info, 'retryPolicy');
        this.parseParameter(decoratorText, 'freshness_policy', info, 'freshnessPolicyMinutes');
        this.parseParameter(decoratorText, 'auto_materialize_policy', info, 'autoMaterializePolicy');

        // Parse tags
        const tagsMatch = decoratorText.match(/tags\s*=\s*\{([^}]+)\}/s);
        if (tagsMatch) {
            info.tags = this.parseTags(tagsMatch[1]);
        }

        return info;
    }

    private parseParameter(decoratorText: string, paramName: string, info: any, outputKey: string): void {
        // String parameters
        const stringMatch = decoratorText.match(new RegExp(`${paramName}\\s*=\\s*["']([^"']+)["']`));
        if (stringMatch) {
            info[outputKey] = stringMatch[1];
            return;
        }

        // List parameters (like deps)
        const listMatch = decoratorText.match(new RegExp(`${paramName}\\s*=\\s*\\[(.*?)\\]`, 's'));
        if (listMatch) {
            const listContent = listMatch[1];
            const items = listContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
            if (items) {
                info[outputKey] = items;
            }
            return;
        }

        // Object references
        const refMatch = decoratorText.match(new RegExp(`${paramName}\\s*=\\s*([a-zA-Z_][a-zA-Z0-9_]*)`));
        if (refMatch) {
            info[outputKey] = refMatch[1];
        }
    }

    private parseTags(tagsContent: string): Record<string, string> {
        const tags: Record<string, string> = {};
        
        // Parse key-value pairs in tags
        const pairs = tagsContent.match(/"([^"]+)"\s*:\s*"([^"]+)"/g);
        if (pairs) {
            pairs.forEach(pair => {
                const match = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
                if (match) {
                    tags[match[1]] = match[2];
                }
            });
        }

        return tags;
    }

    private extractDocumentation(lines: string[], functionLine: number): DocumentationInfo[] {
        const documentation: DocumentationInfo[] = [];

        // Extract docstring
        for (let i = functionLine + 1; i < Math.min(functionLine + 20, lines.length); i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('"""') || line.startsWith("'''")) {
                const quote = line.startsWith('"""') ? '"""' : "'''";
                let docstring = '';
                
                // Single line docstring
                if (line.endsWith(quote) && line.length > 6) {
                    docstring = line.slice(3, -3).trim();
                } else {
                    // Multi-line docstring
                    docstring = line.slice(3);
                    for (let j = i + 1; j < lines.length; j++) {
                        const docLine = lines[j];
                        if (docLine.includes(quote)) {
                            docstring += ' ' + docLine.substring(0, docLine.indexOf(quote)).trim();
                            break;
                        }
                        docstring += ' ' + docLine.trim();
                    }
                }
                
                if (docstring) {
                    documentation.push({
                        type: 'docstring',
                        content: docstring,
                        line: i
                    });
                }
                break;
            }
        }

        // Extract inline comments, TODOs, FIXMEs
        for (let i = Math.max(0, functionLine - 5); i < Math.min(functionLine + 50, lines.length); i++) {
            const line = lines[i];
            
            if (line.includes('# TODO') || line.includes('# FIXME') || line.includes('# HACK')) {
                const type = line.includes('TODO') ? 'todo' : 
                           line.includes('FIXME') ? 'fixme' : 'warning';
                const content = line.substring(line.indexOf('#') + 1).trim();
                documentation.push({ type: type as any, content, line: i });
            } else if (line.includes('#') && !line.trim().startsWith('#')) {
                // Inline comments
                const content = line.substring(line.indexOf('#') + 1).trim();
                if (content.length > 5) { // Ignore short comments
                    documentation.push({ type: 'inline_comment', content, line: i });
                }
            }
        }

        return documentation;
    }

    private calculateComplexity(lines: string[], functionLine: number, decoratorInfo: any): 'Low' | 'Medium' | 'High' {
        let complexity = 0;

        // Count dependencies
        if (decoratorInfo.dependencies) {
            complexity += decoratorInfo.dependencies.length * 2;
        }

        // Count function length
        let functionLength = 0;
        for (let i = functionLine + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
                functionLength++;
            }
            if (line.startsWith('def ') || line.startsWith('@')) {
                break; // Next function/decorator
            }
        }
        complexity += Math.floor(functionLength / 5);

        // Check for complex patterns
        const functionText = lines.slice(functionLine, functionLine + functionLength).join('\n');
        if (functionText.includes('for ') || functionText.includes('while ')) complexity += 3;
        if (functionText.includes('if ') || functionText.includes('elif ')) complexity += 2;
        if (functionText.includes('try:') || functionText.includes('except')) complexity += 3;

        if (complexity < 5) return 'Low';
        if (complexity < 15) return 'Medium';
        return 'High';
    }

    private assessHealth(decoratorInfo: any, documentation: DocumentationInfo[]): 'Good' | 'Warning' | 'Critical' {
        let healthScore = 100;

        // Deduct for missing documentation
        if (!decoratorInfo.description && !documentation.find(d => d.type === 'docstring')) {
            healthScore -= 30;
        }

        // Deduct for TODOs and FIXMEs
        const todos = documentation.filter(d => d.type === 'todo' || d.type === 'fixme');
        healthScore -= todos.length * 15;

        // Deduct for missing group
        if (!decoratorInfo.group) {
            healthScore -= 10;
        }

        // Deduct for missing compute kind
        if (!decoratorInfo.computeKind) {
            healthScore -= 10;
        }

        if (healthScore >= 80) return 'Good';
        if (healthScore >= 50) return 'Warning';
        return 'Critical';
    }

    private extractCodeOwners(lines: string[], decoratorLine: number, functionLine: number): string[] {
        const owners: string[] = [];

        // Look for @author or @owner comments
        for (let i = Math.max(0, decoratorLine - 10); i < functionLine; i++) {
            const line = lines[i];
            const ownerMatch = line.match(/#\s*@?(author|owner|maintainer):?\s*([a-zA-Z0-9@._-]+)/i);
            if (ownerMatch) {
                owners.push(ownerMatch[2]);
            }
        }

        return [...new Set(owners)]; // Remove duplicates
    }

    private applyFilters(assets: AssetMetadata[], filter: any): AssetMetadata[] {
        return assets.filter(asset => {
            if (filter.group && asset.group !== filter.group) return false;
            if (filter.computeKind && asset.computeKind !== filter.computeKind) return false;
            if (filter.health && asset.health !== filter.health) return false;
            if (filter.complexity && asset.complexity !== filter.complexity) return false;
            if (filter.search && !asset.name.toLowerCase().includes(filter.search.toLowerCase())) return false;
            return true;
        });
    }

    private async navigateToAsset(assetName: string): Promise<void> {
        try {
            const assets = await this.extractAllAssetMetadata();
            const asset = assets.find(a => a.name === assetName);
            
            if (asset) {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(asset.filePath));
                const position = new vscode.Position(asset.line, 0);
                
                await vscode.window.showTextDocument(document, {
                    selection: new vscode.Range(position, position)
                });
            } else {
                vscode.window.showWarningMessage(`Asset '${assetName}' not found`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to navigate to asset: ${error}`);
        }
    }

    private async showAssetDetails(assetName: string): Promise<void> {
        const assets = await this.extractAllAssetMetadata();
        const asset = assets.find(a => a.name === assetName);
        
        if (asset) {
            const details = this.formatAssetDetails(asset);
            const doc = await vscode.workspace.openTextDocument({
                content: details,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);
        }
    }

    private formatAssetDetails(asset: AssetMetadata): string {
        return `# Asset: ${asset.name}

## Overview
- **Group:** ${asset.group || 'None'}
- **Compute Kind:** ${asset.computeKind || 'None'}
- **Complexity:** ${asset.complexity}
- **Health:** ${asset.health}
- **File:** ${asset.filePath}
- **Last Modified:** ${asset.lastModified?.toLocaleDateString()}

## Description
${asset.description || 'No description available'}

## Dependencies (${asset.dependencies.length})
${asset.dependencies.map(dep => `- ${dep}`).join('\n') || 'None'}

## Tags
${Object.entries(asset.tags).map(([key, value]) => `- **${key}:** ${value}`).join('\n') || 'None'}

## Configuration
- **Partitions:** ${asset.partitionsDefinition || 'None'}
- **Retry Policy:** ${asset.retryPolicy || 'None'}
- **Auto Materialize:** ${asset.autoMaterializePolicy || 'None'}

## Code Owners
${asset.codeOwners.map(owner => `- ${owner}`).join('\n') || 'None specified'}

## Documentation
${asset.documentation.map(doc => `### ${doc.type.toUpperCase()} (Line ${doc.line})\n${doc.content}`).join('\n\n') || 'No additional documentation'}
`;
    }

    private async exportDocumentation(): Promise<void> {
        try {
            const assets = await this.extractAllAssetMetadata();
            const markdown = this.generateFullDocumentation(assets);
            
            const doc = await vscode.workspace.openTextDocument({
                content: markdown,
                language: 'markdown'
            });
            
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage('Asset documentation generated! Save as .md file.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export documentation: ${error}`);
        }
    }

    private generateFullDocumentation(assets: AssetMetadata[]): string {
        const groups = assets.reduce((acc, asset) => {
            const group = asset.group || 'Ungrouped';
            if (!acc[group]) acc[group] = [];
            acc[group].push(asset);
            return acc;
        }, {} as Record<string, AssetMetadata[]>);

        let markdown = `# Dagster Asset Catalog

Generated on: ${new Date().toLocaleString()}
Total Assets: ${assets.length}

## Summary by Group

${Object.entries(groups).map(([group, groupAssets]) => 
    `- **${group}:** ${groupAssets.length} assets`
).join('\n')}

## Health Overview

- **Good:** ${assets.filter(a => a.health === 'Good').length}
- **Warning:** ${assets.filter(a => a.health === 'Warning').length}
- **Critical:** ${assets.filter(a => a.health === 'Critical').length}

`;

        // Add detailed documentation for each group
        Object.entries(groups).forEach(([group, groupAssets]) => {
            markdown += `\n## Group: ${group}\n\n`;
            
            groupAssets.forEach(asset => {
                markdown += `### ${asset.name}\n\n`;
                markdown += `- **Description:** ${asset.description || 'No description'}\n`;
                markdown += `- **Compute Kind:** ${asset.computeKind || 'None'}\n`;
                markdown += `- **Dependencies:** ${asset.dependencies.join(', ') || 'None'}\n`;
                markdown += `- **Health:** ${asset.health}\n`;
                markdown += `- **File:** \`${asset.filePath}\`\n\n`;
            });
        });

        return markdown;
    }

    private getWebviewContent(assets: AssetMetadata[]): string {
        const groups = assets.reduce((acc, asset) => {
            const group = asset.group || 'Ungrouped';
            if (!acc[group]) acc[group] = [];
            acc[group].push(asset);
            return acc;
        }, {} as Record<string, AssetMetadata[]>);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dagster Asset Catalog</title>
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
        
        .controls {
            display: flex;
            gap: 15px;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .control-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        select, input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 10px;
            border-radius: 3px;
            font-size: 13px;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 13px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background-color: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        
        .group-section {
            margin-bottom: 40px;
        }
        
        .group-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 20px;
            color: var(--vscode-textLink-foreground);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .asset-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        
        .asset-card {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 20px;
            transition: transform 0.2s, border-color 0.2s;
            cursor: pointer;
        }
        
        .asset-card:hover {
            transform: translateY(-2px);
            border-color: var(--vscode-textLink-foreground);
        }
        
        .asset-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
        }
        
        .asset-name {
            font-size: 16px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        .health-badge {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .health-good { background-color: #4CAF50; color: white; }
        .health-warning { background-color: #FF9800; color: white; }
        .health-critical { background-color: #F44336; color: white; }
        
        .asset-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
            font-size: 13px;
            line-height: 1.4;
        }
        
        .asset-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            font-size: 12px;
        }
        
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .meta-label {
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
        }
        
        .meta-value {
            color: var(--vscode-editor-foreground);
        }
        
        .tags {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 10px;
        }
        
        .tag {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
        }
        
        .dependencies {
            margin-top: 10px;
            font-size: 12px;
        }
        
        .dep-list {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-top: 4px;
        }
        
        .dep-item {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 10px;
            cursor: pointer;
        }
        
        .dep-item:hover {
            background-color: var(--vscode-textLink-foreground);
            color: var(--vscode-editor-background);
        }
        
        .complexity-low { border-left: 4px solid #4CAF50; }
        .complexity-medium { border-left: 4px solid #FF9800; }
        .complexity-high { border-left: 4px solid #F44336; }
        
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 60px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📚 Dagster Asset Catalog</h1>
        <div>
            <button onclick="exportDocumentation()">📄 Export Docs</button>
            <button onclick="refreshCatalog()">🔄 Refresh</button>
        </div>
    </div>
    
    <div class="controls">
        <div class="control-group">
            <label>Search:</label>
            <input type="text" id="searchInput" placeholder="Asset name..." onkeyup="filterAssets()">
        </div>
        <div class="control-group">
            <label>Group:</label>
            <select id="groupFilter" onchange="filterAssets()">
                <option value="">All Groups</option>
                ${Object.keys(groups).map(group => `<option value="${group}">${group}</option>`).join('')}
            </select>
        </div>
        <div class="control-group">
            <label>Health:</label>
            <select id="healthFilter" onchange="filterAssets()">
                <option value="">All Health</option>
                <option value="Good">Good</option>
                <option value="Warning">Warning</option>
                <option value="Critical">Critical</option>
            </select>
        </div>
        <div class="control-group">
            <label>Complexity:</label>
            <select id="complexityFilter" onchange="filterAssets()">
                <option value="">All Complexity</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
            </select>
        </div>
    </div>
    
    <div class="stats">
        <div class="stat-card">
            <div class="stat-number">${assets.length}</div>
            <div class="stat-label">Total Assets</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${Object.keys(groups).length}</div>
            <div class="stat-label">Groups</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${assets.filter(a => a.health === 'Good').length}</div>
            <div class="stat-label">Healthy</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${assets.reduce((sum, a) => sum + a.dependencies.length, 0)}</div>
            <div class="stat-label">Dependencies</div>
        </div>
    </div>
    
    <div id="catalogContent">
        ${Object.entries(groups).map(([groupName, groupAssets]) => `
            <div class="group-section" data-group="${groupName}">
                <div class="group-title">
                    📁 ${groupName}
                    <span style="font-size: 14px; font-weight: normal; color: var(--vscode-descriptionForeground);">
                        (${groupAssets.length} assets)
                    </span>
                </div>
                <div class="asset-grid">
                    ${groupAssets.map(asset => `
                        <div class="asset-card complexity-${asset.complexity.toLowerCase()}" 
                             onclick="navigateToAsset('${asset.name}')"
                             data-asset-name="${asset.name}"
                             data-health="${asset.health}"
                             data-complexity="${asset.complexity}">
                            <div class="asset-header">
                                <div class="asset-name">${asset.name}</div>
                                <div class="health-badge health-${asset.health.toLowerCase()}">${asset.health}</div>
                            </div>
                            
                            <div class="asset-description">
                                ${asset.description || 'No description available'}
                            </div>
                            
                            <div class="asset-meta">
                                <div class="meta-item">
                                    <div class="meta-label">Compute Kind</div>
                                    <div class="meta-value">${asset.computeKind || 'None'}</div>
                                </div>
                                <div class="meta-item">
                                    <div class="meta-label">Complexity</div>
                                    <div class="meta-value">${asset.complexity}</div>
                                </div>
                                <div class="meta-item">
                                    <div class="meta-label">Dependencies</div>
                                    <div class="meta-value">${asset.dependencies.length}</div>
                                </div>
                                <div class="meta-item">
                                    <div class="meta-label">Last Modified</div>
                                    <div class="meta-value">${asset.lastModified?.toLocaleDateString() || 'Unknown'}</div>
                                </div>
                            </div>
                            
                            ${Object.keys(asset.tags).length > 0 ? `
                                <div class="tags">
                                    ${Object.entries(asset.tags).map(([key, value]) => 
                                        `<div class="tag" title="${key}: ${value}">${key}</div>`
                                    ).join('')}
                                </div>
                            ` : ''}
                            
                            ${asset.dependencies.length > 0 ? `
                                <div class="dependencies">
                                    <div class="meta-label">Dependencies:</div>
                                    <div class="dep-list">
                                        ${asset.dependencies.map(dep => 
                                            `<div class="dep-item" onclick="event.stopPropagation(); navigateToAsset('${dep}')">${dep}</div>`
                                        ).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
    </div>
    
    ${assets.length === 0 ? `
        <div class="empty-state">
            🔍 No assets found in your workspace.<br>
            Make sure you have Python files with @asset decorators.
        </div>
    ` : ''}
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function navigateToAsset(assetName) {
            vscode.postMessage({
                command: 'navigateToAsset',
                assetName: assetName
            });
        }
        
        function refreshCatalog() {
            vscode.postMessage({
                command: 'refreshCatalog'
            });
        }
        
        function exportDocumentation() {
            vscode.postMessage({
                command: 'exportDocumentation'
            });
        }
        
        function filterAssets() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const group = document.getElementById('groupFilter').value;
            const health = document.getElementById('healthFilter').value;
            const complexity = document.getElementById('complexityFilter').value;
            
            const assetCards = document.querySelectorAll('.asset-card');
            const groupSections = document.querySelectorAll('.group-section');
            
            assetCards.forEach(card => {
                const assetName = card.dataset.assetName.toLowerCase();
                const assetHealth = card.dataset.health;
                const assetComplexity = card.dataset.complexity;
                const cardGroup = card.closest('.group-section').dataset.group;
                
                const matchesSearch = !search || assetName.includes(search);
                const matchesGroup = !group || cardGroup === group;
                const matchesHealth = !health || assetHealth === health;
                const matchesComplexity = !complexity || assetComplexity === complexity;
                
                const visible = matchesSearch && matchesGroup && matchesHealth && matchesComplexity;
                card.style.display = visible ? 'block' : 'none';
            });
            
            // Hide empty groups
            groupSections.forEach(section => {
                const visibleCards = section.querySelectorAll('.asset-card[style="display: block"], .asset-card:not([style*="display: none"])');
                section.style.display = visibleCards.length > 0 ? 'block' : 'none';
            });
        }
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.panel?.dispose();
    }
}

