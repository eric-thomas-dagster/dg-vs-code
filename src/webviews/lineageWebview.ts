import * as vscode from 'vscode';
import { DagsterGraphQLClient } from '../core/graphqlClient';

export class LineageWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dagsterLineage';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _dagsterClient: DagsterGraphQLClient
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'materializeAsset':
                        this._materializeAsset(message.assetKey);
                        break;
                    case 'openAssetDefinition':
                        this._openAssetDefinition(message.assetKey);
                        break;
                    case 'refreshLineage':
                        this._refreshLineage();
                        break;
                }
            },
            undefined,
            []
        );

        // Load initial lineage data
        this._loadLineageData();
    }

    public async showLineage(assetKey?: string) {
        if (this._view) {
            this._view.show?.(true);
            if (assetKey) {
                await this._loadLineageData(assetKey);
            }
        }
    }

    private async _loadLineageData(focusAssetKey?: string) {
        if (!this._view) {
            return;
        }

        try {
            // Show loading state
            this._view.webview.postMessage({
                type: 'loading',
                isLoading: true
            });

            // Fetch assets and their lineage
            const assets = await this._dagsterClient.getAssets();
            
            // If no focus asset specified, use the first asset or try to detect from current file
            let targetAsset = focusAssetKey;
            if (!targetAsset && assets.length > 0) {
                targetAsset = await this._detectCurrentAsset() || assets[0].key;
            }

            let lineageData = null;
            if (targetAsset) {
                try {
                    lineageData = await this._dagsterClient.getAssetLineage(targetAsset);
                } catch (error) {
                    console.error('Failed to fetch lineage for asset:', targetAsset, error);
                }
            }

            // Send data to webview
            this._view.webview.postMessage({
                type: 'lineageData',
                data: {
                    assets,
                    lineage: lineageData,
                    focusAsset: targetAsset
                }
            });

        } catch (error) {
            console.error('Failed to load lineage data:', error);
            this._view.webview.postMessage({
                type: 'error',
                message: `Failed to load lineage data: ${error}`
            });
        } finally {
            this._view.webview.postMessage({
                type: 'loading',
                isLoading: false
            });
        }
    }

    private async _detectCurrentAsset(): Promise<string | null> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'python') {
            return null;
        }

        const text = activeEditor.document.getText();
        const assetRegex = /@(?:\w+\.)?asset(?:\([^)]*\))?\s*\n\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
        const match = text.match(assetRegex);
        
        return match ? match[1] : null;
    }

    private async _materializeAsset(assetKey: string) {
        try {
            vscode.window.showInformationMessage(`Materializing asset: ${assetKey}...`);
            
            const result = await this._dagsterClient.materializeAsset(assetKey);
            
            if (result.success) {
                vscode.window.showInformationMessage(`Asset ${assetKey} materialized successfully!`);
                // Refresh lineage to show updated materialization status
                this._refreshLineage();
            } else {
                vscode.window.showErrorMessage(`Failed to materialize asset ${assetKey}: ${result.error}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error materializing asset: ${error}`);
        }
    }

    private async _openAssetDefinition(assetKey: string) {
        // Try to find the asset definition in the workspace
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return;
            }

            // Search for the asset definition
            const searchResults = await vscode.workspace.findFiles(
                '**/*.py',
                '**/node_modules/**'
            );

            for (const file of searchResults) {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                // Look for the asset definition (supports @asset, @dg.asset, @dagster.asset)
                const assetRegex = new RegExp(`@(?:\\w+\\.)?asset(?:\\([^)]*\\))?\\s*\\n\\s*def\\s+${assetKey}\\b`);
                if (assetRegex.test(text)) {
                    await vscode.window.showTextDocument(document);
                    
                    // Try to jump to the specific line
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (assetRegex.test(lines.slice(i, i + 2).join('\n'))) {
                            const position = new vscode.Position(i, 0);
                            const selection = new vscode.Selection(position, position);
                            vscode.window.activeTextEditor!.selection = selection;
                            vscode.window.activeTextEditor!.revealRange(selection);
                            break;
                        }
                    }
                    return;
                }
            }

            vscode.window.showWarningMessage(`Could not find definition for asset: ${assetKey}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening asset definition: ${error}`);
        }
    }

    private async _refreshLineage() {
        await this._loadLineageData();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'lineage.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'lineage.css'));

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://localhost:3000 https:;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Dagster Asset Lineage</title>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Asset Lineage</h2>
                        <div class="controls">
                            <button id="refreshBtn" class="btn btn-primary" title="Refresh lineage">
                                <span class="codicon codicon-refresh"></span>
                            </button>
                            <button id="openDagsterBtn" class="btn btn-secondary" title="Open in Dagster UI">
                                <span class="codicon codicon-link-external"></span>
                            </button>
                        </div>
                    </div>
                    
                    <div id="loadingContainer" class="loading-container" style="display: none;">
                        <div class="loading-spinner"></div>
                        <p>Loading lineage data...</p>
                    </div>
                    
                    <div id="errorContainer" class="error-container" style="display: none;">
                        <div class="error-message">
                            <span class="codicon codicon-error"></span>
                            <span id="errorText"></span>
                        </div>
                    </div>
                    
                    <div id="lineageContainer" class="lineage-container">
                        <div id="assetSelector" class="asset-selector">
                            <label for="assetSelect">Focus Asset:</label>
                            <select id="assetSelect" class="asset-select">
                                <option value="">Select an asset...</option>
                            </select>
                        </div>
                        
                        <div id="lineageGraph" class="lineage-graph">
                            <div class="no-data">
                                <span class="codicon codicon-graph"></span>
                                <p>No lineage data available</p>
                                <p class="subtext">Make sure Dagster is running locally and assets are available</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
