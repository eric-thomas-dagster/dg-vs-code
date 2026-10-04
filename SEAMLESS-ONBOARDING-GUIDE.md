# 🚀 Seamless Onboarding & Guidelines Integration - Implementation Guide

## Overview

This document describes the implementation of seamless onboarding and Dagster writing guidelines integration for the Ask Dagster extension.

## Key Features

### 1. One-Click Setup ✨

Users can now set up Ask Dagster in literally ONE CLICK:

#### **Option A: Local AI (Recommended)**
- **Click a model card** → Ollama installs model → Ready to go!
- Model options with clear size labels:
  - ⚡ **qwen2.5-coder:1.5b** (1.5GB) - Fastest, recommended for laptops
  - ⚖️ **qwen2.5-coder:7b** (4.7GB) - Balanced performance
  - 🎯 **deepseek-coder:6.7b** (3.8GB) - Code specialist
  - 🚀 **codellama:13b** (7.4GB) - Most powerful

#### **Option B: Cloud AI**
- **Click Claude** → Enter API key → Done!
- **Click OpenAI** → Enter API key → Done!

No more navigating through multiple settings pages. Everything is visual and intuitive.

### 2. Dagster Writing Guidelines 📚

All your Dagster best practices are now available to the AI:

#### **Built-in Guidelines**
- Asset patterns (good vs bad examples)
- Job definitions
- IO Managers & Resources
- Component usage
- Naming conventions
- Testing patterns
- Error handling
- Performance tips

#### **Custom Guidelines**
The extension automatically loads custom guidelines from:
- `dagster-guidelines.md`
- `dagster-writing-guidelines.md`
- `rules.md`
- `.dagster/guidelines.md`

These are merged with built-in guidelines and provided as context to every AI request.

### 3. Smart Context Injection 🧠

Every query now includes:
- **Dagster Guidelines**: Best practices and patterns
- **User's Codebase**: Current file context
- **Project Structure**: Detected assets, jobs, resources
- **Conversation History**: Previous Q&A for continuity

## Architecture

### New Components

```
src/
├── core/
│   ├── guidelinesManager.ts    # Loads and manages guidelines
│   └── onboardingManager.ts    # Handles setup flow
└── ui/
    └── onboardingHTML.ts       # Beautiful onboarding UI
```

### GuidelinesManager

```typescript
const guidelines = new GuidelinesManager(extensionUri);

// Get full context for AI
const context = await guidelines.getGuidelinesContext();

// Get specific topic
const assetGuidelines = await guidelines.getTopicGuidelines('assets');

// Validate generated code
const validation = await guidelines.validateCode(generatedCode, 'asset');
```

### OnboardingManager

```typescript
const onboarding = new OnboardingManager(context);

// Check current state
const state = await onboarding.checkState();

// One-click setups
await onboarding.setupOllama('qwen2.5-coder:1.5b');
await onboarding.setupClaude();
await onboarding.setupOpenAI();
```

## User Experience Flow

### First Time Opening Ask Dagster

1. **Beautiful Welcome Screen** appears:
   ```
   ┌─────────────────────────────────────┐
   │          🤖 Welcome!                │
   │      Ask Dagster AI Assistant       │
   │                                     │
   │  🏠 Local AI (Recommended) FREE    │
   │  ┌────────────────────────────────┐│
   │  │ ⚡ qwen2.5-coder:1.5b (1.5GB) ││
   │  │ ⭐ Best for most users         ││
   │  └────────────────────────────────┘│
   │  ┌────────────────────────────────┐│
   │  │ ⚖️ qwen2.5-coder:7b (4.7GB)   ││
   │  └────────────────────────────────┘│
   │                                     │
   │         or use cloud AI             │
   │  ┌──────────┐  ┌──────────┐       │
   │  │ 🤖 Claude│  │ 🧠 OpenAI│       │
   │  └──────────┘  └──────────┘       │
   └─────────────────────────────────────┘
   ```

2. **User clicks a model** (e.g., qwen2.5-coder:1.5b)

3. **Extension checks Ollama**:
   - ✅ If installed & running → Downloads model
   - ⚠️ If not installed → Opens download page with instructions

4. **Progress shown**:
   ```
   ⏳ Downloading qwen2.5-coder:1.5b... (1.5GB)
   This may take a few minutes...
   ```

5. **Setup complete**:
   ```
   ✅ Ollama setup complete with qwen2.5-coder:1.5b!
   You're ready to ask questions!
   ```

6. **Chat interface appears** with pre-loaded context

### Subsequent Opens

- No onboarding screen (already configured)
- Jump straight to chat
- Guidelines automatically loaded in background

## Integration with Ask Dagster

### Enhanced Message Context

Before sending to LLM:

```typescript
// Load guidelines
const guidelinesContext = await guidelinesManager.getGuidelinesContext();

// Build full prompt
const fullPrompt = `
${guidelinesContext}

## Current File Context
File: ${currentFile}
Detected Assets: ${detectedAssets}

## Conversation History
${conversationHistory}

## User Question
${userQuestion}

Please provide a detailed answer following the Dagster guidelines above.
`;
```

### Code Validation

After generating code:

```typescript
const validation = await guidelinesManager.validateCode(
    generatedCode, 
    'asset'
);

if (!validation.valid) {
    // Show issues to user
    // Offer to auto-fix
    showWarnings(validation.issues, validation.suggestions);
}
```

## Configuration

### Extension Settings

```json
{
    // Onboarding
    "dagster.onboarding.completed": true,
    "dagster.onboarding.provider": "ollama",
    
    // Ollama
    "dagster.ollamaModel": "qwen2.5-coder:1.5b",
    "dagster.ollamaUrl": "http://localhost:11434",
    "dagster.preferOllama": true,
    
    // Cloud providers
    "dagster.claudeApiKey": "",
    "dagster.openaiApiKey": "",
    
    // Guidelines
    "dagster.customGuidelinesPath": "",
    "dagster.validateGeneratedCode": true
}
```

