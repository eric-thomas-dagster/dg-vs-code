# 🔧 Integration Instructions for Seamless Onboarding

## Quick Integration Guide

Since `askDagsterProvider.ts` is very large (6000+ lines), here are the specific changes needed to integrate the new onboarding and guidelines systems.

## Step 1: Add Imports at Top of File

Add these imports after the existing imports:

```typescript
import { OnboardingManager, OnboardingState } from '../core/onboardingManager';
import { GuidelinesManager } from '../core/guidelinesManager';
import { getOnboardingHTML } from '../ui/onboardingHTML';
```

## Step 2: Add Properties to AskDagsterProvider Class

Add these private properties to the class (around line 22):

```typescript
export class AskDagsterProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dagster.askDagster';
    private _view?: vscode.WebviewView;
    private _conversationHistory: Array<{role: 'user' | 'assistant', content: string, timestamp: string}> = [];
    private _sessionMetadata: DemoSession | null = null;
    private _lastCreatedProjectPath?: string;
    
    // NEW: Add these
    private _onboardingManager: OnboardingManager;
    private _guidelinesManager: GuidelinesManager;
    private _onboardingState?: OnboardingState;
```

## Step 3: Update Constructor

Modify the constructor (around line 24-35):

```typescript
constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
) {
    // NEW: Initialize managers
    this._onboardingManager = new OnboardingManager(_context);
    this._guidelinesManager = new GuidelinesManager(_extensionUri);
    
    // Auto-enable generation and default to Ollama for seamless onboarding
    const config = vscode.workspace.getConfiguration('dagster');
    const enableGeneration = config.get<boolean>('enableProjectGeneration', false);
    if (!enableGeneration) {
        config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);
        config.update('preferOllama', true, vscode.ConfigurationTarget.Global);
    }
}
```

## Step 4: Update resolveWebviewView Method

Replace the `resolveWebviewView` method (around line 37-51):

```typescript
public async resolveWebviewView(
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

    // NEW: Check onboarding state
    this._onboardingState = await this._onboardingManager.checkState();
    
    // NEW: Show onboarding if not completed, otherwise show chat
    if (!this._onboardingState.completed) {
        webviewView.webview.html = getOnboardingHTML(this._onboardingState);
    } else {
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
        message => {
            console.log('🔧 Received webview message:', message);
            this._handleMessage(message);
        }
    );
}
```

## Step 5: Add New Message Handlers

Add these new handler methods to the class:

```typescript
private async _handleMessage(message: any): Promise<void> {
    // NEW: Handle onboarding messages
    if (message.type === 'setupOllama' && message.modelName) {
        await this._handleSeamlessOllamaSetup(message.modelName);
        return;
    }
    
    if (message.type === 'setupClaude') {
        await this._handleSeamlessClaudeSetup();
        return;
    }
    
    if (message.type === 'setupOpenAI') {
        await this._handleSeamlessOpenAISetup();
        return;
    }
    
    if (message.type === 'skipOnboarding') {
        await this._handleSkipOnboarding();
        return;
    }
    
    if (message.type === 'startChat') {
        this._showChatInterface();
        return;
    }

    // Existing handlers...
    switch (message.type) {
        case 'askQuestion':
            this._handleQuestion(message.question);
            break;
        // ... rest of existing cases
    }
}

/**
 * NEW: Seamless Ollama setup with model selection
 */
private async _handleSeamlessOllamaSetup(modelName: string): Promise<void> {
    try {
        this._sendToWebview({
            type: 'setupProgress',
            message: `Setting up Ollama with ${modelName}...`
        });

        const result = await this._onboardingManager.setupOllama(modelName);
        
        if (result.success) {
            this._sendToWebview({
                type: 'setupComplete',
                message: result.message
            });
            
            // Reload state and show chat
            this._onboardingState = await this._onboardingManager.checkState();
        } else {
            this._sendToWebview({
                type: 'setupError',
                message: result.message
            });
        }
    } catch (error) {
        this._sendToWebview({
            type: 'setupError',
            message: `Setup failed: ${error}`
        });
    }
}

/**
 * NEW: Seamless Claude setup
 */
private async _handleSeamlessClaudeSetup(): Promise<void> {
    try {
        const result = await this._onboardingManager.setupClaude();
        
        if (result.success) {
            this._sendToWebview({
                type: 'setupComplete',
                message: result.message
            });
            
            this._onboardingState = await this._onboardingManager.checkState();
        } else {
            this._sendToWebview({
                type: 'setupError',
                message: result.message
            });
        }
    } catch (error) {
        this._sendToWebview({
            type: 'setupError',
            message: `Setup failed: ${error}`
        });
    }
}

/**
 * NEW: Seamless OpenAI setup
 */
private async _handleSeamlessOpenAISetup(): Promise<void> {
    try {
        const result = await this._onboardingManager.setupOpenAI();
        
        if (result.success) {
            this._sendToWebview({
                type: 'setupComplete',
                message: result.message
            });
            
            this._onboardingState = await this._onboardingManager.checkState();
        } else {
            this._sendToWebview({
                type: 'setupError',
                message: result.message
            });
        }
    } catch (error) {
        this._sendToWebview({
            type: 'setupError',
            message: `Setup failed: ${error}`
        });
    }
}

/**
 * NEW: Skip onboarding
 */
private async _handleSkipOnboarding(): Promise<void> {
    // Mark as completed but no provider
    const config = vscode.workspace.getConfiguration('dagster');
    await config.update('enableProjectGeneration', false, vscode.ConfigurationTarget.Global);
    
    this._showChatInterface();
}

/**
 * NEW: Show chat interface after onboarding
 */
private _showChatInterface(): void {
    if (this._view) {
        this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
}

/**
 * NEW: Send message to webview
 */
private _sendToWebview(message: any): void {
    if (this._view) {
        this._view.webview.postMessage(message);
    }
}
```

