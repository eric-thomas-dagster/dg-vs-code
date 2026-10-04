import * as vscode from 'vscode';
import { DagsterProjectDetector } from './core/projectDetector';
import { DagsterGraphQLClient } from './core/graphqlClient';
import { LineageWebviewProvider } from './webviews/lineageWebview';
import { AssetTreeProvider } from './views/assetTreeProvider';
import { DagsterCompletionProvider } from './providers/completionProvider';
import { DagsterNavigationProvider, DagsterReferenceProvider } from './providers/navigationProvider';
import { DagsterDiagnosticsProvider } from './providers/diagnosticsProvider';
import { ConfigValidationProvider } from './providers/configValidationProvider';
import { DependencyGraphWebview } from './webviews/dependencyGraphWebview';
import { ImportAnalysisWebview } from './webviews/importAnalysisWebview';
import { AssetMetadataWebview } from './webviews/assetMetadataWebview';
import { DagsterStatusBar } from './ui/statusBar';
import { DagsterCloudValidator, ValidationResult, ValidationIssue } from './core/cloudValidator';
import { DagsterPlusPublisher } from './core/dagsterPlusPublisher';
import { DgCliManager } from './core/dgCliManager';
import { ProjectSetupManager } from './core/projectSetupManager';
import { RunStatus } from './core/graphqlClient';
import { AskDagsterProvider } from './providers/askDagsterProvider';

let dagsterClient: DagsterGraphQLClient;
let lineageProvider: LineageWebviewProvider;
let dependencyGraphProvider: DependencyGraphWebview;
let importAnalysisProvider: ImportAnalysisWebview;
let assetMetadataProvider: AssetMetadataWebview;
let statusBar: DagsterStatusBar;
let dgCliManager: DgCliManager;
let projectSetupManager: ProjectSetupManager;
let askDagsterProvider: AskDagsterProvider;

// Global variable to store the current Dagster server port
let currentDagsterPort: number | null = null;

/**
 * Get the current Dagster server port
 */
export function getCurrentDagsterPort(): number | null {
    return currentDagsterPort;
}

/**
 * Set the current Dagster server port and update VS Code configuration
 */
export function setCurrentDagsterPort(port: number): void {
    currentDagsterPort = port;
    updateConfigurationForPort(port);
}

/**
 * Update VS Code configuration with the detected port
 */
async function updateConfigurationForPort(port: number): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('dagster');
        await config.update('graphqlUrl', `http://localhost:${port}/graphql`, vscode.ConfigurationTarget.Workspace);
        await config.update('webserverUrl', `http://localhost:${port}`, vscode.ConfigurationTarget.Workspace);
        dagsterClient.refreshClient();
    } catch (error) {
        console.error('Failed to update configuration for port:', error);
    }
}

/**
 * Get the current Dagster server URL
 */
export function getCurrentDagsterUrl(): string {
    const port = currentDagsterPort || 3000;
    return `http://localhost:${port}`;
}

/**
 * Get the current Dagster GraphQL URL
 */
export function getCurrentDagsterGraphQLUrl(): string {
    const port = currentDagsterPort || 3000;
    return `http://localhost:${port}/graphql`;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('🔥 Dagster Power User extension is activating...');
    console.log('🔥 About to register hover provider...');

    // Initialize core components
    const projectDetector = new DagsterProjectDetector();
    dagsterClient = new DagsterGraphQLClient();
    lineageProvider = new LineageWebviewProvider(context.extensionUri, dagsterClient);
    dependencyGraphProvider = new DependencyGraphWebview(context.extensionUri);
    importAnalysisProvider = new ImportAnalysisWebview(context.extensionUri);
    assetMetadataProvider = new AssetMetadataWebview(context.extensionUri);
    statusBar = new DagsterStatusBar();
    dgCliManager = new DgCliManager();
    projectSetupManager = new ProjectSetupManager();

    // Check if this is a Dagster project (async)
    checkDagsterProject(projectDetector).catch(error => {
        console.error('Failed to check Dagster project:', error);
    });

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'dagsterLineage',
            lineageProvider
        )
    );

    // Register tree view providers
    const assetTreeProvider = new AssetTreeProvider(dagsterClient);
    vscode.window.registerTreeDataProvider('dagsterAssets', assetTreeProvider);

    // Register Ask Dagster provider
    askDagsterProvider = new AskDagsterProvider(context.extensionUri, context);
    askDagsterProvider.setStatusBar(statusBar);  // Pass status bar reference
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AskDagsterProvider.viewType,
            askDagsterProvider
        )
    );

    // Register completion providers for Python files
    const completionProvider = new DagsterCompletionProvider(dagsterClient);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'python' },
            completionProvider,
            '.', '@'
        )
    );

    // Register navigation providers for smart asset navigation
    console.log('🔥 Creating navigation providers...');
    const navigationProvider = new DagsterNavigationProvider(dagsterClient);
    const referenceProvider = new DagsterReferenceProvider(dagsterClient);
    
    console.log('🔥 Registering Dagster hover provider...');
    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: 'file', language: 'python' },
        navigationProvider
    );
    console.log('Dagster hover provider registered successfully');
    
    context.subscriptions.push(
        hoverProvider,
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', language: 'python' },
            navigationProvider
        ),
        vscode.languages.registerReferenceProvider(
            { scheme: 'file', language: 'python' },
            referenceProvider
        )
    );

    // Register diagnostics provider for real-time code validation
    const diagnosticsProvider = new DagsterDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    // Register config validation provider for enhanced config file support
    const configValidationProvider = new ConfigValidationProvider();
    context.subscriptions.push(configValidationProvider);

    // Register commands
    registerCommands(context);

    console.log('Dagster Power User extension activated successfully!');
}

