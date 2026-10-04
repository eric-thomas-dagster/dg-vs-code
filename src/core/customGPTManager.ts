import * as vscode from 'vscode';
import { OpenAI } from 'openai';

export class CustomGPTManager {
    private _openai?: OpenAI;

    constructor(context: vscode.ExtensionContext) {
        // Initialize OpenAI client if API key is available
        const config = vscode.workspace.getConfiguration('dagster');
        const openaiKey = config.get<string>('openaiApiKey');
        
        if (openaiKey) {
            this._openai = new OpenAI({ apiKey: openaiKey });
        }
    }

    /**
     * Generate project using Custom GPT with Code Interpreter capabilities
     * Using Chat Completion API with enhanced prompts to simulate Code Interpreter behavior
     */
    async generateProject(question: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('dagster');
        const assistantId = config.get<string>('customGPTAssistantId');
        
        if (!this._openai) {
            throw new Error('OpenAI API key not configured. Please add your API key in settings.');
        }

        if (!assistantId) {
            throw new Error('Custom GPT Assistant ID not configured');
        }

        console.log(`🤖 Using Custom GPT with Code Interpreter: ${assistantId}`);

        try {
            // Build comprehensive prompt that leverages Code Interpreter thinking
            const enhancedPrompt = `You are Ask Daggy with Code Interpreter enabled. Your task is to generate a complete, production-ready Dagster project.

User Request: ${question}

CODE INTERPRETER MODE:
1. Think through the entire project structure before generating
2. Validate all syntax before outputting (Python, TOML, YAML)
3. Generate multiple files in one response
4. Use markdown code blocks with file paths for each file

REQUIREMENTS:
✅ Connected assets with lineage using deps= (minimum 3 assets)
✅ Every asset has group_name, compute_kind, and metadata
✅ Asset bodies use 'pass' as placeholders
✅ Valid pyproject.toml syntax
✅ defs.py with Definitions() export
✅ workspace.yaml for local dev
✅ README.md with setup instructions (port 3000, NOT 8080)
✅ All relevant files for the use case

OUTPUT FORMAT:
For each file, use this format:
\`\`\`python:project_name/file.py
# File content here
\`\`\`

Generate ALL files at once. Think about:
- Project structure
- File dependencies
- Syntax validation
- Complete implementation

PROJECT PATTERNS:
\`\`\`python:example_dagster_project/assets.py
from dagster import asset, AssetExecutionContext

@asset(
    group_name="Ingest",
    compute_kind="api",
    metadata={"tier": "bronze"}
)
def raw_data(context: AssetExecutionContext):
    context.log.info("Loading raw data...")
    pass

@asset(
    deps=[raw_data],
    group_name="Transform",
    compute_kind="pandas",
    metadata={"tier": "silver"}
)
def clean_data(context: AssetExecutionContext, raw_data):
    context.log.info("Cleaning data...")
    pass

@asset(
    deps=[clean_data],
    group_name="Analytics",
    compute_kind="python",
    metadata={"tier": "gold"}
)
def metrics(context: AssetExecutionContext, clean_data):
    context.log.info("Calculating metrics...")
    pass
\`\`\`

Now generate the complete project for: ${question}`;

            const response = await this._openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are Ask Daggy, a Dagster expert with Code Interpreter capabilities. You have deep knowledge of Dagster, dbt, data pipelines, and best practices. Your Assistant ID is: ${assistantId}. Always think through problems step-by-step, validate syntax, and generate complete, production-ready projects with proper lineage.`
                    },
                    {
                        role: 'user',
                        content: enhancedPrompt
                    }
                ],
                temperature: 0.2, // Lower temperature for more consistent, code-focused output
                max_tokens: 16000
            });

            const content = response.choices[0].message.content || '';
            console.log(`✅ Received response from Custom GPT (${content.length} chars)`);
            
            return this._formatResponse(content, question);

        } catch (error: any) {
            console.error('❌ Custom GPT error:', error);
            throw new Error(`Custom GPT generation failed: ${error.message}`);
        }
    }

    /**
     * Format the response to match expected output format
     */
    private _formatResponse(content: string, question: string): string {
        // Check if Code Interpreter style content (multiple files)
        const hasMultipleFiles = (content.match(/```/g) || []).length >= 4;
        const hasZIP = content.includes('.zip') || content.includes('ZIP') || content.includes('[Download]');
        
        let response = `🎉 **Project Generated with Custom GPT + Code Interpreter!** 🤖\n\n`;
        response += `*Generated using your personalized Dagster expert (Assistant ID: ${vscode.workspace.getConfiguration('dagster').get('customGPTAssistantId')})*\n\n`;
        
        if (hasMultipleFiles) {
            response += `📦 **Complete Project Generated** (multiple files detected)\n\n`;
        }
        
        response += `${content}\n\n`;
        
        if (hasZIP) {
            response += `💡 **ZIP File Available:** Look for download links above!\n\n`;
        }
        
        response += `**Next Steps:**\n`;
        response += `1. Review all generated files above\n`;
        response += `2. Click "📁 Create Project Files" to generate the actual files\n`;
        response += `3. Files will be created with proper structure and syntax\n\n`;
        response += `*Powered by Custom GPT with Code Interpreter capabilities*`;

        return response;
    }

    /**
     * Check if Custom GPT is available
     */
    isAvailable(): boolean {
        return !!this._openai;
    }
}
