import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DagsterStatusBar } from '../ui/statusBar';

const execAsync = promisify(exec);

export interface OnboardingState {
    completed: boolean;
    provider: 'ollama' | 'claude' | 'openai' | 'none';
    ollamaInstalled: boolean;
    ollamaRunning: boolean;
    modelInstalled: boolean;
    modelName?: string;
    apiKeyConfigured?: boolean;
}

export interface ModelOption {
    name: string;
    size: string;
    description: string;
    recommended?: boolean;
    pullCommand: string;
}

/**
 * Manages seamless onboarding for Ask Dagster
 * One-click setup for Ollama, Claude, or OpenAI
 */
export class OnboardingManager {
    private state: OnboardingState;
    private statusBar?: DagsterStatusBar;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.state = this.loadState();
    }
    
    setStatusBar(statusBar: DagsterStatusBar) {
        this.statusBar = statusBar;
    }

    /**
     * Get available model options with sizes
     */
    getModelOptions(): ModelOption[] {
        return [
            {
                name: 'qwen2.5-coder:1.5b',
                size: '1.5GB',
                description: 'Fastest - Good for basic questions (recommended for laptops)',
                recommended: true,
                pullCommand: 'ollama pull qwen2.5-coder:1.5b'
            },
            {
                name: 'qwen2.5-coder:7b',
                size: '4.7GB',
                description: 'Balanced - Great code generation',
                pullCommand: 'ollama pull qwen2.5-coder:7b'
            },
            {
                name: 'deepseek-coder:6.7b',
                size: '3.8GB',
                description: 'Code specialist - Excellent for Dagster',
                pullCommand: 'ollama pull deepseek-coder:6.7b'
            },
            {
                name: 'codellama:13b',
                size: '7.4GB',
                description: 'Most powerful - Best quality (requires 16GB+ RAM)',
                pullCommand: 'ollama pull codellama:13b'
            },
            {
                name: 'deepseek-coder-v2:16b',
                size: '9.0GB',
                description: 'Latest & greatest - Top performance',
                pullCommand: 'ollama pull deepseek-coder-v2:16b'
            }
        ];
    }

    /**
     * Check current onboarding state
     */
    async checkState(): Promise<OnboardingState> {
        // Check if Ollama is installed
        const ollamaInstalled = await this.isOllamaInstalled();
        
        // Check if Ollama is running
        const ollamaRunning = ollamaInstalled && await this.isOllamaRunning();
        
        // Check which model is installed
        const installedModel = await this.getInstalledModel();
        
        // Check for API keys
        const config = vscode.workspace.getConfiguration('dagster');
        const claudeKey = config.get<string>('claudeApiKey');
        const openaiKey = config.get<string>('openaiApiKey');
        
        this.state = {
            completed: ollamaRunning || !!claudeKey || !!openaiKey,
            provider: ollamaRunning ? 'ollama' : (claudeKey ? 'claude' : (openaiKey ? 'openai' : 'none')),
            ollamaInstalled,
            ollamaRunning,
            modelInstalled: !!installedModel,
            modelName: installedModel,
            apiKeyConfigured: !!claudeKey || !!openaiKey
        };
        
        this.saveState();
        return this.state;
    }

    /**
     * One-click Ollama setup
     */
    async setupOllama(modelName?: string): Promise<{ success: boolean; message: string }> {
        try {
            // Step 1: Check if Ollama is installed
            const installed = await this.isOllamaInstalled();
            
            if (!installed) {
                // Offer to install
                const install = await vscode.window.showInformationMessage(
                    'Ollama is not installed. Would you like to install it?',
                    { modal: true },
                    'Install Ollama',
                    'Use Cloud Provider Instead'
                );
                
                if (install === 'Install Ollama') {
                    await this.openOllamaInstallPage();
                    return {
                        success: false,
                        message: 'Please install Ollama and restart VS Code'
                    };
                } else {
                    return { success: false, message: 'Setup cancelled' };
                }
            }

            // Step 2: Check if Ollama is running
            const running = await this.isOllamaRunning();
            
            if (!running) {
                const start = await vscode.window.showInformationMessage(
                    'Ollama is installed but not running. Would you like to start it?',
                    { modal: true },
                    'Start Ollama'
                );
                
                if (start === 'Start Ollama') {
                    await this.startOllama();
                    // Wait a bit for Ollama to start
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    return { success: false, message: 'Setup cancelled' };
                }
            }

            // Step 3: Select model if not provided
            if (!modelName) {
                modelName = await this.selectModel();
                if (!modelName) {
                    return { success: false, message: 'No model selected' };
                }
            }

            // Step 4: Pull the model
            const pulled = await this.pullModel(modelName);
            
            if (!pulled.success) {
                return pulled;
            }

            // Step 5: Configure extension
            const config = vscode.workspace.getConfiguration('dagster');
            await config.update('activeAIProvider', 'ollama', vscode.ConfigurationTarget.Global);
            await config.update('ollamaModel', modelName, vscode.ConfigurationTarget.Global);
            await config.update('preferOllama', true, vscode.ConfigurationTarget.Global);
            await config.update('claudeEnhancedIntegration', false, vscode.ConfigurationTarget.Global);  // Disable extension integration
            await config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);

            this.state.completed = true;
            
            // Update status bar to show Ollama
            if (this.statusBar) {
                this.statusBar.updateAIProvider();
            }
            this.state.provider = 'ollama';
            this.state.modelInstalled = true;
            this.state.modelName = modelName;
            this.saveState();

            return {
                success: true,
                message: `✅ Ollama setup complete with ${modelName}!`
            };

        } catch (error) {
            return {
                success: false,
                message: `Setup failed: ${error}`
            };
        }
    }

    /**
     * One-click Claude setup
     */
    async setupClaude(): Promise<{ success: boolean; message: string }> {
        try {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Claude API key (from console.anthropic.com)',
                password: true,
                placeHolder: 'sk-ant-...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'API key cannot be empty';
                    }
                    if (!value.startsWith('sk-ant-')) {
                        return 'Claude API keys start with sk-ant-';
                    }
                    return null;
                }
            });

            if (!apiKey) {
                return { success: false, message: 'Setup cancelled' };
            }

            // Test the API key
            const valid = await this.testClaudeKey(apiKey);
            
            if (!valid) {
                return {
                    success: false,
                    message: 'Invalid API key. Please check and try again.'
                };
            }

            // Save configuration
            const config = vscode.workspace.getConfiguration('dagster');
            await config.update('activeAIProvider', 'claude', vscode.ConfigurationTarget.Global);
            await config.update('claudeApiKey', apiKey, vscode.ConfigurationTarget.Global);
            await config.update('preferOllama', false, vscode.ConfigurationTarget.Global);
            await config.update('claudeEnhancedIntegration', false, vscode.ConfigurationTarget.Global);  // Disable extension integration
            await config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);

            this.state.completed = true;
            
            // Update status bar to show Claude API
            if (this.statusBar) {
                this.statusBar.updateAIProvider();
            }
            this.state.provider = 'claude';
            this.state.apiKeyConfigured = true;
            this.saveState();

            return {
                success: true,
                message: '✅ Claude API key configured successfully! Will use Claude API directly.'
            };

        } catch (error) {
            return {
                success: false,
                message: `Setup failed: ${error}`
            };
        }
    }

    /**
     * One-click OpenAI setup
     */
    async setupOpenAI(): Promise<{ success: boolean; message: string }> {
        try {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenAI API key (from platform.openai.com)',
                password: true,
                placeHolder: 'sk-...',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'API key cannot be empty';
                    }
                    if (!value.startsWith('sk-')) {
                        return 'OpenAI API keys start with sk-';
                    }
                    return null;
                }
            });

            if (!apiKey) {
                return { success: false, message: 'Setup cancelled' };
            }

            // Test the API key
            const valid = await this.testOpenAIKey(apiKey);
            
            if (!valid) {
                return {
                    success: false,
                    message: 'Invalid API key. Please check and try again.'
                };
            }

            // Save configuration
            const config = vscode.workspace.getConfiguration('dagster');
            await config.update('activeAIProvider', 'openai', vscode.ConfigurationTarget.Global);
            await config.update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);
            await config.update('preferOllama', false, vscode.ConfigurationTarget.Global);
            await config.update('claudeEnhancedIntegration', false, vscode.ConfigurationTarget.Global);  // Disable extension integration
            await config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);

            this.state.completed = true;
            
            // Update status bar to show OpenAI API
            if (this.statusBar) {
                this.statusBar.updateAIProvider();
            }
            
            this.state.provider = 'openai';
            this.state.apiKeyConfigured = true;
            this.saveState();

            return {
                success: true,
                message: '✅ OpenAI API key configured successfully!'
            };

        } catch (error) {
            return {
                success: false,
                message: `Setup failed: ${error}`
            };
        }
    }

    /**
     * Interactive model selection with size info
     */
    private async selectModel(): Promise<string | undefined> {
        const models = this.getModelOptions();
        
        const selected = await vscode.window.showQuickPick(
            models.map(m => ({
                label: m.name,
                description: `${m.size} - ${m.description}`,
                detail: m.recommended ? '⭐ Recommended' : undefined,
                model: m
            })),
            {
                placeHolder: 'Select a model size',
                title: 'Choose Ollama Model',
                ignoreFocusOut: true
            }
        );

        return selected?.model.name;
    }

    /**
     * Pull model with progress
     */
    private async pullModel(modelName: string): Promise<{ success: boolean; message: string }> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${modelName}...`,
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'This may take a few minutes...' });
                
                await execAsync(`ollama pull ${modelName}`);
                
                return {
                    success: true,
                    message: `Model ${modelName} installed successfully`
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Failed to pull model: ${error}`
                };
            }
        });
    }

    /**
     * Check if Ollama is installed
     */
    private async isOllamaInstalled(): Promise<boolean> {
        try {
            await execAsync('ollama --version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if Ollama is running
     */
    private async isOllamaRunning(): Promise<boolean> {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get installed model from Ollama
     */
    private async getInstalledModel(): Promise<string | undefined> {
        try {
            const config = vscode.workspace.getConfiguration('dagster');
            const preferredModel = config.get<string>('ollamaModel');
            
            const response = await fetch('http://localhost:11434/api/tags');
            const data = await response.json();
            
            if (data.models && data.models.length > 0) {
                // Check if preferred model is installed
                if (preferredModel && data.models.some((m: any) => m.name === preferredModel)) {
                    return preferredModel;
                }
                // Return first available model
                return data.models[0].name;
            }
            
            return undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Start Ollama service - just check if it's running via API
     */
    private async startOllama(): Promise<void> {
        // No need to launch app, just check if API is accessible
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                vscode.window.showInformationMessage('⚠️ Ollama is not running. Please start Ollama manually or install it from https://ollama.com/download');
            }
        } catch (error) {
            // Ollama not running - this is okay, user will need to start it
            console.log('Ollama not detected, user may need to install or start it');
        }
    }

    /**
     * Open Ollama installation page
     */
    private async openOllamaInstallPage(): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
    }

    /**
     * Test Claude API key
     */
    private async testClaudeKey(apiKey: string): Promise<boolean> {
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Hi' }]
                })
            });
            
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Test OpenAI API key
     */
    private async testOpenAIKey(apiKey: string): Promise<boolean> {
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Load state from extension storage
     */
    private loadState(): OnboardingState {
        return this.context.globalState.get('onboardingState', {
            completed: false,
            provider: 'none',
            ollamaInstalled: false,
            ollamaRunning: false,
            modelInstalled: false
        });
    }

    /**
     * Save state to extension storage
     */
    private saveState(): void {
        this.context.globalState.update('onboardingState', this.state);
    }

    /**
     * Setup Claude Code extension integration
     */
    async setupClaudeCodeExtension(): Promise<{ success: boolean; message: string }> {
        try {
            // Check if Claude Code extension is installed
            const claudeExtension = vscode.extensions.getExtension('anthropic.claude-code');
            
            if (!claudeExtension) {
                return {
                    success: false,
                    message: '❌ Claude Code extension not found. Please install it from the VS Code marketplace first.'
                };
            }
            
            // Activate if not active
            if (!claudeExtension.isActive) {
                await claudeExtension.activate();
            }
            
            // Configure to use Claude Code extension as the ACTIVE provider
            const config = vscode.workspace.getConfiguration('dagster');
            await config.update('activeAIProvider', 'claude-code', vscode.ConfigurationTarget.Global);
            await config.update('claudeEnhancedIntegration', true, vscode.ConfigurationTarget.Global);
            await config.update('preferOllama', false, vscode.ConfigurationTarget.Global);
            await config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);
            
            this.state.completed = true;
            this.state.provider = 'claude';
            
            // Update status bar to show Claude Code
            if (this.statusBar) {
                this.statusBar.updateAIProvider();
            }
            
            this.saveState();
            
            return {
                success: true,
                message: '✅ Claude Code extension integration enabled!'
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Setup failed: ${error}`
            };
        }
    }

    /**
     * Reset onboarding (for testing or reconfiguration)
     */
    async reset(): Promise<void> {
        this.state = {
            completed: false,
            provider: 'none',
            ollamaInstalled: false,
            ollamaRunning: false,
            modelInstalled: false
        };
        this.saveState();
        
        vscode.window.showInformationMessage('Onboarding reset. Please configure Ask Dagster again.');
    }
}

