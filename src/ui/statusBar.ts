import * as vscode from 'vscode';

export class DagsterStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private aiStatusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'dagster.showQuickActions';
        this.updateStatus('disconnected');
        
        // Create AI provider status bar item
        this.aiStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.aiStatusBarItem.command = 'dagster.switchAIModel';
        this.updateAIProvider();
    }

    show() {
        this.statusBarItem.show();
        this.aiStatusBarItem.show();
    }

    hide() {
        this.statusBarItem.hide();
        this.aiStatusBarItem.hide();
    }

    updateStatus(status: 'connected' | 'disconnected' | 'loading') {
        switch (status) {
            case 'connected':
                this.statusBarItem.text = '$(check) Dagster';
                this.statusBarItem.tooltip = 'Dagster is running - Click for quick actions';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'disconnected':
                this.statusBarItem.text = '$(circle-outline) Dagster';
                this.statusBarItem.tooltip = 'Dagster not running - Click to start webserver';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'loading':
                this.statusBarItem.text = '$(loading~spin) Dagster';
                this.statusBarItem.tooltip = 'Connecting to Dagster...';
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }
    
    updateAIProvider() {
        const config = vscode.workspace.getConfiguration('dagster');
        const activeProvider = config.get<string>('activeAIProvider', 'auto');
        const claudeKey = config.get<string>('claudeApiKey');
        const openaiKey = config.get<string>('openaiApiKey');
        const claudeEnhancedIntegration = config.get<boolean>('claudeEnhancedIntegration', false);
        const ollamaModel = config.get<string>('ollamaModel', 'codellama:13b');
        
        // Show the actively selected provider
        if (activeProvider === 'claude' && claudeKey) {
            this.aiStatusBarItem.text = '$(sparkle) Claude API';
            this.aiStatusBarItem.tooltip = 'Using Claude API for generation - Click to switch AI model';
        } else if (activeProvider === 'openai' && openaiKey) {
            this.aiStatusBarItem.text = '$(sparkle) OpenAI API';
            this.aiStatusBarItem.tooltip = 'Using OpenAI API for generation - Click to switch AI model';
        } else if (activeProvider === 'claude-code') {
            this.aiStatusBarItem.text = '$(sparkle) Claude Code';
            this.aiStatusBarItem.tooltip = 'Using Claude Code extension for generation - Click to switch AI model';
        } else if (activeProvider === 'ollama') {
            const modelDisplay = ollamaModel.split(':')[0];
            this.aiStatusBarItem.text = `$(lock) Ollama (${modelDisplay})`;
            this.aiStatusBarItem.tooltip = `Using local Ollama (${ollamaModel}) - Click to switch AI model`;
        } else {
            // Auto mode - show what's available
            if (claudeKey) {
                this.aiStatusBarItem.text = '$(sparkle) Claude API (auto)';
                this.aiStatusBarItem.tooltip = 'Auto mode: Using Claude API - Click to switch';
            } else if (openaiKey) {
                this.aiStatusBarItem.text = '$(sparkle) OpenAI API (auto)';
                this.aiStatusBarItem.tooltip = 'Auto mode: Using OpenAI API - Click to switch';
            } else if (claudeEnhancedIntegration) {
                this.aiStatusBarItem.text = '$(sparkle) Claude Code (auto)';
                this.aiStatusBarItem.tooltip = 'Auto mode: Using Claude Code - Click to switch';
            } else {
                const modelDisplay = ollamaModel.split(':')[0];
                this.aiStatusBarItem.text = `$(lock) Ollama (${modelDisplay})`;
                this.aiStatusBarItem.tooltip = `Using local Ollama (${ollamaModel}) - Click to switch`;
            }
        }
    }

    dispose() {
        this.statusBarItem.dispose();
        this.aiStatusBarItem.dispose();
    }
}