function registerCommands(context: vscode.ExtensionContext) {
    // Show Dependency Graph
    const showDependencyGraphCommand = vscode.commands.registerCommand('dagster.showDependencyGraph', async (assetName?: string) => {
        try {
            await dependencyGraphProvider.showGraph(assetName);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show dependency graph: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Show Import Analysis
    const showImportAnalysisCommand = vscode.commands.registerCommand('dagster.showImportAnalysis', async () => {
        try {
            await importAnalysisProvider.showAnalysis();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show import analysis: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Show Asset Catalog
    const showAssetCatalogCommand = vscode.commands.registerCommand('dagster.showAssetCatalog', async () => {
        try {
            await assetMetadataProvider.showAssetCatalog();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show asset catalog: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Ask Dagster
    const askDagsterCommand = vscode.commands.registerCommand('dagster.askDagster', async () => {
        try {
            await vscode.commands.executeCommand('dagster.askDagster.focus');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open Ask Dagster: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Show Asset Lineage (consolidated command)
    const showLineageCommand = vscode.commands.registerCommand('dagster.showLineage', async (assetName?: string) => {
        try {
            let targetAssetName = assetName;
            
            if (!targetAssetName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const position = activeEditor.selection.active;
                    const navProvider = new DagsterNavigationProvider(dagsterClient);
                    targetAssetName = navProvider.getAssetNameAtPosition(activeEditor.document, position);
                }
            }

            // Create a completely new webview panel type to bypass cache
            const timestamp = Date.now();
            const panel = vscode.window.createWebviewPanel(
                `dagsterLineageV2_${timestamp}`, // Completely new panel type
                `Dagster Asset Lineage v2`,
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    localResourceRoots: [context.extensionUri],
                    retainContextWhenHidden: false // Don't retain context to force reload
                }
            );
            
            // Set the HTML content
            panel.webview.html = getLineageWebviewContent(panel.webview, context.extensionUri);
            
            // Auto-refresh asset data when the panel is created
            setTimeout(async () => {
                try {
                    await refreshAssetData(panel);
                } catch (error) {
                    console.error('Failed to auto-refresh assets:', error);
                }
            }, 500);
            
            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    // console.log('Webview message received:', message);
                    
                    switch (message.type) {
                        case 'startDagster':
                            try {
                                await startLocalWebserver();
                            } catch (error) {
                                vscode.window.showErrorMessage(`Failed to start Dagster: ${error}`);
                            }
                            break;
                        case 'refresh':
                        case 'refreshLineage':
                            await refreshAssetData(panel);
                            break;
                        case 'getAssetLineage':
                            await getAssetLineage(panel, message.assetKey);
                            break;
                        case 'materializeAsset':
                            await materializeAsset(message.assetKey);
                            break;
                        case 'openAssetDefinition':
                            await openAssetDefinition(message.assetKey);
                            break;
                        default:
                            // console.log(`Unknown message type: ${message.type}`);
                    }
                }
            );
            

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show lineage: ${error}`);
        }
    });

    // Materialize Current Asset
    const materializeAssetCommand = vscode.commands.registerCommand('dagster.materializeAsset', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active Python file');
                return;
            }

            const assetName = await extractAssetName(activeEditor.document);
            if (!assetName) {
                vscode.window.showWarningMessage('No Dagster asset found in current file');
                return;
            }

            await materializeAsset(assetName);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to materialize asset: ${error}`);
        }
    });

    // Start Local Webserver
    const startWebserverCommand = vscode.commands.registerCommand('dagster.startWebserver', async () => {
        try {
            await startLocalWebserver();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start webserver: ${error}`);
        }
    });

    // Reload Code Location
    const reloadCodeLocationCommand = vscode.commands.registerCommand('dagster.reloadCodeLocation', async () => {
        try {
            await dagsterClient.reloadCodeLocation();
            vscode.window.showInformationMessage('Code location reloaded successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reload code location: ${error}`);
        }
    });

    // Show Run History
    const showRunHistoryCommand = vscode.commands.registerCommand('dagster.showRunHistory', async () => {
        try {
            await showRunHistory();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show run history: ${error}`);
        }
    });

    context.subscriptions.push(
        showLineageCommand,
        materializeAssetCommand,
        startWebserverCommand,
        reloadCodeLocationCommand,
        showRunHistoryCommand
    );

    // Quick Start Command
    const quickStartCommand = vscode.commands.registerCommand('dagster.quickStart', async () => {
        try {
            await startLocalWebserver();
            // Wait a moment then show lineage
            setTimeout(async () => {
                await vscode.commands.executeCommand('dagster.showLineage');
            }, 2000);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to quick start: ${error}`);
        }
    });

    context.subscriptions.push(quickStartCommand);

    // Find Dagster Instance Command
    const findDagsterCommand = vscode.commands.registerCommand('dagster.findDagsterInstance', async () => {
        try {
            vscode.window.showInformationMessage('🔍 Searching for Dagster instances...');
            
            // Check running processes
            const detectedPort = await detectDagsterPort();
            if (detectedPort) {
                vscode.window.showInformationMessage(`Found Dagster on port ${detectedPort}! Connecting...`);
                const config = vscode.workspace.getConfiguration('dagster');
                await config.update('graphqlUrl', `http://localhost:${detectedPort}/graphql`, vscode.ConfigurationTarget.Workspace);
                dagsterClient.refreshClient();
                statusBar.updateStatus('connected');
            } else {
                vscode.window.showWarningMessage('No running Dagster instances found.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find Dagster: ${error}`);
        }
    });

    context.subscriptions.push(findDagsterCommand);

    // Cloud Config Doctor - Single unified command
    const cloudValidator = new DagsterCloudValidator();

    const cloudConfigDoctorCommand = vscode.commands.registerCommand('dagster.cloudConfigDoctor', async () => {
        try {
            const validation = await cloudValidator.validateConfig();
            
            // Show validation results in a webview
            const panel = vscode.window.createWebviewPanel(
                'dagsterCloudDoctor',
                '🩺 Dagster Cloud Config Doctor',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    localResourceRoots: [context.extensionUri]
                }
            );

            panel.webview.html = getCloudDoctorWebviewContent(validation, panel.webview, context.extensionUri);
            
            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.type) {
                        case 'autoFix':
                            try {
                                const fixedValidation = await cloudValidator.autoFix();
                                panel.webview.postMessage({
                                    type: 'validationUpdated',
                                    validation: fixedValidation
                                });
                            } catch (error) {
                                vscode.window.showErrorMessage(`❌ Auto-fix failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            }
                            break;
                        case 'refresh':
                            try {
                                const newValidation = await cloudValidator.validateConfig();
                                panel.webview.postMessage({
                                    type: 'validationUpdated',
                                    validation: newValidation
                                });
                            } catch (error) {
                                vscode.window.showErrorMessage(`❌ Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            }
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );

        } catch (error) {
            vscode.window.showErrorMessage(`❌ Cloud config check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    context.subscriptions.push(cloudConfigDoctorCommand);

    // Dagster+ Publishing Commands
    const dagsterPlusPublisher = new DagsterPlusPublisher(context);

    const publishToDagsterPlusCommand = vscode.commands.registerCommand('dagster.publishToDagsterPlus', async () => {
        try {
            await dagsterPlusPublisher.publishToDagsterPlus();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to publish to Dagster+: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const setupDagsterPlusCommand = vscode.commands.registerCommand('dagster.setupDagsterPlus', async () => {
        try {
            await dagsterPlusPublisher.setupDagsterPlus();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to setup Dagster+: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const deployBranchCommand = vscode.commands.registerCommand('dagster.deployBranch', async () => {
        try {
            const result = await dagsterPlusPublisher.deployBranch();
            if (result.success) {
                const openAction = 'Open Deployment';
                const choice = await vscode.window.showInformationMessage(
                    `✅ ${result.message}`,
                    openAction
                );
                
                if (choice === openAction && result.deploymentUrl) {
                    vscode.env.openExternal(vscode.Uri.parse(result.deploymentUrl));
                }
            } else {
                vscode.window.showErrorMessage(`❌ Branch deployment failed: ${result.error}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to deploy branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const instantDeployCommand = vscode.commands.registerCommand('dagster.instantDeploy', async () => {
        try {
            const result = await dagsterPlusPublisher.deployInstant();
            if (result.success) {
                const openAction = 'Open Dagster+';
                const shareAction = 'Share URL';
                const choice = await vscode.window.showInformationMessage(
                    `⚡ ${result.message}`,
                    openAction,
                    shareAction
                );
                
                if (choice === openAction && result.deploymentUrl) {
                    vscode.env.openExternal(vscode.Uri.parse(result.deploymentUrl));
                } else if (choice === shareAction && result.deploymentUrl) {
                    vscode.env.clipboard.writeText(result.deploymentUrl);
                    vscode.window.showInformationMessage('Deployment URL copied to clipboard!');
                }
            } else {
                vscode.window.showErrorMessage(`❌ Instant deployment failed: ${result.error}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to instant deploy: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const manageApiTokenCommand = vscode.commands.registerCommand('dagster.manageApiToken', async () => {
        try {
            const actions = [
                {
                    label: '🔑 Enter New Token',
                    description: 'Add or update your Dagster+ API token',
                    value: 'new'
                },
                {
                    label: '🔍 View Current Token',
                    description: 'Show the last 4 characters of stored token',
                    value: 'view'
                },
                {
                    label: '🗑️ Clear Stored Token',
                    description: 'Remove the stored API token',
                    value: 'clear'
                },
                {
                    label: '📖 Learn About API Tokens',
                    description: 'Open Dagster+ documentation',
                    value: 'learn'
                }
            ];

            const selected = await vscode.window.showQuickPick(actions, {
                placeHolder: 'Choose token management action'
            });

            if (!selected) {
                return;
            }

            switch (selected.value) {
                case 'new':
                    await dagsterPlusPublisher.requestNewApiToken();
                    break;
                case 'view':
                    const storedToken = await dagsterPlusPublisher.getStoredApiToken();
                    if (storedToken) {
                        vscode.window.showInformationMessage(`Current token: ...${storedToken.slice(-4)}`);
                    } else {
                        vscode.window.showInformationMessage('No API token stored');
                    }
                    break;
                case 'clear':
                    await dagsterPlusPublisher.clearStoredApiToken();
                    vscode.window.showInformationMessage('API token cleared');
                    break;
                case 'learn':
                    vscode.env.openExternal(vscode.Uri.parse('https://docs.dagster.io/dagster-plus/account/managing-user-agent-tokens'));
                    break;
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to manage API token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    context.subscriptions.push(publishToDagsterPlusCommand, setupDagsterPlusCommand, deployBranchCommand, instantDeployCommand, manageApiTokenCommand);

    // Airflow to Dagster conversion command
    const convertAirflowProjectCommand = vscode.commands.registerCommand('dagster.convertAirflowProject', async () => {
        try {
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Airflow Project Folder',
                title: 'Select Airflow Project to Convert'
            });

            if (!folderUri || folderUri.length === 0) {
                return;
            }

            const airflowProjectPath = folderUri[0].fsPath;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Converting Airflow to Dagster...',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Analyzing Airflow DAGs...' });

                const llmProvider = async (prompt: string) => {
                    if (askDagsterProvider) {
                        return await (askDagsterProvider as any)._callLLM(prompt);
                    }
                    throw new Error('Ask Dagster provider not initialized');
                };

                const { GuidelinesManager } = await import('./core/guidelinesManager');
                const guidelinesManager = new GuidelinesManager(context.extensionUri);
                const guidelines = await guidelinesManager.getGuidelinesContext();

                const { AirflowConverter } = await import('./core/airflowConverter');
                const converter = new AirflowConverter(llmProvider, guidelines);

                progress.report({ message: 'Converting DAGs to assets...' });
                const result = await converter.convertProject(airflowProjectPath);

                if (result.success) {
                    const openProject = await vscode.window.showInformationMessage(
                        `✅ ${result.message}\n\nConverted to: ${result.outputPath}`,
                        'Open Project',
                        'View in Explorer'
                    );

                    if (openProject === 'Open Project') {
                        const uri = vscode.Uri.file(result.outputPath!);
                        await vscode.commands.executeCommand('vscode.openFolder', uri, false);
                    } else if (openProject === 'View in Explorer') {
                        const uri = vscode.Uri.file(result.outputPath!);
                        await vscode.commands.executeCommand('revealFileInOS', uri);
                    }

                    if (result.warnings && result.warnings.length > 0) {
                        vscode.window.showWarningMessage(
                            `Conversion completed with warnings:\n${result.warnings.join('\n')}`
                        );
                    }
                } else {
                    vscode.window.showErrorMessage(`Conversion failed: ${result.message}`);
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to convert Airflow project: ${error}`);
        }
    });

    context.subscriptions.push(convertAirflowProjectCommand);

    // Switch AI Model command
    const switchAIModelCommand = vscode.commands.registerCommand('dagster.switchAIModel', async () => {
        try {
            if (!askDagsterProvider) {
                vscode.window.showErrorMessage('Ask Dagster provider not initialized');
                return;
            }

            const onboardingManager = (askDagsterProvider as any).getOnboardingManager();
            
            const choice = await vscode.window.showQuickPick([
                {
                    label: '$(server) Local Ollama',
                    description: 'Free, private, runs on your machine',
                    detail: 'Choose model size after selection',
                    value: 'ollama'
                },
                {
                    label: '$(sparkle) Claude Code Extension',
                    description: 'Use your Claude Code extension',
                    detail: 'Requires Claude Code extension to be installed',
                    value: 'claude-code'
                },
                {
                    label: '$(cloud) Claude API (Anthropic)',
                    description: 'Fast, powerful, pay-per-use',
                    detail: 'Requires API key from console.anthropic.com',
                    value: 'claude'
                },
                {
                    label: '$(symbol-misc) OpenAI API',
                    description: 'GPT-4, fast, pay-per-use',
                    detail: 'Requires API key from platform.openai.com',
                    value: 'openai'
                }
            ], {
                placeHolder: 'Select AI Model Provider',
                title: 'Switch AI Model'
            });

            if (!choice) {
                return;
            }

            let result;
            if (choice.value === 'ollama') {
                result = await onboardingManager.setupOllama();
            } else if (choice.value === 'claude-code') {
                result = await onboardingManager.setupClaudeCodeExtension();
            } else if (choice.value === 'claude') {
                result = await onboardingManager.setupClaude();
            } else if (choice.value === 'openai') {
                result = await onboardingManager.setupOpenAI();
            }

            if (result?.success) {
                vscode.window.showInformationMessage(result.message);
            } else if (result) {
                vscode.window.showWarningMessage(result.message);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to switch AI model: ${error}`);
        }
    });

    context.subscriptions.push(switchAIModelCommand);

    // Quick Actions Command for Status Bar
    const showQuickActionsCommand = vscode.commands.registerCommand('dagster.showQuickActions', async () => {
        const actions = [
            {
                label: '⚡ Instant Project Setup',
                description: 'Setup dependencies + .venv + Dagster + deploy!',
                command: 'dagster.instantProjectSetup'
            },
            {
                label: '🚀 Instant Deploy to Dagster+',
                description: 'Deploy current code instantly - no GitHub setup needed!',
                command: 'dagster.instantDeploy'
            },
            {
                label: '🚀 DG Dev Server',
                description: 'Start Dagster development server with dg CLI',
                command: 'dagster.dgDev'
            },
            {
                label: '🎯 DG Launch Run',
                description: 'Launch assets or jobs with dg CLI',
                command: 'dagster.dgLaunch'
            },
            {
                label: '🔍 DG Check Definitions',
                description: 'Validate Dagster definitions with dg CLI',
                command: 'dagster.dgCheckDefs'
            },
            {
                label: '🏗️ DG Scaffold Asset',
                description: 'Generate new asset with dg CLI',
                command: 'dagster.dgScaffoldAsset'
            },
            {
                label: '🚀 Full Publish to Dagster+',
                description: 'Complete deployment with workflow setup',
                command: 'dagster.publishToDagsterPlus'
            },
            {
                label: '⚙️ Setup Dagster+ Deployment',
                description: 'Configure Dagster+ for this project',
                command: 'dagster.setupDagsterPlus'
            },
            {
                label: '🌿 Deploy Current Branch',
                description: 'Create a branch deployment',
                command: 'dagster.deployBranch'
            },
            {
                label: '🎯 Show Asset Lineage',
                description: 'Visualize asset dependencies',
                command: 'dagster.showLineage'
            },
            {
                label: '🩺 Cloud Config Doctor',
                description: 'Validate and fix cloud configuration',
                command: 'dagster.cloudConfigDoctor'
            },
            {
                label: '🔄 Reload Code Location',
                description: 'Refresh Dagster code location',
                command: 'dagster.reloadCodeLocation'
            },
            {
                label: '📈 Show Run History',
                description: 'View recent pipeline runs',
                command: 'dagster.showRunHistory'
            },
            {
                label: '🎮 Start Local Webserver',
                description: 'Launch Dagster development server',
                command: 'dagster.startWebserver'
            },
            {
                label: '🔐 Manage API Token',
                description: 'Set or update Dagster+ API token',
                command: 'dagster.manageApiToken'
            }
        ];

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: 'Choose a Dagster action',
            matchOnDescription: true
        });

        if (selected) {
            await vscode.commands.executeCommand(selected.command);
            return true; // Indicate that a command was actually selected and executed
        }
        
        return false; // Indicate that the user canceled
    });

    context.subscriptions.push(showQuickActionsCommand);

    // Asset-specific commands
    const findAssetReferencesCommand = vscode.commands.registerCommand('dagster.findAssetReferences', async (assetName?: string) => {
        try {
            let targetAssetName = assetName;
            
            if (!targetAssetName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetAssetName = navProvider.getAssetNameAtPosition(activeEditor.document, position);
                
                if (!targetAssetName) {
                    vscode.window.showWarningMessage('No asset found at cursor position');
                    return;
                }
            }

            // Use VS Code's built-in reference search
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                // Find the position of the asset name in the current document
                const document = activeEditor.document;
                const text = document.getText();
                const assetIndex = text.indexOf(targetAssetName);
                if (assetIndex !== -1) {
                    const position = document.positionAt(assetIndex);
                    await vscode.commands.executeCommand('editor.action.findReferences', 
                        document.uri, position);
                } else {
                    vscode.window.showInformationMessage(`Searching for references to asset: ${targetAssetName}`);
                    // Execute a workspace-wide search as fallback
                    await vscode.commands.executeCommand('workbench.action.findInFiles', {
                        query: targetAssetName,
                        isRegex: false,
                        isCaseSensitive: true,
                        matchWholeWord: true
                    });
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find asset references: ${error}`);
        }
    });

    const goToAssetDefinitionCommand = vscode.commands.registerCommand('dagster.goToAssetDefinition', async (assetName?: string) => {
        try {
            let targetAssetName = assetName;
            
            if (!targetAssetName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetAssetName = navProvider.getAssetNameAtPosition(activeEditor.document, position);
                
                if (!targetAssetName) {
                    vscode.window.showWarningMessage('No asset found at cursor position');
                    return;
                }
            }

            // Use the navigation provider to find and go to definition
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                const definition = await navProvider.provideDefinition(
                    activeEditor.document, 
                    activeEditor.selection.active, 
                    new vscode.CancellationTokenSource().token
                );
                
                if (definition && definition instanceof vscode.Location) {
                    await vscode.window.showTextDocument(definition.uri, {
                        selection: definition.range,
                        viewColumn: vscode.ViewColumn.One
                    });
                } else {
                    vscode.window.showWarningMessage(`Could not find definition for asset: ${targetAssetName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to asset definition: ${error}`);
        }
    });

    // Job-specific commands
    const executeJobCommand = vscode.commands.registerCommand('dagster.executeJob', async (jobName?: string) => {
        try {
            let targetJobName = jobName;
            
            if (!targetJobName) {
                // Try to get jobs from Dagster instance first
                try {
                    console.log('🔍 Fetching jobs for picker...');
                    const jobs = await dagsterClient.getJobs();
                    
                    if (jobs && jobs.length > 0) {
                        console.log(`📋 Found ${jobs.length} jobs, showing picker`);
                        const jobItems = jobs.map(job => ({
                            label: `🔧 ${job.name}`,
                            description: job.description || 'No description',
                            detail: `${job.runs.length > 0 ? `Last run: ${job.runs[0].status}` : 'No recent runs'} • ${job.schedules.length} schedules • ${job.sensors.length} sensors`,
                            job: job.name
                        }));
                        
                        const selectedJob = await vscode.window.showQuickPick(jobItems, {
                            placeHolder: 'Select a job to execute',
                            matchOnDescription: true,
                            matchOnDetail: true
                        });
                        
                        if (selectedJob) {
                            targetJobName = selectedJob.job;
                            console.log(`✅ User selected job: ${targetJobName}`);
                        } else {
                            console.log('❌ User cancelled job selection');
                            return;
                        }
                    } else {
                        console.log('📝 No jobs found from GraphQL, falling back to cursor position');
                        throw new Error('No jobs available');
                    }
                } catch (graphqlError) {
                    console.log('📡 GraphQL failed, trying cursor position approach:', graphqlError);
                    
                    // Fallback to cursor position detection
                    const activeEditor = vscode.window.activeTextEditor;
                    if (!activeEditor) {
                        vscode.window.showWarningMessage('No jobs found in Dagster instance and no active Python file. Please ensure Dagster server is running or position cursor on a job definition.');
                        return;
                    }
                    
                    const position = activeEditor.selection.active;
                    const navProvider = new DagsterNavigationProvider(dagsterClient);
                    targetJobName = navProvider.getJobNameAtPosition(activeEditor.document, position);
                    
                    if (!targetJobName) {
                        vscode.window.showWarningMessage('No jobs found in Dagster instance and no job detected at cursor position. Please position cursor on a job definition or ensure Dagster server is running.');
                        return;
                    }
                }
            }

            vscode.window.showInformationMessage(`🚀 Executing job: ${targetJobName}`);
            const result = await dgCliManager.launch({ job: targetJobName });
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Job ${targetJobName} executed successfully!`);
            } else {
                vscode.window.showErrorMessage(`❌ Failed to execute job: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute job: ${error}`);
        }
    });

    const findJobReferencesCommand = vscode.commands.registerCommand('dagster.findJobReferences', async (jobName?: string) => {
        try {
            let targetJobName = jobName;
            
            if (!targetJobName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetJobName = navProvider.getJobNameAtPosition(activeEditor.document, position);
                
                if (!targetJobName) {
                    vscode.window.showWarningMessage('No job found at cursor position');
                    return;
                }
            }

            // Use the reference provider to find references
            const referenceProvider = new DagsterReferenceProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const references = await referenceProvider.provideReferences(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { includeDeclaration: true },
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (references && references.length > 0) {
                    vscode.window.showInformationMessage(`Found ${references.length} references to job ${targetJobName}`);
                } else {
                    vscode.window.showWarningMessage(`No references found for job ${targetJobName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find job references: ${error}`);
        }
    });

    const goToJobDefinitionCommand = vscode.commands.registerCommand('dagster.goToJobDefinition', async (jobName?: string) => {
        try {
            let targetJobName = jobName;
            
            if (!targetJobName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetJobName = navProvider.getJobNameAtPosition(activeEditor.document, position);
                
                if (!targetJobName) {
                    vscode.window.showWarningMessage('No job found at cursor position');
                    return;
                }
            }

            // Use the navigation provider to find definition
            const navProvider = new DagsterNavigationProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const definition = await navProvider.provideDefinition(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (definition) {
                    if (Array.isArray(definition) && definition.length > 0) {
                        const firstDef = definition[0];
                        if (firstDef instanceof vscode.Location) {
                            await vscode.window.showTextDocument(firstDef.uri, { selection: firstDef.range });
                        }
                    } else if (definition instanceof vscode.Location) {
                        await vscode.window.showTextDocument(definition.uri, { selection: definition.range });
                    }
                } else {
                    vscode.window.showWarningMessage(`Definition not found for job ${targetJobName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to job definition: ${error}`);
        }
    });

    const showJobLineageCommand = vscode.commands.registerCommand('dagster.showJobLineage', async (jobName?: string) => {
        try {
            let targetJobName = jobName;
            
            if (!targetJobName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetJobName = navProvider.getJobNameAtPosition(activeEditor.document, position);
                
                if (!targetJobName) {
                    vscode.window.showWarningMessage('No job found at cursor position');
                    return;
                }
            }

            // Show lineage for the job (will show assets within the job)
            vscode.commands.executeCommand('dagster.showLineage', targetJobName);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show job lineage: ${error}`);
        }
    });

    // Schedule-specific commands
    const findScheduleReferencesCommand = vscode.commands.registerCommand('dagster.findScheduleReferences', async (scheduleName?: string) => {
        try {
            let targetScheduleName = scheduleName;
            
            if (!targetScheduleName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetScheduleName = navProvider.getScheduleNameAtPosition(activeEditor.document, position);
                
                if (!targetScheduleName) {
                    vscode.window.showWarningMessage('No schedule found at cursor position');
                    return;
                }
            }

            // Use the reference provider to find references
            const referenceProvider = new DagsterReferenceProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const references = await referenceProvider.provideReferences(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { includeDeclaration: true },
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (references && references.length > 0) {
                    vscode.window.showInformationMessage(`Found ${references.length} references to schedule ${targetScheduleName}`);
                } else {
                    vscode.window.showWarningMessage(`No references found for schedule ${targetScheduleName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find schedule references: ${error}`);
        }
    });

    const goToScheduleDefinitionCommand = vscode.commands.registerCommand('dagster.goToScheduleDefinition', async (scheduleName?: string) => {
        try {
            let targetScheduleName = scheduleName;
            
            if (!targetScheduleName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetScheduleName = navProvider.getScheduleNameAtPosition(activeEditor.document, position);
                
                if (!targetScheduleName) {
                    vscode.window.showWarningMessage('No schedule found at cursor position');
                    return;
                }
            }

            // Use the navigation provider to find definition
            const navProvider = new DagsterNavigationProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const definition = await navProvider.provideDefinition(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (definition) {
                    if (Array.isArray(definition) && definition.length > 0) {
                        const firstDef = definition[0];
                        if (firstDef instanceof vscode.Location) {
                            await vscode.window.showTextDocument(firstDef.uri, { selection: firstDef.range });
                        }
                    } else if (definition instanceof vscode.Location) {
                        await vscode.window.showTextDocument(definition.uri, { selection: definition.range });
                    }
                } else {
                    vscode.window.showWarningMessage(`Definition not found for schedule ${targetScheduleName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to schedule definition: ${error}`);
        }
    });

    const dgLaunchScheduleCommand = vscode.commands.registerCommand('dagster.dgLaunchSchedule', async (scheduleName?: string) => {
        try {
            if (!scheduleName) {
                scheduleName = await vscode.window.showInputBox({
                    prompt: 'Enter schedule name',
                    placeHolder: 'my_schedule'
                });
            }
            if (!scheduleName) return;

            // Note: DG CLI doesn't have direct --schedule option, so we'll show instructions
            const message = `Schedules run automatically based on their cron schedule. To manually trigger a schedule's job, you can:
            
1. Use the Dagster UI to manually trigger the schedule
2. Use 'dg launch --job <job_name>' if you know the job name that the schedule targets`;
            
            vscode.window.showInformationMessage(`ℹ️ Schedule: ${scheduleName}`, { detail: message, modal: true });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to process schedule: ${error}`);
        }
    });

    // Sensor-specific commands
    const findSensorReferencesCommand = vscode.commands.registerCommand('dagster.findSensorReferences', async (sensorName?: string) => {
        try {
            let targetSensorName = sensorName;
            
            if (!targetSensorName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetSensorName = navProvider.getSensorNameAtPosition(activeEditor.document, position);
                
                if (!targetSensorName) {
                    vscode.window.showWarningMessage('No sensor found at cursor position');
                    return;
                }
            }

            // Use the reference provider to find references
            const referenceProvider = new DagsterReferenceProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const references = await referenceProvider.provideReferences(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { includeDeclaration: true },
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (references && references.length > 0) {
                    vscode.window.showInformationMessage(`Found ${references.length} references to sensor ${targetSensorName}`);
                } else {
                    vscode.window.showWarningMessage(`No references found for sensor ${targetSensorName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find sensor references: ${error}`);
        }
    });

    const goToSensorDefinitionCommand = vscode.commands.registerCommand('dagster.goToSensorDefinition', async (sensorName?: string) => {
        try {
            let targetSensorName = sensorName;
            
            if (!targetSensorName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetSensorName = navProvider.getSensorNameAtPosition(activeEditor.document, position);
                
                if (!targetSensorName) {
                    vscode.window.showWarningMessage('No sensor found at cursor position');
                    return;
                }
            }

            // Use the navigation provider to find definition
            const navProvider = new DagsterNavigationProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const definition = await navProvider.provideDefinition(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (definition) {
                    if (Array.isArray(definition) && definition.length > 0) {
                        const firstDef = definition[0];
                        if (firstDef instanceof vscode.Location) {
                            await vscode.window.showTextDocument(firstDef.uri, { selection: firstDef.range });
                        }
                    } else if (definition instanceof vscode.Location) {
                        await vscode.window.showTextDocument(definition.uri, { selection: definition.range });
                    }
                } else {
                    vscode.window.showWarningMessage(`Definition not found for sensor ${targetSensorName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to sensor definition: ${error}`);
        }
    });

    const dgLaunchSensorCommand = vscode.commands.registerCommand('dagster.dgLaunchSensor', async (sensorName?: string) => {
        try {
            if (!sensorName) {
                sensorName = await vscode.window.showInputBox({
                    prompt: 'Enter sensor name',
                    placeHolder: 'my_sensor'
                });
            }
            if (!sensorName) return;

            // Note: DG CLI doesn't have direct --sensor option, so we'll show instructions
            const message = `Sensors run automatically based on their evaluation. To manually trigger a sensor's job, you can:
            
1. Use the Dagster UI to manually trigger the sensor
2. Use 'dg launch --job <job_name>' if you know the job name that the sensor targets`;
            
            vscode.window.showInformationMessage(`ℹ️ Sensor: ${sensorName}`, { detail: message, modal: true });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to process sensor: ${error}`);
        }
    });

    // Op-specific commands
    const findOpReferencesCommand = vscode.commands.registerCommand('dagster.findOpReferences', async (opName?: string) => {
        try {
            let targetOpName = opName;
            
            if (!targetOpName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetOpName = navProvider.getOpNameAtPosition(activeEditor.document, position);
                
                if (!targetOpName) {
                    vscode.window.showWarningMessage('No op found at cursor position');
                    return;
                }
            }

            // Use the reference provider to find references
            const referenceProvider = new DagsterReferenceProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const references = await referenceProvider.provideReferences(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { includeDeclaration: true },
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (references && references.length > 0) {
                    vscode.window.showInformationMessage(`Found ${references.length} references to op ${targetOpName}`);
                } else {
                    vscode.window.showWarningMessage(`No references found for op ${targetOpName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find op references: ${error}`);
        }
    });

    const goToOpDefinitionCommand = vscode.commands.registerCommand('dagster.goToOpDefinition', async (opName?: string) => {
        try {
            let targetOpName = opName;
            
            if (!targetOpName) {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active Python file');
                    return;
                }
                
                const position = activeEditor.selection.active;
                const navProvider = new DagsterNavigationProvider(dagsterClient);
                targetOpName = navProvider.getOpNameAtPosition(activeEditor.document, position);
                
                if (!targetOpName) {
                    vscode.window.showWarningMessage('No op found at cursor position');
                    return;
                }
            }

            // Use the navigation provider to find definition
            const navProvider = new DagsterNavigationProvider(dagsterClient);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const definition = await navProvider.provideDefinition(
                    activeEditor.document,
                    activeEditor.selection.active,
                    { isCancellationRequested: false, onCancellationRequested: new vscode.EventEmitter().event }
                );

                if (definition) {
                    if (Array.isArray(definition) && definition.length > 0) {
                        const firstDef = definition[0];
                        if (firstDef instanceof vscode.Location) {
                            await vscode.window.showTextDocument(firstDef.uri, { selection: firstDef.range });
                        }
                    } else if (definition instanceof vscode.Location) {
                        await vscode.window.showTextDocument(definition.uri, { selection: definition.range });
                    }
                } else {
                    vscode.window.showWarningMessage(`Definition not found for op ${targetOpName}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to op definition: ${error}`);
        }
    });

    const dgLaunchOpCommand = vscode.commands.registerCommand('dagster.dgLaunchOp', async (opName?: string) => {
        try {
            if (!opName) {
                opName = await vscode.window.showInputBox({
                    prompt: 'Enter op name',
                    placeHolder: 'my_op'
                });
            }
            if (!opName) return;

            // Note: DG CLI doesn't have direct --op option, so we'll show instructions
            const message = `Ops are typically executed as part of jobs. To launch an op, you can:
            
1. Use 'dg launch --job <job_name>' to run the job that contains this op
2. Create a simple job that contains just this op and launch that job`;
            
            vscode.window.showInformationMessage(`ℹ️ Op: ${opName}`, { detail: message, modal: true });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to process op: ${error}`);
        }
    });

    // =================== DG CLI COMMANDS ===================
    
    // DG Check Commands
    const dgCheckDefsCommand = vscode.commands.registerCommand('dagster.dgCheckDefs', async () => {
        try {
            const result = await dgCliManager.checkDefs({ verbose: true });
            if (result.success) {
                vscode.window.showInformationMessage('✅ Dagster definitions validation passed!');
            } else {
                vscode.window.showErrorMessage(`❌ Validation failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to check definitions: ${error}`);
        }
    });

    const dgCheckTomlCommand = vscode.commands.registerCommand('dagster.dgCheckToml', async () => {
        try {
            const result = await dgCliManager.checkToml({ verbose: true });
            if (result.success) {
                vscode.window.showInformationMessage('✅ TOML configuration validation passed!');
            } else {
                vscode.window.showErrorMessage(`❌ TOML validation failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to check TOML: ${error}`);
        }
    });

    const dgCheckYamlCommand = vscode.commands.registerCommand('dagster.dgCheckYaml', async () => {
        try {
            const result = await dgCliManager.checkYaml({ verbose: true });
            if (result.success) {
                vscode.window.showInformationMessage('✅ YAML configuration validation passed!');
            } else {
                vscode.window.showErrorMessage(`❌ YAML validation failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to check YAML: ${error}`);
        }
    });

    // DG Dev Command
    const dgDevCommand = vscode.commands.registerCommand('dagster.dgDev', async () => {
        try {
            // Check if already available
            if (!await dgCliManager.isAvailable()) {
                vscode.window.showErrorMessage('❌ dg CLI not found. Please install Dagster and ensure dg is in your PATH.');
                return;
            }

            const options = await vscode.window.showQuickPick([
                { label: '🚀 Start Dev Server (Default)', description: 'Start with default settings', detail: 'Port 3000, info log level', value: 'default' },
                { label: '⚙️ Custom Configuration', description: 'Configure port, host, log level', detail: 'Customize dev server options', value: 'custom' }
            ], {
                placeHolder: 'Choose how to start Dagster dev server'
            });

            if (!options) return;

            let devOptions: any = {};

            if (options.value === 'custom') {
                const port = await vscode.window.showInputBox({
                    prompt: 'Enter port number (default: 3000)',
                    value: '3000',
                    validateInput: (value) => {
                        const num = parseInt(value);
                        if (isNaN(num) || num < 1000 || num > 65535) {
                            return 'Please enter a valid port number between 1000-65535';
                        }
                        return null;
                    }
                });
                if (port) devOptions.port = parseInt(port);

                const logLevel = await vscode.window.showQuickPick([
                    { label: 'Debug', value: 'debug' },
                    { label: 'Info (Default)', value: 'info' },
                    { label: 'Warning', value: 'warning' },
                    { label: 'Error', value: 'error' },
                    { label: 'Critical', value: 'critical' }
                ], {
                    placeHolder: 'Choose log level'
                });
                if (logLevel) devOptions.logLevel = logLevel.value;
            }

            vscode.window.showInformationMessage('🚀 Starting Dagster dev server...');
            const disposable = await dgCliManager.startDev(devOptions);
            
            // Update global port variable if custom port was specified
            if (devOptions.port) {
                currentDagsterPort = devOptions.port;
            }
            
            vscode.window.showInformationMessage('✅ Dagster dev server started! Check output panel for details.');
            dgCliManager.showOutput();

            // Store disposable to stop server later
            context.subscriptions.push(disposable);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start dev server: ${error}`);
        }
    });

    // DG Launch Command
    const dgLaunchCommand = vscode.commands.registerCommand('dagster.dgLaunch', async () => {
        try {
            const launchType = await vscode.window.showQuickPick([
                { label: '🎯 Launch Assets', description: 'Materialize specific assets', value: 'assets' },
                { label: '🔧 Launch Job', description: 'Execute a specific job', value: 'job' },
                { label: '📋 Launch All', description: 'Launch all assets', value: 'all' }
            ], {
                placeHolder: 'What would you like to launch?'
            });

            if (!launchType) return;

            let launchOptions: any = {};

            if (launchType.value === 'assets') {
                const assets = await vscode.window.showInputBox({
                    prompt: 'Enter asset names (comma-separated)',
                    placeHolder: 'asset1,asset2,asset3'
                });
                if (assets) launchOptions.assets = assets;
            } else if (launchType.value === 'job') {
                // Try to get jobs from Dagster instance first
                try {
                    console.log('🔍 Fetching jobs for DG Launch picker...');
                    const jobs = await dagsterClient.getJobs();
                    
                    if (jobs && jobs.length > 0) {
                        console.log(`📋 Found ${jobs.length} jobs for DG Launch picker`);
                        
                        // Also get CLI jobs for validation
                        let cliJobs: string[] = [];
                        try {
                            const dgCliResult = await dgCliManager.listDefs({ json: true });
                            if (dgCliResult.success && dgCliResult.data?.jobs) {
                                cliJobs = dgCliResult.data.jobs.map((job: any) => job.name);
                                console.log(`🔧 CLI jobs available: ${cliJobs.join(', ')}`);
                            }
                        } catch (cliError) {
                            console.log('⚠️ Could not fetch CLI jobs for validation:', cliError);
                        }
                        
                        const jobItems = jobs.map(job => {
                            const isInCli = cliJobs.length === 0 || cliJobs.includes(job.name);
                            return {
                                label: `${isInCli ? '🔧' : '⚠️'} ${job.name}`,
                                description: job.description || 'No description',
                                detail: isInCli 
                                    ? `${job.runs.length > 0 ? `Last run: ${job.runs[0].status}` : 'No recent runs'} • ${job.schedules.length} schedules • ${job.sensors.length} sensors`
                                    : '⚠️ Not available in CLI - may fail to launch',
                                job: job.name
                            };
                        });
                        
                        const selectedJob = await vscode.window.showQuickPick(jobItems, {
                            placeHolder: 'Select a job to launch (⚠️ = may not work with DG CLI)',
                            matchOnDescription: true,
                            matchOnDetail: true
                        });
                        
                        if (selectedJob) {
                            launchOptions.job = selectedJob.job;
                            console.log(`✅ User selected job for DG Launch: ${selectedJob.job}`);
                        } else {
                            console.log('❌ User cancelled job selection in DG Launch');
                            return;
                        }
                    } else {
                        console.log('📝 No jobs found from GraphQL for DG Launch, falling back to text input');
                        throw new Error('No jobs available');
                    }
                } catch (graphqlError) {
                    console.log('📡 GraphQL failed for DG Launch, using text input:', graphqlError);
                    
                    // Fallback to text input
                    const job = await vscode.window.showInputBox({
                        prompt: 'Enter job name (GraphQL unavailable)',
                        placeHolder: 'my_job'
                    });
                    if (job) launchOptions.job = job;
                }
            }

            vscode.window.showInformationMessage('🚀 Launching Dagster run...');
            const result = await dgCliManager.launch(launchOptions);
            
            if (result.success) {
                vscode.window.showInformationMessage('✅ Dagster run launched successfully!');
            } else {
                vscode.window.showErrorMessage(`❌ Launch failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch: ${error}`);
        }
    });

    // DG List Commands
    const dgListDefsCommand = vscode.commands.registerCommand('dagster.dgListDefs', async () => {
        try {
            const result = await dgCliManager.listDefs({ json: false });
            if (result.success) {
                dgCliManager.showOutput();
                vscode.window.showInformationMessage('📋 Definitions listed in output panel');
            } else {
                vscode.window.showErrorMessage('❌ Failed to list definitions');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list definitions: ${error}`);
        }
    });

    const dgListComponentsCommand = vscode.commands.registerCommand('dagster.dgListComponents', async () => {
        try {
            const result = await dgCliManager.listComponents();
            if (result.success) {
                dgCliManager.showOutput();
                vscode.window.showInformationMessage('📋 Components listed in output panel');
            } else {
                vscode.window.showErrorMessage('❌ Failed to list components');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list components: ${error}`);
        }
    });

    const dgListProjectsCommand = vscode.commands.registerCommand('dagster.dgListProjects', async () => {
        try {
            const result = await dgCliManager.listProjects();
            if (result.success) {
                dgCliManager.showOutput();
                vscode.window.showInformationMessage('📋 Projects listed in output panel');
            } else {
                vscode.window.showErrorMessage('❌ Failed to list projects');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list projects: ${error}`);
        }
    });

    // DG Scaffold Commands
    const dgScaffoldAssetCommand = vscode.commands.registerCommand('dagster.dgScaffoldAsset', async () => {
        try {
            const assetName = await vscode.window.showInputBox({
                prompt: 'Enter asset name',
                placeHolder: 'my_asset',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Asset name is required';
                    }
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Asset name must be a valid Python identifier';
                    }
                    return null;
                }
            });

            if (!assetName) return;

            const outputPath = `assets/${assetName}.py`;
            
            vscode.window.showInformationMessage(`🏗️ Scaffolding asset ${assetName}...`);
            const result = await dgCliManager.scaffoldDefs('dagster.asset', outputPath);
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Asset ${assetName} scaffolded successfully!`);
                
                // Try to open the generated file
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot) {
                    const fullPath = vscode.Uri.file(`${workspaceRoot}/src/*/defs/${outputPath}`);
                    try {
                        const files = await vscode.workspace.findFiles(`**/defs/${outputPath}`);
                        if (files.length > 0) {
                            await vscode.window.showTextDocument(files[0]);
                        }
                    } catch (error) {
                        console.log('Could not open generated file:', error);
                    }
                }
            } else {
                vscode.window.showErrorMessage(`❌ Scaffolding failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to scaffold asset: ${error}`);
        }
    });

    const dgScaffoldJobCommand = vscode.commands.registerCommand('dagster.dgScaffoldJob', async () => {
        try {
            const jobName = await vscode.window.showInputBox({
                prompt: 'Enter job name',
                placeHolder: 'my_job',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Job name is required';
                    }
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Job name must be a valid Python identifier';
                    }
                    return null;
                }
            });

            if (!jobName) return;

            const outputPath = `jobs/${jobName}.py`;
            
            vscode.window.showInformationMessage(`🏗️ Scaffolding job ${jobName}...`);
            const result = await dgCliManager.scaffoldDefs('dagster.job', outputPath);
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Job ${jobName} scaffolded successfully!`);
                
                // Try to open the generated file
                const files = await vscode.workspace.findFiles(`**/defs/${outputPath}`);
                if (files.length > 0) {
                    await vscode.window.showTextDocument(files[0]);
                }
            } else {
                vscode.window.showErrorMessage(`❌ Scaffolding failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to scaffold job: ${error}`);
        }
    });

    const dgScaffoldScheduleCommand = vscode.commands.registerCommand('dagster.dgScaffoldSchedule', async () => {
        try {
            const scheduleName = await vscode.window.showInputBox({
                prompt: 'Enter schedule name',
                placeHolder: 'daily_schedule',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Schedule name is required';
                    }
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Schedule name must be a valid Python identifier';
                    }
                    return null;
                }
            });

            if (!scheduleName) return;

            const outputPath = `schedules/${scheduleName}.py`;
            
            vscode.window.showInformationMessage(`🏗️ Scaffolding schedule ${scheduleName}...`);
            const result = await dgCliManager.scaffoldDefs('dagster.schedule', outputPath);
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Schedule ${scheduleName} scaffolded successfully!`);
                
                // Try to open the generated file
                const files = await vscode.workspace.findFiles(`**/defs/${outputPath}`);
                if (files.length > 0) {
                    await vscode.window.showTextDocument(files[0]);
                }
            } else {
                vscode.window.showErrorMessage(`❌ Scaffolding failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to scaffold schedule: ${error}`);
        }
    });

    // DG Scaffold Build Artifacts
    const dgScaffoldDockerfileCommand = vscode.commands.registerCommand('dagster.dgScaffoldDockerfile', async () => {
        try {
            vscode.window.showInformationMessage('🏗️ Scaffolding Dockerfile...');
            const result = await dgCliManager.scaffoldBuildArtifacts();
            
            if (result.success) {
                vscode.window.showInformationMessage('✅ Dockerfile scaffolded successfully!');
            } else {
                vscode.window.showErrorMessage(`❌ Scaffolding failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to scaffold Dockerfile: ${error}`);
        }
    });

    // DG Scaffold GitHub Actions
    const dgScaffoldGithubActionsCommand = vscode.commands.registerCommand('dagster.dgScaffoldGithubActions', async () => {
        try {
            vscode.window.showInformationMessage('🏗️ Scaffolding GitHub Actions workflow...');
            const result = await dgCliManager.scaffoldGithubActions();
            
            if (result.success) {
                vscode.window.showInformationMessage('✅ GitHub Actions workflow scaffolded successfully!');
            } else {
                vscode.window.showErrorMessage(`❌ Scaffolding failed: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to scaffold GitHub Actions: ${error}`);
        }
    });

    // =================== PROJECT SETUP COMMANDS ===================

    // Instant Project Setup
    const instantProjectSetupCommand = vscode.commands.registerCommand('dagster.instantProjectSetup', async () => {
        try {
            const setupType = await vscode.window.showQuickPick([
                { 
                    label: '⚡ Instant Setup + Deploy', 
                    description: 'Complete setup with instant Dagster+ deployment',
                    detail: 'Dependencies + .venv + Dagster + DG CLI + Deploy',
                    value: 'instant-deploy' 
                },
                { 
                    label: '🚀 Full Development Setup', 
                    description: 'Complete development environment',
                    detail: 'Dependencies + .venv + Dagster + DG CLI',
                    value: 'full-dev' 
                },
                { 
                    label: '🔧 Quick Environment Setup', 
                    description: 'Setup environment for existing project',
                    detail: '.venv + dependencies + Dagster',
                    value: 'quick-env' 
                },
                { 
                    label: '🎯 Install Dagster Only', 
                    description: 'Install just Dagster and DG CLI',
                    detail: 'Dagster + DG CLI (no .venv)',
                    value: 'dagster-only' 
                }
            ], {
                placeHolder: 'Choose setup type',
                title: '🚀 Dagster Project Setup'
            });

            if (!setupType) return;

            vscode.window.showInformationMessage('🚀 Starting project setup...');
            projectSetupManager.showOutput();

            let result;
            switch (setupType.value) {
                case 'instant-deploy':
                    result = await projectSetupManager.fullDevSetup();
                    if (result.success) {
                        vscode.window.showInformationMessage('🚀 Setup complete! Triggering instant deploy...');
                        vscode.commands.executeCommand('dagster.instantDeploy');
                    }
                    break;
                case 'full-dev':
                    result = await projectSetupManager.fullDevSetup();
                    break;
                case 'quick-env':
                    result = await projectSetupManager.quickEnvironmentSetup();
                    break;
                case 'dagster-only':
                    result = await projectSetupManager.installDagsterOnly();
                    break;
            }

            if (result?.success) {
                vscode.window.showInformationMessage('✅ Project setup completed successfully!');
            } else {
                vscode.window.showErrorMessage(`❌ Setup failed: ${result?.errors.join(', ') || 'Unknown error'}`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to setup project: ${error}`);
        }
    });

    // Clone Setup Deploy Workflow
    const cloneSetupDeployCommand = vscode.commands.registerCommand('dagster.cloneSetupDeploy', async () => {
        try {
            const repoUrl = await vscode.window.showInputBox({
                prompt: 'Enter GitHub repository URL',
                placeHolder: 'https://github.com/username/dagster-project.git',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Repository URL is required';
                    }
                    if (!value.includes('github.com') && !value.includes('gitlab.com') && !value.includes('bitbucket.org') && !value.includes('.git')) {
                        return 'Please enter a valid Git repository URL';
                    }
                    return null;
                }
            });

            if (!repoUrl) return;

            const deployOption = await vscode.window.showQuickPick([
                { label: '🚀 Clone + Setup + Deploy', description: 'Complete workflow with instant deploy', value: true },
                { label: '🔧 Clone + Setup Only', description: 'Setup without deployment', value: false }
            ], {
                placeHolder: 'Choose workflow'
            });

            if (deployOption === undefined) return;

            vscode.window.showInformationMessage('🚀 Starting Clone → Setup → Deploy workflow...');
            projectSetupManager.showOutput();

            const result = await projectSetupManager.cloneSetupDeploy(repoUrl, deployOption.value);
            
            if (result.success) {
                vscode.window.showInformationMessage('✅ Clone → Setup → Deploy completed successfully!');
            } else {
                vscode.window.showErrorMessage(`❌ Workflow failed: ${result.errors.join(', ')}`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute workflow: ${error}`);
        }
    });

    // =================== CONTEXTUAL DG LAUNCH COMMANDS ===================

    // Launch specific asset with DG CLI
    const dgLaunchAssetCommand = vscode.commands.registerCommand('dagster.dgLaunchAsset', async (assetName?: string) => {
        try {
            if (!assetName) {
                assetName = await vscode.window.showInputBox({
                    prompt: 'Enter asset name to launch',
                    placeHolder: 'my_asset'
                });
            }

            if (!assetName) return;

            vscode.window.showInformationMessage(`🚀 Launching asset: ${assetName}`);
            const result = await dgCliManager.launch({ assets: assetName });
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Asset ${assetName} launched successfully!`);
            } else {
                vscode.window.showErrorMessage(`❌ Failed to launch asset: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch asset: ${error}`);
        }
    });

    // Launch specific job with DG CLI
    const dgLaunchJobCommand = vscode.commands.registerCommand('dagster.dgLaunchJob', async (jobName?: string) => {
        try {
            if (!jobName) {
                jobName = await vscode.window.showInputBox({
                    prompt: 'Enter job name to launch',
                    placeHolder: 'my_job'
                });
            }

            if (!jobName) return;

            vscode.window.showInformationMessage(`🚀 Launching job: ${jobName}`);
            const result = await dgCliManager.launch({ job: jobName });
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Job ${jobName} launched successfully!`);
            } else {
                vscode.window.showErrorMessage(`❌ Failed to launch job: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch job: ${error}`);
        }
    });

    // Launch partition with DG CLI
    const dgLaunchPartitionCommand = vscode.commands.registerCommand('dagster.dgLaunchPartition', async (partitionName?: string) => {
        try {
            if (!partitionName) {
                partitionName = await vscode.window.showInputBox({
                    prompt: 'Enter partition identifier',
                    placeHolder: '2024-01-01 or specific_partition_key'
                });
            }

            if (!partitionName) return;

            const launchType = await vscode.window.showQuickPick([
                { label: '🎯 Launch Assets with Partition', description: 'Materialize assets for this partition', value: 'assets' },
                { label: '🔧 Launch Job with Partition', description: 'Execute job for this partition', value: 'job' }
            ], {
                placeHolder: 'How would you like to launch this partition?'
            });

            if (!launchType) return;

            let launchOptions: any = { partition: partitionName };

            if (launchType.value === 'job') {
                const jobName = await vscode.window.showInputBox({
                    prompt: 'Enter job name for partition launch',
                    placeHolder: 'my_partitioned_job'
                });
                if (jobName) launchOptions.job = jobName;
            }

            vscode.window.showInformationMessage(`🚀 Launching partition: ${partitionName}`);
            const result = await dgCliManager.launch(launchOptions);
            
            if (result.success) {
                vscode.window.showInformationMessage(`✅ Partition ${partitionName} launched successfully!`);
            } else {
                vscode.window.showErrorMessage(`❌ Failed to launch partition: ${result.errors.join(', ')}`);
            }
            dgCliManager.showOutput();

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch partition: ${error}`);
        }
    });

    // Debug command to test GraphQL jobs query
    const debugJobsCommand = vscode.commands.registerCommand('dagster.debugJobs', async () => {
        try {
            vscode.window.showInformationMessage('🔍 Testing GraphQL jobs query...');
            console.log('🔍 Debug: Testing GraphQL jobs query...');
            
            // Check current configuration
            const config = vscode.workspace.getConfiguration('dagster');
            const graphqlUrl = config.get<string>('graphqlUrl', 'http://localhost:3000/graphql');
            console.log(`🔧 Current GraphQL URL: ${graphqlUrl}`);
            
            // Test connection first
            console.log('🔧 Testing connection...');
            await dagsterClient.testConnection();
            console.log('✅ Connection test passed');
            
            // Try to get jobs
            console.log('🔧 Fetching jobs...');
            const jobs = await dagsterClient.getJobs();
            console.log(`📋 Found ${jobs.length} jobs:`, jobs);
            
            vscode.window.showInformationMessage(`✅ Found ${jobs.length} jobs! Check Developer Console for details.`);
        } catch (error) {
            console.error('❌ Debug jobs error:', error);
            vscode.window.showErrorMessage(`❌ Debug jobs failed: ${error}`);
        }
    });

    context.subscriptions.push(
        showDependencyGraphCommand,
        showImportAnalysisCommand,
        showAssetCatalogCommand,
        askDagsterCommand,
        findAssetReferencesCommand,
        goToAssetDefinitionCommand,
        // Debug command
        debugJobsCommand,
        // Job commands
        executeJobCommand,
        findJobReferencesCommand,
        goToJobDefinitionCommand,
        showJobLineageCommand,
        // Schedule commands
        findScheduleReferencesCommand,
        goToScheduleDefinitionCommand,
        dgLaunchScheduleCommand,
        // Sensor commands
        findSensorReferencesCommand,
        goToSensorDefinitionCommand,
        dgLaunchSensorCommand,
        // Op commands
        findOpReferencesCommand,
        goToOpDefinitionCommand,
        dgLaunchOpCommand,
        // DG CLI Commands
        dgCheckDefsCommand,
        dgCheckTomlCommand,
        dgCheckYamlCommand,
        dgDevCommand,
        dgLaunchCommand,
        dgListDefsCommand,
        dgListComponentsCommand,
        dgListProjectsCommand,
        dgScaffoldAssetCommand,
        dgScaffoldJobCommand,
        dgScaffoldScheduleCommand,
        dgScaffoldDockerfileCommand,
        dgScaffoldGithubActionsCommand,
        // Project Setup Commands
        instantProjectSetupCommand,
        cloneSetupDeployCommand,
        // Contextual Launch Commands
        dgLaunchAssetCommand,
        dgLaunchJobCommand,
        dgLaunchPartitionCommand
    );
}

async function checkDagsterProject(detector: DagsterProjectDetector) {
    const isDagsterProject = await detector.isDagsterProject();
    
    // Set context for when clauses in package.json
    vscode.commands.executeCommand('setContext', 'dagster.isActivated', isDagsterProject);
    
    if (isDagsterProject) {
        vscode.window.showInformationMessage('Dagster project detected! 🎉', 'Start Server').then(selection => {
            if (selection === 'Start Server') {
                vscode.commands.executeCommand('dagster.quickStart');
            }
        });
        statusBar.show();
        
        // Try to connect to local Dagster instance
        try {
            await dagsterClient.testConnection();
            statusBar.updateStatus('connected');
            currentDagsterPort = 3000; // Default port connection successful
            vscode.window.showInformationMessage('🎉 Connected to existing Dagster server on port 3000!', 'Open UI').then(selection => {
                if (selection === 'Open UI') {
                    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:3000`));
                }
            });
        } catch (error) {
            statusBar.updateStatus('disconnected');
            console.log('Dagster instance not running locally on default port, trying to detect...');
            // Try to find the correct port automatically
            const detectedPort = await tryDifferentPorts();
            if (detectedPort) {
                vscode.window.showInformationMessage(`🔍 Detected existing Dagster server on port ${detectedPort}!`, 'Open UI').then(selection => {
                    if (selection === 'Open UI') {
                        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${detectedPort}`));
                    }
                });
            }
        }
    } else {
        statusBar.hide();
    }
}

async function extractAssetName(document: vscode.TextDocument): Promise<string | null> {
    const text = document.getText();
    
    // Simple regex to find @asset decorator and function name (supports @asset, @dg.asset, @dagster.asset)
    const assetRegex = /@(?:\w+\.)?asset[^\n]*\n(?:\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)|.*?\n\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*))/;
    const match = text.match(assetRegex);
    
    return match ? (match[1] || match[2]) : null;
}



async function startLocalWebserver() {
    try {
        console.log('startLocalWebserver called');
        
        // Show initial toast notification
        vscode.window.showInformationMessage('🚀 Starting Dagster server...', 'View Terminal').then(selection => {
            if (selection === 'View Terminal') {
                vscode.commands.executeCommand('workbench.action.terminal.focus');
            }
        });
        
        // Find the Dagster project directory
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workspacePath = workspaceFolder?.uri.fsPath || '';
        
        // Check if current directory has Dagster files, otherwise check example subdirectory
        const projectDetector = new DagsterProjectDetector();
        const fs = require('fs');
        const path = require('path');
        
        let projectPath = workspacePath;
        const hasDagsterInRoot = fs.existsSync(path.join(workspacePath, 'dagster_example.py')) || 
                                 fs.existsSync(path.join(workspacePath, 'pyproject.toml')) ||
                                 fs.existsSync(path.join(workspacePath, 'workspace.yaml'));
        
        if (!hasDagsterInRoot && fs.existsSync(path.join(workspacePath, 'example'))) {
            projectPath = path.join(workspacePath, 'example');
        }
        
        const terminal = vscode.window.createTerminal({
            name: 'Dagster Webserver',
            cwd: projectPath
        });
        
        terminal.sendText('dagster dev -f dagster_example.py');
        terminal.show();
        
        // Monitor the server startup and port detection
        let attempts = 0;
        const maxAttempts = 20; // Try for about 20 seconds
        
        const checkServerStartup = async () => {
            attempts++;
            
            try {
                // First try the default port
                const config = vscode.workspace.getConfiguration('dagster');
                await dagsterClient.testConnection();
                
                // If we get here, connection succeeded on default port
                currentDagsterPort = 3000; // Default port
                statusBar.updateStatus('connected');
                vscode.window.showInformationMessage(`✅ Dagster server is running on port ${currentDagsterPort}!`, 'Open UI').then(selection => {
                    if (selection === 'Open UI') {
                        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${currentDagsterPort}`));
                    }
                });
                return;
            } catch (error) {
                // Try to detect the actual port
                const detectedPort = await detectDagsterPort();
                
                if (detectedPort) {
                    // Update configuration with detected port
                    const config = vscode.workspace.getConfiguration('dagster');
                    await config.update('graphqlUrl', `http://localhost:${detectedPort}/graphql`, vscode.ConfigurationTarget.Workspace);
                    await config.update('webserverUrl', `http://localhost:${detectedPort}`, vscode.ConfigurationTarget.Workspace);
                    
                    // Test connection with detected port
                    dagsterClient.refreshClient();
                    try {
                        await dagsterClient.testConnection();
                        currentDagsterPort = detectedPort;
                        statusBar.updateStatus('connected');
                        vscode.window.showInformationMessage(`✅ Dagster server detected on port ${detectedPort}!`, 'Open UI').then(selection => {
                            if (selection === 'Open UI') {
                                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${detectedPort}`));
                            }
                        });
                        return;
                    } catch (connectionError) {
                        console.log(`Failed to connect on detected port ${detectedPort}:`, connectionError);
                    }
                }
                
                // If we haven't found the server yet and still have attempts left
                if (attempts < maxAttempts) {
                    setTimeout(checkServerStartup, 1000); // Try again in 1 second
                } else {
                    // Final attempt - try common ports
                    statusBar.updateStatus('disconnected');
                    const foundPort = await tryDifferentPorts();
                    if (!foundPort) {
                        vscode.window.showWarningMessage('⚠️ Dagster server started but port detection failed. Check terminal for details.', 'View Terminal').then(selection => {
                            if (selection === 'View Terminal') {
                                vscode.commands.executeCommand('workbench.action.terminal.focus');
                            }
                        });
                    }
                }
            }
        };
        
        // Start checking after a brief delay to let the server begin startup
        setTimeout(checkServerStartup, 3000);
        
    } catch (error) {
        console.error('Error in startLocalWebserver:', error);
        vscode.window.showErrorMessage(`❌ Error starting Dagster server: ${error}`);
        throw error;
    }
}

async function tryDifferentPorts() {
    const config = vscode.workspace.getConfiguration('dagster');
    
    // First try to detect the actual port from running process
    const detectedPort = await detectDagsterPort();
    if (detectedPort && await tryPort(detectedPort, config)) {
        currentDagsterPort = detectedPort;
        return detectedPort;
    }
    
    // Then try common ports
    const commonPorts = [3000, 3001, 3002, 3003];
    for (const port of commonPorts) {
        if (await tryPort(port, config)) {
            currentDagsterPort = port;
            return port;
        }
    }
    
    // Finally try scanning a range of high ports where Dagster might start
    console.log('Scanning high port range for Dagster...');
    for (let port = 59000; port <= 65000; port += 100) {
        if (await tryPort(port, config)) {
            currentDagsterPort = port;
            return port;
        }
    }
    
    vscode.window.showWarningMessage('⚠️ Could not connect to Dagster on any port. Please check if Dagster is running.', 'View Terminal').then(selection => {
        if (selection === 'View Terminal') {
            vscode.commands.executeCommand('workbench.action.terminal.focus');
        }
    });
    return null;
}

async function tryPort(port: number, config: vscode.WorkspaceConfiguration): Promise<boolean> {
    try {
        const testUrl = `http://localhost:${port}/graphql`;
        const webUrl = `http://localhost:${port}`;
        
        await config.update('graphqlUrl', testUrl, vscode.ConfigurationTarget.Workspace);
        await config.update('webserverUrl', webUrl, vscode.ConfigurationTarget.Workspace);
        dagsterClient.refreshClient();
        await dagsterClient.testConnection();
        
        statusBar.updateStatus('connected');
        vscode.window.showInformationMessage(`🎉 Connected to Dagster on port ${port}!`, 'Open UI').then(selection => {
            if (selection === 'Open UI') {
                vscode.env.openExternal(vscode.Uri.parse(webUrl));
            }
        });
        return true;
    } catch (error) {
        return false;
    }
}

async function detectDagsterPort(): Promise<number | null> {
    try {
        // Try to find Dagster process and extract port from command line
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const { stdout } = await execAsync('ps aux | grep "dagster" | grep -v grep');
        console.log('Process search output:', stdout);
        
        // Look for different patterns in the Dagster process output
        const patterns = [
            /http:\/\/127\.0\.0\.1:(\d+)/,
            /localhost:(\d+)/,
            /port (\d+)/i,
            /:(\d{4,5})/  // Any 4-5 digit port number
        ];
        
        for (const pattern of patterns) {
            const match = stdout.match(pattern);
            if (match) {
                const port = parseInt(match[1]);
                console.log(`Detected port ${port} from pattern:`, pattern);
                return port;
            }
        }
    } catch (error) {
        console.log('Could not detect Dagster port (this is okay):', error instanceof Error ? error.message : String(error));
    }
    
    return null;
}

async function refreshAssetData(panel: vscode.WebviewPanel) {
    try {
        // First, try to detect and connect to the correct port
        const detectedPort = await detectDagsterPort();
        if (detectedPort) {
            const config = vscode.workspace.getConfiguration('dagster');
            const testUrl = `http://localhost:${detectedPort}/graphql`;
            await config.update('graphqlUrl', testUrl, vscode.ConfigurationTarget.Workspace);
            dagsterClient.refreshClient();
        }

        // Try to connect and get asset data
        await dagsterClient.testConnection();
        const assets = await dagsterClient.getAssets();
        
        console.log('Assets fetched:', assets);
        
        if (assets && assets.length > 0) {
            const message = {
                type: 'assetDataRefreshed',
                assets: assets,
                message: `✅ Found ${assets.length} assets!`
            };
            console.log('Sending message to webview:', message);
            
            // Send the message
            panel.webview.postMessage(message);
            
            // Also send a simple test message to verify communication
            setTimeout(() => {
                panel.webview.postMessage({
                    type: 'test',
                    message: 'Test communication from extension'
                });
            }, 100);
            vscode.window.showInformationMessage(`✅ Refreshed! Found ${assets.length} assets.`);
        } else {
            const message = {
                type: 'assetDataRefreshed',
                assets: [],
                message: '⚠️ Connected but no assets found. Check your Dagster definitions.'
            };
            console.log('Sending empty assets message to webview:', message);
            panel.webview.postMessage(message);
            vscode.window.showWarningMessage('Connected to Dagster but no assets found.');
        }
        
        statusBar.updateStatus('connected');
    } catch (error) {
        panel.webview.postMessage({
            type: 'refreshError',
            message: `❌ Could not connect to Dagster: ${error}`
        });
        vscode.window.showErrorMessage(`Failed to refresh: ${error}`);
        statusBar.updateStatus('disconnected');
        
        // Try to find the correct port
        await tryDifferentPorts();
    }
}

async function showRunHistory() {
    try {
        const runs = await dagsterClient.getRecentRuns();
        
        if (runs.length === 0) {
            vscode.window.showInformationMessage('No recent runs found');
            return;
        }

        const runItems = runs.map(run => ({
            label: `${run.pipelineName} - ${run.status}`,
            description: run.startTime,
            detail: `Run ID: ${run.runId}`
        }));

        const selected = await vscode.window.showQuickPick(runItems, {
            placeHolder: 'Select a run to view details'
        });

        if (selected) {
            // TODO: Show run details in a webview
            vscode.window.showInformationMessage(`Selected run: ${selected.detail}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to fetch run history: ${error}`);
    }
}

async function getAssetLineage(panel: vscode.WebviewPanel, assetKey: string) {
    try {
        console.log(`Fetching lineage for asset: ${assetKey}`);
        const lineageData = await dagsterClient.getAssetLineage(assetKey);
        
        panel.webview.postMessage({
            type: 'assetLineageData',
            assetKey: assetKey,
            lineageData: lineageData
        });
        
        console.log(`Lineage data sent for asset: ${assetKey}`);
    } catch (error) {
        console.error('Failed to fetch asset lineage:', error);
        panel.webview.postMessage({
            type: 'error',
            message: `Failed to fetch lineage for ${assetKey}: ${error}`
        });
    }
}

async function materializeAsset(assetKey: string) {
    try {
        console.log(`Materializing asset: ${assetKey}`);

        const result = await dagsterClient.materializeAsset(assetKey);
        console.log(`🎯 Materialization result for ${assetKey}:`, result);
        
        if (result.success && result.runId) {
            console.log(`✅ Successfully started run ${result.runId} for ${assetKey}`);
            // Show initial success toast
            vscode.window.showInformationMessage(
                `🚀 Started materializing ${assetKey}`, 
                'View Run Details'
            ).then(selection => {
                if (selection === 'View Run Details') {
                    showRunDetails(result.runId!, assetKey);
                }
            });

            // Start polling for completion
            pollRunStatus(result.runId!, assetKey);
        } else {
            vscode.window.showErrorMessage(`❌ Failed to materialize ${assetKey}: ${result.error}`);
        }
    } catch (error) {
        console.error('Failed to materialize asset:', error);
        vscode.window.showErrorMessage(`❌ Failed to materialize ${assetKey}: ${error}`);
    }
}

async function pollRunStatus(runId: string, assetKey: string) {
    const maxPolls = 120; // Poll for up to 2 minutes (should be plenty for local)
    let pollCount = 0;

    const poll = async () => {
        try {
            console.log(`🔄 Polling run status for ${runId}, poll count: ${pollCount}`);
            const status = await dagsterClient.getRunStatus(runId);
            console.log(`📊 Run status for ${runId}:`, status);
            
            if (status.status === 'SUCCESS') {
                vscode.window.showInformationMessage(
                    `✅ ${assetKey} materialized successfully!`, 
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        showRunDetails(runId, assetKey);
                    }
                });
                return; // Stop polling
            } else if (status.status === 'FAILURE') {
                vscode.window.showErrorMessage(
                    `❌ ${assetKey} materialization failed`, 
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        showRunDetails(runId, assetKey);
                    }
                });
                return; // Stop polling
            } else if (status.status === 'CANCELED' || status.status === 'CANCELING') {
                vscode.window.showWarningMessage(`⚠️ ${assetKey} materialization was canceled`);
                return; // Stop polling
            }

            // Continue polling if still running
            pollCount++;
            if (pollCount < maxPolls && (status.status === 'QUEUED' || status.status === 'STARTED')) {
                // Adaptive polling: faster initially, then slower
                const delay = pollCount < 10 ? 500 : pollCount < 30 ? 1000 : 2000;
                setTimeout(poll, delay);
            } else if (pollCount >= maxPolls) {
                // Timeout - show a warning but don't error out
                vscode.window.showWarningMessage(
                    `⏱️ ${assetKey} is still running (taking longer than expected)`,
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        showRunDetails(runId, assetKey);
                    }
                });
            }
        } catch (error) {
            console.error(`❌ Failed to poll run status for ${runId}:`, error);
            vscode.window.showErrorMessage(`❌ Error polling run status for ${assetKey}: ${error}`);
            // Stop polling on error
        }
    };

    // Start polling immediately (no delay)
    poll();
}

function showRunDetails(runId: string, assetKey: string) {
    // Create a webview to show run details
    const panel = vscode.window.createWebviewPanel(
        'dagsterRunDetails',
        `🏃 Run Details: ${assetKey}`,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            localResourceRoots: []
        }
    );

    panel.webview.html = getRunDetailsWebviewContent(runId, assetKey);
    
    // Load initial status and then start refreshing
    const loadInitialStatus = async () => {
        try {
            const status = await dagsterClient.getRunStatus(runId);
            panel.webview.postMessage({
                type: 'statusUpdate',
                status: status
            });
            
            // Start periodic refresh only if run is still in progress
            if (status.status !== 'SUCCESS' && status.status !== 'FAILURE' && status.status !== 'CANCELED') {
                startPeriodicRefresh();
            }
        } catch (error) {
            console.error('Failed to load initial run status:', error);
            // Still start periodic refresh in case of temporary error
            startPeriodicRefresh();
        }
    };
    
    const startPeriodicRefresh = () => {
        const refreshInterval = setInterval(async () => {
            try {
                const status = await dagsterClient.getRunStatus(runId);
                panel.webview.postMessage({
                    type: 'statusUpdate',
                    status: status
                });

                // Stop refreshing if run is complete
                if (status.status === 'SUCCESS' || status.status === 'FAILURE' || status.status === 'CANCELED') {
                    clearInterval(refreshInterval);
                }
            } catch (error) {
                console.error('Failed to refresh run status:', error);
                clearInterval(refreshInterval);
            }
        }, 2000);

        // Clear interval when panel is disposed
        panel.onDidDispose(() => {
            clearInterval(refreshInterval);
        });
    };
    
    // Wait a bit for webview to initialize, then load initial status
    setTimeout(loadInitialStatus, 500);
}

async function openAssetDefinition(assetKey: string) {
    try {
        // console.log(`🔍 Opening definition for asset: "${assetKey}"`);
        
        // Search for the asset definition in the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }
        
        // First, try to find DBT models (SQL files) - prioritize models/ directory
        const sqlFiles = await vscode.workspace.findFiles('**/*.sql', '**/node_modules/**');
        if (sqlFiles.length > 0) {
            // Sort to prioritize files in models/ directories
            const sortedSqlFiles = sqlFiles.sort((a, b) => {
                const aInModels = a.fsPath.includes('/models/') || a.fsPath.includes('\\models\\');
                const bInModels = b.fsPath.includes('/models/') || b.fsPath.includes('\\models\\');
                if (aInModels && !bInModels) {
                    return -1;
                }
                if (!aInModels && bInModels) {
                    return 1;
                }
                return 0;
            });
            
            const dbtResult = await searchDBTModel(assetKey, sortedSqlFiles);
            if (dbtResult) {
                return; // Found and opened DBT model
            }
        }
        
        // Fallback to Python files for traditional Dagster assets
        const files = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        // console.log(`📁 Found ${files.length} Python files to search`);
        
        for (const file of files) {
            // console.log(`📄 Searching in file: ${file.fsPath}`);
            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            
            // Look for asset definition patterns - much simpler approach
            const lines = text.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                // Look for function definition line with exact asset name
                const defMatch = line.match(new RegExp(`def\\s+(${assetKey})\\s*\\(`));
                if (defMatch) {
                    // console.log(`Found asset ${assetKey} at line ${i + 1}: ${line.trim()}`);
                    
                    // Open the file and navigate to the exact function name
                    const editor = await vscode.window.showTextDocument(document, {
                        viewColumn: vscode.ViewColumn.One
                    });
                    
                    const functionNameStartCol = line.indexOf(assetKey);
                    const functionNameStart = new vscode.Position(i, functionNameStartCol);
                    const functionNameEnd = new vscode.Position(i, functionNameStartCol + assetKey.length);
                    
                    // Select the function name and center it
                    editor.selection = new vscode.Selection(functionNameStart, functionNameEnd);
                    editor.revealRange(new vscode.Range(functionNameStart, functionNameEnd), vscode.TextEditorRevealType.InCenter);
                    
                    // console.log(`Navigated to ${assetKey} at line ${i + 1}, column ${functionNameStartCol}`);
                    return;
                }
            }
        }
        
        vscode.window.showWarningMessage(`Could not find definition for asset: ${assetKey}`);
    } catch (error) {
        console.error('Failed to open asset definition:', error);
        vscode.window.showErrorMessage(`Failed to open definition for ${assetKey}: ${error}`);
    }
}

async function searchDBTModel(assetKey: string, sqlFiles: vscode.Uri[]): Promise<boolean> {
    // DBT asset names can have different formats:
    // 1. Direct match: assetKey = "my_model" -> look for "my_model.sql"
    // 2. Prefixed: assetKey = "dbt_project_my_model" -> look for "my_model.sql"
    // 3. Schema prefixed: assetKey = "analytics_my_model" -> look for "my_model.sql"
    
    const possibleModelNames = [
        assetKey,                                    // Direct match
        assetKey.replace(/^dbt_[^_]+_/, ''),        // Remove "dbt_project_" prefix
        assetKey.replace(/^[^_]+_/, ''),            // Remove first schema prefix
        assetKey.split('_').slice(-1)[0],           // Just the last part
        assetKey.split('_').slice(-2).join('_')     // Last two parts
    ];
    
    for (const modelName of possibleModelNames) {
        for (const file of sqlFiles) {
            const fileName = file.fsPath.split('/').pop()?.replace('.sql', '');
            
            if (fileName === modelName || 
                file.fsPath.includes(`/${modelName}.sql`) ||
                file.fsPath.includes(`\\${modelName}.sql`)) {
                
                // Found matching DBT model file
                const document = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(document, {
                    viewColumn: vscode.ViewColumn.One
                });
                
                // Look for the first SELECT statement or model config
                const text = document.getText();
                const lines = text.split('\n');
                let targetLine = 0;
                
                // Look for common DBT patterns to position cursor
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].toLowerCase().trim();
                    if (line.startsWith('select') || 
                        line.startsWith('with') ||
                        line.includes('config(') ||
                        line.includes('{{')) {
                        targetLine = i;
                        break;
                    }
                }
                
                // Position cursor at the meaningful content
                const position = new vscode.Position(targetLine, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                
                // console.log(`Found DBT model: ${fileName} for asset: ${assetKey}`);
                return true;
            }
        }
    }
    
    return false; // No DBT model found
}

function getLineageWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'lineage.css'));
    const nonce = getNonce(); // Generate secure nonce
    const cacheBreaker = Date.now(); // Force webview refresh

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
                            🔄 Refresh
                        </button>
                    </div>
                </div>
                

                
                <div id="loadingContainer" class="loading-container" style="display: none;">
                    <div class="loading-spinner"></div>
                    <p>Loading assets...</p>
                </div>
                
                <div id="errorContainer" class="error-container" style="display: none;">
                    <div class="error-message">
                        <span class="codicon codicon-error"></span>
                        <span id="errorText"></span>
                    </div>
                </div>
                
                <div id="lineageContainer" class="lineage-container">
                    <div class="lineage-controls">
                        <select id="assetSelect">
                            <option value="">Select an asset...</option>
                        </select>
                    </div>
                    <div id="lineageGraph" class="lineage-graph">
                        <div class="no-data">
                            <span class="codicon codicon-graph"></span>
                            <p>Click Refresh to load asset data</p>
                            <button id="startDagsterBtn" class="btn btn-primary">
                                🚀 Start Dagster Dev Server
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                let currentData = null;
                let focusAsset = null;
                
                // Try to restore previous state
                const previousState = vscode.getState();
                if (previousState) {
                    currentData = previousState.currentData;
                    focusAsset = previousState.focusAsset;
                    debugLog('🔄 Restored previous state: ' + (currentData ? currentData.assets.length + ' assets' : 'no data'));
                    
                    if (currentData && currentData.assets && currentData.assets.length > 0) {
                        populateAssetSelector(currentData.assets);
                        renderAssetLineage();
                        
                        // Show the lineage container
                        document.getElementById('loadingContainer').style.display = 'none';
                        document.getElementById('errorContainer').style.display = 'none';
                        document.getElementById('lineageContainer').style.display = 'flex';
                    }
                }
                
                // Simple console logging (can be removed for production)
                function debugLog(msg) {
                    console.log(msg); // Enabled for debugging lineage issues
                }
                
                // Basic JavaScript test
                console.log('🚀 JAVASCRIPT IS WORKING - Version 0.1.10');
                alert('JavaScript is loading! Check console for more debug info.');
                
                // Debug logging enabled
                console.log('Lineage webview loaded successfully');
                debugLog('🎯 Lineage webview loaded');
                
                // Message handler
                window.addEventListener('message', event => {
                    const message = event.data;
                    debugLog('📩 Message received: ' + message.type);
                    
                    switch (message.type) {
                        case 'assetDataRefreshed':
                            debugLog('✅ Assets refreshed: ' + (message.assets ? message.assets.length : 0) + ' assets');
                            handleAssetDataRefreshed(message);
                            break;
                        case 'assetLineageData':
                            debugLog('🔗 Lineage data received for: ' + message.assetKey);
                            handleAssetLineageData(message);
                            break;
                        case 'refreshError':
                            debugLog('❌ Refresh error: ' + message.message);
                            handleRefreshError(message);
                            break;
                        case 'loading':
                            showLoading(message.isLoading);
                            break;
                        case 'error':
                            showError(message.message);
                            break;
                        default:
                            debugLog('❓ Unknown message: ' + message.type);
                    }
                });
                
                function handleAssetDataRefreshed(message) {
                    // IMPORTANT: Reset focus asset to ensure clean state
                    focusAsset = null;
                    currentData = {
                        assets: message.assets || [],
                        lineage: null,
                        focusAsset: null
                    };
                    
                    populateAssetSelector(currentData.assets);
                    
                    // Reset the asset selector to default
                    const assetSelect = document.getElementById('assetSelect');
                    assetSelect.value = '';
                    
                    renderAssetLineage(); // Show full graph by default
                    
                    document.getElementById('loadingContainer').style.display = 'none';
                    document.getElementById('errorContainer').style.display = 'none';
                    document.getElementById('lineageContainer').style.display = 'flex';
                    
                    // Save state for persistence
                    vscode.setState({
                        currentData: currentData,
                        focusAsset: focusAsset
                    });
                    
                    debugLog('🔄 State reset and saved: focusAsset=' + focusAsset + ', selector=' + assetSelect.value);
                }
                
                function handleRefreshError(message) {
                    debugLog('🚨 Handling refresh error: ' + message.message);
                    
                    // Clear existing asset data
                    currentData = {
                        assets: [],
                        lineage: null,
                        focusAsset: null
                    };
                    
                    // Reset the asset selector
                    const assetSelect = document.getElementById('assetSelect');
                    assetSelect.innerHTML = '<option value="">Select an asset...</option>';
                    
                    // Show the initial empty state with start button
                    const lineageGraph = document.getElementById('lineageGraph');
                    lineageGraph.innerHTML = \`
                        <div class="no-data">
                            <span class="codicon codicon-graph"></span>
                            <p>Could not connect to Dagster. Click Start to launch or Refresh to retry.</p>
                            <button id="startDagsterBtn" class="btn btn-primary">
                                🚀 Start Dagster Dev Server
                            </button>
                        </div>
                    \`;
                    
                    // Re-attach the start button event listener
                    document.getElementById('startDagsterBtn').addEventListener('click', () => {
                        debugLog('🚀 Start Dagster button clicked');
                        vscode.postMessage({ type: 'startDagster' });
                    });
                    
                    // Hide other containers and show lineage container
                    document.getElementById('loadingContainer').style.display = 'none';
                    document.getElementById('errorContainer').style.display = 'none';
                    document.getElementById('lineageContainer').style.display = 'flex';
                    
                    // Clear state
                    vscode.setState({
                        currentData: currentData,
                        focusAsset: null
                    });
                    
                    debugLog('🔄 Reset to empty state due to refresh error');
                }
                
                function populateAssetSelector(assets) {
                    const select = document.getElementById('assetSelect');
                    select.innerHTML = '<option value="">🌐 Full Asset Graph (Select asset for focused lineage)</option>';
                    
                    assets.forEach(asset => {
                        const option = document.createElement('option');
                        option.value = asset.key;
                        option.textContent = asset.key;
                        select.appendChild(option);
                    });
                    
                    debugLog('📋 Asset selector populated with ' + assets.length + ' assets');
                }
                
                function handleAssetLineageData(message) {
                    debugLog('🔗 Received lineage data for: ' + message.assetKey + ', focusAsset: ' + focusAsset);
                    
                    if (message.lineageData && message.assetKey === focusAsset) {
                        // Only update and render if this lineage is for the currently focused asset
                        currentData.lineage = message.lineageData;
                        
                        // Force render the focused lineage view
                        const upstreamAssets = message.lineageData.dependencies || [];
                        const downstreamAssets = message.lineageData.dependedBy || [];
                        const focusAssetData = currentData.assets.find(a => a.key === focusAsset);
                        
                        if (focusAssetData) {
                            debugLog('🎯 Rendering focused lineage for: ' + focusAsset);
                            const useHorizontalLayout = upstreamAssets.length + downstreamAssets.length <= 4;
                            renderFocusedLineageGraph(upstreamAssets, focusAssetData, downstreamAssets, useHorizontalLayout);
                        } else {
                            debugLog('❌ Could not find asset data for: ' + focusAsset);
                            renderAssetGrid();
                        }
                        
                        // Save state for persistence
                        vscode.setState({
                            currentData: currentData,
                            focusAsset: focusAsset
                        });
                    } else if (!message.lineageData) {
                        debugLog('❌ No lineage data available for: ' + message.assetKey);
                        renderAssetGrid();
                    } else {
                        debugLog('🔄 Ignoring lineage data for: ' + message.assetKey + ' (not current focus)');
                    }
                }
                
                function renderAssetGrid() {
                    const lineageGraph = document.getElementById('lineageGraph');
                    const assets = currentData ? currentData.assets : [];
                    
                    if (!assets || assets.length === 0) {
                        lineageGraph.innerHTML = '<div class="no-data"><p>No assets found</p></div>';
                        return;
                    }
                    
                    const assetCards = assets.map(asset => createAssetCard(asset, false)).join('');
                    lineageGraph.innerHTML = '<div style="display: flex; flex-wrap: wrap;">' + assetCards + '</div>';
                    attachAssetEventListeners();
                    debugLog('🎨 Rendered ' + assets.length + ' asset cards');
                }
                
                function renderAssetLineage() {
                    const lineageGraph = document.getElementById('lineageGraph');
                    
                    debugLog('🎨 renderAssetLineage called - focusAsset: "' + focusAsset + '" (type: ' + typeof focusAsset + ')');
                    
                    // If no specific asset is selected, show full asset graph
                    if (!focusAsset) {
                        debugLog('🌐 Rendering full asset graph (no focus asset)');
                        renderFullAssetGraph();
                        return;
                    }
                    
                    if (!currentData.lineage) {
                        debugLog('🔄 No lineage data for focused asset, fetching...');
                        vscode.postMessage({ type: 'getAssetLineage', assetKey: focusAsset });
                        renderAssetGrid(); // Show loading while fetching
                        return;
                    }
                    
                    const upstreamAssets = currentData.lineage.dependencies || [];
                    const downstreamAssets = currentData.lineage.dependedBy || [];
                    const focusAssetData = currentData.assets.find(a => a.key === focusAsset);
                    
                    // Determine layout based on container width and number of assets
                    const containerWidth = lineageGraph.clientWidth || 800;
                    const totalAssets = upstreamAssets.length + 1 + downstreamAssets.length;
                    const useHorizontalLayout = containerWidth > 600 && totalAssets <= 6;
                    
                    renderFocusedLineageGraph(upstreamAssets, focusAssetData, downstreamAssets, useHorizontalLayout);
                    
                    debugLog('🔗 Rendered ' + (useHorizontalLayout ? 'horizontal' : 'vertical') + ' lineage for: ' + focusAsset);
                }
                
                function renderFullAssetGraph() {
                    const lineageGraph = document.getElementById('lineageGraph');
                    if (!currentData.assets || currentData.assets.length === 0) {
                        lineageGraph.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">No assets available. Click "🔄 Refresh" to load assets.</div>';
                        return;
                    }
                    
                    debugLog('🌐 Rendering full asset graph - fetching real lineage for ' + currentData.assets.length + ' assets');
                    
                    // Show loading state while fetching real lineage
                    let html = '<div class="full-lineage-container" style="position: relative; width: 100%; min-height: 500px; background: #1e1e1e; border-radius: 8px; padding: 20px; overflow: auto;">';
                    html += '<div style="text-align: center; margin-bottom: 20px; color: #569cd6;"><h3 style="margin: 0;">🌐 Complete Asset Lineage Graph</h3></div>';
                    html += '<div id="fullGraphLoading" style="text-align: center; color: #ffa500; margin: 50px 0;">🔄 Loading real lineage data...</div>';
                    html += '<div id="fullGraphContent" style="display: none;"></div>';
                    html += '</div>';
                    lineageGraph.innerHTML = html;
                    
                    // Fetch real lineage data for all assets
                    fetchCompleteLineageGraph();
                }
                
                async function fetchCompleteLineageGraph() {
                    debugLog('🔄 Fetching complete lineage graph from GraphQL...');
                    
                    try {
                        // Fetch lineage for ALL assets to build complete graph
                        const allLineagePromises = currentData.assets.map(async (asset) => {
                            const message = { type: 'getAssetLineage', assetKey: asset.key };
                            return new Promise((resolve) => {
                                const tempHandler = (event) => {
                                    if (event.data.type === 'assetLineageData' && event.data.assetKey === asset.key) {
                                        window.removeEventListener('message', tempHandler);
                                        resolve({
                                            assetKey: asset.key,
                                            asset: asset,
                                            lineage: event.data.lineageData
                                        });
                                    }
                                };
                                window.addEventListener('message', tempHandler);
                                vscode.postMessage(message);
                            });
                        });
                        
                        // Wait for all lineage data
                        const allLineageData = await Promise.all(allLineagePromises);
                        debugLog('✅ Received lineage data for ' + allLineageData.length + ' assets');
                        
                        // Build the complete graph with real data
                        renderCompleteLineageGraph(allLineageData);
                        
                    } catch (error) {
                        debugLog('❌ Error fetching complete lineage: ' + error);
                        document.getElementById('fullGraphLoading').innerHTML = '❌ Failed to load lineage data';
                    }
                }
                
                function renderCompleteLineageGraph(allLineageData) {
                    debugLog('🎨 Rendering complete graph with real lineage data');
                    
                    // Build connections map from real data
                    const connections = {};
                    const assetMap = {};
                    
                    // Initialize
                    allLineageData.forEach(({ assetKey, asset }) => {
                        assetMap[assetKey] = asset;
                        connections[assetKey] = { upstream: [], downstream: [] };
                    });
                    
                    // Build real connections
                    allLineageData.forEach(({ assetKey, lineage }) => {
                        if (lineage) {
                            if (lineage.dependencies) {
                                lineage.dependencies.forEach(dep => {
                                    connections[assetKey].upstream.push(dep.key);
                                    if (connections[dep.key]) {
                                        connections[dep.key].downstream.push(assetKey);
                                    }
                                });
                            }
                        }
                    });
                    
                    debugLog('📊 Built connections map with ' + Object.keys(connections).length + ' assets');
                    
                    // Calculate levels using topological sort
                    const levels = calculateAssetLevels(connections);
                    
                    // Render the graph
                    const fullGraphContent = document.getElementById('fullGraphContent');
                    let html = '<svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;" id="fullLineageSvg">';
                    html += '<defs><marker id="arrowhead-full" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">';
                    html += '<polygon points="0 0, 8 3, 0 6" fill="#569cd6" /></marker></defs></svg>';
                    
                    // Create container for better positioning
                    html += '<div style="position: relative; z-index: 2; min-height: 600px; padding: 40px;">';
                    
                    // Render assets by level with better spacing
                    const levelKeys = Object.keys(levels).sort((a, b) => parseInt(a) - parseInt(b));
                    levelKeys.forEach((level, levelIndex) => {
                        const assetsAtLevel = levels[level];
                        const y = 100 + levelIndex * 200; // More vertical space between levels
                        
                        // Level header
                        html += '<div style="position: absolute; top: ' + (y - 30) + 'px; left: 20px; color: #569cd6; font-weight: bold; font-size: 14px;">';
                        html += '📊 Level ' + level + ' (' + assetsAtLevel.length + ' assets)</div>';
                        
                        // Center the assets horizontally with better spacing
                        const containerWidth = 1600; // Wider container
                        const assetWidth = 200; // Slightly wider cards
                        const gap = 50; // Much bigger gap between cards
                        const totalWidth = assetsAtLevel.length * assetWidth + (assetsAtLevel.length - 1) * gap;
                        const startX = Math.max(60, (containerWidth - totalWidth) / 2);
                        
                        assetsAtLevel.forEach((assetKey, assetIndex) => {
                            const asset = assetMap[assetKey];
                            if (asset) {
                                const x = startX + assetIndex * (assetWidth + gap);
                                
                                html += createFullLineageAssetCard(asset, x, y, assetWidth, level);
                            }
                        });
                    });
                    
                    html += '</div>';
                    
                    fullGraphContent.innerHTML = html;
                    
                    // Hide loading, show content
                    document.getElementById('fullGraphLoading').style.display = 'none';
                    fullGraphContent.style.display = 'block';
                    
                    // Add click handlers for asset nodes and buttons
                    setTimeout(() => {
                        // Asset card click handlers (for focusing)
                        const assetNodes = document.querySelectorAll('.asset-node-full');
                        assetNodes.forEach(node => {
                            node.addEventListener('click', (e) => {
                                // Don't trigger on button clicks
                                if (!e.target.classList.contains('asset-action-btn')) {
                                    const assetKey = node.getAttribute('data-asset');
                                    if (assetKey) {
                                        debugLog('🎯 Clicked asset in full graph: ' + assetKey);
                                        focusAsset = assetKey;
                                        vscode.postMessage({ type: 'getAssetLineage', assetKey: assetKey });
                                        // Update selector to reflect selection
                                        const selector = document.getElementById('assetSelect');
                                        if (selector) {
                                            selector.value = assetKey;
                                        }
                                    }
                                }
                            });
                        });
                        
                        // Button click handlers
                        const actionButtons = document.querySelectorAll('.asset-action-btn');
                        actionButtons.forEach(button => {
                            button.addEventListener('click', (e) => {
                                e.stopPropagation(); // Prevent asset card click
                                const action = button.getAttribute('data-action');
                                const assetKey = button.getAttribute('data-asset');
                                
                                if (action === 'code') {
                                    debugLog('📝 Opening code for: ' + assetKey);
                                    vscode.postMessage({ type: 'openAssetDefinition', assetKey: assetKey });
                                } else if (action === 'materialize') {
                                    debugLog('▶️ Materializing: ' + assetKey);
                                    vscode.postMessage({ type: 'materializeAsset', assetKey: assetKey });
                                }
                            });
                        });
                        
                        // Draw connections after DOM is ready
                        drawAllConnections(connections);
                    }, 200);
                    
                    debugLog('✅ Complete lineage graph rendered with real data');
                }
                
                function createFullLineageAssetCard(asset, x, y, width, level) {
                    const isDBT = asset.key.startsWith('dbt_');
                    const assetKind = asset.computeKind || (isDBT ? 'dbt' : 'dagster');
                    
                    // Choose colors and icons based on actual compute kind
                    let kindColor = '#4caf50'; // default green
                    let kindIcon = '⚡';
                    
                    if (assetKind === 'dbt') {
                        kindColor = '#ff9800'; // orange
                        kindIcon = '🔧';
                    } else if (assetKind === 'python') {
                        kindColor = '#3776ab'; // python blue
                        kindIcon = '🐍';
                    } else if (assetKind === 'pandas') {
                        kindColor = '#150458'; // pandas purple
                        kindIcon = '🐼';
                    } else if (assetKind === 'sql') {
                        kindColor = '#336791'; // sql blue
                        kindIcon = '🗃️';
                    }
                    
                    let html = '<div class="asset-node-full" data-asset="' + asset.key + '" data-level="' + level + '" ';
                    html += 'style="position: absolute; top: ' + y + 'px; left: ' + x + 'px; ';
                    html += 'width: ' + width + 'px; padding: 16px; ';
                    html += 'background: linear-gradient(145deg, #2d2d30, #3e3e42); ';
                    html += 'border: 2px solid #569cd6; border-radius: 12px; ';
                    html += 'cursor: pointer; text-align: center; color: white; ';
                    html += 'box-shadow: 0 4px 12px rgba(0,0,0,0.4); ';
                    html += 'transition: all 0.3s ease; font-size: 12px;">';
                    
                    // Asset title
                    html += '<div style="font-weight: bold; margin-bottom: 8px; color: #569cd6; font-size: 13px;">';
                    html += asset.key + '</div>';
                    
                    // Asset kind/type with proper color and icon
                    html += '<div style="font-size: 10px; color: ' + kindColor + '; margin-bottom: 8px;">';
                    html += kindIcon + ' ' + assetKind.toUpperCase();
                    html += '</div>';
                    
                    // Description if available
                    if (asset.description) {
                        const shortDesc = asset.description.length > 40 ? 
                            asset.description.substring(0, 40) + '...' : asset.description;
                        html += '<div style="font-size: 9px; color: #ccc; margin-bottom: 8px; font-style: italic;">';
                        html += shortDesc + '</div>';
                    }
                    
                    // Action buttons
                    html += '<div style="display: flex; gap: 4px; justify-content: center; margin-top: 8px;">';
                    
                    // Code button
                    html += '<button class="asset-action-btn" data-action="code" data-asset="' + asset.key + '" ';
                    html += 'style="background: #007acc; border: none; border-radius: 4px; color: white; ';
                    html += 'padding: 4px 8px; font-size: 9px; cursor: pointer; transition: background 0.2s;">';
                    html += '📝 Code</button>';
                    
                    // Materialize button
                    html += '<button class="asset-action-btn" data-action="materialize" data-asset="' + asset.key + '" ';
                    html += 'style="background: #28a745; border: none; border-radius: 4px; color: white; ';
                    html += 'padding: 4px 8px; font-size: 9px; cursor: pointer; transition: background 0.2s;">';
                    html += '▶️ Run</button>';
                    
                    html += '</div>';
                    
                    // Level indicator
                    html += '<div style="font-size: 8px; color: #888; margin-top: 6px;">Level ' + level + '</div>';
                    
                    html += '</div>';
                    return html;
                }
                
                function calculateAssetLevels(connections) {
                    const levels = {};
                    const visited = new Set();
                    const processing = new Set();
                    
                    function visit(assetKey, level = 0) {
                        if (processing.has(assetKey)) return level; // Cycle detection
                        if (visited.has(assetKey)) return levels[assetKey] || level;
                        
                        processing.add(assetKey);
                        
                        let maxUpstreamLevel = level;
                        if (connections[assetKey] && connections[assetKey].upstream) {
                            connections[assetKey].upstream.forEach(upstreamKey => {
                                const upstreamLevel = visit(upstreamKey, level);
                                maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel + 1);
                            });
                        }
                        
                        processing.delete(assetKey);
                        visited.add(assetKey);
                        
                        const assetLevel = maxUpstreamLevel;
                        levels[assetLevel] = levels[assetLevel] || [];
                        if (!levels[assetLevel].includes(assetKey)) {
                            levels[assetLevel].push(assetKey);
                        }
                        
                        return assetLevel;
                    }
                    
                    // Visit all assets
                    Object.keys(connections).forEach(assetKey => {
                        if (!visited.has(assetKey)) {
                            visit(assetKey);
                        }
                    });
                    
                    return levels;
                }
                
                function drawAllConnections(connections) {
                    const svg = document.getElementById('fullLineageSvg');
                    if (!svg) {
                        debugLog('❌ SVG element not found for drawing connections');
                        return;
                    }
                    
                    debugLog('🔍 Drawing connections with data: ' + JSON.stringify(Object.keys(connections)));
                    
                    // Start with the marker definitions - bigger, more visible arrows
                    let pathsHtml = '<defs><marker id="arrowhead-full" markerWidth="12" markerHeight="10" refX="12" refY="5" orient="auto" markerUnits="userSpaceOnUse">';
                    pathsHtml += '<polygon points="0 0, 12 5, 0 10" fill="#569cd6" stroke="#569cd6" stroke-width="1" /></marker></defs>';
                    
                    let connectionCount = 0;
                    
                    Object.keys(connections).forEach(assetKey => {
                        const assetConnections = connections[assetKey];
                        if (assetConnections.downstream && assetConnections.downstream.length > 0) {
                            debugLog('🔗 Asset ' + assetKey + ' has downstream: ' + assetConnections.downstream.join(', '));
                            const fromElement = document.querySelector('[data-asset="' + assetKey + '"]');
                            if (fromElement) {
                                assetConnections.downstream.forEach(downstreamKey => {
                                    const toElement = document.querySelector('[data-asset="' + downstreamKey + '"]');
                                    if (toElement) {
                                        debugLog('✅ Drawing connection: ' + assetKey + ' -> ' + downstreamKey);
                                        const fromRect = fromElement.getBoundingClientRect();
                                        const toRect = toElement.getBoundingClientRect();
                                        const containerRect = svg.getBoundingClientRect();
                                        
                                        // Calculate connection points
                                        const fromX = fromRect.left + fromRect.width / 2 - containerRect.left;
                                        const fromY = fromRect.bottom - containerRect.top - 5; // Slightly above bottom
                                        const toX = toRect.left + toRect.width / 2 - containerRect.left;
                                        const toY = toRect.top - containerRect.top + 5; // Slightly below top
                                        
                                        // Create curved path for better visual flow
                                        const midY = fromY + (toY - fromY) / 2;
                                        const controlY1 = fromY + 30;
                                        const controlY2 = toY - 30;
                                        
                                        pathsHtml += '<path d="M ' + fromX + ' ' + fromY + ' ';
                                        pathsHtml += 'C ' + fromX + ' ' + controlY1 + ' ' + toX + ' ' + controlY2 + ' ' + toX + ' ' + toY + '" ';
                                        pathsHtml += 'stroke="#569cd6" stroke-width="4" fill="none" ';
                                        pathsHtml += 'marker-end="url(#arrowhead-full)" opacity="0.9" ';
                                        pathsHtml += 'stroke-dasharray="none" stroke-linecap="round" />';
                                        
                                        connectionCount++;
                                    } else {
                                        debugLog('❌ Could not find toElement for: ' + downstreamKey);
                                    }
                                });
                            } else {
                                debugLog('❌ Could not find fromElement for: ' + assetKey);
                            }
                        } else {
                            debugLog('⚪ Asset ' + assetKey + ' has no downstream connections');
                        }
                    });
                    
                    svg.innerHTML = pathsHtml;
                    debugLog('🔗 Drew ' + connectionCount + ' connections for complete lineage graph');
                }
                
                // Old hardcoded tree function removed - now using real GraphQL lineage data
                
                function renderTreeLevel(nodes, level, levelType) {
                    if (!nodes || nodes.length === 0) return '';
                    
                    const indent = level * 60;
                    const levelColors = {
                        'root': '#4CAF50',      // Green for root/source
                        'intermediate': '#2196F3', // Blue for intermediate
                        'leaf': '#FF9800'       // Orange for leaf/sink
                    };
                    
                    let html = '<div class="tree-level" data-level="' + level + '" style="margin-left: ' + indent + 'px; margin-bottom: 40px;">';
                    
                    // Level header
                    if (level === 0) {
                        html += '<div style="text-align: left; margin-bottom: 15px; color: ' + levelColors[levelType] + '; font-weight: bold;">📁 Source Data</div>';
                    } else if (levelType === 'leaf') {
                        html += '<div style="text-align: left; margin-bottom: 15px; color: ' + levelColors[levelType] + '; font-weight: bold;">📊 Final Outputs</div>';
                    } else {
                        html += '<div style="text-align: left; margin-bottom: 15px; color: ' + levelColors[levelType] + '; font-weight: bold;">⚙️ Processed Data</div>';
                    }
                    
                    // Assets in this level
                    html += '<div class="tree-nodes" style="display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 20px;">';
                    nodes.forEach((assetKey, index) => {
                        const asset = currentData.assets.find(a => a.key === assetKey) || { key: assetKey };
                        html += '<div class="tree-node full-graph-asset" data-asset="' + assetKey + '" data-level="' + level + '" data-index="' + index + '" style="min-width: 180px;">';
                        html += createLineageAssetCard(asset, false);
                        html += '</div>';
                    });
                    html += '</div>';
                    
                    // Render children levels
                    const allChildren = new Set();
                    const childrenByParent = {};
                    
                    nodes.forEach(nodeKey => {
                        const children = getChildrenForAsset(nodeKey);
                        childrenByParent[nodeKey] = children;
                        children.forEach(child => allChildren.add(child));
                    });
                    
                    if (allChildren.size > 0) {
                        const childNodes = Array.from(allChildren);
                        const nextLevelType = hasGrandchildren(childNodes) ? 'intermediate' : 'leaf';
                        html += renderTreeLevel(childNodes, level + 1, nextLevelType);
                    }
                    
                    html += '</div>';
                    return html;
                }
                
                // Hardcoded relationship functions removed - using real GraphQL data
                
                function hasGrandchildren(nodes) {
                    return nodes.some(node => getChildrenForAsset(node).length > 0);
                }
                
                function drawTreeConnections() {
                    debugLog('🌳 Drawing tree connections...');
                    const svg = document.getElementById('fullLineageSvg');
                    if (!svg) {
                        debugLog('❌ Could not find fullLineageSvg');
                        return;
                    }
                    
                    // Update SVG to match container
                    const container = svg.parentElement;
                    svg.setAttribute('width', container.offsetWidth);
                    svg.setAttribute('height', container.offsetHeight);
                    svg.innerHTML = '';
                    
                    const containerRect = container.getBoundingClientRect();
                    
                    // Get all tree nodes
                    const treeNodes = container.querySelectorAll('.tree-node');
                    const nodePositions = new Map();
                    
                    treeNodes.forEach(node => {
                        const assetKey = node.getAttribute('data-asset');
                        const card = node.querySelector('.lineage-asset-card');
                        if (card) {
                            const rect = card.getBoundingClientRect();
                            nodePositions.set(assetKey, {
                                x: rect.left - containerRect.left + rect.width / 2,
                                y: rect.top - containerRect.top + rect.height / 2,
                                left: rect.left - containerRect.left,
                                right: rect.right - containerRect.left,
                                top: rect.top - containerRect.top,
                                bottom: rect.bottom - containerRect.top
                            });
                        }
                    });
                    
                    // Draw connections based on relationships (including DBT models)
                    const relationships = {
                        'raw_sales_data': ['cleaned_sales_data', 'stg_sales_data'],
                        'cleaned_sales_data': ['sales_summary', 'product_performance'],
                        'stg_sales_data': ['dbt_sales_summary', 'dbt_product_performance'],
                        'sales_summary': ['sales_report'],
                        'product_performance': ['sales_report'],
                        'dbt_sales_summary': ['dbt_sales_report'],
                        'dbt_product_performance': ['dbt_sales_report']
                    };
                    
                    Object.entries(relationships).forEach(([parent, children]) => {
                        const parentPos = nodePositions.get(parent);
                        if (parentPos) {
                            children.forEach(child => {
                                const childPos = nodePositions.get(child);
                                if (childPos) {
                                    // Draw from bottom of parent to top of child
                                    const x1 = parentPos.x;
                                    const y1 = parentPos.bottom;
                                    const x2 = childPos.x;
                                    const y2 = childPos.top;
                                    
                                    drawTreeConnection(svg, x1, y1, x2, y2, '#569cd6');
                                    debugLog('🔗 Tree connection: ' + parent + ' -> ' + child);
                                }
                            });
                        }
                    });
                }
                
                function drawTreeConnection(svg, x1, y1, x2, y2, color) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    
                    // Create a tree-like curved path (L-shaped with curves)
                    const midY = y1 + (y2 - y1) * 0.6;
                    const pathData = 'M ' + x1 + ' ' + y1 + 
                                   ' L ' + x1 + ' ' + midY + 
                                   ' Q ' + x1 + ' ' + (midY + 10) + ' ' + (x1 + (x2 > x1 ? 10 : -10)) + ' ' + (midY + 10) +
                                   ' L ' + (x2 - (x2 > x1 ? 10 : -10)) + ' ' + (midY + 10) +
                                   ' Q ' + x2 + ' ' + (midY + 10) + ' ' + x2 + ' ' + (midY + 20) +
                                   ' L ' + x2 + ' ' + y2;
                    
                    path.setAttribute('d', pathData);
                    path.setAttribute('stroke', color);
                    path.setAttribute('stroke-width', '2');
                    path.setAttribute('fill', 'none');
                    
                    // Add arrowhead
                    const markerId = 'tree-arrow-' + color.substring(1);
                    let existingMarker = svg.querySelector('#' + markerId);
                    
                    if (!existingMarker) {
                        const defs = svg.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                        if (!svg.querySelector('defs')) {
                            svg.appendChild(defs);
                        }
                        
                        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
                        marker.setAttribute('id', markerId);
                        marker.setAttribute('markerWidth', '8');
                        marker.setAttribute('markerHeight', '6');
                        marker.setAttribute('refX', '7');
                        marker.setAttribute('refY', '3');
                        marker.setAttribute('orient', 'auto');
                        marker.setAttribute('markerUnits', 'userSpaceOnUse');
                        
                        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                        polygon.setAttribute('points', '0,0 0,6 8,3');
                        polygon.setAttribute('fill', color);
                        
                        marker.appendChild(polygon);
                        defs.appendChild(marker);
                    }
                    
                    path.setAttribute('marker-end', 'url(#' + markerId + ')');
                    svg.appendChild(path);
                }
                
                function renderFocusedLineageGraph(upstreamAssets, focusAssetData, downstreamAssets, horizontal = true) {
                    const lineageGraph = document.getElementById('lineageGraph');
                    
                    // Create SVG-based lineage graph
                    let html = '<div class="lineage-svg-container" style="position: relative; width: 100%; min-height: 400px; background: #1e1e1e; border-radius: 8px; padding: 20px; overflow: auto;">';
                    
                    // SVG for drawing connections
                    html += '<svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;" id="lineageSvg"></svg>';
                    
                    if (horizontal) {
                        // Horizontal layout (like Dagster web UI)
                        html += '<div style="position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 60px; min-height: 400px; flex-wrap: wrap;">';
                        
                        // Upstream column
                        if (upstreamAssets.length > 0) {
                            html += '<div class="upstream-layer" style="display: flex; flex-direction: column; gap: 20px; align-items: center;">';
                            upstreamAssets.forEach((dep, index) => {
                                const assetKey = dep.asset.assetKey.path.join('.');
                                const asset = currentData.assets.find(a => a.key === assetKey) || { key: assetKey };
                                html += '<div class="asset-node-container" data-layer="upstream" data-index="' + index + '">';
                                html += createLineageAssetCard(asset, false);
                                html += '</div>';
                            });
                            html += '</div>';
                        }
                        
                        // Focus asset column
                        html += '<div class="focus-layer" style="display: flex; align-items: center;">';
                        html += '<div class="asset-node-container focus-asset" data-layer="focus" data-index="0">';
                        html += createLineageAssetCard(focusAssetData || { key: focusAsset }, true);
                        html += '</div>';
                        html += '</div>';
                        
                        // Downstream column
                        if (downstreamAssets.length > 0) {
                            html += '<div class="downstream-layer" style="display: flex; flex-direction: column; gap: 20px; align-items: center;">';
                            downstreamAssets.forEach((dep, index) => {
                                const assetKey = dep.asset.assetKey.path.join('.');
                                const asset = currentData.assets.find(a => a.key === assetKey) || { key: assetKey };
                                html += '<div class="asset-node-container" data-layer="downstream" data-index="' + index + '">';
                                html += createLineageAssetCard(asset, false);
                                html += '</div>';
                            });
                            html += '</div>';
                        }
                    } else {
                        // Vertical layout (for narrow spaces)
                        html += '<div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 40px; min-height: 400px;">';
                        
                        // Upstream row
                        if (upstreamAssets.length > 0) {
                            html += '<div class="upstream-layer" style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">';
                            upstreamAssets.forEach((dep, index) => {
                                const assetKey = dep.asset.assetKey.path.join('.');
                                const asset = currentData.assets.find(a => a.key === assetKey) || { key: assetKey };
                                html += '<div class="asset-node-container" data-layer="upstream" data-index="' + index + '">';
                                html += createLineageAssetCard(asset, false);
                                html += '</div>';
                            });
                            html += '</div>';
                        }
                        
                        // Focus asset row
                        html += '<div class="focus-layer" style="display: flex; justify-content: center;">';
                        html += '<div class="asset-node-container focus-asset" data-layer="focus" data-index="0">';
                        html += createLineageAssetCard(focusAssetData || { key: focusAsset }, true);
                        html += '</div>';
                        html += '</div>';
                        
                        // Downstream row
                        if (downstreamAssets.length > 0) {
                            html += '<div class="downstream-layer" style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">';
                            downstreamAssets.forEach((dep, index) => {
                                const assetKey = dep.asset.assetKey.path.join('.');
                                const asset = currentData.assets.find(a => a.key === assetKey) || { key: assetKey };
                                html += '<div class="asset-node-container" data-layer="downstream" data-index="' + index + '">';
                                html += createLineageAssetCard(asset, false);
                                html += '</div>';
                            });
                            html += '</div>';
                        }
                    }
                    
                    html += '</div></div>';
                    
                    lineageGraph.innerHTML = html;
                    attachAssetEventListeners();
                    
                    // Draw connections after a delay to ensure DOM is rendered
                    setTimeout(() => drawLineageConnections(horizontal), 200);
                }
                
                function createLineageAssetCard(asset, isFocus) {
                    // Detect asset type based on naming patterns
                    const isDBTModel = asset.key.includes('stg_') || 
                                      asset.key.includes('dim_') || 
                                      asset.key.includes('fct_') ||
                                      asset.key.includes('mart_') ||
                                      asset.key.startsWith('dbt_') ||
                                      (asset.description && asset.description.toLowerCase().includes('dbt'));
                    
                    const focusClass = isFocus ? 'border: 3px solid #f9a825; box-shadow: 0 4px 12px rgba(249, 168, 37, 0.4);' : 'border: 2px solid #444;';
                    let bgColor = isFocus ? '#2d3748' : '#1a1a1a';
                    let typeIndicator = '🐍 Python';
                    let typeColor = '#569cd6'; // Blue for Python
                    
                    if (isDBTModel) {
                        bgColor = isFocus ? '#2d4838' : '#1a2a1a'; // Slightly green tint
                        typeIndicator = '🗄️ DBT';
                        typeColor = '#4CAF50'; // Green for DBT
                    }
                    
                    return '<div class="lineage-asset-card" style="' +
                        'background: ' + bgColor + '; ' + focusClass + ' ' +
                        'border-radius: 8px; padding: 16px; min-width: 180px; max-width: 220px; ' +
                        'box-shadow: 0 2px 8px rgba(0,0,0,0.3); position: relative; ' +
                        'transition: all 0.2s ease;">' +
                        '<div class="asset-type" style="position: absolute; top: 8px; right: 8px; font-size: 10px; color: ' + typeColor + '; font-weight: bold;">' + typeIndicator + '</div>' +
                        '<div class="asset-header" style="margin-bottom: 12px; margin-top: 4px;">' +
                        '<div class="asset-name" style="font-weight: bold; color: ' + typeColor + '; font-size: 14px; margin-bottom: 4px;">' + asset.key + '</div>' +
                        (asset.description ? '<div class="asset-description" style="font-size: 11px; color: #888; line-height: 1.3;">' + asset.description + '</div>' : '') +
                        '</div>' +
                        '<div class="asset-actions" style="display: flex; gap: 6px;">' +
                        '<button class="materialize-btn" data-asset="' + asset.key + '" style="flex: 1; padding: 6px 10px; font-size: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background=\\'#45a049\\'" onmouseout="this.style.background=\\'#4CAF50\\'" title="Materialize Asset">▶️ Run</button>' +
                        '<button class="goto-btn" data-asset="' + asset.key + '" style="flex: 1; padding: 6px 10px; font-size: 10px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background=\\'#1976D2\\'" onmouseout="this.style.background=\\'#2196F3\\'" title="Go to Definition">📄 Code</button>' +
                        '</div>' +
                        '</div>';
                }
                
                function drawLineageConnections(horizontal = true) {
                    const svg = document.getElementById('lineageSvg');
                    if (!svg) return;
                    
                    debugLog('🎨 Drawing lineage connections (' + (horizontal ? 'horizontal' : 'vertical') + ' layout)');
                    
                    const container = svg.parentElement;
                    
                    // Wait a moment for layout to settle
                    setTimeout(() => {
                        const containerRect = container.getBoundingClientRect();
                        const svgRect = svg.getBoundingClientRect();
                        
                        // Update SVG dimensions to match container
                        svg.setAttribute('width', container.offsetWidth);
                        svg.setAttribute('height', container.offsetHeight);
                        svg.style.width = container.offsetWidth + 'px';
                        svg.style.height = container.offsetHeight + 'px';
                        
                        // Clear existing paths
                        svg.innerHTML = '';
                        
                        const focusNode = container.querySelector('.focus-asset .lineage-asset-card');
                        if (!focusNode) {
                            debugLog('❌ No focus node found');
                            return;
                        }
                        
                        const focusRect = focusNode.getBoundingClientRect();
                        const focusX = focusRect.left - containerRect.left + focusRect.width / 2;
                        const focusY = focusRect.top - containerRect.top + focusRect.height / 2;
                        
                        debugLog('🎯 Focus node at (' + focusX + ', ' + focusY + ')');
                        
                        // Draw connections from upstream assets to focus asset
                        const upstreamNodes = container.querySelectorAll('[data-layer="upstream"] .lineage-asset-card');
                        debugLog('⬆️ Found ' + upstreamNodes.length + ' upstream nodes');
                        
                        upstreamNodes.forEach((node, index) => {
                            const nodeRect = node.getBoundingClientRect();
                            const nodeX = nodeRect.left - containerRect.left + nodeRect.width / 2;
                            const nodeY = nodeRect.top - containerRect.top + nodeRect.height / 2;
                            
                            debugLog('📍 Upstream ' + index + ': (' + nodeX + ', ' + nodeY + ')');
                            
                            if (horizontal) {
                                // Connect from right edge of upstream to left edge of focus
                                const x1 = nodeRect.right - containerRect.left;
                                const y1 = nodeY;
                                const x2 = focusRect.left - containerRect.left;
                                const y2 = focusY;
                                drawConnection(svg, x1, y1, x2, y2, '#4CAF50');
                            } else {
                                // Connect from bottom of upstream to top of focus
                                const x1 = nodeX;
                                const y1 = nodeRect.bottom - containerRect.top;
                                const x2 = focusX;
                                const y2 = focusRect.top - containerRect.top;
                                drawConnection(svg, x1, y1, x2, y2, '#4CAF50');
                            }
                        });
                        
                        // Draw connections from focus asset to downstream assets
                        const downstreamNodes = container.querySelectorAll('[data-layer="downstream"] .lineage-asset-card');
                        debugLog('⬇️ Found ' + downstreamNodes.length + ' downstream nodes');
                        
                        downstreamNodes.forEach((node, index) => {
                            const nodeRect = node.getBoundingClientRect();
                            const nodeX = nodeRect.left - containerRect.left + nodeRect.width / 2;
                            const nodeY = nodeRect.top - containerRect.top + nodeRect.height / 2;
                            
                            debugLog('📍 Downstream ' + index + ': (' + nodeX + ', ' + nodeY + ')');
                            
                            if (horizontal) {
                                // Connect from right edge of focus to left edge of downstream
                                const x1 = focusRect.right - containerRect.left;
                                const y1 = focusY;
                                const x2 = nodeRect.left - containerRect.left;
                                const y2 = nodeY;
                                drawConnection(svg, x1, y1, x2, y2, '#2196F3');
                            } else {
                                // Connect from bottom of focus to top of downstream
                                const x1 = focusX;
                                const y1 = focusRect.bottom - containerRect.top;
                                const x2 = nodeX;
                                const y2 = nodeRect.top - containerRect.top;
                                drawConnection(svg, x1, y1, x2, y2, '#2196F3');
                            }
                        });
                        
                        debugLog('✅ Finished drawing ' + (upstreamNodes.length + downstreamNodes.length) + ' connections');
                    }, 50);
                }
                
                function drawFullGraphConnections() {
                    const svg = document.getElementById('fullLineageSvg');
                    if (!svg || !currentData.assets) return;
                    
                    debugLog('🌐 Drawing full graph connections');
                    
                    const container = svg.parentElement;
                    
                    // Wait for layout to settle
                    setTimeout(() => {
                        const containerRect = container.getBoundingClientRect();
                        
                        // Update SVG dimensions
                        svg.setAttribute('width', container.offsetWidth);
                        svg.setAttribute('height', container.offsetHeight);
                        svg.style.width = container.offsetWidth + 'px';
                        svg.style.height = container.offsetHeight + 'px';
                        
                        // Clear existing paths
                        svg.innerHTML = '';
                        
                        debugLog('📦 Container dimensions: ' + container.offsetWidth + 'x' + container.offsetHeight);
                        
                        // Create a map of asset positions
                        const assetPositions = new Map();
                        container.querySelectorAll('.full-graph-asset').forEach(node => {
                            const assetKey = node.getAttribute('data-asset');
                            const card = node.querySelector('.lineage-asset-card');
                            if (card) {
                                const rect = card.getBoundingClientRect();
                                
                                // Calculate positions relative to the container
                                const x = rect.left - containerRect.left + rect.width / 2;
                                const y = rect.top - containerRect.top + rect.height / 2;
                                const bottom = rect.bottom - containerRect.top;
                                const top = rect.top - containerRect.top;
                                const left = rect.left - containerRect.left;
                                const right = rect.right - containerRect.left;
                                
                                assetPositions.set(assetKey, {
                                    x: x,
                                    y: y,
                                    bottom: bottom,
                                    top: top,
                                    left: left,
                                    right: right
                                });
                                debugLog('📍 Asset ' + assetKey + ' at center (' + x + ', ' + y + ') bounds: top=' + top + ' bottom=' + bottom + ' left=' + left + ' right=' + right);
                            }
                        });
                        
                        debugLog('📋 Found ' + assetPositions.size + ' asset positions');
                        
                        // Debug: list all found assets
                        const foundAssets = Array.from(assetPositions.keys());
                        debugLog('🔍 Available assets: ' + foundAssets.join(', '));
                        
                        // Draw connections based on our known relationships
                        const connections = [
                            ['raw_sales_data', 'cleaned_sales_data'],
                            ['cleaned_sales_data', 'sales_summary'],
                            ['cleaned_sales_data', 'product_performance'],
                            ['sales_summary', 'sales_report'],
                            ['product_performance', 'sales_report']
                        ];
                        
                        connections.forEach(([source, target]) => {
                            const sourcePos = assetPositions.get(source);
                            const targetPos = assetPositions.get(target);
                            
                            if (sourcePos && targetPos) {
                                // Calculate edge-to-edge connections like the focused view
                                let x1, y1, x2, y2;
                                
                                // Determine connection direction and use appropriate edges
                                if (sourcePos.x < targetPos.x) {
                                    // Source is to the left, connect right edge to left edge
                                    x1 = sourcePos.right;
                                    y1 = sourcePos.y;
                                    x2 = targetPos.left;
                                    y2 = targetPos.y;
                                } else if (sourcePos.x > targetPos.x) {
                                    // Source is to the right, connect left edge to right edge  
                                    x1 = sourcePos.left;
                                    y1 = sourcePos.y;
                                    x2 = targetPos.right;
                                    y2 = targetPos.y;
                                } else if (sourcePos.y < targetPos.y) {
                                    // Source is above, connect bottom edge to top edge
                                    x1 = sourcePos.x;
                                    y1 = sourcePos.bottom;
                                    x2 = targetPos.x;
                                    y2 = targetPos.top;
                                } else {
                                    // Source is below, connect top edge to bottom edge
                                    x1 = sourcePos.x;
                                    y1 = sourcePos.top;
                                    x2 = targetPos.x;
                                    y2 = targetPos.bottom;
                                }
                                
                                debugLog('🔗 Edge-to-edge connection ' + source + ' (' + x1 + ',' + y1 + ') -> ' + target + ' (' + x2 + ',' + y2 + ')');
                                drawConnection(svg, x1, y1, x2, y2, '#569cd6');
                            } else {
                                debugLog('❌ Missing position for connection: ' + source + ' -> ' + target);
                            }
                        });
                        
                        debugLog('✅ Full graph connections complete');
                    }, 100);
                }
                
                function isLikelyConnected(asset1, asset2) {
                    // Simple heuristic for demo purposes
                    // In practice, you'd use actual lineage data
                    const patterns = [
                        ['raw_sales_data', 'cleaned_sales_data'],
                        ['cleaned_sales_data', 'sales_summary'],
                        ['cleaned_sales_data', 'product_performance'],
                        ['sales_summary', 'final_report'],
                        ['product_performance', 'final_report']
                    ];
                    
                    return patterns.some(([a, b]) => 
                        (asset1 === a && asset2 === b) || (asset1 === b && asset2 === a)
                    );
                }
                
                function drawConnection(svg, x1, y1, x2, y2, color) {
                    // Add debug logging
                    debugLog('🔗 Drawing connection from (' + x1 + ', ' + y1 + ') to (' + x2 + ', ' + y2 + ') with color ' + color + ' on SVG: ' + svg.id);
                    debugLog('🔍 SVG dimensions: ' + svg.getAttribute('width') + 'x' + svg.getAttribute('height'));
                    debugLog('🔍 SVG has defs: ' + (!!svg.querySelector('defs')));
                    
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    
                    // Create a smooth curved path
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Create a curved path that's more visible
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const offset = Math.abs(x2 - x1) * 0.3; // Add some curve
                    
                    let pathData = 'M ' + x1 + ' ' + y1 + ' Q ' + midX + ' ' + (midY - offset) + ' ' + x2 + ' ' + y2;
                    
                    path.setAttribute('d', pathData);
                    path.setAttribute('stroke', color);
                    path.setAttribute('stroke-width', '2');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('opacity', '0.8');
                    path.setAttribute('stroke-linecap', 'round');
                    
                    // Create or reuse arrow marker
                    const markerId = 'arrowhead-' + color.substring(1);
                    let existingMarker = svg.querySelector('#' + markerId);
                    
                    debugLog('🎯 Marker ' + markerId + ' exists: ' + (!!existingMarker) + ' on SVG: ' + svg.id);
                    
                    if (!existingMarker) {
                        debugLog('🏗️ Creating new marker ' + markerId + ' for SVG: ' + svg.id);
                        const defs = svg.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                        if (!svg.querySelector('defs')) {
                            svg.appendChild(defs);
                            debugLog('📁 Created new defs section for SVG: ' + svg.id);
                        }
                        
                        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
                        marker.setAttribute('id', markerId);
                        marker.setAttribute('markerWidth', '8');
                        marker.setAttribute('markerHeight', '6');
                        marker.setAttribute('refX', '7');
                        marker.setAttribute('refY', '3');
                        marker.setAttribute('orient', 'auto');
                        marker.setAttribute('markerUnits', 'userSpaceOnUse');
                        
                        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                        polygon.setAttribute('points', '0,0 0,6 8,3');
                        polygon.setAttribute('fill', color);
                        polygon.setAttribute('opacity', '0.9');
                        
                        marker.appendChild(polygon);
                        defs.appendChild(marker);
                        debugLog('✅ Created new marker ' + markerId + ' on SVG: ' + svg.id);
                    }
                    
                    path.setAttribute('marker-end', 'url(#' + markerId + ')');
                    svg.appendChild(path);
                    
                    debugLog('✅ Connection drawn successfully');
                    debugLog('📊 SVG now has ' + svg.querySelectorAll('path').length + ' paths and ' + svg.querySelectorAll('marker').length + ' markers');
                }
                
                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }
                
                function createAssetCard(asset, isFocus) {
                    const focusClass = isFocus ? 'border: 2px solid #f9a825; box-shadow: 0 0 8px rgba(249, 168, 37, 0.3);' : '';
                    const escapedKey = escapeHtml(asset.key);
                    const escapedDescription = asset.description ? escapeHtml(asset.description) : '';
                    
                    return '<div class="asset-node" style="margin: 8px; padding: 12px; border: 1px solid #444; border-radius: 4px; background: #2d2d30; ' + focusClass + ' min-width: 200px;">' +
                        '<div class="asset-name" style="font-weight: bold; color: #569cd6; margin-bottom: 8px;">' + escapedKey + '</div>' +
                        (escapedDescription ? '<div class="asset-description" style="font-size: 12px; color: #ccc; margin-bottom: 8px;">' + escapedDescription + '</div>' : '') +
                        '<div class="asset-actions" style="display: flex; gap: 4px; flex-wrap: wrap;">' +
                        '<button class="materialize-btn" data-asset="' + escapedKey + '" style="padding: 4px 8px; font-size: 11px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;" title="Materialize Asset">▶️ Run</button>' +
                        '<button class="goto-btn" data-asset="' + escapedKey + '" style="padding: 4px 8px; font-size: 11px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer;" title="Go to Definition">📄 Code</button>' +
                        '</div>' +
                        '</div>';
                }
                
                function attachAssetEventListeners() {
                    // Materialize buttons
                    document.querySelectorAll('.materialize-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const assetKey = btn.dataset.asset;
                            debugLog('▶️ Materializing asset: ' + assetKey);
                            vscode.postMessage({ type: 'materializeAsset', assetKey: assetKey });
                        });
                    });
                    
                    // Go to definition buttons
                    document.querySelectorAll('.goto-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const assetKey = btn.dataset.asset;
                            debugLog('📄 Opening code for asset: ' + assetKey);
                            vscode.postMessage({ type: 'openAssetDefinition', assetKey: assetKey });
                        });
                    });
                }
                
                function showLoading(isLoading) {
                    document.getElementById('loadingContainer').style.display = isLoading ? 'flex' : 'none';
                    document.getElementById('lineageContainer').style.display = isLoading ? 'none' : 'flex';
                }
                
                function showError(message) {
                    document.getElementById('errorText').textContent = message;
                    document.getElementById('errorContainer').style.display = 'flex';
                    document.getElementById('loadingContainer').style.display = 'none';
                    document.getElementById('lineageContainer').style.display = 'none';
                }
                
                // Event listeners
                document.getElementById('refreshBtn').addEventListener('click', () => {
                    debugLog('🔄 Refresh button clicked');
                    vscode.postMessage({ type: 'refresh' });
                });
                
                document.getElementById('startDagsterBtn').addEventListener('click', () => {
                    debugLog('🚀 Start Dagster button clicked');
                    vscode.postMessage({ type: 'startDagster' });
                });
                
                // Asset selector change event
                const assetSelectElement = document.getElementById('assetSelect');
                console.log('🔍 Asset selector element:', assetSelectElement);
                if (!assetSelectElement) {
                    console.error('❌ Could not find assetSelect element!');
                    return;
                }
                assetSelectElement.addEventListener('change', (e) => {
                    const selectedAsset = e.target.value;
                    debugLog('📋 Asset selector changed to: "' + selectedAsset + '"');
                    if (selectedAsset) {
                        debugLog('🎯 Asset selected: ' + selectedAsset);
                        focusAsset = selectedAsset;
                        // Clear previous lineage data to force fresh fetch
                        currentData.lineage = null;
                        vscode.postMessage({ type: 'getAssetLineage', assetKey: selectedAsset });
                    } else {
                        debugLog('🌐 Full graph selected, clearing focusAsset');
                        focusAsset = null;
                        currentData.lineage = null; // Clear lineage when going to full graph
                        renderAssetLineage(); // This will now show the full graph
                        
                        // Save state for persistence
                        vscode.setState({
                            currentData: currentData,
                            focusAsset: focusAsset
                        });
                    }
                });
                
                debugLog('✅ Event listeners attached, ready to go!');
            </script>
        </body>
        </html>`;
}

function getCloudDoctorWebviewContent(validation: ValidationResult, webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Dagster Cloud Config Doctor</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                    color: #cccccc;
                    background-color: #1e1e1e;
                    margin: 0;
                    padding: 20px;
                    line-height: 1.6;
                }
                .header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #444;
                }
                .title {
                    font-size: 24px;
                    font-weight: bold;
                    color: #ffffff;
                }
                .score-badge {
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 16px;
                }
                .score-excellent { background: #4CAF50; color: white; }
                .score-good { background: #8BC34A; color: white; }
                .score-fair { background: #FF9800; color: white; }
                .score-poor { background: #F44336; color: white; }
                .actions {
                    margin-bottom: 20px;
                }
                .btn {
                    padding: 10px 20px;
                    margin-right: 10px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: background-color 0.2s;
                }
                .btn-primary { background: #007ACC; color: white; }
                .btn-success { background: #4CAF50; color: white; }
                .btn-warning { background: #FF9800; color: white; }
                .btn:hover { opacity: 0.8; }
                .issue-list {
                    margin-top: 20px;
                }
                .issue-item {
                    margin-bottom: 15px;
                    padding: 15px;
                    border-radius: 6px;
                    border-left: 4px solid;
                }
                .issue-error {
                    background: #3f1a1a;
                    border-left-color: #f44336;
                }
                .issue-warning {
                    background: #3f2e1a;
                    border-left-color: #ff9800;
                }
                .issue-info {
                    background: #1a2d3f;
                    border-left-color: #2196f3;
                }
                .issue-type {
                    font-weight: bold;
                    text-transform: uppercase;
                    font-size: 11px;
                    margin-bottom: 5px;
                }
                .issue-field {
                    color: #569cd6;
                    font-family: 'Courier New', monospace;
                    font-weight: bold;
                }
                .issue-message {
                    margin: 8px 0;
                }
                .fix-suggestion {
                    margin-top: 10px;
                    padding: 10px;
                    background: rgba(76, 175, 80, 0.1);
                    border-radius: 4px;
                    border: 1px solid rgba(76, 175, 80, 0.3);
                }
                .fix-suggestion .fix-title {
                    font-weight: bold;
                    color: #4CAF50;
                    margin-bottom: 5px;
                }
                .no-issues {
                    text-align: center;
                    padding: 40px;
                    color: #4CAF50;
                    font-size: 18px;
                }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .summary-card {
                    padding: 15px;
                    background: #2d2d30;
                    border-radius: 6px;
                    border-left: 4px solid;
                }
                .summary-card.errors { border-left-color: #f44336; }
                .summary-card.warnings { border-left-color: #ff9800; }
                .summary-card.info { border-left-color: #2196f3; }
                .summary-number {
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .summary-label {
                    font-size: 12px;
                    text-transform: uppercase;
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">🩺 Dagster Cloud Config Doctor</div>
                <div class="score-badge score-${getScoreClass(validation.score)}">${validation.score}% Healthy</div>
            </div>

            <div class="actions">
                <button class="btn btn-primary" onclick="refreshValidation()">🔄 Re-examine</button>
                ${validation.issues.filter((i: ValidationIssue) => i.fix).length > 0 ? 
                    '<button class="btn btn-success" onclick="autoFix()">🩹 Heal All Issues</button>' : ''}
            </div>

            <div class="summary">
                <div class="summary-card errors">
                    <div class="summary-number">${validation.issues.filter((i: ValidationIssue) => i.type === 'error').length}</div>
                    <div class="summary-label">Errors</div>
                </div>
                <div class="summary-card warnings">
                    <div class="summary-number">${validation.issues.filter((i: ValidationIssue) => i.type === 'warning').length}</div>
                    <div class="summary-label">Warnings</div>
                </div>
                <div class="summary-card info">
                    <div class="summary-number">${validation.issues.filter((i: ValidationIssue) => i.type === 'info').length}</div>
                    <div class="summary-label">Info</div>
                </div>
            </div>

            <div class="issue-list">
                ${validation.issues.length === 0 ? 
                    '<div class="no-issues">🎉 Perfect health! Your configuration is ready for Dagster Cloud.</div>' :
                    validation.issues.map((issue: ValidationIssue) => `
                        <div class="issue-item issue-${issue.type}">
                            <div class="issue-type">${issue.type}</div>
                            <div class="issue-field">${issue.field}</div>
                            <div class="issue-message">${issue.message}</div>
                            ${issue.fix ? `
                                <div class="fix-suggestion">
                                    <div class="fix-title">🩹 Prescription:</div>
                                    <div>${issue.fix.description}</div>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')
                }
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                
                function refreshValidation() {
                    vscode.postMessage({ type: 'refresh' });
                }
                
                function autoFix() {
                    vscode.postMessage({ type: 'autoFix' });
                }
                
                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'validationUpdated':
                            // Reload the page with new validation results
                            location.reload();
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
}

function getScoreClass(score: number): string {
    if (score >= 90) {
        return 'excellent';
    }
    if (score >= 70) {
        return 'good';
    }
    if (score >= 50) {
        return 'fair';
    }
    return 'poor';
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getRunDetailsWebviewContent(runId: string, assetKey: string): string {
    const nonce = getNonce();
    
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Run Details: ${assetKey}</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                    color: #cccccc;
                    background-color: #1e1e1e;
                    margin: 0;
                    padding: 20px;
                    line-height: 1.6;
                }
                .header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 1px solid #444;
                }
                .title {
                    font-size: 24px;
                    font-weight: bold;
                    color: #ffffff;
                }
                .status-badge {
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 14px;
                }
                .status-queued { background: #FF9800; color: white; }
                .status-started { background: #2196F3; color: white; }
                .status-success { background: #4CAF50; color: white; }
                .status-failure { background: #F44336; color: white; }
                .status-canceled { background: #9E9E9E; color: white; }
                .info-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .info-card {
                    padding: 15px;
                    background: #2d2d30;
                    border-radius: 6px;
                    border-left: 4px solid #007ACC;
                }
                .info-label {
                    font-size: 12px;
                    text-transform: uppercase;
                    opacity: 0.8;
                    margin-bottom: 5px;
                }
                .info-value {
                    font-size: 16px;
                    font-weight: bold;
                }
                .run-id {
                    font-family: 'Courier New', monospace;
                    background: #333;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                }
                .loading {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 20px 0;
                }
                .spinner {
                    width: 20px;
                    height: 20px;
                    border: 2px solid #444;
                    border-top: 2px solid #007ACC;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .actions {
                    margin-top: 20px;
                }
                .btn {
                    padding: 10px 20px;
                    margin-right: 10px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    background: #007ACC;
                    color: white;
                    text-decoration: none;
                    display: inline-block;
                }
                .btn:hover {
                    opacity: 0.8;
                }
                .stats-section, .steps-section, .tags-section {
                    margin: 30px 0;
                    padding: 20px;
                    background: #252526;
                    border-radius: 8px;
                    border: 1px solid #444;
                }
                .stats-section h3, .steps-section h3, .tags-section h3 {
                    margin: 0 0 15px 0;
                    color: #ffffff;
                    font-size: 18px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                }
                .stat-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 15px;
                    background: #2d2d30;
                    border-radius: 6px;
                    border-left: 3px solid #007ACC;
                }
                .stat-icon {
                    font-size: 24px;
                }
                .stat-info {
                    flex: 1;
                }
                .stat-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #ffffff;
                    line-height: 1;
                }
                .stat-label {
                    font-size: 12px;
                    opacity: 0.8;
                    margin-top: 2px;
                }
                .steps-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .step-item {
                    display: flex;
                    align-items: center;
                    padding: 10px 15px;
                    background: #2d2d30;
                    border-radius: 4px;
                    gap: 10px;
                }
                .step-icon {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #007ACC;
                }
                .step-key {
                    font-family: 'Courier New', monospace;
                    font-weight: bold;
                }
                .step-kind {
                    color: #999;
                    font-size: 12px;
                    text-transform: uppercase;
                }
                .tags-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .tag-item {
                    padding: 6px 12px;
                    background: #2d2d30;
                    border: 1px solid #555;
                    border-radius: 15px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .tag-key {
                    font-weight: bold;
                    color: #ffcc00;
                }
                .tag-value {
                    color: #cccccc;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">🏃 Run Details: ${assetKey}</div>
                <div id="statusBadge" class="status-badge status-queued">Loading...</div>
            </div>

            <div class="info-grid">
                <div class="info-card">
                    <div class="info-label">Run ID</div>
                    <div class="info-value">
                        <span class="run-id">${runId}</span>
                    </div>
                </div>
                <div class="info-card">
                    <div class="info-label">Asset</div>
                    <div class="info-value">${assetKey}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Start Time</div>
                    <div class="info-value" id="startTime">-</div>
                </div>
                <div class="info-card">
                    <div class="info-label">End Time</div>
                    <div class="info-value" id="endTime">-</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Duration</div>
                    <div class="info-value" id="duration">-</div>
                </div>

            </div>

            <div class="stats-section" id="statsSection" style="display: none;">
                <h3>📊 Run Statistics</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">✅</div>
                        <div class="stat-info">
                            <div class="stat-value" id="stepsSucceeded">0</div>
                            <div class="stat-label">Steps Succeeded</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">❌</div>
                        <div class="stat-info">
                            <div class="stat-value" id="stepsFailed">0</div>
                            <div class="stat-label">Steps Failed</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🎯</div>
                        <div class="stat-info">
                            <div class="stat-value" id="materializations">0</div>
                            <div class="stat-label">Materializations</div>
                        </div>
                    </div>

                </div>
            </div>

            <div class="steps-section" id="stepsSection" style="display: none;">
                <h3>🔧 Execution Steps</h3>
                <div id="stepsList" class="steps-list">
                    <!-- Steps will be populated here -->
                </div>
            </div>

            <div class="tags-section" id="tagsSection" style="display: none;">
                <h3>🏷️ Run Tags</h3>
                <div id="tagsList" class="tags-list">
                    <!-- Tags will be populated here -->
                </div>
            </div>

            <div id="loadingIndicator" class="loading">
                <div class="spinner"></div>
                <span>Waiting for run to complete...</span>
            </div>

            <div class="actions">
                <a href="http://localhost:3000/runs/${runId}" class="btn" target="_blank">
                    🌐 View in Dagster UI
                </a>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                
                function updateStatus(status) {
                    const statusBadge = document.getElementById('statusBadge');
                    const startTime = document.getElementById('startTime');
                    const endTime = document.getElementById('endTime');
                    const duration = document.getElementById('duration');

                    const loadingIndicator = document.getElementById('loadingIndicator');
                    
                    // Update status badge
                    statusBadge.textContent = status.status;
                    statusBadge.className = 'status-badge status-' + status.status.toLowerCase();
                    
                    // Update basic info
                    if (status.startTime) {
                        startTime.textContent = status.startTime;
                    }
                    if (status.endTime) {
                        endTime.textContent = status.endTime;
                        loadingIndicator.style.display = 'none';
                        
                        // Calculate duration
                        if (status.startTime && status.endTime) {
                            const start = new Date(status.startTime);
                            const end = new Date(status.endTime);
                            const durationMs = end.getTime() - start.getTime();
                            const seconds = (durationMs / 1000).toFixed(2);
                            duration.textContent = seconds + 's';
                        }
                    }
                    

                    
                    // Update statistics
                    if (status.stats) {
                        const statsSection = document.getElementById('statsSection');
                        statsSection.style.display = 'block';
                        
                        document.getElementById('stepsSucceeded').textContent = status.stats.stepsSucceeded || 0;
                        document.getElementById('stepsFailed').textContent = status.stats.stepsFailed || 0;
                        document.getElementById('materializations').textContent = status.stats.materializations || 0;
                    }
                    
                    // Update execution steps
                    if (status.executionPlan && status.executionPlan.steps && status.executionPlan.steps.length > 0) {
                        const stepsSection = document.getElementById('stepsSection');
                        const stepsList = document.getElementById('stepsList');
                        stepsSection.style.display = 'block';
                        
                        stepsList.innerHTML = status.executionPlan.steps.map(step => 
                            '<div class="step-item">' +
                            '<div class="step-icon"></div>' +
                            '<div class="step-key">' + step.key + '</div>' +
                            '<div class="step-kind">' + step.kind + '</div>' +
                            '</div>'
                        ).join('');
                    }
                    
                    // Update tags
                    if (status.tags && status.tags.length > 0) {
                        const tagsSection = document.getElementById('tagsSection');
                        const tagsList = document.getElementById('tagsList');
                        tagsSection.style.display = 'block';
                        
                        tagsList.innerHTML = status.tags.map(tag =>
                            '<div class="tag-item">' +
                            '<span class="tag-key">' + tag.key + '</span>' +
                            '<span>:</span>' +
                            '<span class="tag-value">' + tag.value + '</span>' +
                            '</div>'
                        ).join('');
                    }
                    
                    // Hide loading indicator for completed runs
                    if (status.status === 'SUCCESS' || status.status === 'FAILURE' || status.status === 'CANCELED') {
                        loadingIndicator.style.display = 'none';
                    }
                }
                
                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'statusUpdate':
                            updateStatus(message.status);
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
}

export function deactivate() {
    if (statusBar) {
        statusBar.dispose();
    }
}
