# Provider Switching with Persistent API Keys - v0.3.4

## Problem Solved
User wanted to **keep all API keys configured** but be able to **switch between providers** without having to re-enter keys each time.

**Before**: The extension would always use the first available API key, ignoring user's choice.
**After**: User's explicit provider selection is respected, and all API keys stay configured.

## What Changed

### 1. New Setting: `activeAIProvider`
**File**: `package.json`

Added a new configuration setting that tracks which provider the user has explicitly selected:

```json
"dagster.activeAIProvider": {
  "type": "string",
  "enum": ["auto", "claude", "openai", "claude-code", "ollama"],
  "default": "auto",
  "description": "Active AI provider for project generation",
  "enumDescriptions": [
    "Automatically use the first available provider",
    "Use Claude API (requires API key)",
    "Use OpenAI API (requires API key)",
    "Use Claude Code extension",
    "Use local Ollama"
  ]
}
```

**Options**:
- `auto` - Use first available provider (old behavior)
- `claude` - Use Claude API (even if OpenAI key is also set)
- `openai` - Use OpenAI API (even if Claude key is also set)
- `claude-code` - Use Claude Code extension
- `ollama` - Use local Ollama

### 2. Updated Setup Methods
**File**: `src/core/onboardingManager.ts`

Each setup method now sets the `activeAIProvider`:

```typescript
async setupOllama() {
    // ... setup logic ...
    await config.update('activeAIProvider', 'ollama', vscode.ConfigurationTarget.Global);
    // Keys stay configured!
}

async setupClaude(apiKey: string) {
    // ... setup logic ...
    await config.update('activeAIProvider', 'claude', vscode.ConfigurationTarget.Global);
    await config.update('claudeApiKey', apiKey, vscode.ConfigurationTarget.Global);
    // OpenAI key stays configured!
}

async setupOpenAI(apiKey: string) {
    // ... setup logic ...
    await config.update('activeAIProvider', 'openai', vscode.ConfigurationTarget.Global);
    await config.update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);
    // Claude key stays configured!
}

async setupClaudeCodeExtension() {
    // ... setup logic ...
    await config.update('activeAIProvider', 'claude-code', vscode.ConfigurationTarget.Global);
    // All API keys stay configured!
}
```

### 3. New Provider Selection Logic
**File**: `src/providers/askDagsterProvider.ts`

Changed `_handleProjectGeneration` to **respect user's explicit choice**:

```typescript
private async _handleProjectGeneration(question: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('dagster');
    
    // Check which provider the user has explicitly selected
    const activeProvider = config.get<string>('activeAIProvider', 'auto');
    const claudeKey = config.get<string>('claudeApiKey');
    const openaiKey = config.get<string>('openaiApiKey');
    
    console.log(`🎯 Active AI Provider: ${activeProvider}`);
    
    // Use the provider the user selected
    if (activeProvider === 'claude' && claudeKey) {
        console.log('🧠 Using Claude API (user selected)');
        return await this._generateWithClaude(question, claudeKey);
    }
    
    if (activeProvider === 'openai' && openaiKey) {
        console.log('🤖 Using OpenAI API (user selected)');
        return await this._generateWithOpenAI(question, openaiKey);
    }
    
    if (activeProvider === 'claude-code') {
        console.log('🧠 Using Claude Code extension (user selected)');
        return await this._generateWithClaudeExtension(question);
    }
    
    if (activeProvider === 'ollama') {
        console.log('🔒 Using Ollama (user selected)');
        return await this._tryOllama(question);
    }
    
    // Fallback: Try any available provider if selected one fails
    // ...
}
```

**Key Changes**:
- ✅ Checks `activeAIProvider` **first**
- ✅ Uses that provider even if other API keys are configured
- ✅ Falls back to other providers only if the selected one fails
- ✅ All API keys remain configured

### 4. Updated Status Bar
**File**: `src/ui/statusBar.ts`

Status bar now shows the **actively selected** provider:

```typescript
updateAIProvider() {
    const config = vscode.workspace.getConfiguration('dagster');
    const activeProvider = config.get<string>('activeAIProvider', 'auto');
    
    // Show the actively selected provider
    if (activeProvider === 'claude' && claudeKey) {
        this.aiStatusBarItem.text = '$(sparkle) Claude API';
    } else if (activeProvider === 'openai' && openaiKey) {
        this.aiStatusBarItem.text = '$(sparkle) OpenAI API';
    } else if (activeProvider === 'claude-code') {
        this.aiStatusBarItem.text = '$(sparkle) Claude Code';
    } else if (activeProvider === 'ollama') {
        this.aiStatusBarItem.text = `$(lock) Ollama (${modelDisplay})`;
    } else {
        // Auto mode - show what's available
        this.aiStatusBarItem.text = '$(sparkle) Claude API (auto)';
    }
}
```

## How It Works Now

### Scenario 1: You Have Both Claude and OpenAI Keys

**Before (v0.3.3)**:
- Extension always used Claude API (first in priority list)
- Couldn't switch to OpenAI without removing Claude key

**After (v0.3.4)**:
1. You have both keys configured ✅
2. Run `Dagster: Switch AI Model`
3. Select "OpenAI API"
4. Extension sets `activeAIProvider = 'openai'`
5. **Now uses OpenAI**, even though Claude key is still configured
6. Switch back to Claude anytime without re-entering keys

### Scenario 2: You Want to Use Claude Code

