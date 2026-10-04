# Claude Code Extension Integration - v0.3.3

## Summary
Added **full support for Claude Code extension** as a first-class AI provider option, allowing you to use your existing Claude Code extension for Dagster project generation without needing a separate API key.

## What's New

### 1. Claude Code Extension as Primary Option
**File**: `src/extension.ts`

Added Claude Code extension to the AI model switcher:

```typescript
const choice = await vscode.window.showQuickPick([
    {
        label: '$(server) Local Ollama',
        description: 'Free, private, runs on your machine',
        value: 'ollama'
    },
    {
        label: '$(sparkle) Claude Code Extension',  // NEW!
        description: 'Use your Claude Code extension',
        detail: 'Requires Claude Code extension to be installed',
        value: 'claude-code'
    },
    {
        label: '$(cloud) Claude API (Anthropic)',
        description: 'Fast, powerful, pay-per-use',
        value: 'claude'
    },
    {
        label: '$(symbol-misc) OpenAI API',
        description: 'GPT-4, fast, pay-per-use',
        value: 'openai'
    }
]);
```

### 2. Improved Claude Code Extension Integration
**File**: `src/providers/askDagsterProvider.ts`

Updated `_generateViaCommands` to properly detect and use Claude Code extension:

```typescript
private async _generateViaCommands(prompt: string, commandInfo: any): Promise<string> {
    console.log('🔗 Generating via Claude Code extension...');
    
    try {
        // Check if Claude Code extension is available
        const claudeExtension = vscode.extensions.getExtension('anthropic.claude-code');
        
        if (!claudeExtension) {
            throw new Error('Claude Code extension not found');
        }
        
        if (!claudeExtension.isActive) {
            console.log('⚠️ Claude Code extension not active, activating...');
            await claudeExtension.activate();
        }
        
        console.log('✅ Claude Code extension is active');
        
        // Try to get the extension's API
        const claudeApi = claudeExtension.exports;
        
        if (claudeApi && typeof claudeApi.sendMessage === 'function') {
            console.log('🎯 Using Claude Code API directly');
            const response = await claudeApi.sendMessage(prompt);
            return response;
        }
        
        // Fallback: Use file-based communication
        console.log('📝 Using file-based communication with Claude Code');
        // ... file-based fallback logic
    }
}
```

### 3. Updated Provider Priority Logic
**File**: `src/providers/askDagsterProvider.ts`

Changed the order to prioritize Claude Code extension when enabled:

**NEW PRIORITY ORDER**:
1. ✅ Claude API (if API key configured)
2. ✅ OpenAI API (if API key configured)
3. ✅ **Claude Code Extension** (if enabled) ← NOW CHECKED BEFORE OLLAMA
4. ✅ Ollama (as fallback)

```typescript
// Try Claude Code extension if enabled (before Ollama)
const claudeEnhancedIntegration = config.get<boolean>('claudeEnhancedIntegration', false);
if (claudeEnhancedIntegration) {
    console.log('🧠 Trying Claude Code extension (claudeEnhancedIntegration=true)');
    try {
        const result = await this._generateWithClaudeExtension(question);
        return result;
    } catch (error) {
        console.log('⚠️ Claude Code extension failed:', error);
        // Fall through to Ollama
    }
}

// Try Ollama as fallback
if (preferOllama || claudeEnhancedIntegration) {
    console.log('🔒 Trying Ollama as fallback');
    const ollamaResult = await this._tryOllama(question);
    if (ollamaResult) {
        return ollamaResult;
    }
}
```

### 4. New Setup Method for Claude Code
**File**: `src/core/onboardingManager.ts`

Added dedicated setup method:

```typescript
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
        
        // Configure to use Claude Code extension
        const config = vscode.workspace.getConfiguration('dagster');
        await config.update('claudeEnhancedIntegration', true, vscode.ConfigurationTarget.Global);
        await config.update('preferOllama', false, vscode.ConfigurationTarget.Global);
        await config.update('enableProjectGeneration', true, vscode.ConfigurationTarget.Global);
        
        // Update status bar
        if (this.statusBar) {
            this.statusBar.updateAIProvider();
        }
        
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
```

### 5. Status Bar Shows Claude Code
**File**: `src/ui/statusBar.ts`

Updated status bar to display Claude Code when enabled:

```typescript
updateAIProvider() {
    const config = vscode.workspace.getConfiguration('dagster');
    const claudeKey = config.get<string>('claudeApiKey');
    const openaiKey = config.get<string>('openaiApiKey');
    const claudeEnhancedIntegration = config.get<boolean>('claudeEnhancedIntegration', false);
    const preferOllama = config.get<boolean>('preferOllama', true);
    
    if (claudeKey) {
        this.aiStatusBarItem.text = '$(sparkle) Claude API';
    } else if (openaiKey) {
        this.aiStatusBarItem.text = '$(sparkle) OpenAI API';
    } else if (claudeEnhancedIntegration) {
        this.aiStatusBarItem.text = '$(sparkle) Claude Code';  // NEW!
        this.aiStatusBarItem.tooltip = 'Using Claude Code extension for generation';
    } else if (preferOllama) {
        this.aiStatusBarItem.text = `$(lock) Ollama (${modelDisplay})`;
    }
}
```