## Step 6: Enhance _handleQuestion with Guidelines

Find the `_handleQuestion` method (search for `private async _handleQuestion`) and enhance it:

```typescript
private async _handleQuestion(question: string) {
    if (!this._view) {
        return;
    }

    try {
        // Add to conversation history
        this._conversationHistory.push({
            role: 'user',
            content: question,
            timestamp: new Date().toISOString()
        });

        // Show thinking indicator
        this._view.webview.postMessage({
            type: 'assistantThinking'
        });

        // NEW: Load guidelines and inject into context
        const guidelinesContext = await this._guidelinesManager.getGuidelinesContext();
        
        // Get current file context
        const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath || '';
        const currentFileContent = vscode.window.activeTextEditor?.document.getText() || '';
        
        // Build enhanced prompt with guidelines
        const enhancedPrompt = `${guidelinesContext}

## Current Workspace Context
File: ${currentFile}
${currentFileContent ? `\nCurrent file content:\n\`\`\`python\n${currentFileContent.slice(0, 500)}...\n\`\`\`` : ''}

## Conversation History
${this._conversationHistory.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}

## User Question
${question}

Please provide a detailed answer following the Dagster guidelines above. If generating code, ensure it includes group_name, compute_kind, and follows best practices.`;

        // Call LLM with enhanced prompt (your existing LLM call logic)
        const answer = await this._callLLM(enhancedPrompt);
        
        // NEW: If code was generated, validate it
        if (answer.includes('@asset') || answer.includes('@job')) {
            const validation = await this._guidelinesManager.validateCode(answer, 'asset');
            
            if (!validation.valid && validation.issues.length > 0) {
                // Append validation warnings to answer
                const warnings = validation.issues
                    .map((issue, i) => `⚠️ ${issue}\n💡 ${validation.suggestions[i]}`)
                    .join('\n');
                    
                answer.content += `\n\n**Code Quality Notes:**\n${warnings}`;
            }
        }

        // Add to conversation history
        this._conversationHistory.push({
            role: 'assistant',
            content: answer,
            timestamp: new Date().toISOString()
        });

        // Send response to webview
        this._view.webview.postMessage({
            type: 'assistantResponse',
            content: answer,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error handling question:', error);
        this._view.webview.postMessage({
            type: 'error',
            content: `Sorry, I encountered an error: ${error}`
        });
    }
}
```

## Step 7: Update Package.json (Optional but Recommended)

Update version and description:

```json
{
  "version": "0.2.0",
  "displayName": "Dagster Power User - Enhanced",
  "description": "Enhanced VS Code support for Dagster with seamless AI setup and best practices integration"
}
```

## Step 8: Test Everything

### Test Onboarding
1. Delete extension storage (fresh start)
2. Open Ask Dagster panel
3. Should see beautiful onboarding screen
4. Click a model (e.g., qwen2.5-coder:1.5b)
5. Verify setup completes
6. Should see chat interface

### Test Guidelines
1. Ask: "Create an asset to pull customer data"
2. Verify response includes:
   - `@asset` decorator
   - `group_name` parameter
   - `compute_kind` parameter
   - Descriptive name (not generic like "data")

### Test Validation
1. Ask for code generation
2. Check if validation warnings appear for missing best practices
3. Verify suggestions are helpful

## Alternative: Simple Script to Apply Changes

If you want to automate this, here's a script:

```bash
#!/bin/bash

# Backup original file
cp src/providers/askDagsterProvider.ts src/providers/askDagsterProvider.ts.backup

# Apply changes with sed (be careful!)
# This is just a template - adjust line numbers based on your actual file

echo "Manual integration recommended due to file complexity"
echo "Please follow the step-by-step guide above"
```

## Summary

These changes add:
1. ✅ Beautiful onboarding on first launch
2. ✅ One-click model selection with sizes
3. ✅ One-click Claude/OpenAI setup
4. ✅ Automatic guidelines injection
5. ✅ Code validation with suggestions

All while preserving your existing functionality!

## Need Help?

If integration is tricky due to the file's complexity, you can:
1. Create a new branch: `git checkout -b feature/seamless-onboarding`
2. Apply changes incrementally
3. Test after each step
4. Merge when everything works

Or let me know what specific part needs clarification!