**Before (v0.3.3)**:
- If you had OpenAI key, it would use that instead
- Claude Code was ignored

**After (v0.3.4)**:
1. You have OpenAI key configured ✅
2. Run `Dagster: Switch AI Model`
3. Select "Claude Code Extension"
4. Extension sets `activeAIProvider = 'claude-code'`
5. **Now uses Claude Code**, even though OpenAI key is configured
6. Your OpenAI key stays saved for later

### Scenario 3: Switching Between All Providers

**Example Workflow**:
```
1. Monday: Use Claude API for premium quality
   → Run "Switch AI Model" → Select "Claude API"
   → Status bar: $(sparkle) Claude API

2. Tuesday: Use Ollama for privacy
   → Run "Switch AI Model" → Select "Local Ollama"
   → Status bar: $(lock) Ollama (codellama)

3. Wednesday: Use OpenAI for speed
   → Run "Switch AI Model" → Select "OpenAI API"
   → Status bar: $(sparkle) OpenAI API

4. Thursday: Use Claude Code extension
   → Run "Switch AI Model" → Select "Claude Code Extension"
   → Status bar: $(sparkle) Claude Code
```

**All API keys stay configured the entire time!** ✅

## Console Logs

When you generate a project, you'll see:

```
🎯 Active AI Provider: claude-code
🧠 Using Claude Code extension (user selected)
✅ Claude Code extension is active
```

Or:

```
🎯 Active AI Provider: openai
🤖 Using OpenAI API (user selected)
```

This makes it **crystal clear** which provider is being used.

## Status Bar Behavior

### Explicit Selection
When you explicitly select a provider:
- `$(sparkle) Claude API` - You selected Claude
- `$(sparkle) OpenAI API` - You selected OpenAI
- `$(sparkle) Claude Code` - You selected Claude Code
- `$(lock) Ollama (codellama)` - You selected Ollama

### Auto Mode
If `activeAIProvider = 'auto'`:
- `$(sparkle) Claude API (auto)` - Auto-selected Claude (has key)
- `$(sparkle) OpenAI API (auto)` - Auto-selected OpenAI (has key)
- `$(sparkle) Claude Code (auto)` - Auto-selected Claude Code
- `$(lock) Ollama (codellama)` - Auto-selected Ollama (default)

## Fallback Behavior

If your selected provider fails, the extension will try others:

```typescript
// Example: You selected Claude, but it fails
🎯 Active AI Provider: claude
🧠 Using Claude API (user selected)
⚠️ Claude API failed: Network error

⚠️ Selected provider failed, trying fallbacks...
🤖 Fallback: Trying OpenAI API
✅ Generated with OpenAI API
```

**Your selection is preserved** - next time it will try Claude again.

## Benefits

✅ **Keep All Keys**: Never delete API keys when switching
✅ **Easy Switching**: One command to switch between any provider
✅ **Clear Feedback**: Status bar shows which provider is active
✅ **Smart Fallback**: Falls back to other providers if selected one fails
✅ **Persistent Choice**: Your selection is remembered across sessions
✅ **No Re-entry**: Switch back and forth without re-entering keys

## Files Modified

1. **package.json**
   - Added `dagster.activeAIProvider` setting
   - Bumped version to `0.3.4`

2. **src/core/onboardingManager.ts**
   - Updated `setupOllama()` to set `activeAIProvider = 'ollama'`
   - Updated `setupClaude()` to set `activeAIProvider = 'claude'`
   - Updated `setupOpenAI()` to set `activeAIProvider = 'openai'`
   - Updated `setupClaudeCodeExtension()` to set `activeAIProvider = 'claude-code'`

3. **src/providers/askDagsterProvider.ts**
   - Refactored `_handleProjectGeneration()` to check `activeAIProvider` first
   - Added fallback logic if selected provider fails
   - Added console logs showing active provider

4. **src/ui/statusBar.ts**
   - Updated `updateAIProvider()` to show actively selected provider
   - Added "(auto)" indicator for auto mode

## Installation

```bash
cd /Users/ericthomas/dg-vs-code
code --install-extension dagster-power-user-0.3.4.vsix --force
```

Then **reload VS Code**.

## Testing

1. **Set up multiple providers**:
   - Add Claude API key
   - Add OpenAI API key
   - Have Claude Code extension installed

2. **Test switching**:
   - Run `Dagster: Switch AI Model`
   - Select "Claude API"
   - Check status bar: Should show `$(sparkle) Claude API`
   - Generate a project
   - Check console: Should see `🎯 Active AI Provider: claude`

3. **Switch to another**:
   - Run `Dagster: Switch AI Model`
   - Select "Claude Code Extension"
   - Check status bar: Should show `$(sparkle) Claude Code`
   - Generate a project
   - Check console: Should see `🎯 Active AI Provider: claude-code`

4. **Verify keys persist**:
   - Open VS Code Settings
   - Search for "dagster claude"
   - Verify Claude API key is still there
   - Search for "dagster openai"
   - Verify OpenAI API key is still there

## Summary

This update solves the **"I have to delete my API key to switch providers"** problem:

**Before**: 
- Had to delete OpenAI key to use Claude Code ❌
- Had to delete Claude key to use OpenAI ❌
- Couldn't easily switch between providers ❌

**After**:
- Keep all API keys configured ✅
- Switch with one command ✅
- Status bar shows active provider ✅
- Selection persists across sessions ✅
- Smart fallback if provider fails ✅

**You can now switch between providers freely without losing your API keys!** 🎉









