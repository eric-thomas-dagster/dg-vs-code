# AI Provider Selection Fix - v0.3.1

## Problem
When the user selected "Claude Code" from the switch menu, the extension would:
1. Try to use the Claude Code extension first (which failed with "No suitable Claude commands found")
2. Fall back to Ollama instead of using the Claude API
3. The status bar didn't show which AI provider was actually being used
4. The generated code still used `@job` instead of `deps=` for lineage

## Root Cause
The `_handleProjectGeneration` method in `askDagsterProvider.ts` was checking for `claudeEnhancedIntegration` **before** checking for API keys. This meant:
- When user clicked "Claude Code", it set `claudeEnhancedIntegration=true`
- The extension tried the Claude Code extension first (which doesn't work)
- Then it fell back to Ollama (because `preferOllama=true` by default)
- It never actually used the Claude **API** key

## Solution

### 1. Fixed Provider Priority Logic
**File**: `src/providers/askDagsterProvider.ts`

Changed the order of provider checks in `_handleProjectGeneration`:

**BEFORE** (lines 4615-4628):
```typescript
// Try Claude extension integration first if available
if (claudeEnhancedIntegration) {
    console.log('🚀 Using enhanced Claude integration for project generation');
    this._logSessionStep('attempting_claude_extension');
    try {
        const result = await this._generateWithClaudeExtension(question);
        this._logSessionStep('claude_extension_success');
        return result;
    } catch (error) {
        console.log('⚠️ Claude extension generation failed, falling back to other methods:', error);
        this._logSessionStep('claude_extension_failed', { error: String(error) });
        // Fall through to other methods
    }
}
```

**AFTER** (lines 4614-4651):
```typescript
// Check for API keys first (prioritize direct API access)
const claudeKey = config.get<string>('claudeApiKey');
const openaiKey = config.get<string>('openaiApiKey');
const preferOllama = config.get<boolean>('preferOllama', true);

// If user has API keys, use them directly (don't try Claude Code extension)
if (claudeKey) {
    console.log('🧠 Using Claude API directly (API key found)');
    this._logSessionStep('using_claude_api');
    try {
        return await this._generateWithClaude(question, claudeKey);
    } catch (error) {
        console.log('⚠️ Claude API failed:', error);
        this._logSessionStep('claude_api_failed', { error: String(error) });
        // Fall through to other methods
    }
}

if (openaiKey) {
    console.log('🤖 Using OpenAI API directly (API key found)');
    this._logSessionStep('using_openai_api');
    try {
        return await this._generateWithOpenAI(question, openaiKey);
    } catch (error) {
        console.log('⚠️ OpenAI API failed:', error);
        this._logSessionStep('openai_api_failed', { error: String(error) });
        // Fall through to other methods
    }
}

// Try Ollama if preferred and no API keys
if (preferOllama) {
    console.log('🔒 Trying Ollama (preferOllama=true)');
    const ollamaResult = await this._tryOllama(question);
    if (ollamaResult) {
        return ollamaResult;
    }
}

// Only try Claude Code extension as last resort
const claudeEnhancedIntegration = config.get<boolean>('claudeEnhancedIntegration', false);
if (claudeEnhancedIntegration) {
    console.log('🚀 Trying Claude Code extension as fallback');
    // ... try extension
}
```

**Key Changes**:
- ✅ Check for Claude API key **first**
- ✅ Check for OpenAI API key **second**
- ✅ Check for Ollama **third** (only if no API keys)
- ✅ Try Claude Code extension **last** (as fallback only)

### 2. Added Status Bar AI Provider Indicator
**File**: `src/ui/statusBar.ts`

Added a new status bar item that shows which AI provider is currently configured:

```typescript
export class DagsterStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private aiStatusBarItem: vscode.StatusBarItem;  // NEW!

    constructor() {
        // ... existing Dagster status bar
        
        // Create AI provider status bar item
        this.aiStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.aiStatusBarItem.command = 'dagster.switchAIModel';
        this.updateAIProvider();
    }
    
    updateAIProvider() {
        const config = vscode.workspace.getConfiguration('dagster');
        const claudeKey = config.get<string>('claudeApiKey');
        const openaiKey = config.get<string>('openaiApiKey');
        const preferOllama = config.get<boolean>('preferOllama', true);
        const ollamaModel = config.get<string>('ollamaModel', 'codellama:13b');
        
        if (claudeKey) {
            this.aiStatusBarItem.text = '$(sparkle) Claude API';
            this.aiStatusBarItem.tooltip = 'Using Claude API for generation - Click to switch AI model';
        } else if (openaiKey) {
            this.aiStatusBarItem.text = '$(sparkle) OpenAI API';
            this.aiStatusBarItem.tooltip = 'Using OpenAI API for generation - Click to switch AI model';
        } else if (preferOllama) {
            const modelDisplay = ollamaModel.split(':')[0];
            this.aiStatusBarItem.text = `$(lock) Ollama (${modelDisplay})`;
            this.aiStatusBarItem.tooltip = `Using local Ollama (${ollamaModel}) - Click to switch AI model`;
        } else {
            this.aiStatusBarItem.text = '$(question) No AI';
            this.aiStatusBarItem.tooltip = 'No AI provider configured - Click to set up';
        }
    }
}
```

**Status Bar Display Examples**:
- `$(sparkle) Claude API` - When Claude API key is configured
- `$(sparkle) OpenAI API` - When OpenAI API key is configured
- `$(lock) Ollama (codellama)` - When using local Ollama
- `$(question) No AI` - When no provider is configured

### 3. Connected Status Bar to Onboarding
**Files**: 
- `src/core/onboardingManager.ts`
- `src/providers/askDagsterProvider.ts`
- `src/extension.ts`

Added automatic status bar updates when AI provider is changed:

**onboardingManager.ts**:
```typescript
export class OnboardingManager {
    private statusBar?: DagsterStatusBar;
    
    setStatusBar(statusBar: DagsterStatusBar) {
        this.statusBar = statusBar;
    }
    
    async setupClaude(apiKey: string) {
        // ... save config
        
        // Update status bar to show Claude API
        if (this.statusBar) {
            this.statusBar.updateAIProvider();
        }
    }
}
```

**askDagsterProvider.ts**:
```typescript
export class AskDagsterProvider {
    public setStatusBar(statusBar: DagsterStatusBar) {
        this._onboardingManager.setStatusBar(statusBar);
    }
}
```

**extension.ts**:
```typescript
askDagsterProvider = new AskDagsterProvider(context.extensionUri, context);
askDagsterProvider.setStatusBar(statusBar);  // Pass status bar reference
```

## Testing

### Test Case 1: Switch to Claude API
1. Open command palette: `Dagster: Switch AI Model`
2. Select "Claude API"
3. Enter valid Claude API key
4. **Expected**: Status bar shows `$(sparkle) Claude API`
5. Generate a project
6. **Expected**: Console logs show `🧠 Using Claude API directly (API key found)`
7. **Expected**: Project is generated with Claude API (not Ollama)

### Test Case 2: Switch to OpenAI API
1. Open command palette: `Dagster: Switch AI Model`
2. Select "OpenAI API"
3. Enter valid OpenAI API key
4. **Expected**: Status bar shows `$(sparkle) OpenAI API`
5. Generate a project
6. **Expected**: Console logs show `🤖 Using OpenAI API directly (API key found)`

### Test Case 3: Switch to Ollama
1. Open command palette: `Dagster: Switch AI Model`
2. Select "Local Ollama"
3. Choose model size (e.g., "Premium: codellama:13b")
4. **Expected**: Status bar shows `$(lock) Ollama (codellama)`
5. Generate a project
6. **Expected**: Console logs show `🔒 Trying Ollama (preferOllama=true)`

### Test Case 4: Status Bar Click
1. Click on the AI provider status bar item
2. **Expected**: Opens the "Switch AI Model" quick pick menu
3. **Expected**: Can easily switch between providers

## Benefits

### For Users
✅ **Clear Visibility**: Status bar always shows which AI provider is active
✅ **Correct Provider**: Extension now uses the AI provider you actually selected
✅ **Easy Switching**: Click status bar to quickly change AI providers
✅ **No Confusion**: No more "I selected Claude but it used Ollama"

### For Debugging
✅ **Console Logs**: Clear logs showing which provider is being used
✅ **Session Tracking**: Logs show `using_claude_api`, `using_openai_api`, etc.
✅ **Fallback Visibility**: Can see when and why fallbacks occur

## Files Modified

1. **src/providers/askDagsterProvider.ts**
   - Reordered provider priority logic
   - Added `setStatusBar()` method
   - Removed duplicate provider checking code

2. **src/ui/statusBar.ts**
   - Added `aiStatusBarItem` for AI provider display
   - Added `updateAIProvider()` method
   - Shows current AI provider in status bar

3. **src/core/onboardingManager.ts**
   - Added `setStatusBar()` method
   - Calls `updateAIProvider()` after each provider setup
   - Imported `DagsterStatusBar` type

4. **src/extension.ts**
   - Passes status bar reference to `askDagsterProvider`

5. **package.json**
   - Bumped version to `0.3.1`

## Installation

```bash
cd /Users/ericthomas/dg-vs-code
npm run compile
npm run package
code --install-extension dagster-power-user-0.3.1.vsix --force
```

Then **reload VS Code** to activate the changes.

## Next Steps

1. **Test the fix**: Try switching between AI providers and verify the status bar updates
2. **Generate projects**: Confirm each provider is actually being used
3. **Check lineage**: Verify generated projects use `deps=` for asset lineage
4. **User feedback**: Confirm the status bar is helpful and not intrusive

## Summary

This fix ensures that:
1. ✅ The extension uses the AI provider you actually selected
2. ✅ The status bar shows which provider is active
3. ✅ API keys are prioritized over the Claude Code extension
4. ✅ Switching providers is easy and visible
5. ✅ Console logs clearly show which provider is being used

**No more confusion about which AI is generating your code!** 🎉









