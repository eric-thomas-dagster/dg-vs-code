import * as vscode from 'vscode';

export interface AssetNode {
    id: string;
    name: string;
    type: 'asset' | 'job' | 'schedule' | 'sensor' | 'op';
    description?: string;
    group?: string;
    computeKind?: string;
    filePath?: string;
    line?: number;
}

export interface DependencyEdge {
    from: string;
    to: string;
    type: 'dependency' | 'schedule_target' | 'sensor_target' | 'job_asset';
}

export class DependencyGraphWebview {
    private panel: vscode.WebviewPanel | undefined;
    private readonly extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    public async showGraph(focusAsset?: string): Promise<void> {
        // Create or show webview panel
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'dagsterDependencyGraph',
                '📊 Dagster Dependency Graph',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'navigateToAsset':
                        await this.navigateToAsset(message.assetName);
                        break;
                    case 'refreshGraph':
                        await this.updateGraph();
                        break;
                    case 'focusAsset':
                        await this.updateGraph(message.assetName);
                        break;
                }
            });
        }

        // Update the webview content
        await this.updateGraph(focusAsset);
    }

    private async updateGraph(focusAsset?: string): Promise<void> {
        if (!this.panel) return;

        // Analyze workspace for assets and dependencies
        const { nodes, edges } = await this.analyzeWorkspace();
        
        // Generate HTML content
        const html = this.getWebviewContent(nodes, edges, focusAsset);
        this.panel.webview.html = html;
    }

    private async analyzeWorkspace(): Promise<{ nodes: AssetNode[], edges: DependencyEdge[] }> {
        const nodes: AssetNode[] = [];
        const edges: DependencyEdge[] = [];
        const assetMap = new Map<string, AssetNode>();

        try {
            // Find all Python files in workspace
            const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 100);
            console.log(`🔍 Found ${pythonFiles.length} Python files for analysis`);

            for (const file of pythonFiles) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                const lines = text.split('\n');

                    console.log(`📝 Analyzing file: ${file.fsPath}`);
                    // Parse assets, jobs, schedules, sensors
                    await this.parseEntitiesFromDocument(document, lines, nodes, edges, assetMap);
                } catch (error) {
                    console.warn(`Error parsing file ${file.fsPath}:`, error);
                }
            }

            console.log(`✅ Analysis complete: ${nodes.length} nodes, ${edges.length} edges`);
            console.log('Nodes found:', nodes.map(n => `${n.name} (${n.type})`));
            return { nodes, edges };
        } catch (error) {
            console.error('Error analyzing workspace:', error);
            return { nodes: [], edges: [] };
        }
    }

    private async parseEntitiesFromDocument(
        document: vscode.TextDocument,
        lines: string[],
        nodes: AssetNode[],
        edges: DependencyEdge[],
        assetMap: Map<string, AssetNode>
    ): Promise<void> {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Look for Dagster decorators
            const decoratorMatch = line.match(/@(?:\w+\.)?(asset|job|schedule|sensor|op|solid)(?:\s*\(|$)/);
            if (decoratorMatch) {
                console.log(`🎯 Found decorator: ${line.trim()} -> ${decoratorMatch[1]}`);
                const entityType = decoratorMatch[1] as 'asset' | 'job' | 'schedule' | 'sensor' | 'op';
                
                // Find function name
                let functionName: string | undefined;
                let description: string | undefined;
                let group: string | undefined;
                let computeKind: string | undefined;
                let deps: string[] = [];
                let targetJob: string | undefined;
                let targetAssets: string[] = [];

                // Look for function definition
                for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
                    const funcMatch = lines[j].match(/def\s+(\w+)\s*\(/);
                    if (funcMatch) {
                        functionName = funcMatch[1];
                        console.log(`📍 Found function: ${functionName} for ${entityType}`);
                        break;
                    }
                }

                if (!functionName) {
                    console.log(`❌ No function found for decorator: ${line.trim()}`);
                    continue;
                }

                // Extract decorator parameters
                let decoratorText = '';
                let parenCount = 0;
                let foundOpenParen = false;

                for (let k = i; k < Math.min(i + 10, lines.length); k++) {
                    const currentLine = lines[k];
                    decoratorText += currentLine + '\n';

                    for (const char of currentLine) {
                        if (char === '(') {
                            foundOpenParen = true;
                            parenCount++;
                        } else if (char === ')') {
                            parenCount--;
                        }
                    }

                    if (foundOpenParen && parenCount === 0) {
                        break;
                    }
                }

                // Parse decorator parameters
                this.parseDecoratorParams(decoratorText, entityType, {
                    deps, group, computeKind, targetJob, targetAssets, description
                });

                // Extract docstring
                description = description || this.extractDocstring(lines, i + 1);

                // Create node
                // Check for duplicates before adding
                if (!assetMap.has(functionName)) {
                    const node: AssetNode = {
                        id: functionName,
                        name: functionName,
                        type: entityType,
                        description,
                        group,
                        computeKind,
                        filePath: document.uri.fsPath,
                        line: i
                    };

                    nodes.push(node);
                    assetMap.set(functionName, node);
                } else {
                    console.log(`⚠️ Skipping duplicate node: ${functionName} in ${document.fileName}`);
                }

                // Create dependency edges
                if (entityType === 'asset' && deps.length > 0) {
                    console.log(`🔗 Creating ${deps.length} edges for ${functionName}: ${deps.join(', ')}`);
                    deps.forEach(dep => {
                        console.log(`  📍 Edge: ${dep} -> ${functionName}`);
                        edges.push({
                            from: dep,
                            to: functionName,
                            type: 'dependency'
                        });
                    });
                } else if (entityType === 'asset') {
                    console.log(`ℹ️ Asset ${functionName} has no dependencies`);
                } else if (entityType === 'schedule' && targetJob) {
                    edges.push({
                        from: functionName,
                        to: targetJob,
                        type: 'schedule_target'
                    });
                } else if (entityType === 'sensor') {
                    if (targetJob) {
                        edges.push({
                            from: functionName,
                            to: targetJob,
                            type: 'sensor_target'
                        });
                    }
                    targetAssets.forEach(asset => {
                        edges.push({
                            from: functionName,
                            to: asset,
                            type: 'sensor_target'
                        });
                    });
                }
            }
        }
    }

    private parseDecoratorParams(decoratorText: string, entityType: string, params: any): void {
        // Parse deps (multiple patterns)
        console.log(`🔍 Parsing decorator for deps: ${decoratorText.substring(0, 150)}...`);
        
        // Pattern 1: deps=[asset1, asset2]
        let depsMatch = decoratorText.match(/deps\s*=\s*\[(.*?)\]/s);
        if (!depsMatch) {
            // Pattern 2: deps=["asset1", "asset2"] (quoted)
            depsMatch = decoratorText.match(/deps\s*=\s*\[\s*["']([^"'\]]+)["']\s*(?:,\s*["']([^"'\]]+)["']\s*)*\]/s);
        }
        if (!depsMatch) {
            // Pattern 3: Look for function parameters that might be dependencies
            const paramMatch = decoratorText.match(/\(\s*([^)]+)\s*\)/s);
            if (paramMatch) {
                // Check if it's just a simple asset reference like @dg.asset(raw_data)
                const simpleRef = paramMatch[1].match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
                if (simpleRef) {
                    params.deps = [simpleRef[1]];
                    console.log(`📦 Found simple asset dependency: ${simpleRef[1]}`);
                    return;
                }
            }
        }
        
        if (depsMatch) {
            const depsContent = depsMatch[1];
            console.log(`🔍 Found deps content: "${depsContent}"`);
            
            // Extract asset names (handle both quoted and unquoted)
            const assetRefs = depsContent.match(/["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/g);
            if (assetRefs) {
                const cleanRefs = assetRefs.map(ref => ref.replace(/["']/g, '').trim()).filter(ref => ref);
                console.log(`📦 Extracted asset refs: ${cleanRefs.join(', ')}`);
                params.deps = cleanRefs;
            } else {
                console.log(`❌ No asset refs found in deps content`);
            }
        } else {
            console.log(`ℹ️ No deps found in decorator`);
        }

        // Parse group
        const groupMatch = decoratorText.match(/group_name\\s*=\\s*["']([^"']+)["']/);
        if (groupMatch) {
            params.group = groupMatch[1];
        }

        // Parse compute kind
        const kindMatch = decoratorText.match(/compute_kind\\s*=\\s*["']([^"']+)["']/);
        if (kindMatch) {
            params.computeKind = kindMatch[1];
        }

        // Parse target job (for schedules/sensors)
        const jobMatch = decoratorText.match(/job\\s*=\\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (jobMatch) {
            params.targetJob = jobMatch[1];
        }

        // Parse target assets (for sensors)
        const assetSelectionMatch = decoratorText.match(/asset_selection\s*=\s*\[(.*?)\]/s);
        if (assetSelectionMatch) {
            const assetsContent = assetSelectionMatch[1];
            const assetRefs = assetsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
            if (assetRefs) {
                params.targetAssets = assetRefs;
            }
        }
    }

    private extractDocstring(lines: string[], startLine: number): string | undefined {
        for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('"""') || line.startsWith("'''")) {
                const quote = line.startsWith('"""') ? '"""' : "'''";
                
                // Single line docstring
                if (line.endsWith(quote) && line.length > 6) {
                    return line.slice(3, -3).trim();
                }
                
                // Multi-line docstring
                let docstring = line.slice(3);
                for (let j = i + 1; j < lines.length; j++) {
                    const docLine = lines[j];
                    if (docLine.includes(quote)) {
                        docstring += ' ' + docLine.substring(0, docLine.indexOf(quote)).trim();
                        break;
                    }
                    docstring += ' ' + docLine.trim();
                }
                return docstring.trim();
            }
        }
        return undefined;
    }

    private async navigateToAsset(assetName: string): Promise<void> {
        try {
            // Find the asset definition
            const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 50);
            
            for (const file of pythonFiles) {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                // Look for the asset definition
                const lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.includes('@asset') || line.includes('@dg.asset')) {
                        // Check if this is our asset
                        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                            const funcMatch = lines[j].match(/def\s+(\w+)\s*\(/);
                            if (funcMatch && funcMatch[1] === assetName) {
                                // Found it! Navigate to the definition
                                const position = new vscode.Position(j, 0);
                                const location = new vscode.Location(document.uri, position);
                                
                                await vscode.window.showTextDocument(document.uri, {
                                    selection: new vscode.Range(position, position)
                                });
                                return;
                            }
                        }
                    }
                }
            }
            
            vscode.window.showWarningMessage(`Asset '${assetName}' not found in workspace`);
        } catch (error) {
            console.error('Error navigating to asset:', error);
            vscode.window.showErrorMessage(`Failed to navigate to asset '${assetName}'`);
        }
    }

    private getWebviewContent(nodes: AssetNode[], edges: DependencyEdge[], focusAsset?: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dagster Dependency Graph</title>
    <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style>
        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .controls {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        
        .control-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        select, input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
        }
        
        #graph {
            width: 100%;
            height: 600px;
            border: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
            border-radius: 8px;
        }
        
        .legend {
            margin-top: 20px;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            font-size: 12px;
        }
        
        .legend-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .legend-color {
            width: 16px;
            height: 16px;
            border-radius: 8px;
        }
        
        .stats {
            margin-top: 20px;
            padding: 10px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div style="padding: 16px 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 16px;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: var(--vscode-editor-foreground); display: flex; align-items: center; gap: 8px;">
            📊 Global Asset Lineage
        </h1>
        <p style="margin: 8px 0 0 0; color: var(--vscode-descriptionForeground); font-size: 14px;" id="statsText">
            Loading assets...
        </p>
    </div>
    
    <div class="controls">
        <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap; padding: 16px; background: var(--vscode-editorWidget-background); border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--vscode-panel-border);">
            <div style="display: flex; align-items: center; gap: 8px;">
                <label for="typeFilter" style="font-weight: 500; color: var(--vscode-editor-foreground);">Filter:</label>
                <select id="typeFilter" onchange="filterByType()" style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground);">
                    <option value="all">All Types</option>
                    <option value="asset">📊 Assets</option>
                    <option value="job">⚙️ Jobs</option>
                    <option value="schedule">📅 Schedules</option>
                    <option value="sensor">📡 Sensors</option>
                    <option value="op">🔧 Ops</option>
                </select>
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px;">
                <label for="focusInput" style="font-weight: 500; color: var(--vscode-editor-foreground);">Focus:</label>
                <input type="text" id="focusInput" placeholder="Enter asset name..." style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); min-width: 160px;">
                <button onclick="focusAsset()" style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer;">Focus</button>
            </div>
            
            <div style="display: flex; gap: 8px;">
                <button onclick="resetView()" style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer;">Reset View</button>
                <button onclick="refreshGraph()" style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--vscode-button-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer;">🔄 Refresh</button>
            </div>
        </div>
    </div>
    
    <div id="graph"></div>
    
    <div class="legend">
        <div class="legend-item">
            <div class="legend-color" style="background-color: #4CAF50;"></div>
            <span>Assets</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background-color: #2196F3;"></div>
            <span>Jobs</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background-color: #FF9800;"></div>
            <span>Schedules</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background-color: #9C27B0;"></div>
            <span>Sensors</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background-color: #607D8B;"></div>
            <span>Ops</span>
        </div>
    </div>
    
    <div class="stats">
        <strong>Graph Statistics:</strong>
        <span id="stats">Loading...</span>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // Raw data from VS Code
        const rawNodes = ${JSON.stringify(nodes)};
        const rawEdges = ${JSON.stringify(edges)};
        
        let network;
        let allNodes, allEdges;
        
        function initializeGraph() {
            // Prepare nodes for vis.js with Dagster-like styling
            allNodes = new vis.DataSet(rawNodes.map(node => ({
                id: node.id,
                label: node.name,
                title: createTooltip(node),
                color: getDagsterNodeColor(node.type),
                shape: 'box',
                font: { 
                    color: '#2D3748',
                    size: 14,
                    face: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
                },
                borderWidth: 2,
                margin: 15,
                widthConstraint: { minimum: 120, maximum: 200 },
                heightConstraint: { minimum: 40, maximum: 60 },
                shapeProperties: {
                    borderRadius: 8
                }
            })));
            
            // Prepare edges for vis.js with Dagster-like styling
            allEdges = new vis.DataSet(rawEdges.map(edge => ({
                from: edge.from,
                to: edge.to,
                arrows: {
                    to: {
                        enabled: true,
                        type: 'arrow',
                        scaleFactor: 1.2
                    }
                },
                color: { 
                    color: '#A0AEC0', 
                    highlight: '#4A5568',
                    opacity: 0.8
                },
                width: 2,
                smooth: { 
                    type: 'cubicBezier', 
                    forceDirection: 'horizontal',
                    roundness: 0.4
                },
                font: { size: 10, color: '#4A5568' }
            })));
            
            const data = { nodes: allNodes, edges: allEdges };
            const options = {
                physics: {
                    enabled: true,
                    stabilization: { iterations: 150 },
                    hierarchicalRepulsion: {
                        nodeDistance: 150,
                        centralGravity: 0.3,
                        springLength: 100,
                        springConstant: 0.01,
                        damping: 0.09
                    }
                },
                layout: {
                    hierarchical: {
                        direction: 'LR',
                        sortMethod: 'directed',
                        levelSeparation: 200,
                        nodeSpacing: 120,
                        treeSpacing: 150,
                        blockShifting: true,
                        edgeMinimization: true,
                        parentCentralization: true
                    }
                },
                interaction: {
                    hover: true,
                    hoverConnectedEdges: true,
                    selectConnectedEdges: false,
                    tooltipDelay: 200
                },
                nodes: {
                    font: { 
                        size: 14,
                        face: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
                    },
                    margin: 15
                },
                edges: {
                    smooth: { 
                        type: 'cubicBezier', 
                        forceDirection: 'horizontal',
                        roundness: 0.4
                    }
                }
            };
            
            const container = document.getElementById('graph');
            if (!container) {
                console.error('Graph container not found!');
                return;
            }
            
            try {
                network = new vis.Network(container, data, options);
                console.log('✅ Network created successfully');
            } catch (error) {
                console.error('❌ Error creating network:', error);
                return;
            }
            
            // Handle node clicks
            network.on('click', function(params) {
                if (params.nodes.length > 0) {
                    const nodeId = params.nodes[0];
                    vscode.postMessage({
                        command: 'navigateToAsset',
                        assetName: nodeId
                    });
                }
            });
            
            // Focus on specific asset if provided
            ${focusAsset ? `focusOnAsset('${focusAsset}');` : ''}
            
            updateStats();
        }
        
        function createTooltip(node) {
            let tooltip = \`<strong>\${node.name}</strong> (\${node.type})<br>\`;
            if (node.description) tooltip += \`\${node.description}<br>\`;
            if (node.group) tooltip += \`Group: \${node.group}<br>\`;
            if (node.computeKind) tooltip += \`Compute Kind: \${node.computeKind}<br>\`;
            tooltip += \`File: \${node.filePath?.split('/').pop() || 'Unknown'}\`;
            return tooltip;
        }
        
        function getDagsterNodeColor(type) {
            // Dagster-inspired color scheme with background and border
            const colors = {
                asset: {
                    background: '#F7FAFC',
                    border: '#3182CE',
                    highlight: { background: '#EDF2F7', border: '#2B6CB0' }
                },
                job: {
                    background: '#F0FFF4',
                    border: '#38A169',
                    highlight: { background: '#E6FFFA', border: '#2F855A' }
                },
                schedule: {
                    background: '#FFFAF0',
                    border: '#ED8936',
                    highlight: { background: '#FEF5E7', border: '#C05621' }
                },
                sensor: {
                    background: '#FAF5FF',
                    border: '#805AD5',
                    highlight: { background: '#F0E6FF', border: '#6B46C1' }
                },
                op: {
                    background: '#F7FAFC',
                    border: '#4A5568',
                    highlight: { background: '#EDF2F7', border: '#2D3748' }
                }
            };
            return colors[type] || {
                background: '#F7FAFC',
                border: '#718096',
                highlight: { background: '#EDF2F7', border: '#4A5568' }
            };
        }
        
        function getNodeShape(type) {
            const shapes = {
                asset: 'box',
                job: 'ellipse',
                schedule: 'diamond',
                sensor: 'triangle',
                op: 'circle'
            };
            return shapes[type] || 'circle';
        }
        
        function getEdgeColor(type) {
            const colors = {
                dependency: '#4CAF50',
                schedule_target: '#FF9800',
                sensor_target: '#9C27B0',
                job_asset: '#2196F3'
            };
            return colors[type] || '#666666';
        }
        
        function getEdgeWidth(type) {
            return type === 'dependency' ? 3 : 2;
        }
        
        function getEdgeLabel(type) {
            const labels = {
                dependency: '',
                schedule_target: 'schedules',
                sensor_target: 'monitors',
                job_asset: 'contains'
            };
            return labels[type] || '';
        }
        
        function filterByType() {
            if (!allNodes) {
                console.error('Nodes dataset not initialized');
                return;
            }
            
            const typeFilter = document.getElementById('typeFilter').value;
            
            if (typeFilter === 'all') {
                allNodes.update(rawNodes.map(node => ({ id: node.id, hidden: false })));
            } else {
                allNodes.update(rawNodes.map(node => ({ 
                    id: node.id, 
                    hidden: node.type !== typeFilter 
                })));
            }
            
            updateStats();
        }
        
        function focusAsset() {
            const assetName = document.getElementById('focusInput').value.trim();
            if (assetName) {
                focusOnAsset(assetName);
            }
        }
        
        function focusOnAsset(assetName) {
            if (!network) {
                console.error('Network not initialized');
                return;
            }
            try {
                network.focus(assetName, {
                    scale: 1.5,
                    animation: true
                });
                
                // Highlight the focused node
                network.selectNodes([assetName]);
            } catch (error) {
                console.warn(\`Asset '\${assetName}' not found in graph\`);
            }
        }
        
        function resetView() {
            if (!network) {
                console.error('Network not initialized');
                return;
            }
            network.fit({
                animation: true
            });
            network.unselectAll();
            document.getElementById('typeFilter').value = 'all';
            document.getElementById('focusInput').value = '';
            filterByType();
        }
        
        function refreshGraph() {
            vscode.postMessage({
                command: 'refreshGraph'
            });
        }
        
        function updateStats() {
            const statsElement = document.getElementById('statsText');
            if (statsElement && rawNodes) {
                const assetCount = rawNodes.filter(n => n.type === 'asset').length;
                const jobCount = rawNodes.filter(n => n.type === 'job').length;
                const scheduleCount = rawNodes.filter(n => n.type === 'schedule').length;
                const sensorCount = rawNodes.filter(n => n.type === 'sensor').length;
                const opCount = rawNodes.filter(n => n.type === 'op').length;
                const totalCount = rawNodes.length;
                
                const stats = [];
                if (assetCount > 0) stats.push(\`\${assetCount} asset\${assetCount !== 1 ? 's' : ''}\`);
                if (jobCount > 0) stats.push(\`\${jobCount} job\${jobCount !== 1 ? 's' : ''}\`);
                if (scheduleCount > 0) stats.push(\`\${scheduleCount} schedule\${scheduleCount !== 1 ? 's' : ''}\`);
                if (sensorCount > 0) stats.push(\`\${sensorCount} sensor\${sensorCount !== 1 ? 's' : ''}\`);
                if (opCount > 0) stats.push(\`\${opCount} op\${opCount !== 1 ? 's' : ''}\`);
                
                statsElement.textContent = \`Showing \${stats.join(', ')} (\${totalCount} total entities)\`;
            }
        }
        
        // Set up event listeners
        document.getElementById('typeFilter').addEventListener('change', filterByType);
        
        // Initialize the graph
        initializeGraph();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.panel?.dispose();
    }
}