## How to Use

### Option 1: Via Command Palette
1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type: `Dagster: Switch AI Model`
3. Select **"Claude Code Extension"**
4. Extension will activate Claude Code integration
5. Status bar (right side) will show: `$(sparkle) Claude Code`

### Option 2: Via Webview
1. Open the "Ask Dagster" panel
2. Click on the **"Claude"** option in the AI providers section
3. It will automatically detect and use your Claude Code extension

## What Happens When You Select Claude Code

1. ✅ **Extension Detection**: Checks if `anthropic.claude-code` extension is installed
2. ✅ **Activation**: Activates the extension if it's not already active
3. ✅ **Configuration**: Sets `claudeEnhancedIntegration=true` in VS Code settings
4. ✅ **Status Bar Update**: Shows `$(sparkle) Claude Code` on the right side
5. ✅ **Generation**: Uses Claude Code extension for all project generation

## Integration Methods

The extension tries multiple methods to communicate with Claude Code:

### Method 1: Direct API (Preferred)
```typescript
const claudeApi = claudeExtension.exports;
if (claudeApi && typeof claudeApi.sendMessage === 'function') {
    const response = await claudeApi.sendMessage(prompt);
    return response;
}
```

### Method 2: File-Based Communication (Fallback)
```typescript
// Write prompt to temporary file
const tempFilePath = path.join(workspace, '.dagster-prompt.txt');
await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from(prompt, 'utf8'));

// Open file so Claude can see it
const doc = await vscode.workspace.openTextDocument(tempFileUri);
await vscode.window.showTextDocument(doc);
```

## Benefits

✅ **No API Key Required**: Use your existing Claude Code extension
✅ **Seamless Integration**: Automatically detects and activates Claude Code
✅ **Fallback Support**: Falls back to Ollama if Claude Code fails
✅ **Status Bar Indicator**: Always know which AI provider is active
✅ **Easy Switching**: One command to switch between providers

## Troubleshooting

### Claude Code Extension Not Found
**Error**: `❌ Claude Code extension not found`

**Solution**:
1. Install Claude Code extension from VS Code marketplace
2. Reload VS Code
3. Try switching to Claude Code again

### Claude Code Not Working
**Symptoms**: Generation fails or falls back to Ollama

**Solutions**:
1. Check console logs for errors: `View → Output → Extension Host`
2. Verify Claude Code extension is active: Check Extensions panel
3. Try reloading VS Code
4. Switch to Claude API or Ollama as alternative

### Status Bar Shows Wrong Provider
**Issue**: Status bar shows Ollama but you selected Claude Code

**Solution**:
1. Reload VS Code to refresh the status bar
2. Check VS Code settings: `dagster.claudeEnhancedIntegration` should be `true`
3. Run `Dagster: Switch AI Model` again

## Files Modified

1. **src/providers/askDagsterProvider.ts**
   - Updated `_generateViaCommands` to properly detect Claude Code
   - Changed provider priority to check Claude Code before Ollama
   - Added file-based fallback communication method

2. **src/core/onboardingManager.ts**
   - Added `setupClaudeCodeExtension()` method
   - Configures `claudeEnhancedIntegration` setting

3. **src/ui/statusBar.ts**
   - Added Claude Code display option
   - Shows `$(sparkle) Claude Code` when enabled

4. **src/extension.ts**
   - Added Claude Code option to AI model switcher
   - Wired up `setupClaudeCodeExtension()` handler

5. **package.json**
   - Bumped version to `0.3.3`

## Installation

```bash
cd /Users/ericthomas/dg-vs-code
code --install-extension dagster-power-user-0.3.3.vsix --force
```

Then **reload VS Code** to activate.

## Testing

1. **Test Claude Code Detection**:
   - Run `Dagster: Switch AI Model`
   - Select "Claude Code Extension"
   - Should see success message if Claude Code is installed

2. **Test Project Generation**:
   - Open "Ask Dagster" panel
   - Generate a project (e.g., "Generate a retail analytics project")
   - Check console logs for `🧠 Trying Claude Code extension`
   - Verify project is generated

3. **Test Status Bar**:
   - After selecting Claude Code, check right side of status bar
   - Should show `$(sparkle) Claude Code`
   - Click on it to verify tooltip says "Using Claude Code extension"

4. **Test Fallback**:
   - If Claude Code fails, should fall back to Ollama
   - Check console logs for fallback messages

## Summary

This update makes Claude Code extension a **first-class citizen** in the Dagster Power User extension:

1. ✅ Easy to enable via "Switch AI Model" command
2. ✅ Proper detection and activation of Claude Code extension
3. ✅ Multiple communication methods (API + file-based fallback)
4. ✅ Status bar shows current provider
5. ✅ Graceful fallback to Ollama if needed
6. ✅ No API key required - uses your existing Claude Code setup

**You can now use your Claude Code extension for Dagster project generation!** 🎉









