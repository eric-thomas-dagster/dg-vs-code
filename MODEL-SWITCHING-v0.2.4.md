# 🔄 AI Model Persistence & Switching - Version 0.2.4

## Fixed Issues

### 1. ✅ Model Choice Persistence
**Problem**: Extension was asking for AI model selection on every reload  
**Solution**: Integrated `OnboardingManager` into `AskDagsterProvider` to persist your choice

The extension now:
- Remembers your AI model choice across VS Code reloads
- Stores configuration in VS Code global settings
- Only asks once (unless you explicitly switch)

### 2. ✅ Easy Model Switching
**Problem**: No easy way to switch between models  
**Solution**: Added new command `🔄 Switch AI Model`

Access via:
- Command Palette: `Cmd+Shift+P` → "🔄 Switch AI Model"
- Shows all three options with descriptions:
  - 🖥️ Local Ollama (free, private)
  - ☁️ Claude (fast, powerful)
  - 🤖 OpenAI (GPT-4)

### 3. ✅ Model Size Selection for Ollama
**Problem**: You should have been able to pick model size but flow wasn't triggering  
**Solution**: Fixed onboarding flow to show model sizes

When you select Ollama, you'll now see:
```
⭐ qwen2.5-coder:1.5b  (1.5GB) - Fastest, good for laptops
   qwen2.5-coder:7b    (4.7GB) - Balanced, great code generation
   deepseek-coder:6.7b (3.8GB) - Code specialist, excellent for Dagster
   codellama:13b       (7.4GB) - Most powerful (requires 16GB+ RAM)
   deepseek-coder-v2:16b (9.0GB) - Latest & greatest
```

## Why Ollama Might Be Slow

**Current Issue**: Ollama models (especially larger ones) can take 30-60 seconds to generate complex projects.

**What's happening**:
1. Model is loading into RAM (if not already loaded)
2. Generating code token-by-token locally
3. No progress indicator was showing (now fixed!)

**Recommendations**:
- **For testing**: Use `qwen2.5-coder:1.5b` (fastest, 1.5GB)
- **For production**: Switch to Claude or OpenAI (5-10x faster)
- **For best quality**: Use `deepseek-coder-v2:16b` if you have 16GB+ RAM

## How to Use

### Initial Setup (First Time Only)
1. Open Command Palette: `Cmd+Shift+P`
2. Type "Switch AI Model"
3. Select your preferred provider
4. For Ollama: Choose model size
5. Done! Your choice is saved

### Switching Models (Anytime)
```
Cmd+Shift+P → "🔄 Switch AI Model"
```

Pick:
- **Local Ollama** when offline or privacy-focused
- **Claude** for speed and quality (recommended for demos)
- **OpenAI** for GPT-4 power

### Your Config is Saved Here:
```
VS Code Settings → Dagster Power User
- dagster.preferOllama: true/false
- dagster.ollamaModel: "qwen2.5-coder:1.5b"
- dagster.claudeApiKey: (if using Claude)
- dagster.openaiApiKey: (if using OpenAI)
```

## Testing Your Current Ollama Generation

If your "Generate a retail analytics project with Snowflake and Fivetran" is still running:

**Check if Ollama is processing**:
```bash
# In terminal
curl http://localhost:11434/api/ps
```

If you see a model loaded, it's working - just slow!

**To check which model is running**:
```bash
ollama list
ollama ps  # Shows currently loaded model
```

## Recommended Next Steps

1. **Reload VS Code** to activate v0.2.4
2. **Switch to Claude or OpenAI** for faster testing:
   ```
   Cmd+Shift+P → "🔄 Switch AI Model" → Claude
   ```
3. **Enter your API key** (get from console.anthropic.com)
4. **Try the same prompt again** - should be 5-10x faster!

## Changes Made

### New Files:
- None (onboardingManager.ts already existed but wasn't integrated)

### Modified Files:
1. **`src/providers/askDagsterProvider.ts`**
   - Added `import { OnboardingManager }`
   - Initialized `_onboardingManager` in constructor
   - Added `getOnboardingManager()` method
   - Now persists model choice

2. **`src/extension.ts`**
   - Added `switchAIModelCommand` handler
   - Shows quick pick with all three providers
   - Calls appropriate setup method
   - Shows success/error messages

3. **`package.json`**
   - Added `dagster.switchAIModel` command
   - Added to "Dagster AI" category
   - Added activation event

---

**Version**: 0.2.4  
**Fixed**: Model persistence + easy switching + size selection  
**Recommended**: Switch to Claude for 5-10x faster generation!  
**Status**: Ready to test! 🚀









