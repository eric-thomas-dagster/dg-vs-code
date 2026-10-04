// Lineage webview JavaScript for Dagster Power User extension

(function() {
    const vscode = acquireVsCodeApi();
    
    let currentData = null;
    let focusAsset = null;

    // DOM elements
    const loadingContainer = document.getElementById('loadingContainer');
    const errorContainer = document.getElementById('errorContainer');
    const errorText = document.getElementById('errorText');
    const lineageContainer = document.getElementById('lineageContainer');
    const lineageGraph = document.getElementById('lineageGraph');
    const assetSelect = document.getElementById('assetSelect');
    const refreshBtn = document.getElementById('refreshBtn');
    const openDagsterBtn = document.getElementById('openDagsterBtn');

    // Event listeners
    refreshBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'refreshLineage' });
    });

    openDagsterBtn.addEventListener('click', () => {
        const webserverUrl = 'http://localhost:3000'; // TODO: Make configurable
        window.open(`${webserverUrl}/asset-groups`, '_blank');
    });

    assetSelect.addEventListener('change', (e) => {
        const selectedAsset = e.target.value;
        focusAsset = selectedAsset || null; // Handle empty string as null
        showDebugInfo(`Asset selected: ${selectedAsset || 'Full Graph'}`);
        
        if (selectedAsset) {
            // Request lineage data for the specific asset from the extension
            showDebugInfo(`Requesting lineage for asset: ${selectedAsset}`);
            vscode.postMessage({ 
                type: 'getAssetLineage', 
                assetKey: selectedAsset 
            });
        } else {
            // Clear lineage data and render full graph
            if (currentData) {
                currentData.lineage = null;
            }
            renderLineageGraph();
        }
    });

    // Message handler
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Webview received message:', message);
        console.log('Message type:', message.type);
        console.log('Message details:', JSON.stringify(message, null, 2));
        
        // Show all messages in debug UI
        showDebugInfo(`MESSAGE RECEIVED: ${message.type} - ${JSON.stringify(message).substring(0, 100)}...`);
        
        switch (message.type) {
            case 'loading':
                console.log('Handling loading message');
                showLoading(message.isLoading);
                break;
            case 'error':
                console.log('Handling error message');
                showError(message.message);
                break;
            case 'lineageData':
                console.log('Handling lineage data');
                handleLineageData(message.data);
                break;
            case 'assetLineageData':
                console.log('Handling asset lineage data for specific asset');
                handleAssetLineageData(message);
                break;
            case 'assetDataRefreshed':
                console.log('Handling asset data refreshed');
                alert('Webview received assetDataRefreshed message with ' + (message.assets ? message.assets.length : 0) + ' assets!');
                handleAssetDataRefreshed(message);
                break;
            case 'refreshError':
                console.log('Handling refresh error');
                showError(message.message);
                break;
            case 'test':
                console.log('Test message received:', message.message);
                alert('Test communication works! ' + message.message);
                break;
            default:
                console.log('Unknown message type:', message.type);
        }
    });

    function showLoading(isLoading) {
        loadingContainer.style.display = isLoading ? 'flex' : 'none';
        lineageContainer.style.display = isLoading ? 'none' : 'flex';
        errorContainer.style.display = 'none';
    }

    function showError(message) {
        errorText.textContent = message;
        errorContainer.style.display = 'flex';
        loadingContainer.style.display = 'none';
        lineageContainer.style.display = 'none';
    }

    function showSuccessMessage(message) {
        // Create or update a success message area
        let successContainer = document.getElementById('successContainer');
        if (!successContainer) {
            successContainer = document.createElement('div');
            successContainer.id = 'successContainer';
            successContainer.className = 'success-container';
            successContainer.innerHTML = `
                <div class="success-message">
                    <span class="codicon codicon-check"></span>
                    <span id="successText"></span>
                </div>
            `;
            document.querySelector('.container').insertBefore(successContainer, lineageContainer);
        }
        
        document.getElementById('successText').textContent = message;
        successContainer.style.display = 'flex';
        
        // Hide after 3 seconds
        setTimeout(() => {
            successContainer.style.display = 'none';
        }, 3000);
    }

    function showWarningMessage(message) {
        // Temporarily show in the no-data area
        const noDataDiv = document.querySelector('.no-data');
        if (noDataDiv) {
            noDataDiv.innerHTML = `
                <span class="codicon codicon-warning"></span>
                <p>${message}</p>
                <button id="startDagsterBtn" class="btn btn-primary">
                    🚀 Start Dagster Dev Server
                </button>
            `;
            attachStartDagsterListener();
        }
    }

    function showDebugInfo(message) {
        // Create or update debug info area
        let debugContainer = document.getElementById('debugContainer');
        if (!debugContainer) {
            debugContainer = document.createElement('div');
            debugContainer.id = 'debugContainer';
            debugContainer.style.cssText = `
                background: #0d1117;
                color: #7d8590;
                padding: 8px;
                margin: 8px 0;
                border-left: 3px solid #30a9f0;
                font-family: 'SF Mono', Consolas, monospace;
                font-size: 12px;
                white-space: pre-wrap;
                max-height: 200px;
                overflow-y: auto;
            `;
            document.querySelector('.container').insertBefore(debugContainer, lineageContainer);
        }
        
        const timestamp = new Date().toLocaleTimeString();
        debugContainer.textContent += `[${timestamp}] ${message}\n`;
        debugContainer.scrollTop = debugContainer.scrollHeight;
    }

    // Expose globally for testing
    window.showDebugInfo = showDebugInfo;

    function handleLineageData(data) {
        showDebugInfo(`handleLineageData called: focusAsset=${data.focusAsset}, assets=${data.assets?.length}, lineage=${data.lineage ? 'present' : 'null'}`);
        
        currentData = data;
        focusAsset = data.focusAsset;
        
        populateAssetSelector(data.assets);
        
        // Update the selector to show the focused asset
        if (focusAsset) {
            assetSelect.value = focusAsset;
        } else {
            assetSelect.value = '';
        }
        
        renderLineageGraph();
        
        loadingContainer.style.display = 'none';
        errorContainer.style.display = 'none';
        lineageContainer.style.display = 'flex';
    }

    function handleAssetLineageData(message) {
        showDebugInfo(`handleAssetLineageData: ${message.assetKey}`);
        
        if (currentData && message.assetKey === focusAsset) {
            // Update the lineage data for the focused asset
            currentData.lineage = message.lineageData;
            renderLineageGraph();
        }
    }

    function handleAssetDataRefreshed(message) {
        console.log('Asset data refreshed:', message);
        
        // Show debug info directly in the UI
        showDebugInfo(`WEBVIEW DEBUG: Received ${message.assets ? message.assets.length : 0} assets at ${new Date().toLocaleTimeString()}`);
        
        // Reset focus when data is refreshed
        focusAsset = null;
        
        // Update the current data with the refreshed assets
        currentData = {
            assets: message.assets || [],
            lineage: null,
            focusAsset: null
        };
        
        populateAssetSelector(currentData.assets);
        
        // Reset the selector to show no asset selected
        assetSelect.value = '';
        
        renderLineageGraph();
        
        // Show success message in the UI
        if (message.assets && message.assets.length > 0) {
            showSuccessMessage(message.message || `Found ${message.assets.length} assets!`);
        } else {
            showWarningMessage(message.message || 'No assets found');
        }
        
        loadingContainer.style.display = 'none';
        errorContainer.style.display = 'none';
        lineageContainer.style.display = 'flex';
    }

    function populateAssetSelector(assets) {
        // Clear existing options except the first one
        assetSelect.innerHTML = '<option value="">🌐 Full Asset Graph (Select asset for focused lineage)</option>';
        
        assets.forEach(asset => {
            const option = document.createElement('option');
            option.value = asset.key;
            option.textContent = asset.key;
            if (asset.key === focusAsset) {
                option.selected = true;
            }
            assetSelect.appendChild(option);
        });
    }

    function renderLineageGraph() {
        if (!currentData || !currentData.assets) {
            lineageGraph.innerHTML = `
                <div class="no-data">
                    <span class="codicon codicon-graph"></span>
                    <p>No lineage data available</p>
                    <p class="subtext">Make sure Dagster is running locally and assets are available</p>
                </div>
            `;
            return;
        }

        if (!focusAsset) {
            // For full graph view, fetch lineage for all assets and render complete graph
            renderFullAssetGraph();
            return;
        }

        // For focused asset view, check if we already have lineage data
        if (currentData.lineage) {
            showDebugInfo(`Using existing lineage data for ${focusAsset}`);
            renderAssetLineage(currentData.lineage);
        } else {
            // Fetch lineage data for the specific asset
            showDebugInfo(`Fetching lineage for focused asset: ${focusAsset}`);
            fetchAndRenderFocusedLineage(focusAsset);
        }
    }

    async function fetchAndRenderFocusedLineage(assetKey) {
        try {
            showDebugInfo(`Fetching lineage for focused asset: ${assetKey}`);
            
            const response = await fetch('http://localhost:3000/graphql', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: `
                        query GetAssetLineage($assetKey: AssetKeyInput!) {
                            assetNodeOrError(assetKey: $assetKey) {
                                ... on AssetNode {
                                    id
                                    assetKey {
                                        path
                                    }
                                    dependencies {
                                        asset {
                                            id
                                            assetKey {
                                                path
                                            }
                                        }
                                    }
                                    dependedBy {
                                        asset {
                                            id
                                            assetKey {
                                                path
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    `,
                    variables: {
                        assetKey: { path: [assetKey] }
                    }
                })
            });

            const result = await response.json();
            if (result.data?.assetNodeOrError) {
                const lineageData = result.data.assetNodeOrError;
                showDebugInfo(`Fetched lineage for ${assetKey}: ${lineageData.dependencies?.length || 0} deps, ${lineageData.dependedBy?.length || 0} dependents`);
                renderAssetLineage(lineageData);
            } else {
                showError(`Failed to fetch lineage for ${assetKey}`);
                renderFullAssetGraph(); // Fall back to full graph
            }
        } catch (error) {
            console.error(`Failed to fetch lineage for ${assetKey}:`, error);
            showError(`Failed to fetch lineage for ${assetKey}: ${error.message}`);
            renderFullAssetGraph(); // Fall back to full graph
        }
    }

    function renderAssetGrid() {
        console.log('renderAssetGrid called, currentData:', currentData);
        const assets = currentData ? currentData.assets : null;
        console.log('Assets to render:', assets);
        
        if (!assets || assets.length === 0) {
            console.log('No assets to display');
            lineageGraph.innerHTML = `
                <div class="no-data">
                    <span class="codicon codicon-graph"></span>
                    <p>No assets found</p>
                    <p class="subtext">Click Refresh to reload asset data</p>
                </div>
            `;
            return;
        }
        
        console.log('Rendering', assets.length, 'assets');
        
        const gridHtml = `
            <div class="graph-container">
                <div class="graph-level">
                    ${assets.map(asset => {
                        const isDbtAsset = asset.key.startsWith('dbt_') || asset.key.startsWith('stg_');
                        const assetType = isDbtAsset ? 'dbt' : 'python';
                        return createAssetNodeHtml(asset, false, assetType);
                    }).join('')}
                </div>
            </div>
        `;
        
        lineageGraph.innerHTML = gridHtml;
        attachAssetNodeListeners();
    }

    async function renderFullAssetGraph() {
        console.log('renderFullAssetGraph called');
        const assets = currentData ? currentData.assets : null;
        
        if (!assets || assets.length === 0) {
            renderAssetGrid();
            return;
        }

        showDebugInfo(`Fetching lineage for ${assets.length} assets...`);

        // Fetch lineage data for all assets
        const allLineageData = {};
        const promises = assets.map(async (asset) => {
            try {
                const response = await fetch('http://localhost:3000/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `
                            query GetAssetLineage($assetKey: AssetKeyInput!) {
                                assetNodeOrError(assetKey: $assetKey) {
                                    ... on AssetNode {
                                        id
                                        assetKey {
                                            path
                                        }
                                        dependencies {
                                            asset {
                                                id
                                                assetKey {
                                                    path
                                                }
                                            }
                                        }
                                        dependedBy {
                                            asset {
                                                id
                                                assetKey {
                                                    path
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        `,
                        variables: {
                            assetKey: { path: [asset.key] }
                        }
                    })
                });

                const result = await response.json();
                if (result.data?.assetNodeOrError) {
                    allLineageData[asset.key] = result.data.assetNodeOrError;
                }
            } catch (error) {
                console.error(`Failed to fetch lineage for ${asset.key}:`, error);
            }
        });

        await Promise.all(promises);
        showDebugInfo(`Fetched lineage for ${Object.keys(allLineageData).length} assets`);

        // Render the complete graph with all connections
        renderCompleteGraph(assets, allLineageData);
    }

    function renderCompleteGraph(assets, allLineageData) {
        showDebugInfo('Rendering complete graph with all connections...');
        
        // Create a topological sort to organize assets by their dependencies
        const assetLevels = calculateAssetLevels(assets, allLineageData);
        
        // Create the HTML structure
        let html = '<div class="graph-container">';
        
        // Add SVG for drawing connections
        html += '<svg class="lineage-connections" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;"></svg>';
        
        // Render assets by level
        assetLevels.forEach((levelAssets, level) => {
            html += `<div class="graph-level" data-level="${level}">`;
            levelAssets.forEach(asset => {
                // Determine asset type for styling
                const isDbtAsset = asset.key.startsWith('dbt_') || asset.key.startsWith('stg_');
                const assetType = isDbtAsset ? 'dbt' : 'python';
                html += createAssetNodeHtml(asset, false, assetType);
            });
            html += '</div>';
        });
        
        html += '</div>';
        lineageGraph.innerHTML = html;
        
        // Attach event listeners
        attachAssetNodeListeners();
        
        // Draw connections after DOM is ready
        setTimeout(() => {
            drawAllConnections(allLineageData);
        }, 100);
    }

    function calculateAssetLevels(assets, allLineageData) {
        const assetMap = new Map(assets.map(a => [a.key, a]));
        const levels = [];
        const processed = new Set();
        const inProgress = new Set();
        
        // Helper function to get dependencies for an asset
        function getDependencies(assetKey) {
            const lineage = allLineageData[assetKey];
            if (!lineage?.dependencies) return [];
            return lineage.dependencies.map(dep => dep.asset.assetKey.path.join('.'));
        }
        
        // Recursive function to calculate level for an asset
        function getAssetLevel(assetKey) {
            if (processed.has(assetKey)) {
                return processed.get(assetKey);
            }
            
            if (inProgress.has(assetKey)) {
                // Circular dependency - place at level 0
                return 0;
            }
            
            inProgress.add(assetKey);
            
            const deps = getDependencies(assetKey);
            let maxDepLevel = -1;
            
            for (const dep of deps) {
                if (assetMap.has(dep)) {
                    maxDepLevel = Math.max(maxDepLevel, getAssetLevel(dep));
                }
            }
            
            const level = maxDepLevel + 1;
            processed.set(assetKey, level);
            inProgress.delete(assetKey);
            
            // Add to levels array
            if (!levels[level]) levels[level] = [];
            levels[level].push(assetMap.get(assetKey));
            
            return level;
        }
        
        // Calculate levels for all assets
        assets.forEach(asset => getAssetLevel(asset.key));
        
        // Filter out empty levels
        return levels.filter(level => level && level.length > 0);
    }

    function drawAllConnections(allLineageData) {
        const svg = document.querySelector('.lineage-connections');
        if (!svg) return;
        
        // Clear existing connections
        svg.innerHTML = '';
        
        // Add arrow marker definitions
        svg.innerHTML = `
            <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                        refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#30a9f0" />
                </marker>
            </defs>
        `;
        
        // Draw connections for each asset
        Object.entries(allLineageData).forEach(([assetKey, lineageData]) => {
            if (lineageData?.dependencies) {
                lineageData.dependencies.forEach(dep => {
                    const fromAsset = dep.asset.assetKey.path.join('.');
                    const toAsset = assetKey;
                    drawConnection(svg, fromAsset, toAsset);
                });
            }
        });
    }

    function drawConnection(svg, fromAssetKey, toAssetKey) {
        const fromElement = document.querySelector(`[data-asset="${fromAssetKey}"]`);
        const toElement = document.querySelector(`[data-asset="${toAssetKey}"]`);
        
        if (!fromElement || !toElement) {
            console.log(`Cannot draw connection: ${fromAssetKey} -> ${toAssetKey} (missing elements)`);
            return;
        }
        
        const svgRect = svg.getBoundingClientRect();
        const fromRect = fromElement.getBoundingClientRect();
        const toRect = toElement.getBoundingClientRect();
        
        // Calculate connection points (bottom center of from, top center of to)
        const fromX = fromRect.left + fromRect.width / 2 - svgRect.left;
        const fromY = fromRect.bottom - svgRect.top;
        const toX = toRect.left + toRect.width / 2 - svgRect.left;
        const toY = toRect.top - svgRect.top;
        
        // Create path element
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Calculate curve for better visualization
        const midY = fromY + (toY - fromY) / 2;
        const pathData = `M ${fromX} ${fromY} Q ${fromX} ${midY} ${toX} ${toY}`;
        
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', '#30a9f0');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', 'url(#arrowhead)');
        
        svg.appendChild(path);
        
        console.log(`Drew connection: ${fromAssetKey} -> ${toAssetKey}`);
    }

    function attachStartDagsterListener() {
        const startBtn = document.getElementById('startDagsterBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'startDagster' });
            });
        }
    }

    function renderAssetLineage(lineageData) {
        const upstreamAssets = lineageData.dependencies || [];
        const downstreamAssets = lineageData.dependedBy || [];
        const focusAssetData = currentData.assets.find(a => a.key === focusAsset);

        let html = '<div class="graph-container">';

        // Upstream assets
        if (upstreamAssets.length > 0) {
            html += `
                <div class="graph-level">
                    ${upstreamAssets.map(dep => {
                        const asset = currentData.assets.find(a => a.key === dep.asset.key.path.join('.'));
                        const assetData = asset || { key: dep.asset.key.path.join('.') };
                        const isDbtAsset = assetData.key.startsWith('dbt_') || assetData.key.startsWith('stg_');
                        const assetType = isDbtAsset ? 'dbt' : 'python';
                        return createAssetNodeHtml(assetData, false, assetType);
                    }).join('')}
                </div>
                <div class="graph-arrows">
                    <span class="codicon codicon-arrow-down"></span>
                </div>
            `;
        }

        // Focus asset
        const focusAssetData_typed = focusAssetData || { key: focusAsset };
        const isFocusDbtAsset = focusAssetData_typed.key.startsWith('dbt_') || focusAssetData_typed.key.startsWith('stg_');
        const focusAssetType = isFocusDbtAsset ? 'dbt' : 'python';
        html += `
            <div class="graph-level">
                ${createAssetNodeHtml(focusAssetData_typed, true, focusAssetType)}
            </div>
        `;

        // Downstream assets
        if (downstreamAssets.length > 0) {
            html += `
                <div class="graph-arrows">
                    <span class="codicon codicon-arrow-down"></span>
                </div>
                <div class="graph-level">
                    ${downstreamAssets.map(dep => {
                        const asset = currentData.assets.find(a => a.key === dep.asset.key.path.join('.'));
                        const assetData = asset || { key: dep.asset.key.path.join('.') };
                        const isDbtAsset = assetData.key.startsWith('dbt_') || assetData.key.startsWith('stg_');
                        const assetType = isDbtAsset ? 'dbt' : 'python';
                        return createAssetNodeHtml(assetData, false, assetType);
                    }).join('')}
                </div>
            `;
        }

        html += '</div>';
        lineageGraph.innerHTML = html;
        attachAssetNodeListeners();
    }

    function createAssetNodeHtml(asset, isFocus = false, assetType = 'python') {
        if (!asset) {
            console.log('Asset is null or undefined');
            return '';
        }

        console.log('Creating asset node for:', asset);
        
        const assetKey = asset.key || 'unknown-asset';
        const hasRecentMaterialization = asset.assetMaterializations && asset.assetMaterializations.length > 0;
        const materializationClass = hasRecentMaterialization ? 'materialized' : 'not-materialized';
        const focusClass = isFocus ? 'focus' : '';
        const typeClass = `asset-type-${assetType}`;
        
        // Asset type indicator
        const typeIndicator = assetType === 'dbt' ? 
            '<span class="asset-type-badge dbt-badge">DBT</span>' : 
            '<span class="asset-type-badge python-badge">Python</span>';
        
        const description = asset.description ? `<div class="asset-details">${asset.description}</div>` : '';
        
        const actions = `
            <div class="asset-actions">
                <button class="asset-action materialize-btn" data-asset="${assetKey}" title="Run ${assetKey}">
                    ▶ Run
                </button>
                <button class="asset-action goto-btn" data-asset="${assetKey}" title="📄 Code">
                    📄 Code
                </button>
            </div>
        `;

        return `
            <div class="asset-node ${materializationClass} ${focusClass} ${typeClass}" data-asset="${assetKey}">
                ${typeIndicator}
                <div class="asset-name">${assetKey}</div>
                ${description}
                ${actions}
            </div>
        `;
    }

    function attachAssetNodeListeners() {
        // Asset node click handlers
        document.querySelectorAll('.asset-node').forEach(node => {
            node.addEventListener('click', (e) => {
                if (e.target.closest('.asset-action')) {
                    return; // Don't handle if clicking on action buttons
                }
                
                const assetKey = node.dataset.asset;
                if (assetKey && assetKey !== focusAsset) {
                    focusAsset = assetKey;
                    assetSelect.value = assetKey;
                    renderLineageGraph();
                }
            });
        });

        // Materialize button handlers
        document.querySelectorAll('.materialize-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const assetKey = btn.dataset.asset;
                vscode.postMessage({ 
                    type: 'materializeAsset', 
                    assetKey: assetKey 
                });
            });
        });

        // Go to definition button handlers
        document.querySelectorAll('.goto-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const assetKey = btn.dataset.asset;
                vscode.postMessage({ 
                    type: 'openAssetDefinition', 
                    assetKey: assetKey 
                });
            });
        });
    }

    // Initial load - FORCE VISIBLE DEBUG MESSAGE
    alert('🚀 WEBVIEW LOADED v2: JavaScript has been updated!');
    showDebugInfo('WEBVIEW LOADED v2: Requesting initial refresh...');
    showDebugInfo('JavaScript version: Enhanced with full asset graph support');
    console.log('Webview JavaScript loaded - version 2');
    vscode.postMessage({ type: 'refreshLineage' });
})();