### No User Action Required!

Default settings work out of the box:
- ✅ Ollama preferred
- ✅ Recommended model selected
- ✅ Guidelines loaded automatically
- ✅ Validation enabled

## Benefits

### For Users

1. **Faster Setup**: 1 click instead of 5+ steps
2. **Better Guidance**: Visual model selection with size info
3. **Consistent Code**: Generated code follows best practices
4. **Learning Tool**: Guidelines teach proper Dagster patterns
5. **Flexible**: Can use local or cloud AI

### For Extension

1. **Higher Adoption**: Easy setup = more users
2. **Better Quality**: Guidelines ensure good code generation
3. **Reduced Support**: Clear UI reduces confusion
4. **Extensible**: Easy to add more guidelines or models

## Future Enhancements

### Phase 1 (Current)
- ✅ One-click setup
- ✅ Guidelines integration
- ✅ Code validation

### Phase 2 (Next)
- [ ] Auto-detect available system RAM → Suggest appropriate model size
- [ ] One-click model switching
- [ ] Benchmark mode (test different models)
- [ ] Guidelines editor (edit guidelines in UI)

### Phase 3 (Future)
- [ ] Community guidelines (share best practices)
- [ ] Team guidelines (sync across team)
- [ ] Advanced validation (AST-based analysis)
- [ ] Guidelines versioning (track changes)

## Testing

### Manual Testing Checklist

#### Onboarding Flow
- [ ] First-time user sees onboarding screen
- [ ] Can select each model and setup completes
- [ ] Claude setup works with valid API key
- [ ] OpenAI setup works with valid API key
- [ ] Error handling for invalid API keys
- [ ] Skip button works
- [ ] Subsequent opens skip onboarding

#### Guidelines
- [ ] Built-in guidelines load correctly
- [ ] Custom guidelines are detected and loaded
- [ ] Guidelines context is passed to LLM
- [ ] Code validation detects common issues
- [ ] Validation suggestions are helpful

#### Integration
- [ ] Generated code follows guidelines
- [ ] Asset code includes group_name and compute_kind
- [ ] Job code uses proper patterns
- [ ] Validation warnings appear for bad code

## Deployment

### Files Changed/Added

**New Files**:
- `src/core/guidelinesManager.ts`
- `src/core/onboardingManager.ts`
- `src/ui/onboardingHTML.ts`

**Modified Files**:
- `src/providers/askDagsterProvider.ts` (integrate onboarding + guidelines)
- `src/extension.ts` (initialize managers)
- `package.json` (bump version to 0.2.0)

### Package.json Updates

```json
{
  "version": "0.2.0",
  "displayName": "Dagster Power User - Enhanced",
  "description": "..with seamless setup and AI-powered code generation"
}
```

### Release Notes

```markdown
## v0.2.0 - Seamless Onboarding & Guidelines

### 🎉 Major Features
- **One-Click Setup**: Choose your AI provider in seconds
- **Visual Model Selection**: See model sizes and pick what fits your machine
- **Dagster Guidelines Integration**: Generated code follows best practices
- **Code Validation**: Automatic checks for common issues

### 🏠 Local AI (Recommended)
- Easy Ollama setup with size guidance
- 4 model options from 1.5GB to 7.4GB
- 100% free and private

### ☁️ Cloud AI
- One-click Claude setup
- One-click OpenAI setup
- Simple API key entry

### 📚 Best Practices
- Built-in Dagster writing guidelines
- Custom guidelines support
- Auto-validation of generated code
```

## Support & Documentation

### User Guide

Add to README.md:

```markdown
## Getting Started with Ask Dagster

### Setup (1 minute)

1. **Open Ask Dagster** panel (Click 🤖 icon in sidebar)
2. **Choose your AI**:
   - **Local** (Recommended): Click a model size → Done!
   - **Cloud**: Click Claude/OpenAI → Enter API key → Done!
3. **Start asking questions!**

### Recommended Setup

For most users:
- **Model**: qwen2.5-coder:1.5b (1.5GB)
- **Why**: Fast, accurate, runs on any laptop
- **Cost**: $0 forever

### Custom Guidelines

Create `dagster-guidelines.md` in your project root:

```markdown
# Our Team's Dagster Patterns

## Assets
- Always use group_name="DataEngineering"
- Prefix with team name: team_asset_name

## Resources
- Use our custom PostgresResource
```

Ask Dagster will automatically use these!
```

### Troubleshooting

```markdown
## Troubleshooting

### Ollama not detected
1. Install from ollama.com
2. Run `ollama serve` in terminal
3. Restart VS Code

### Model download slow
- Models are 1.5-7GB, first download takes time
- Subsequent uses are instant

### API key not working
- Claude keys start with `sk-ant-`
- OpenAI keys start with `sk-`
- Get keys from console.anthropic.com or platform.openai.com
```

## Conclusion

With these enhancements, Ask Dagster becomes:

1. **Easier**: One-click setup vs multi-step configuration
2. **Smarter**: Guidelines ensure high-quality code generation
3. **More Powerful**: Context-aware with your team's patterns
4. **More Accessible**: Clear model size guidance for all hardware

Users can go from "never used Ask Dagster" to "generating production-quality Dagster code" in under 60 seconds.

---

**Next Steps**: 
1. Test the onboarding flow thoroughly
2. Gather user feedback on model sizes
3. Add telemetry (opt-in) to understand usage patterns
4. Build RAG system (Phase 2 from main enhancement plan)









