/**
 * Seamless Onboarding HTML for Ask Dagster
 * One-click setup for Ollama (with model size picker) or Cloud providers
 */

export function getOnboardingHTML(state: any): string {
    const models = [
        {
            name: 'qwen2.5-coder:1.5b',
            size: '1.5GB',
            desc: 'Fastest - Good for basic questions',
            recommended: true,
            icon: '⚡'
        },
        {
            name: 'qwen2.5-coder:7b',
            size: '4.7GB',
            desc: 'Balanced - Great code generation',
            icon: '⚖️'
        },
        {
            name: 'deepseek-coder:6.7b',
            size: '3.8GB',
            desc: 'Code specialist - Excellent for Dagster',
            icon: '🎯'
        },
        {
            name: 'codellama:13b',
            size: '7.4GB',
            desc: 'Most powerful - Best quality',
            icon: '🚀'
        }
    ];

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Ask Dagster</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
        }

        .hero {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: var(--vscode-editorWidget-background);
            border-radius: 12px;
            border: 1px solid var(--vscode-editorWidget-border);
        }

        .hero-icon {
            font-size: 64px;
            margin-bottom: 16px;
        }

        h1 {
            font-size: 28px;
            margin-bottom: 12px;
            color: var(--vscode-editor-foreground);
        }

        .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
        }

        .setup-section {
            margin-bottom: 32px;
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-editor-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .badge-recommended {
            background: rgba(38, 177, 93, 0.2);
            color: #26b15d;
        }

        .badge-free {
            background: rgba(75, 150, 255, 0.2);
            color: #4b96ff;
        }

        .badge-cloud {
            background: rgba(255, 170, 0, 0.2);
            color: #ffaa00;
        }

        /* Local AI Setup */
        .local-setup {
            background: linear-gradient(135deg, rgba(38, 177, 93, 0.1), rgba(38, 177, 93, 0.05));
            border: 2px solid rgba(38, 177, 93, 0.3);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }

        .model-grid {
            display: grid;
            gap: 12px;
            margin-top: 16px;
        }

        .model-card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 8px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .model-card:hover {
            border-color: rgba(38, 177, 93, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .model-card.recommended {
            border-color: rgba(38, 177, 93, 0.5);
            background: rgba(38, 177, 93, 0.05);
        }

        .model-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
        }

        .model-icon {
            font-size: 24px;
        }

        .model-name {
            font-weight: 600;
            font-size: 14px;
            flex: 1;
        }

        .model-size {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
        }

        .model-desc {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-left: 36px;
        }

        /* Cloud Setup */
        .cloud-setup {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-top: 16px;
        }

        .provider-card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .provider-card:hover {
            border-color: var(--vscode-button-background);
            transform: translateY(-2px);
        }

        .provider-icon {
            font-size: 32px;
            margin-bottom: 12px;
        }

        .provider-name {
            font-weight: 600;
            margin-bottom: 4px;
        }

        .provider-desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        /* Buttons */
        .btn {
            width: 100%;
            padding: 12px 20px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Status */
        .status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 13px;
            margin-top: 16px;
        }

        .status-success {
            background: rgba(38, 177, 93, 0.1);
            color: #26b15d;
            border: 1px solid rgba(38, 177, 93, 0.3);
        }

        .status-error {
            background: rgba(255, 80, 80, 0.1);
            color: #ff5050;
            border: 1px solid rgba(255, 80, 80, 0.3);
        }

        .status-info {
            background: rgba(75, 150, 255, 0.1);
            color: #4b96ff;
            border: 1px solid rgba(75, 150, 255, 0.3);
        }

        .divider {
            display: flex;
            align-items: center;
            text-align: center;
            margin: 32px 0;
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
        }

        .divider span {
            padding: 0 16px;
        }

        .features {
            display: grid;
            gap: 12px;
            margin-top: 16px;
        }

        .feature {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        .feature-icon {
            font-size: 18px;
        }

        .hidden {
            display: none;
        }

        .loading {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: var(--vscode-button-foreground);
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .skip-link {
            text-align: center;
            margin-top: 24px;
        }

        .skip-link button {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
            font-size: 13px;
        }

        .skip-link button:hover {
            color: var(--vscode-textLink-activeForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="hero">
            <div class="hero-icon">🤖</div>
            <h1>Welcome to Ask Dagster</h1>
            <p class="subtitle">
                Your AI-powered Dagster companion. Get instant answers, generate code,
                and learn best practices - all without leaving VS Code.
            </p>
        </div>

        <!-- Local AI Setup (Recommended) -->
        <div class="setup-section local-setup">
            <div class="section-title">
                <span>🏠 Local AI</span>
                <span class="badge badge-recommended">Recommended</span>
                <span class="badge badge-free">100% Free</span>
            </div>
            
            <p style="margin-bottom: 16px; font-size: 13px; color: var(--vscode-descriptionForeground);">
                Run AI models on your computer. Private, fast, and no API costs.
            </p>

            <div class="features">
                <div class="feature">
                    <span class="feature-icon">🔒</span>
                    <span>Complete privacy - your code never leaves your machine</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">⚡</span>
                    <span>Works offline - no internet required</span>
                </div>
                <div class="feature">
                    <span class="feature-icon">💰</span>
                    <span>Zero cost - unlimited usage</span>
                </div>
            </div>

            <div class="model-grid">
                ${models.map(model => `
                    <div class="model-card ${model.recommended ? 'recommended' : ''}" 
                         onclick="selectModel('${model.name}')">
                        <div class="model-header">
                            <span class="model-icon">${model.icon}</span>
                            <span class="model-name">${model.name}</span>
                            <span class="model-size">${model.size}</span>
                        </div>
                        <div class="model-desc">${model.desc}</div>
                        ${model.recommended ? '<span class="badge badge-recommended" style="margin-top: 8px;">⭐ Best for most users</span>' : ''}
                    </div>
                `).join('')}
            </div>

            <div id="ollama-status"></div>
        </div>

        <div class="divider">
            <span>or use cloud AI</span>
        </div>

        <!-- Cloud Setup -->
        <div class="setup-section">
            <div class="section-title">
                <span>☁️ Cloud AI</span>
                <span class="badge badge-cloud">Requires API Key</span>
            </div>
            
            <p style="margin-bottom: 16px; font-size: 13px; color: var(--vscode-descriptionForeground);">
                Use powerful cloud models. Requires an API key (paid service).
            </p>

            <div class="cloud-setup">
                <div class="provider-card" onclick="setupClaude()">
                    <div class="provider-icon">🤖</div>
                    <div class="provider-name">Claude</div>
                    <div class="provider-desc">Anthropic's powerful AI</div>
                </div>

                <div class="provider-card" onclick="setupOpenAI()">
                    <div class="provider-icon">🧠</div>
                    <div class="provider-name">OpenAI</div>
                    <div class="provider-desc">GPT-4 and beyond</div>
                </div>
            </div>
        </div>

        <div class="skip-link">
            <button onclick="skipOnboarding()">Skip setup - configure later</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function selectModel(modelName) {
            // Show loading status
            showStatus('info', '⏳ Setting up Ollama with ' + modelName + '...');
            
            // Send setup request
            vscode.postMessage({
                type: 'setupOllama',
                modelName: modelName
            });
        }

        function setupClaude() {
            vscode.postMessage({
                type: 'setupClaude'
            });
        }

        function setupOpenAI() {
            vscode.postMessage({
                type: 'setupOpenAI'
            });
        }

        function skipOnboarding() {
            vscode.postMessage({
                type: 'skipOnboarding'
            });
        }

        function showStatus(type, message) {
            const statusDiv = document.getElementById('ollama-status');
            statusDiv.innerHTML = \`
                <div class="status status-\${type}">
                    \${type === 'info' ? '<span class="loading"></span>' : ''}
                    <span>\${message}</span>
                </div>
            \`;
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'setupComplete':
                    showStatus('success', '✅ ' + message.message);
                    setTimeout(() => {
                        vscode.postMessage({ type: 'startChat' });
                    }, 1500);
                    break;
                    
                case 'setupError':
                    showStatus('error', '❌ ' + message.message);
                    break;
                    
                case 'setupProgress':
                    showStatus('info', '⏳ ' + message.message);
                    break;
            }
        });
    </script>
</body>
</html>
    `;
}




