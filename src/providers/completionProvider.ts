import * as vscode from 'vscode';
import { DagsterGraphQLClient, DagsterAsset } from '../core/graphqlClient';

export class DagsterCompletionProvider implements vscode.CompletionItemProvider {
    private assets: DagsterAsset[] = [];
    private lastFetch = 0;
    private readonly CACHE_DURATION = 30000; // 30 seconds

    constructor(private dagsterClient: DagsterGraphQLClient) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        
        // Only provide completions for Python files
        if (document.languageId !== 'python') {
            return [];
        }

        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);

        // Refresh assets cache if needed
        await this.refreshAssetsIfNeeded();

        const completions: vscode.CompletionItem[] = [];

        // Asset completions in AssetIn() calls
        if (this.shouldProvideAssetInCompletions(linePrefix)) {
            completions.push(...this.getAssetInCompletions());
        }

        // Asset completions in asset dependencies
        if (this.shouldProvideAssetDependencyCompletions(linePrefix)) {
            completions.push(...this.getAssetDependencyCompletions());
        }

        // Decorator completions
        if (this.shouldProvideDecoratorCompletions(linePrefix)) {
            completions.push(...this.getDecoratorCompletions());
        }

        // Import completions
        if (this.shouldProvideImportCompletions(linePrefix)) {
            completions.push(...this.getImportCompletions());
        }

        // Context method completions
        if (this.shouldProvideContextCompletions(linePrefix)) {
            completions.push(...this.getContextCompletions());
        }

        return completions;
    }

    private async refreshAssetsIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastFetch > this.CACHE_DURATION) {
            try {
                this.assets = await this.dagsterClient.getAssets();
                this.lastFetch = now;
            } catch (error) {
                console.error('Failed to refresh assets for completion:', error);
            }
        }
    }

    private shouldProvideAssetInCompletions(linePrefix: string): boolean {
        return /AssetIn\(\s*["']?$/.test(linePrefix);
    }

    private shouldProvideAssetDependencyCompletions(linePrefix: string): boolean {
        return /deps\s*=\s*\[\s*["']?$/.test(linePrefix) || 
               /deps\s*=\s*\[\s*.*,\s*["']?$/.test(linePrefix);
    }

    private shouldProvideDecoratorCompletions(linePrefix: string): boolean {
        return /^\s*@/.test(linePrefix);
    }

    private shouldProvideImportCompletions(linePrefix: string): boolean {
        // Handle various import patterns
        return /from\s+dagster\s+import\s*/.test(linePrefix) ||           // from dagster import 
               /from\s+dagster\s+import\s+.*,\s*$/.test(linePrefix) ||    // from dagster import asset, 
               /from\s+dagster\s+import\s*\(\s*/.test(linePrefix) ||      // from dagster import (
               /from\s+dagster\s+import\s*\(\s*.*,\s*$/.test(linePrefix) || // from dagster import (asset,
               /^import\s+dagster/.test(linePrefix);
    }

    private shouldProvideContextCompletions(linePrefix: string): boolean {
        return /context\./.test(linePrefix);
    }

    private getAssetInCompletions(): vscode.CompletionItem[] {
        return this.assets.map(asset => {
            const completion = new vscode.CompletionItem(
                asset.key,
                vscode.CompletionItemKind.Value
            );
            completion.detail = 'Dagster Asset';
            completion.documentation = asset.description || `Asset: ${asset.key}`;
            completion.insertText = `"${asset.key}"`;
            completion.sortText = `0_${asset.key}`;
            return completion;
        });
    }

    private getAssetDependencyCompletions(): vscode.CompletionItem[] {
        return this.assets.map(asset => {
            const completion = new vscode.CompletionItem(
                asset.key,
                vscode.CompletionItemKind.Reference
            );
            completion.detail = 'Asset Dependency';
            completion.documentation = asset.description || `Asset dependency: ${asset.key}`;
            completion.insertText = `"${asset.key}"`;
            completion.sortText = `0_${asset.key}`;
            return completion;
        });
    }

    private getDecoratorCompletions(): vscode.CompletionItem[] {
        const decorators = [
            {
                label: '@asset',
                insertText: 'asset',
                documentation: 'Defines a Dagster asset',
                detail: 'Asset Decorator'
            },
            {
                label: '@op',
                insertText: 'op',
                documentation: 'Defines a Dagster op',
                detail: 'Op Decorator'
            },
            {
                label: '@job',
                insertText: 'job',
                documentation: 'Defines a Dagster job',
                detail: 'Job Decorator'
            },
            {
                label: '@graph',
                insertText: 'graph',
                documentation: 'Defines a Dagster graph',
                detail: 'Graph Decorator'
            },
            {
                label: '@schedule',
                insertText: 'schedule',
                documentation: 'Defines a Dagster schedule',
                detail: 'Schedule Decorator'
            },
            {
                label: '@sensor',
                insertText: 'sensor',
                documentation: 'Defines a Dagster sensor',
                detail: 'Sensor Decorator'
            },
            {
                label: '@resource',
                insertText: 'resource',
                documentation: 'Defines a Dagster resource',
                detail: 'Resource Decorator'
            }
        ];

        return decorators.map(decorator => {
            const completion = new vscode.CompletionItem(
                decorator.label,
                vscode.CompletionItemKind.Snippet
            );
            completion.insertText = decorator.insertText;
            completion.documentation = new vscode.MarkdownString(decorator.documentation);
            completion.detail = decorator.detail;
            completion.sortText = `1_${decorator.label}`;
            return completion;
        });
    }

    private getImportCompletions(): vscode.CompletionItem[] {
        const imports = [
            'asset',
            'op',
            'job',
            'graph',
            'schedule',
            'sensor',
            'resource',
            'AssetIn',
            'AssetOut',
            'Config',
            'OpExecutionContext',
            'AssetExecutionContext',
            'Definitions',
            'DailyPartitionsDefinition',
            'HourlyPartitionsDefinition',
            'StaticPartitionsDefinition',
            'MaterializeResult',
            'AssetMaterialization',
            'AssetCheckResult',
            'AssetCheckSeverity',
            'MetadataValue',
            'Output'
        ];

        return imports.map(importName => {
            const completion = new vscode.CompletionItem(
                importName,
                vscode.CompletionItemKind.Module
            );
            completion.detail = 'Dagster Import';
            completion.insertText = importName;
            completion.sortText = `2_${importName}`;
            return completion;
        });
    }

    private getContextCompletions(): vscode.CompletionItem[] {
        const contextMethods = [
            {
                label: 'log',
                insertText: 'log',
                documentation: 'Logger for the current execution context',
                detail: 'Logger'
            },
            {
                label: 'resources',
                insertText: 'resources',
                documentation: 'Resources available in the current execution context',
                detail: 'Resources'
            },
            {
                label: 'asset_key',
                insertText: 'asset_key',
                documentation: 'The asset key for the current asset',
                detail: 'AssetKey'
            },
            {
                label: 'partition_key',
                insertText: 'partition_key',
                documentation: 'The partition key for the current execution',
                detail: 'Partition Key'
            },
            {
                label: 'run_id',
                insertText: 'run_id',
                documentation: 'The run ID for the current execution',
                detail: 'Run ID'
            },
            {
                label: 'asset_partition_key_for_output',
                insertText: 'asset_partition_key_for_output("${1:output_name}")',
                documentation: 'Get the partition key for a specific output',
                detail: 'Asset Partition Key'
            },
            {
                label: 'has_assets',
                insertText: 'has_assets',
                documentation: 'Whether this context has any assets',
                detail: 'Boolean'
            }
        ];

        return contextMethods.map(method => {
            const completion = new vscode.CompletionItem(
                method.label,
                vscode.CompletionItemKind.Method
            );
            completion.insertText = new vscode.SnippetString(method.insertText);
            completion.documentation = new vscode.MarkdownString(method.documentation);
            completion.detail = method.detail;
            completion.sortText = `3_${method.label}`;
            return completion;
        });
    }
}
