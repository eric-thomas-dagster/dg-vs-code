import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Enhanced context manager that loads ALL available documentation
 * to provide rich context to LLMs for maximum quality responses
 */
export class ContextManager {
    private loadedContext: string = '';
    private loaded: boolean = false;

    constructor() {}

    /**
     * Load all available context files
     */
    async loadAllContext(): Promise<string> {
        if (this.loaded && this.loadedContext) {
            return this.loadedContext;
        }

        console.log('📚 Loading essential context with documentation references...');
        
        const contextPieces: string[] = [];

        // 1. Load user's custom guidelines (dagster-writing-guidelines.md) - KEEP THIS FULL
        const customGuidelines = await this.loadCustomGuidelines();
        if (customGuidelines) {
            console.log('✅ Loaded custom guidelines');
            // Limit to 8000 chars to keep it manageable
            const limitedGuidelines = customGuidelines.length > 8000 
                ? customGuidelines.substring(0, 8000) + '\n\n... (guidelines truncated)'
                : customGuidelines;
            contextPieces.push('## YOUR CUSTOM GUIDELINES:\n' + limitedGuidelines);
        }

        // 2. Add references to Dagster documentation (don't load content)
        contextPieces.push(`
## DOCUMENTATION REFERENCES:

**Essential Dagster Resources:**
- Documentation Index: https://docs.dagster.io/llms.txt (knowledge base manifest)
- Full Documentation: https://docs.dagster.io/llms-full.txt (complete reference)
- API Reference: https://docs.dagster.io/api
- Integrations: https://docs.dagster.io/integrations
- Guides: https://docs.dagster.io/guides

**When generating code, reference these docs for:**
- Asset definitions: https://docs.dagster.io/api/dagster/assets
- Schedules & Sensors: https://docs.dagster.io/api/dagster/schedules-sensors
- Resources: https://docs.dagster.io/api/dagster/resources
- Components: https://docs.dagster.io/api/dagster/components
- DBT integration: https://docs.dagster.io/integrations/libraries/dbt
- BigQuery: https://docs.dagster.io/integrations/libraries/gcp/bigquery

**Note:** Use these links to find the correct patterns and best practices when generating code.
        `);

        this.loadedContext = contextPieces.join('\n\n---\n\n');
        this.loaded = true;

        console.log(`📚 Total context loaded: ${this.loadedContext.length} characters`);
        
        return this.loadedContext;
    }

    private async loadCustomGuidelines(): Promise<string | null> {
        try {
            const downloadsPath = path.join(process.env.HOME || '~', 'Downloads');
            const guidelinesFile = path.join(downloadsPath, 'dagster-writing-guidelines (1).md');
            
            if (fs.existsSync(guidelinesFile)) {
                const content = fs.readFileSync(guidelinesFile, 'utf-8');
                console.log('📄 Loaded custom guidelines:', guidelinesFile);
                return content;
            }
        } catch (error) {
            console.log('⚠️ Could not load custom guidelines:', error);
        }
        
        return null;
    }

    // Removed loadLLMSTxt, loadDownloadsDocs, loadDagsterDocs - now using URL references instead

    /**
     * Get context formatted for LLM
     */
    async getContextForPrompt(): Promise<string> {
        const allContext = await this.loadAllContext();
        
        // With URL references instead of full content, context should be ~10-15KB max
        // But add safety check just in case
        if (allContext.length > 20000) {
            console.log(`⚠️ Context too large (${allContext.length} chars), truncating to 20000`);
            return allContext.substring(0, 20000) + '\n\n... (context truncated for API limits)';
        }
        
        return allContext;
    }
}

