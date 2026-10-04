import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

export class SemanticSearch {
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    /**
     * Search Dagster documentation for relevant information
     */
    async searchDagsterDocs(query: string, maxResults: number = 10): Promise<string[]> {
        const relevantDocs = [
            { url: 'https://docs.dagster.io/llms.txt', topic: 'LLM Integration' },
            { url: 'https://docs.dagster.io/llms-full.txt', topic: 'Comprehensive LLM Docs' },
            { url: 'https://docs.dagster.io/concepts', topic: 'Core Concepts' },
            { url: 'https://docs.dagster.io/api', topic: 'API Reference' },
            { url: 'https://docs.dagster.io/integrations', topic: 'Integrations' }
        ];

        const results: string[] = [];
        
        // Use LLM to do semantic matching
        const searchPrompt = `Based on this query: "${query}"

Which of these Dagster documentation topics are most relevant?
- LLM Integration (llms.txt)
- Comprehensive LLM Docs (llms-full.txt)  
- Core Concepts
- API Reference
- Integrations

Return the 2 most relevant topics and briefly explain why.`;

        // For now, use simple keyword matching (we can enhance with LLM later)
        const lowerQuery = query.toLowerCase();
        
        for (const doc of relevantDocs) {
            if (this._isRelevant(lowerQuery, doc.topic)) {
                results.push(`📚 **${doc.topic}**: ${doc.url}\n`);
            }
        }

        return results.slice(0, maxResults);
    }

    private _isRelevant(query: string, topic: string): boolean {
        const lowerTopic = topic.toLowerCase();
        
        // Simple keyword matching for now
        if (query.includes('llm') || query.includes('ai') || query.includes('prompt')) {
            return lowerTopic.includes('llm');
        }
        
        if (query.includes('integration') || query.includes('connector') || query.includes('fivetran') || query.includes('dbt')) {
            return lowerTopic.includes('integration');
        }
        
        if (query.includes('asset') || query.includes('definition') || query.includes('job') || query.includes('schedule')) {
            return lowerTopic.includes('concept') || lowerTopic.includes('api');
        }
        
        return false;
    }

    /**
     * Fetch content from a URL (for loading full documentation)
     */
    async fetchDocumentation(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            
            client.get(url, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve(data);
                });
                
            }).on('error', (err) => {
                console.error(`Failed to fetch ${url}:`, err);
                reject(err);
            });
        });
    }

    /**
     * Search the user's workspace for relevant examples
     */
    async searchWorkspace(query: string): Promise<string[]> {
        // Search for relevant files in the workspace
        const pattern = '**/*.{py,toml,yaml,yml}';
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 10);
        
        const results: string[] = [];
        
        for (const file of files) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const content = doc.getText();
                
                if (this._contentMatches(query, content)) {
                    results.push(`📄 ${file.fsPath}: ...${content.substring(0, 200)}...`);
                }
            } catch (e) {
                // Ignore files that can't be read
            }
        }
        
        return results;
    }

    private _contentMatches(query: string, content: string): boolean {
        const lowerQuery = query.toLowerCase();
        const lowerContent = content.toLowerCase();
        
        const keywords = lowerQuery.split(/\s+/);
        
        // Check if at least 2 keywords match
        let matches = 0;
        for (const keyword of keywords) {
            if (lowerContent.includes(keyword)) {
                matches++;
            }
        }
        
        return matches >= Math.min(2, keywords.length);
    }

    /**
     * Get semantic context for a question
     */
    async getContext(question: string): Promise<string> {
        const lowerQuestion = question.toLowerCase();
        let context = '';

        // Get relevant documentation links
        const docResults = await this.searchDagsterDocs(question, 3);
        if (docResults.length > 0) {
            context += '\n📚 **Relevant Documentation for this request:**\n';
            context += docResults.join('\n');
        }

        // Search workspace for relevant examples if searching for similar code
        if (lowerQuestion.includes('example') || lowerQuestion.includes('similar') || lowerQuestion.includes('like')) {
            const workspaceResults = await this.searchWorkspace(question);
            if (workspaceResults.length > 0) {
                context += '\n\n📄 **Similar examples in your workspace:**\n';
                context += workspaceResults.slice(0, 2).join('\n');
            }
        }

        return context;
    }
}

