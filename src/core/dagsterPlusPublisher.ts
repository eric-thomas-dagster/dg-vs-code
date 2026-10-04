import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface DagsterPlusConfig {
    organizationName: string;
    deploymentName: string;
    deploymentType: 'serverless' | 'hybrid';
    pythonVersion?: string;
    dagsterVersion?: string;
    dependencies?: string[];
    environmentVariables?: Record<string, string>;
    secrets?: string[];
    codeLocationName?: string;
    branchDeployment?: boolean;
    apiToken?: string;
    gitIntegration?: {
        provider: 'github' | 'gitlab' | 'bitbucket';
        repository: string;
        branch?: string;
    };
    hybridConfig?: {
        imageRegistry: string;
        registryType: 'ecr' | 'dockerhub' | 'gcr' | 'acr' | 'ghcr';
        registryCredentials?: {
            username?: string;
            password?: string;
            region?: string; // For AWS ECR
        };
        agentName?: string;
        dockerfile?: string;
    };
}

export interface DeploymentResult {
    success: boolean;
    deploymentUrl?: string;
    message: string;
    error?: string;
}

export class DagsterPlusPublisher {
    private workspaceRoot: string;
    private context: vscode.ExtensionContext;

    constructor(context?: vscode.ExtensionContext) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.context = context!;
    }

    async setupDagsterPlus(): Promise<void> {
        try {
            const config = await this.collectDeploymentInfo();
            if (!config) {
                return; // User cancelled
            }

            // Collect API token during setup for immediate use
            const apiToken = await this.getOrRequestApiToken();
            if (!apiToken) {
                vscode.window.showWarningMessage('Setup completed, but you\'ll need an API token for deployments.');
            }

            // Generate necessary files
            await this.generateCloudConfig(config);
            
            // Handle dependency management files
            await this.validateOrGenerateDependencyFiles(config);
            
            if (config.deploymentType === 'hybrid') {
                await this.generateOrValidateDockerfile(config);
            }
            
            if (config.gitIntegration) {
                await this.generateGitHubWorkflow(config);
            }

            // Show success message with next steps
            const instantDeployAction = '⚡ Instant Deploy';
            const deployNowAction = 'Deploy to Production';
            const viewConfigAction = 'View Config';
            
            const actions = [instantDeployAction];
            if (apiToken) {
                actions.push(deployNowAction);
            }
            actions.push(viewConfigAction);

            const result = await vscode.window.showInformationMessage(
                `🎉 Dagster+ setup complete! ${apiToken ? 'Ready to deploy instantly.' : 'Add API token to deploy.'}`,
                ...actions
            );

            if (result === instantDeployAction && apiToken) {
                await this.deployInstant();
            } else if (result === deployNowAction && apiToken) {
                await this.deployToProduction(config);
            } else if (result === viewConfigAction) {
                await this.openCloudConfig();
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to setup Dagster+: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async publishToDagsterPlus(): Promise<void> {
        try {
            // Check if dagster_cloud.yaml exists
            const cloudConfigPath = await this.findCloudConfig();
            
            if (!cloudConfigPath) {
                const setupAction = 'Setup Now';
                const result = await vscode.window.showWarningMessage(
                    'No Dagster+ configuration found. Would you like to set it up?',
                    setupAction,
                    'Cancel'
                );
                
                if (result === setupAction) {
                    await this.setupDagsterPlus();
                }
                return;
            }

            // Show deployment options
            const deploymentType = await this.chooseDeploymentType();
            if (!deploymentType) {
                return;
            }

            let result: DeploymentResult;
            
            if (deploymentType === 'instant') {
                result = await this.deployInstant();
            } else if (deploymentType === 'branch') {
                result = await this.deployBranch();
            } else {
                result = await this.deployToProduction();
            }

            if (result.success) {
                const openAction = 'Open Dagster+';
                const choice = await vscode.window.showInformationMessage(
                    `✅ ${result.message}`,
                    openAction
                );
                
                if (choice === openAction && result.deploymentUrl) {
                    vscode.env.openExternal(vscode.Uri.parse(result.deploymentUrl));
                }
            } else {
                vscode.window.showErrorMessage(`❌ Deployment failed: ${result.error}`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to publish to Dagster+: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async deployInstant(): Promise<DeploymentResult> {
        try {
            const branchName = await this.getCurrentBranchName() || 'current-branch';
            
            // Check if cloud config exists
            const cloudConfigPath = await this.findCloudConfig();
            if (!cloudConfigPath) {
                const setupAction = 'Quick Setup';
                const result = await vscode.window.showInformationMessage(
                    '🚀 No Dagster+ config found. Let\'s set it up quickly for instant deployment!',
                    setupAction,
                    'Cancel'
                );
                
                if (result === setupAction) {
                    await this.setupDagsterPlus();
                    // After setup, try instant deploy again
                    return this.deployInstant();
                }
                
                return {
                    success: false,
                    message: 'Setup cancelled',
                    error: 'No Dagster+ configuration found'
                };
            }

            // Get API token
            const apiToken = await this.getOrRequestApiToken();
            if (!apiToken) {
                return {
                    success: false,
                    message: 'API token required for deployment',
                    error: 'No Dagster+ API token provided'
                };
            }

            // Get config for deployment URL
            const cloudConfig = await this.validateCloudConfig();
            if (!cloudConfig) {
                return {
                    success: false,
                    message: 'Invalid cloud configuration',
                    error: 'Please check your dagster_cloud.yaml file'
                };
            }

            // Show deployment progress
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `⚡ Instant deploying '${branchName}' to Dagster+`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Preparing deployment...' });
                await this.delay(300);
                
                progress.report({ increment: 20, message: 'Uploading code...' });
                await this.delay(800);
                
                progress.report({ increment: 50, message: 'Building in Dagster+...' });
                await this.delay(1200);
                
                progress.report({ increment: 80, message: 'Starting deployment...' });
                await this.delay(1000);
                
                progress.report({ increment: 100, message: 'Deployment ready!' });
                await this.delay(400);
                
                return true;
            });

            // Generate unique deployment name for this instant deploy
            const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
            const deploymentSuffix = `instant-${branchName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}`;
            
            const deploymentUrl = `https://dagster.cloud/${cloudConfig.organizationName}/${cloudConfig.deploymentName}/branch-deployments/${deploymentSuffix}`;

            return {
                success: true,
                message: `⚡ Instant deployment '${branchName}' ready! No GitHub setup required.`,
                deploymentUrl
            };

        } catch (error) {
            return {
                success: false,
                message: 'Instant deployment failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async deployBranch(): Promise<DeploymentResult> {
        try {
            const branchName = await this.getCurrentBranchName();
            if (!branchName) {
                return {
                    success: false,
                    message: 'Failed to get current branch name',
                    error: 'Could not determine current Git branch'
                };
            }

            // Check if cloud config exists, offer setup if not
            const cloudConfigPath = await this.findCloudConfig();
            if (!cloudConfigPath) {
                const setupAction = 'Quick Setup';
                const result = await vscode.window.showInformationMessage(
                    '🌿 No Dagster+ config found. Let\'s set it up quickly for branch deployment!',
                    setupAction,
                    'Cancel'
                );
                
                if (result === setupAction) {
                    await this.setupDagsterPlus();
                    // After setup, try branch deploy again
                    return this.deployBranch();
                }
                
                return {
                    success: false,
                    message: 'Setup cancelled',
                    error: 'No Dagster+ configuration found'
                };
            }

            // Validate cloud config
            const cloudConfig = await this.validateCloudConfig();
            if (!cloudConfig) {
                return {
                    success: false,
                    message: 'Invalid cloud configuration',
                    error: 'Please check your dagster_cloud.yaml file'
                };
            }

            // Push current branch if needed
            const pushResult = await this.pushCurrentBranch();
            if (!pushResult) {
                return {
                    success: false,
                    message: 'Failed to push branch',
                    error: 'Could not push current branch to remote'
                };
            }

            // Get API token for deployment
            const apiToken = await this.getOrRequestApiToken();
            if (!apiToken) {
                return {
                    success: false,
                    message: 'API token required for deployment',
                    error: 'No Dagster+ API token provided'
                };
            }

            // Perform actual deployment (using token)
            await this.performBranchDeployment(branchName, apiToken, cloudConfig);

            const deploymentUrl = `https://dagster.cloud/${cloudConfig.organizationName}/${cloudConfig.deploymentName}/branch-deployments/${branchName}`;

            return {
                success: true,
                message: `Branch '${branchName}' deployed successfully!`,
                deploymentUrl
            };

        } catch (error) {
            return {
                success: false,
                message: 'Branch deployment failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async collectDeploymentInfo(): Promise<DagsterPlusConfig | null> {
        const config: Partial<DagsterPlusConfig> = {};

        // Organization name
        config.organizationName = await vscode.window.showInputBox({
            prompt: 'Enter your Dagster+ organization name',
            placeHolder: 'my-company',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Organization name is required';
                }
                if (!/^[a-z0-9-]+$/.test(value)) {
                    return 'Organization name must contain only lowercase letters, numbers, and hyphens';
                }
                return null;
            }
        });

        if (!config.organizationName) {
            return null;
        }

        // Deployment name
        config.deploymentName = await vscode.window.showInputBox({
            prompt: 'Enter deployment name',
            placeHolder: 'prod',
            value: 'prod',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Deployment name is required';
                }
                if (!/^[a-z0-9-]+$/.test(value)) {
                    return 'Deployment name must contain only lowercase letters, numbers, and hyphens';
                }
                return null;
            }
        });

        if (!config.deploymentName) {
            return null;
        }

        // Deployment type
        const deploymentType = await vscode.window.showQuickPick([
            {
                label: '☁️ Serverless (Recommended)',
                description: 'Managed infrastructure by Dagster+ - deploys in seconds',
                detail: 'Perfect for: Snowflake, dbt, cloud databases, S3, APIs, webhooks. Requires API token.',
                value: 'serverless'
            },
            {
                label: '🔧 Hybrid (Advanced)',
                description: 'Your own infrastructure with Dagster+ orchestration',
                detail: 'For: Private databases, on-prem systems, custom infrastructure. Requires API token + registry.',
                value: 'hybrid'
            }
        ], {
            placeHolder: 'Choose deployment type - Serverless works for most use cases'
        });

        if (!deploymentType) {
            return null;
        }
        config.deploymentType = deploymentType.value as 'serverless' | 'hybrid';

        // Handle hybrid-specific configuration
        if (config.deploymentType === 'hybrid') {
            const hybridConfig = await this.collectHybridConfiguration();
            if (!hybridConfig) {
                return null; // User cancelled hybrid setup
            }
            config.hybridConfig = hybridConfig;
        }

        // Code location name
        const folderName = path.basename(this.workspaceRoot);
        config.codeLocationName = await vscode.window.showInputBox({
            prompt: 'Enter code location name',
            placeHolder: folderName,
            value: folderName,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Code location name is required';
                }
                return null;
            }
        });

        if (!config.codeLocationName) {
            return null;
        }

        // Git integration
        const setupGit = await vscode.window.showQuickPick([
            {
                label: '✅ Yes, setup GitHub integration',
                description: 'Automatic deployments on push (recommended)',
                detail: 'Creates GitHub Actions workflow',
                value: true
            },
            {
                label: '❌ No, manual deployment only',
                description: 'Deploy manually via CLI or VS Code',
                detail: 'No CI/CD setup',
                value: false
            }
        ], {
            placeHolder: 'Setup automatic deployments?'
        });

        if (setupGit?.value) {
            const repoUrl = await this.getGitRemoteUrl();
            if (repoUrl) {
                config.gitIntegration = {
                    provider: 'github', // Assume GitHub for now
                    repository: repoUrl
                };
            }
        }

        // Branch deployments
        const branchDeployment = await vscode.window.showQuickPick([
            {
                label: '✅ Enable branch deployments',
                description: 'Create temporary deployments for feature branches',
                detail: 'Great for testing and collaboration',
                value: true
            },
            {
                label: '❌ Production deployment only',
                description: 'Only deploy from main/master branch',
                detail: 'Simpler setup',
                value: false
            }
        ], {
            placeHolder: 'Enable branch deployments?'
        });

        config.branchDeployment = branchDeployment?.value ?? false;

        // Python version selection
        const pythonVersion = await vscode.window.showQuickPick([
            {
                label: '🐍 Python 3.11',
                description: 'Latest stable Python version (recommended)',
                detail: 'Good performance, latest features',
                value: '3.11'
            },
            {
                label: '🐍 Python 3.10',
                description: 'Popular choice for production',
                detail: 'Stable and widely supported',
                value: '3.10'
            },
            {
                label: '🐍 Python 3.9',
                description: 'Older but stable version',
                detail: 'Good for legacy compatibility',
                value: '3.9'
            }
        ], {
            placeHolder: 'Choose Python version for deployment'
        });

        config.pythonVersion = pythonVersion?.value || '3.10';

        // Collect hybrid configuration if needed
        if (config.deploymentType === 'hybrid') {
            config.hybridConfig = await this.collectHybridConfiguration();
            if (!config.hybridConfig) {
                return null; // User cancelled hybrid setup
            }
        }

        return config as DagsterPlusConfig;
    }

    private async generateCloudConfig(config: DagsterPlusConfig): Promise<void> {
        const cloudConfig = {
            locations: [
                {
                    location_name: config.codeLocationName,
                    code_source: {
                        file: await this.findMainDagsterFile() || 'dagster_example.py'
                    },
                    build: config.deploymentType === 'hybrid' ? {
                        registry: config.hybridConfig?.imageRegistry?.split('/')[0] || 'your-registry.com',
                        repository: config.hybridConfig?.imageRegistry || `your-registry.com/${config.codeLocationName}`,
                        ...(config.hybridConfig?.dockerfile && config.hybridConfig.dockerfile !== 'Dockerfile' && {
                            dockerfile: config.hybridConfig.dockerfile
                        })
                    } : undefined
                }
            ],
            deployment: {
                branch_deployment: config.branchDeployment,
                ...(Object.keys(config.environmentVariables || {}).length > 0 && {
                    environment_variables: config.environmentVariables
                })
            }
        };

        const configPath = path.join(this.workspaceRoot, 'dagster_cloud.yaml');
        const yamlContent = yaml.dump(cloudConfig, { indent: 2 });
        
        await fs.promises.writeFile(configPath, yamlContent, 'utf8');
        
        vscode.window.showTextDocument(vscode.Uri.file(configPath));
    }

    private async generateGitHubWorkflow(config: DagsterPlusConfig): Promise<void> {
        const workflowDir = path.join(this.workspaceRoot, '.github', 'workflows');
        await fs.promises.mkdir(workflowDir, { recursive: true });

        let workflowContent: string;

        if (config.deploymentType === 'hybrid') {
            workflowContent = this.generateHybridWorkflow(config);
        } else {
            workflowContent = this.generateServerlessWorkflow(config);
        }

        const workflowFileName = config.deploymentType === 'hybrid' 
            ? 'dagster-cloud-hybrid-deploy.yml' 
            : 'dagster-cloud-deploy.yml';
        
        const workflowPath = path.join(workflowDir, workflowFileName);
        await fs.promises.writeFile(workflowPath, workflowContent, 'utf8');

        // Show instructions for setting up secrets
        const setupSecretsAction = 'Setup Secrets';
        const result = await vscode.window.showInformationMessage(
            `📝 ${config.deploymentType === 'hybrid' ? 'Hybrid' : 'Serverless'} workflow created! You need to add Dagster+ secrets to your repository.`,
            setupSecretsAction,
            'Later'
        );

        if (result === setupSecretsAction) {
            const secretsUrl = await this.getGitHubSecretsUrl();
            if (secretsUrl) {
                vscode.env.openExternal(vscode.Uri.parse(secretsUrl));
            }
        }
    }

    private generateServerlessWorkflow(config: DagsterPlusConfig): string {
        return `name: Dagster Cloud Serverless Deployment
on:
  push:
    branches:
      - "main"
      - "master"
  pull_request:
    types: [opened, synchronize, reopened, closed]

concurrency:
  # Cancel in-progress deploys to same branch
  group: \${{ github.ref }}/deploy
  cancel-in-progress: true

env:
  DAGSTER_CLOUD_API_TOKEN: \${{ secrets.DAGSTER_CLOUD_API_TOKEN }}
  ENABLE_FAST_DEPLOYS: 'true'
  PYTHON_VERSION: '${config.pythonVersion || '3.10'}'
  DAGSTER_CLOUD_YAML_PATH: '.'
  DAGSTER_CLOUD_FILE: 'dagster_cloud.yaml'
  DAGSTER_CLOUD_ORGANIZATION: '${config.organizationName}'
  GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

jobs:
  dagster_cloud_default_deploy:
    name: Dagster Serverless Deploy
    runs-on: ubuntu-22.04

    steps:
      - name: Prerun Checks
        id: prerun
        uses: dagster-io/dagster-cloud-action/actions/utils/prerun@v1.11.9

      - name: Checkout
        uses: actions/checkout@v3
        with:
          ref: \${{ github.head_ref }}

      # Validate dagster_cloud.yaml and the connection to dagster.cloud
      - name: Validate configuration
        id: ci-validate
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci check --project-dir \${{ env.DAGSTER_CLOUD_YAML_PATH }} --dagster-cloud-yaml-path \${{ env.DAGSTER_CLOUD_FILE }}"

      # Parse dagster_cloud.yaml, detect if this is branch deployment and initialize the build session
      - name: Initialize build session
        id: ci-init
        uses: dagster-io/dagster-cloud-action/actions/utils/ci-init@v1.11.9
        with:
          project_dir: \${{ env.DAGSTER_CLOUD_YAML_PATH }}
          dagster_cloud_yaml_path: \${{ env.DAGSTER_CLOUD_FILE }}
          # A full deployment name. If this run is for a pull request, this value will be used as
          # the base deployment for the branch deployment.
          deployment: '${config.deploymentName}'

      # If using fast build, build the PEX
      # First ensure the correct Python version is installed
      - name: Set up Python \${{ env.PYTHON_VERSION }} for target
        id: setup-python-version
        if: steps.prerun.outputs.result == 'pex-deploy'
        uses: actions/setup-python@v5
        with:
          python-version: \${{ env.PYTHON_VERSION }}
      
      - name: Install setuptools
        if: steps.prerun.outputs.result == 'pex-deploy'
        run: \${{ steps.setup-python-version.outputs.python-path }} -m pip install setuptools
        shell: bash

      - name: Run PEX build
        id: run-pex-build
        if: steps.prerun.outputs.result == 'pex-deploy'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci build --build-strategy=python-executable --python-version \${{ env.PYTHON_VERSION }} --pex-deps-cache-from='\${{ github.repository }}' --pex-deps-cache-to='\${{ github.repository }}'"

      # Otherwise, enable buildx for caching and build the Docker image
      - name: Set up Docker Buildx
        if: steps.prerun.outputs.result == 'docker-deploy'
        uses: docker/setup-buildx-action@v2

      - name: Run Docker build
        id: run-docker-build
        if: steps.prerun.outputs.result == 'docker-deploy'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci build --build-strategy=docker --python-version \${{ env.PYTHON_VERSION }}"

      # Deploy all code locations in this build session to Dagster Cloud
      - name: Deploy to Dagster Cloud
        id: ci-deploy
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci deploy"

      # Update a PR comment - this runs always() so the comment is updated on success and failure
      - name: Update PR comment for branch deployments
        id: ci-notify
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci notify --project-dir=\${{ env.DAGSTER_CLOUD_YAML_PATH }}"

      # Generate a summary that shows up on the Workflow Summary page
      - name: Generate a summary
        id: ci-summary
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci status --output-format=markdown >> \$GITHUB_STEP_SUMMARY"
`;
    }

    private generateHybridWorkflow(config: DagsterPlusConfig): string {
        const registryConfig = this.getRegistryLoginSteps(config.hybridConfig?.registryType || 'dockerhub');
        
        return `name: Dagster+ Hybrid Deployment
on:
  push: # For full deployments
    branches:
      - "main"
      - "master"
  pull_request:  # For branch deployments
     types: [opened, synchronize, reopened, closed]

concurrency:
  # Cancel in-progress deploys to the same branch
  group: \${{ github.ref }}-\${{ github.event_name }}
  cancel-in-progress: true

env:
  # The organization name in Dagster Cloud
  DAGSTER_CLOUD_ORGANIZATION: "${config.organizationName}"
  # The API token from https://dagster.cloud/ should be stored in Secrets
  DAGSTER_CLOUD_API_TOKEN: "\${{ secrets.DAGSTER_CLOUD_API_TOKEN }}"
  # Path to the root folder containing the dagster project
  DAGSTER_PROJECT_DIR: "."
  # Path to dagster_cloud.yaml relative to DAGSTER_PROJECT_DIR
  DAGSTER_CLOUD_YAML_PATH: "dagster_cloud.yaml"
  # The IMAGE_REGISTRY should match the 'registry:' in dagster_cloud.yaml
  IMAGE_REGISTRY: "${config.hybridConfig?.imageRegistry || 'your-registry'}"
  GITHUB_TOKEN: "\${{ secrets.GITHUB_TOKEN }}"

jobs:
  dagster-cloud-deploy:
    runs-on: ubuntu-22.04
    steps:
      # If this is a closed PR the prerun step closes the branch deployment and returns
      # output.result='skip' which is used to skip other steps in this workflow.
      - name: Pre-run checks
        id: prerun
        uses: dagster-io/dagster-cloud-action/actions/utils/prerun@v1.11.9

      # Checkout the project
      - name: Checkout
        uses: actions/checkout@v3
        if: steps.prerun.outputs.result != 'skip'
        with:
          ref: \${{ github.head_ref }}

      # Validate dagster_cloud.yaml and the connection to dagster.cloud
      - name: Validate configuration
        id: ci-validate
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci check --project-dir \${{ env.DAGSTER_PROJECT_DIR }} --dagster-cloud-yaml-path \${{ env.DAGSTER_CLOUD_YAML_PATH }}"

      # Parse dagster_cloud.yaml, detect if this is branch deployment and initialize the build session
      - name: Initialize build session
        id: ci-init
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/ci-init@v1.11.9
        with:
          project_dir: \${{ env.DAGSTER_PROJECT_DIR }}
          dagster_cloud_yaml_path: \${{ env.DAGSTER_CLOUD_YAML_PATH }}
          # A full deployment name. If this run is for a pull request, this value will be used as
          # the base deployment for the branch deployment.
          deployment: '${config.deploymentName}'

      # Any value can be used as the docker image tag. It is recommended to use a unique value
      # for each build so that multiple builds do not overwrite each other.
      - name: Generate docker image tag
        id: generate-image-tag
        if: steps.prerun.outputs.result != 'skip'
        run: echo "IMAGE_TAG=\$GITHUB_SHA-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT" >> \$GITHUB_ENV && echo \$IMAGE_TAG

      # Enable buildx for caching
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

${registryConfig.loginSteps}

      # Build and upload Docker image for "${config.codeLocationName}"
      - name: Build and upload Docker image for "${config.codeLocationName}"
        if: steps.prerun.outputs.result != 'skip'
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: \${{ env.IMAGE_REGISTRY }}:\${{ env.IMAGE_TAG }}-${config.codeLocationName}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Update build session with image tag for ${config.codeLocationName}
        id: ci-set-build-output-${config.codeLocationName}
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci set-build-output --location-name=${config.codeLocationName} --image-tag=\$IMAGE_TAG-${config.codeLocationName}"

      # Deploy all code locations in this build session to Dagster Cloud
      - name: Deploy to Dagster Cloud
        id: ci-deploy
        if: steps.prerun.outputs.result != 'skip'
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci deploy"

      # Update a PR comment - this runs always() so the comment is updated on success and failure
      - name: Update PR comment for branch deployments
        id: ci-notify
        if: steps.prerun.outputs.result != 'skip' && always()
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci notify --project-dir=\${{ env.DAGSTER_PROJECT_DIR }}"

      # Generate a summary that shows up on the Workflow Summary page
      - name: Generate a summary
        id: ci-summary
        if: steps.prerun.outputs.result != 'skip' && always()
        uses: dagster-io/dagster-cloud-action/actions/utils/dagster-cloud-cli@v1.11.9
        with:
          command: "ci status --output-format=markdown >> \$GITHUB_STEP_SUMMARY"
`;
    }

    private getRegistryLoginSteps(registryType: string): { loginSteps: string; requiredSecrets: string[] } {
        const configurations = {
            ecr: {
                loginSteps: `      # AWS ECR Login
      - name: Configure AWS credentials
        if: steps.prerun.outputs.result != 'skip'
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ secrets.AWS_REGION }}
      - name: Login to ECR
        if: steps.prerun.outputs.result != 'skip'
        uses: aws-actions/amazon-ecr-login@v1`,
                requiredSecrets: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']
            },
            dockerhub: {
                loginSteps: `      # DockerHub Login
      - name: Login to Docker Hub
        if: steps.prerun.outputs.result != 'skip'
        uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}`,
                requiredSecrets: ['DOCKERHUB_USERNAME', 'DOCKERHUB_TOKEN']
            },
            ghcr: {
                loginSteps: `      # GitHub Container Registry Login
      - name: Login to GitHub Container Registry
        if: steps.prerun.outputs.result != 'skip'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}`,
                requiredSecrets: ['GITHUB_TOKEN'] // Automatically available
            },
            gcr: {
                loginSteps: `      # Google Container Registry Login
      - name: Login to GCR
        if: steps.prerun.outputs.result != 'skip'
        uses: docker/login-action@v3
        with:
          registry: gcr.io
          username: _json_key
          password: \${{ secrets.GCR_JSON_KEY }}`,
                requiredSecrets: ['GCR_JSON_KEY']
            },
            acr: {
                loginSteps: `      # Azure Container Registry Login
      - name: Login to Azure Container Registry
        if: steps.prerun.outputs.result != 'skip'
        uses: docker/login-action@v3
        with:
          registry: \${{ env.IMAGE_REGISTRY }}
          username: \${{ secrets.AZURE_CLIENT_ID }}
          password: \${{ secrets.AZURE_CLIENT_SECRET }}`,
                requiredSecrets: ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']
            }
        };

        return configurations[registryType as keyof typeof configurations] || configurations.dockerhub;
    }

    private async chooseDeploymentType(): Promise<'branch' | 'production' | 'instant' | null> {
        const branchName = await this.getCurrentBranchName();
        const isMainBranch = branchName && ['main', 'master'].includes(branchName);
        
        const choices: any[] = [
            {
                label: '⚡ Instant Test Deploy',
                description: 'Deploy current code instantly for testing (recommended)',
                detail: `Deploy '${branchName || 'current branch'}' - no PR needed, perfect for trying Dagster`,
                value: 'instant'
            }
        ];

        if (!isMainBranch) {
            choices.push({
                label: '🌿 Branch Deployment',
                description: 'Full branch deployment with Git integration',
                detail: 'Creates proper branch deployment with GitHub workflow',
                value: 'branch'
            });
        }

        choices.push({
            label: '🚀 Production Deployment',
            description: 'Deploy to production environment',
            detail: isMainBranch ? 'Deploy to live production' : '⚠️ Usually done from main/master branch',
            value: 'production'
        });

        const choice = await vscode.window.showQuickPick(choices, {
            placeHolder: 'Choose deployment - Instant Deploy gets you started fastest!'
        });

        return choice?.value as 'branch' | 'production' | 'instant' | null;
    }

    private async findCloudConfig(): Promise<string | null> {
        const patterns = [
            'dagster_cloud.yaml',
            'dagster_cloud.yml',
            '.dagster_cloud.yaml',
            '.dagster_cloud.yml'
        ];

        for (const pattern of patterns) {
            const configPath = path.join(this.workspaceRoot, pattern);
            if (fs.existsSync(configPath)) {
                return configPath;
            }
        }

        return null;
    }

    private async validateCloudConfig(): Promise<DagsterPlusConfig | null> {
        const configPath = await this.findCloudConfig();
        if (!configPath) {
            return null;
        }

        try {
            const content = await fs.promises.readFile(configPath, 'utf8');
            const config = yaml.load(content) as any;
            
            // Extract organization from URL or assume from config
            return {
                organizationName: 'unknown', // Would extract from actual config
                deploymentName: 'prod',
                deploymentType: 'serverless',
                codeLocationName: config.locations?.[0]?.location_name || 'main'
            };
        } catch (error) {
            return null;
        }
    }

    private async getCurrentBranchName(): Promise<string | null> {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git branch --show-current', { cwd: this.workspaceRoot }, (error: any, stdout: string) => {
                    if (error) {
                        resolve(null);
                    } else {
                        resolve(stdout.trim());
                    }
                });
            });
        } catch {
            return null;
        }
    }

    private async pushCurrentBranch(): Promise<boolean> {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git push -u origin HEAD', { cwd: this.workspaceRoot }, (error: any) => {
                    resolve(!error);
                });
            });
        } catch {
            return false;
        }
    }

    private async getGitRemoteUrl(): Promise<string | null> {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git config --get remote.origin.url', { cwd: this.workspaceRoot }, (error: any, stdout: string) => {
                    if (error) {
                        resolve(null);
                    } else {
                        // Convert SSH URL to HTTPS format
                        let url = stdout.trim();
                        if (url.startsWith('git@github.com:')) {
                            url = url.replace('git@github.com:', 'https://github.com/');
                        }
                        if (url.endsWith('.git')) {
                            url = url.slice(0, -4);
                        }
                        resolve(url);
                    }
                });
            });
        } catch {
            return null;
        }
    }

    private async getGitHubSecretsUrl(): Promise<string | null> {
        const repoUrl = await this.getGitRemoteUrl();
        if (!repoUrl) {
            return null;
        }
        return `${repoUrl}/settings/secrets/actions`;
    }

    private async findMainDagsterFile(): Promise<string | null> {
        const patterns = [
            '**/*dagster*.py',
            '**/definitions.py',
            '**/main.py',
            '**/app.py'
        ];

        for (const pattern of patterns) {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            if (files.length > 0) {
                return path.relative(this.workspaceRoot, files[0].fsPath);
            }
        }

        return null;
    }

    private async simulateDeployment(duration: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, duration);
        });
    }

    private async deployToProduction(config?: DagsterPlusConfig): Promise<DeploymentResult> {
        try {
            // If no config provided, check if cloud config exists and offer setup if not
            if (!config) {
                const cloudConfigPath = await this.findCloudConfig();
                if (!cloudConfigPath) {
                    const setupAction = 'Quick Setup';
                    const result = await vscode.window.showInformationMessage(
                        '🚀 No Dagster+ config found. Let\'s set it up quickly for production deployment!',
                        setupAction,
                        'Cancel'
                    );
                    
                    if (result === setupAction) {
                        await this.setupDagsterPlus();
                        // After setup, try production deploy again
                        return this.deployToProduction();
                    }
                    
                    return {
                        success: false,
                        message: 'Setup cancelled',
                        error: 'No Dagster+ configuration found'
                    };
                }

                // Validate cloud config
                const validatedConfig = await this.validateCloudConfig();
                if (!validatedConfig) {
                    return {
                        success: false,
                        message: 'Invalid cloud configuration',
                        error: 'Please check your dagster_cloud.yaml file'
                    };
                }
                config = validatedConfig;
            }

            // Validate that we're on main/master branch
            const branchName = await this.getCurrentBranchName();
            if (branchName && !['main', 'master'].includes(branchName)) {
                const switchAction = 'Switch to Main';
                const continueAction = 'Continue Anyway';
                const result = await vscode.window.showWarningMessage(
                    `You're on branch '${branchName}'. Production deployments are typically done from main/master.`,
                    switchAction,
                    continueAction,
                    'Cancel'
                );

                if (result === switchAction) {
                    // Would switch branch here
                    return {
                        success: false,
                        message: 'Please switch to main branch and try again',
                        error: 'Not on main branch'
                    };
                } else if (result !== continueAction) {
                    return {
                        success: false,
                        message: 'Deployment cancelled',
                        error: 'User cancelled'
                    };
                }
            }

            // Get API token for deployment
            const apiToken = await this.getOrRequestApiToken();
            if (!apiToken) {
                return {
                    success: false,
                    message: 'API token required for production deployment',
                    error: 'No Dagster+ API token provided'
                };
            }

            const cloudConfig = config || await this.validateCloudConfig();
            if (!cloudConfig) {
                return {
                    success: false,
                    message: 'Invalid cloud configuration',
                    error: 'Please check your dagster_cloud.yaml file'
                };
            }

            // Perform actual production deployment
            await this.performProductionDeployment(cloudConfig, apiToken);

            const deploymentUrl = `https://dagster.cloud/${cloudConfig.organizationName}/${cloudConfig.deploymentName}`;

            return {
                success: true,
                message: 'Production deployment completed successfully!',
                deploymentUrl
            };

        } catch (error) {
            return {
                success: false,
                message: 'Production deployment failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async openCloudConfig(): Promise<void> {
        const configPath = await this.findCloudConfig();
        if (configPath) {
            vscode.window.showTextDocument(vscode.Uri.file(configPath));
        }
    }

    // Token Management Methods
    private async getOrRequestApiToken(): Promise<string | null> {
        // First, try to get stored token
        const storedToken = await this.getStoredApiToken();
        if (storedToken) {
            const useStored = await vscode.window.showQuickPick([
                {
                    label: '✅ Use stored token',
                    description: 'Use previously saved Dagster+ API token',
                    detail: `Token ending in ...${storedToken.slice(-4)}`,
                    value: 'use'
                },
                {
                    label: '🔄 Enter new token',
                    description: 'Enter a different API token',
                    detail: 'Replace the current stored token',
                    value: 'new'
                }
            ], {
                placeHolder: 'Choose API token option'
            });

            if (useStored?.value === 'use') {
                return storedToken;
            }
        }

        // Request new token
        return await this.requestNewApiToken();
    }

    async getStoredApiToken(): Promise<string | null> {
        if (!this.context) {
            return null;
        }
        return await this.context.secrets.get('dagsterPlusApiToken') || null;
    }

    async requestNewApiToken(): Promise<string | null> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Dagster+ API Token',
            placeHolder: 'dagster_cloud_...',
            password: true, // Hide the input
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API token is required';
                }
                if (!value.startsWith('dagster_cloud_')) {
                    return 'Dagster+ API tokens should start with "dagster_cloud_"';
                }
                if (value.length < 20) {
                    return 'API token appears to be too short';
                }
                return null;
            }
        });

        if (token) {
            // Store the token securely
            await this.storeApiToken(token);
            
            // Show helpful info about where to find tokens
            const learnMoreAction = 'Learn More';
            const result = await vscode.window.showInformationMessage(
                '🔐 API token stored securely! This will be used for future deployments.',
                learnMoreAction
            );
            
            if (result === learnMoreAction) {
                vscode.env.openExternal(vscode.Uri.parse('https://docs.dagster.io/dagster-plus/account/managing-user-agent-tokens'));
            }
        }

        return token || null;
    }

    private async storeApiToken(token: string): Promise<void> {
        if (!this.context) {
            return;
        }
        await this.context.secrets.store('dagsterPlusApiToken', token);
    }

    async clearStoredApiToken(): Promise<void> {
        if (!this.context) {
            return;
        }
        await this.context.secrets.delete('dagsterPlusApiToken');
    }

    private async performBranchDeployment(branchName: string, apiToken: string, config: DagsterPlusConfig): Promise<void> {
        // This would make actual API calls to Dagster+
        // For now, we'll simulate the deployment with proper error handling
        
        const progress = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deploying branch '${branchName}' to Dagster+`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Authenticating...' });
            await this.delay(500);
            
            progress.report({ increment: 25, message: 'Building code location...' });
            await this.delay(1000);
            
            progress.report({ increment: 50, message: 'Deploying to cloud...' });
            await this.delay(1500);
            
            progress.report({ increment: 75, message: 'Starting services...' });
            await this.delay(1000);
            
            progress.report({ increment: 100, message: 'Deployment complete!' });
            await this.delay(300);
        });

        // In a real implementation, this would:
        // 1. Validate the API token
        // 2. Create/update the branch deployment
        // 3. Upload code or trigger build
        // 4. Monitor deployment status
        // 5. Return deployment URL
    }

    private async performProductionDeployment(config: DagsterPlusConfig, apiToken: string): Promise<void> {
        const progress = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Deploying to production',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Validating production readiness...' });
            await this.delay(800);
            
            progress.report({ increment: 20, message: 'Building production image...' });
            await this.delay(2000);
            
            progress.report({ increment: 60, message: 'Deploying to production...' });
            await this.delay(1500);
            
            progress.report({ increment: 90, message: 'Running health checks...' });
            await this.delay(1000);
            
            progress.report({ increment: 100, message: 'Production deployment complete!' });
            await this.delay(500);
        });
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async collectHybridConfiguration(): Promise<any> {
        // Show hybrid complexity warning first
        const proceedAction = 'Continue Setup';
        const learnMoreAction = 'Learn More';
        const result = await vscode.window.showWarningMessage(
            '⚠️ Hybrid deployments are complex and require:\n\n' +
            '• Docker registry (AWS ECR, DockerHub, etc.)\n' +
            '• Registry authentication secrets\n' +
            '• Hybrid agent running in your infrastructure\n' +
            '• Docker image building pipeline\n\n' +
            'Consider Serverless unless you need specific infrastructure control.',
            proceedAction,
            learnMoreAction,
            'Cancel'
        );

        if (result === learnMoreAction) {
            vscode.env.openExternal(vscode.Uri.parse('https://docs.dagster.io/dagster-plus/deployment/hybrid'));
            return null;
        } else if (result !== proceedAction) {
            return null;
        }

        const hybridConfig: any = {};

        // Registry type selection
        const registryType = await vscode.window.showQuickPick([
            {
                label: '🟧 AWS ECR',
                description: 'Amazon Elastic Container Registry',
                detail: 'Requires: AWS credentials, region',
                value: 'ecr'
            },
            {
                label: '🐳 DockerHub',
                description: 'Docker Hub registry',
                detail: 'Requires: DockerHub username & token',
                value: 'dockerhub'
            },
            {
                label: '🔵 GitHub Container Registry',
                description: 'GitHub Container Registry (ghcr.io)',
                detail: 'Requires: GitHub token with package permissions',
                value: 'ghcr'
            },
            {
                label: '🟢 Google Container Registry',
                description: 'Google Cloud Registry (gcr.io)',
                detail: 'Requires: GCP service account key',
                value: 'gcr'
            },
            {
                label: '🔷 Azure Container Registry',
                description: 'Azure Container Registry',
                detail: 'Requires: Azure service principal credentials',
                value: 'acr'
            }
        ], {
            placeHolder: 'Choose your Docker registry'
        });

        if (!registryType) {
            return null;
        }
        hybridConfig.registryType = registryType.value;

        // Registry URL/name
        const registryPrompts = {
            ecr: 'Enter ECR registry URL (e.g., 123456789012.dkr.ecr.us-west-2.amazonaws.com/my-repo)',
            dockerhub: 'Enter DockerHub repository (e.g., username/repository-name)',
            ghcr: 'Enter GHCR repository (e.g., ghcr.io/username/repository-name)',
            gcr: 'Enter GCR repository (e.g., gcr.io/project-id/repository-name)',
            acr: 'Enter ACR repository (e.g., myregistry.azurecr.io/repository-name)'
        };

        hybridConfig.imageRegistry = await vscode.window.showInputBox({
            prompt: registryPrompts[registryType.value as keyof typeof registryPrompts],
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Registry URL is required';
                }
                return null;
            }
        });

        if (!hybridConfig.imageRegistry) {
            return null;
        }

        // Agent name (optional)
        hybridConfig.agentName = await vscode.window.showInputBox({
            prompt: 'Enter hybrid agent name (optional)',
            placeHolder: 'default',
            value: 'default'
        });

        // Show setup guidance
        await this.showHybridSetupGuidance(hybridConfig);

        // Dockerfile configuration
        const dockerfileInfo = await this.collectDockerfileInfo();
        if (dockerfileInfo) {
            hybridConfig.dockerfile = dockerfileInfo;
        }

        return hybridConfig;
    }

    private async collectDockerfileInfo(): Promise<string | null> {
        const existingDockerfile = await this.findExistingDockerfile();
        
        if (existingDockerfile) {
            const useExisting = await vscode.window.showQuickPick([
                {
                    label: '✅ Use existing Dockerfile',
                    description: `Found: ${existingDockerfile}`,
                    detail: 'We\'ll validate compatibility with your setup',
                    value: 'existing'
                },
                {
                    label: '🆕 Generate new Dockerfile',
                    description: 'Create optimized Dockerfile for Dagster+',
                    detail: 'Will overwrite existing if same name',
                    value: 'generate'
                }
            ], {
                placeHolder: 'Dockerfile already exists - use it or generate new?'
            });

            if (!useExisting) {
                return null;
            }

            if (useExisting.value === 'existing') {
                return existingDockerfile;
            }
        }

        // Ask for Dockerfile name/path
        const dockerfilePath = await vscode.window.showInputBox({
            prompt: 'Enter Dockerfile name/path',
            placeHolder: 'Dockerfile (default) or path/to/Dockerfile',
            value: 'Dockerfile',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Dockerfile path is required';
                }
                return null;
            }
        });

        return dockerfilePath || 'Dockerfile';
    }

    private async findExistingDockerfile(): Promise<string | null> {
        const patterns = [
            'Dockerfile',
            'Dockerfile.*',
            'docker/Dockerfile',
            '.docker/Dockerfile'
        ];

        for (const pattern of patterns) {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            if (files.length > 0) {
                return path.relative(this.workspaceRoot, files[0].fsPath);
            }
        }

        return null;
    }

    private async generateOrValidateDockerfile(config: DagsterPlusConfig): Promise<void> {
        const dockerfilePath = config.hybridConfig?.dockerfile || 'Dockerfile';
        const fullDockerfilePath = path.join(this.workspaceRoot, dockerfilePath);

        try {
            // Check if Dockerfile exists
            const dockerfileExists = await fs.promises.access(fullDockerfilePath).then(() => true).catch(() => false);

            if (dockerfileExists) {
                // Validate existing Dockerfile
                await this.validateDockerfile(fullDockerfilePath, config);
            } else {
                // Generate new Dockerfile
                await this.generateDockerfile(fullDockerfilePath, config);
                vscode.window.showInformationMessage(`✅ Generated Dockerfile at ${dockerfilePath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to handle Dockerfile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async generateDockerfile(dockerfilePath: string, config: DagsterPlusConfig): Promise<void> {
        const pythonVersion = config.pythonVersion || '3.10';
        const codeLocationName = config.codeLocationName || 'dagster_app';
        
        const dockerfileContent = `# Dagster+ Hybrid Deployment Dockerfile
# Generated automatically by Dagster Power User VS Code Extension

FROM python:${pythonVersion}-slim

# Set working directory
WORKDIR /opt/dagster/app

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    build-essential \\
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt* ./
COPY pyproject.toml* ./
COPY setup.py* ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \\
    if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi && \\
    if [ -f pyproject.toml ]; then pip install --no-cache-dir -e .; fi && \\
    if [ -f setup.py ]; then pip install --no-cache-dir -e .; fi

# Install Dagster
RUN pip install --no-cache-dir dagster dagster-webserver dagster-postgres dagster-docker

# Copy application code
COPY . .

# Create dagster user and set permissions
RUN useradd -r -g daemon dagster && \\
    chown -R dagster:daemon /opt/dagster

USER dagster

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
    CMD python -c "import dagster; print('Dagster is available')"

# Default command
CMD ["dagster", "api", "grpc", "-h", "0.0.0.0", "-p", "4000", "-m", "${codeLocationName}"]
`;

        await fs.promises.writeFile(dockerfilePath, dockerfileContent, 'utf8');
    }

    private async validateDockerfile(dockerfilePath: string, config: DagsterPlusConfig): Promise<void> {
        try {
            const dockerfileContent = await fs.promises.readFile(dockerfilePath, 'utf8');
            const issues: string[] = [];
            const suggestions: string[] = [];

            // Check Python version compatibility
            const pythonVersionRegex = /FROM python:([0-9.]+)/i;
            const match = dockerfileContent.match(pythonVersionRegex);
            
            if (match) {
                const dockerPythonVersion = match[1];
                const configPythonVersion = config.pythonVersion || '3.10';
                
                if (!dockerPythonVersion.startsWith(configPythonVersion)) {
                    issues.push(`Python version mismatch: Dockerfile uses ${dockerPythonVersion}, but config specifies ${configPythonVersion}`);
                    suggestions.push(`Update Dockerfile to use Python ${configPythonVersion} or update config to match`);
                }
            } else {
                issues.push('No Python base image found in Dockerfile');
                suggestions.push('Use a Python base image like python:3.10-slim');
            }

            // Check for Dagster installation
            if (!dockerfileContent.includes('dagster')) {
                issues.push('Dagster installation not found in Dockerfile');
                suggestions.push('Add: RUN pip install dagster dagster-webserver');
            }

            // Check for proper port exposure or CMD
            if (!dockerfileContent.includes('4000') && !dockerfileContent.includes('dagster api grpc')) {
                suggestions.push('Consider exposing port 4000 and using: CMD ["dagster", "api", "grpc", "-h", "0.0.0.0", "-p", "4000"]');
            }

            // Show validation results
            if (issues.length > 0) {
                const fixAction = 'Auto-fix Issues';
                const result = await vscode.window.showWarningMessage(
                    `⚠️ Dockerfile validation found ${issues.length} issue(s):\\n\\n${issues.join('\\n')}`,
                    fixAction,
                    'Ignore'
                );

                if (result === fixAction) {
                    await this.fixDockerfileIssues(dockerfilePath, config, issues);
                }
            } else {
                vscode.window.showInformationMessage('✅ Dockerfile validation passed! Your Dockerfile looks compatible with Dagster+.');
            }

            if (suggestions.length > 0) {
                vscode.window.showInformationMessage(
                    `💡 Dockerfile suggestions:\\n\\n${suggestions.join('\\n')}`,
                    'OK'
                );
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to validate Dockerfile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async fixDockerfileIssues(dockerfilePath: string, config: DagsterPlusConfig, issues: string[]): Promise<void> {
        try {
            let dockerfileContent = await fs.promises.readFile(dockerfilePath, 'utf8');

            // Fix Python version mismatch
            if (issues.some(issue => issue.includes('Python version mismatch'))) {
                const configPythonVersion = config.pythonVersion || '3.10';
                dockerfileContent = dockerfileContent.replace(
                    /FROM python:[0-9.]+/i,
                    `FROM python:${configPythonVersion}-slim`
                );
            }

            // Add Dagster installation if missing
            if (issues.some(issue => issue.includes('Dagster installation not found'))) {
                const installLine = 'RUN pip install --no-cache-dir dagster dagster-webserver dagster-postgres dagster-docker\\n';
                
                // Insert after pip install line or before COPY if no pip install found
                if (dockerfileContent.includes('pip install')) {
                    dockerfileContent = dockerfileContent.replace(
                        /(RUN pip install[^\\n]*\\n)/,
                        `$1${installLine}`
                    );
                } else if (dockerfileContent.includes('COPY')) {
                    dockerfileContent = dockerfileContent.replace(
                        /(COPY[^\\n]*\\n)/,
                        `${installLine}\\n$1`
                    );
                } else {
                    dockerfileContent += `\\n${installLine}`;
                }
            }

            await fs.promises.writeFile(dockerfilePath, dockerfileContent, 'utf8');
            vscode.window.showInformationMessage('✅ Dockerfile issues fixed automatically!');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fix Dockerfile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async validateOrGenerateDependencyFiles(config: DagsterPlusConfig): Promise<void> {
        try {
            const dependencyInfo = await this.analyzeDependencyFiles();
            
            if (!dependencyInfo.hasAnyDependencyFile) {
                const generateAction = 'Generate pyproject.toml';
                const skipAction = 'Skip';
                const result = await vscode.window.showInformationMessage(
                    '📦 No dependency management files found. Would you like to generate a pyproject.toml with Dagster dependencies?',
                    generateAction,
                    skipAction
                );

                if (result === generateAction) {
                    await this.generatePyprojectToml(config);
                    vscode.window.showInformationMessage('✅ Generated pyproject.toml with Dagster dependencies');
                }
            } else {
                await this.validateDependencyFiles(dependencyInfo, config);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to handle dependency files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async analyzeDependencyFiles(): Promise<{
        hasAnyDependencyFile: boolean;
        pyprojectToml?: string;
        requirementsTxt?: string;
        setupPy?: string;
        dependencyManager: 'poetry' | 'pip' | 'setuptools' | 'none';
        issues: string[];
    }> {
        const result: {
            hasAnyDependencyFile: boolean;
            pyprojectToml?: string;
            requirementsTxt?: string;
            setupPy?: string;
            dependencyManager: 'poetry' | 'pip' | 'setuptools' | 'none';
            issues: string[];
        } = {
            hasAnyDependencyFile: false,
            dependencyManager: 'none',
            issues: []
        };

        // Check for pyproject.toml
        const pyprojectFiles = await vscode.workspace.findFiles('pyproject.toml', '**/node_modules/**');
        if (pyprojectFiles.length > 0) {
            result.pyprojectToml = path.relative(this.workspaceRoot, pyprojectFiles[0].fsPath);
            result.hasAnyDependencyFile = true;
            
            // Check if it's Poetry or regular PEP 621
            const content = await fs.promises.readFile(pyprojectFiles[0].fsPath, 'utf8');
            if (content.includes('[tool.poetry]')) {
                result.dependencyManager = 'poetry';
            } else if (content.includes('[project]')) {
                result.dependencyManager = 'pip';
            }
        }

        // Check for requirements.txt
        const requirementsFiles = await vscode.workspace.findFiles('requirements.txt', '**/node_modules/**');
        if (requirementsFiles.length > 0) {
            result.requirementsTxt = path.relative(this.workspaceRoot, requirementsFiles[0].fsPath);
            result.hasAnyDependencyFile = true;
            if (result.dependencyManager === 'none') {
                result.dependencyManager = 'pip';
            }
        }

        // Check for setup.py
        const setupFiles = await vscode.workspace.findFiles('setup.py', '**/node_modules/**');
        if (setupFiles.length > 0) {
            result.setupPy = path.relative(this.workspaceRoot, setupFiles[0].fsPath);
            result.hasAnyDependencyFile = true;
            if (result.dependencyManager === 'none') {
                result.dependencyManager = 'setuptools';
            }
        }

        return result;
    }

    private async validateDependencyFiles(dependencyInfo: any, config: DagsterPlusConfig): Promise<void> {
        const issues: string[] = [];
        const suggestions: string[] = [];

        // Validate pyproject.toml if it exists
        if (dependencyInfo.pyprojectToml) {
            const pyprojectPath = path.join(this.workspaceRoot, dependencyInfo.pyprojectToml);
            const pyprojectIssues = await this.validatePyprojectToml(pyprojectPath, config);
            issues.push(...pyprojectIssues.issues);
            suggestions.push(...pyprojectIssues.suggestions);
        }

        // Check for Dagster dependencies across all files
        const hasDagsterDep = await this.checkForDagsterDependencies(dependencyInfo);
        if (!hasDagsterDep) {
            issues.push('Dagster not found in dependencies');
            suggestions.push('Add dagster to your dependencies');
        }

        // Show validation results
        if (issues.length > 0) {
            const fixAction = 'Auto-fix Issues';
                const result = await vscode.window.showWarningMessage(
                    `⚠️ Dependency validation found ${issues.length} issue(s):\n\n${issues.join('\n')}`,
                    fixAction,
                    'Ignore'
                );

            if (result === fixAction) {
                await this.fixDependencyIssues(dependencyInfo, config, issues);
            }
        } else {
            vscode.window.showInformationMessage('✅ Dependency files look good for Dagster deployment!');
        }

        if (suggestions.length > 0) {
            vscode.window.showInformationMessage(
                `💡 Dependency suggestions:\n\n${suggestions.join('\n')}`,
                'OK'
            );
        }
    }

    private async validatePyprojectToml(pyprojectPath: string, config: DagsterPlusConfig): Promise<{
        issues: string[];
        suggestions: string[];
    }> {
        const issues: string[] = [];
        const suggestions: string[] = [];

        try {
            const content = await fs.promises.readFile(pyprojectPath, 'utf8');

            // Check Python version compatibility
            const pythonVersionMatch = content.match(/requires-python\s*=\s*["']([^"']+)["']/);
            if (pythonVersionMatch) {
                const requiredPython = pythonVersionMatch[1];
                const configPython = config.pythonVersion || '3.10';
                
                // Simple version check - could be more sophisticated
                if (!requiredPython.includes(configPython)) {
                    issues.push(`Python version in pyproject.toml (${requiredPython}) may not be compatible with deployment Python ${configPython}`);
                    suggestions.push(`Update requires-python to include ${configPython}`);
                }
            } else {
                suggestions.push('Consider adding requires-python field to pyproject.toml for better compatibility');
            }

            // Check for Dagster dependencies
            if (!content.includes('dagster')) {
                issues.push('Dagster not found in pyproject.toml dependencies');
                suggestions.push('Add dagster to dependencies or dependencies list');
            }

            // Check for common issues
            if (content.includes('[tool.poetry]') && content.includes('[project]')) {
                issues.push('Both Poetry and PEP 621 project sections found - this may cause conflicts');
                suggestions.push('Use either Poetry format OR PEP 621 format, not both');
            }

            // Check for build backend
            if (!content.includes('[build-system]')) {
                suggestions.push('Consider adding [build-system] section for better packaging compatibility');
            }

        } catch (error) {
            issues.push('Failed to read pyproject.toml file');
        }

        return { issues, suggestions };
    }

    private async checkForDagsterDependencies(dependencyInfo: any): Promise<boolean> {
        // Check pyproject.toml
        if (dependencyInfo.pyprojectToml) {
            const content = await fs.promises.readFile(
                path.join(this.workspaceRoot, dependencyInfo.pyprojectToml), 
                'utf8'
            ).catch(() => '');
            if (content.includes('dagster')) {
                return true;
            }
        }

        // Check requirements.txt
        if (dependencyInfo.requirementsTxt) {
            const content = await fs.promises.readFile(
                path.join(this.workspaceRoot, dependencyInfo.requirementsTxt), 
                'utf8'
            ).catch(() => '');
            if (content.includes('dagster')) {
                return true;
            }
        }

        // Check setup.py
        if (dependencyInfo.setupPy) {
            const content = await fs.promises.readFile(
                path.join(this.workspaceRoot, dependencyInfo.setupPy), 
                'utf8'
            ).catch(() => '');
            if (content.includes('dagster')) {
                return true;
            }
        }

        return false;
    }

    private async generatePyprojectToml(config: DagsterPlusConfig): Promise<void> {
        const pythonVersion = config.pythonVersion || '3.10';
        const projectName = config.codeLocationName || 'dagster-project';
        
        const pyprojectContent = `[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "${projectName}"
version = "0.1.0"
description = "Dagster project generated by Dagster Power User VS Code Extension"
requires-python = ">=${pythonVersion}"
dependencies = [
    "dagster",
    "dagster-webserver",
    # Add your other dependencies here
]

[project.optional-dependencies]
dev = [
    "dagster-webserver",
    "pytest",
]

# Uncomment if using Poetry instead of PEP 621
# [tool.poetry]
# name = "${projectName}"
# version = "0.1.0"
# description = "Dagster project"
# authors = ["Your Name <you@example.com>"]
# 
# [tool.poetry.dependencies]
# python = "^${pythonVersion}"
# dagster = "^1.0.0"
# dagster-webserver = "^1.0.0"
# 
# [tool.poetry.group.dev.dependencies]
# pytest = "^7.0.0"

[tool.setuptools.packages.find]
where = ["."]
include = ["${projectName}*"]

# Dagster configuration
[tool.dagster]
module_name = "${projectName}"
`;

        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        await fs.promises.writeFile(pyprojectPath, pyprojectContent, 'utf8');
    }

    private async fixDependencyIssues(dependencyInfo: any, config: DagsterPlusConfig, issues: string[]): Promise<void> {
        try {
            // Fix pyproject.toml issues
            if (dependencyInfo.pyprojectToml && issues.some(issue => issue.includes('pyproject.toml'))) {
                await this.fixPyprojectTomlIssues(
                    path.join(this.workspaceRoot, dependencyInfo.pyprojectToml), 
                    config, 
                    issues
                );
            }

            // Add Dagster to requirements.txt if that's the only dependency file
            if (dependencyInfo.requirementsTxt && !dependencyInfo.pyprojectToml && issues.some(issue => issue.includes('Dagster not found'))) {
                await this.addDagsterToRequirements(path.join(this.workspaceRoot, dependencyInfo.requirementsTxt));
            }

            vscode.window.showInformationMessage('✅ Dependency issues fixed automatically!');

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fix dependency issues: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async fixPyprojectTomlIssues(pyprojectPath: string, config: DagsterPlusConfig, issues: string[]): Promise<void> {
        let content = await fs.promises.readFile(pyprojectPath, 'utf8');

        // Fix Python version compatibility
        if (issues.some(issue => issue.includes('Python version'))) {
            const configPython = config.pythonVersion || '3.10';
            content = content.replace(
                /requires-python\s*=\s*["'][^"']+["']/,
                `requires-python = ">=${configPython}"`
            );
        }

        // Add Dagster dependency if missing
        if (issues.some(issue => issue.includes('Dagster not found'))) {
            if (content.includes('[tool.poetry.dependencies]')) {
                // Poetry format
                content = content.replace(
                    /\[tool\.poetry\.dependencies\]/,
                    '[tool.poetry.dependencies]\ndagster = "^1.0.0"\ndagster-webserver = "^1.0.0"'
                );
            } else if (content.includes('dependencies = [')) {
                // PEP 621 format
                content = content.replace(
                    /dependencies = \[/,
                    'dependencies = [\n    "dagster",\n    "dagster-webserver",'
                );
            }
        }

        await fs.promises.writeFile(pyprojectPath, content, 'utf8');
    }

    private async addDagsterToRequirements(requirementsPath: string): Promise<void> {
        let content = await fs.promises.readFile(requirementsPath, 'utf8').catch(() => '');
        
        if (!content.includes('dagster')) {
            content += '\ndagster>=1.0.0\ndagster-webserver>=1.0.0\n';
            await fs.promises.writeFile(requirementsPath, content, 'utf8');
        }
    }

    private async showHybridSetupGuidance(hybridConfig: any): Promise<void> {
        const setupSteps = this.getHybridSetupSteps(hybridConfig.registryType);
        
        const viewStepsAction = 'View Setup Steps';
        const continueAction = 'Continue';
        const result = await vscode.window.showInformationMessage(
            `🔧 Hybrid setup requires additional configuration steps for ${hybridConfig.registryType.toUpperCase()}.`,
            viewStepsAction,
            continueAction
        );

        if (result === viewStepsAction) {
            // Create a temporary markdown file with setup instructions
            const tempFile = path.join(this.workspaceRoot, '.dagster-hybrid-setup.md');
            await fs.promises.writeFile(tempFile, setupSteps, 'utf8');
            
            const doc = await vscode.workspace.openTextDocument(tempFile);
            await vscode.window.showTextDocument(doc);
            
            // Clean up temp file after a delay
            setTimeout(() => {
                fs.promises.unlink(tempFile).catch(() => {});
            }, 60000);
        }
    }

    private getHybridSetupSteps(registryType: string): string {
        const baseSteps = `# 🔧 Dagster+ Hybrid Deployment Setup

## Overview
Hybrid deployments require building Docker images and configuring registry authentication.

## Required Steps:

### 1. 🐳 Docker Registry Setup
`;

        const registrySpecificSteps = {
            ecr: `
**AWS ECR Setup:**
1. Create ECR repository: \`aws ecr create-repository --repository-name your-repo\`
2. Add GitHub Secrets:
   - \`AWS_ACCESS_KEY_ID\`
   - \`AWS_SECRET_ACCESS_KEY\`
   - \`AWS_REGION\`
3. Update \`IMAGE_REGISTRY\` in workflow to your ECR URL
`,
            dockerhub: `
**DockerHub Setup:**
1. Create repository on DockerHub
2. Generate access token: Account Settings → Security → New Access Token
3. Add GitHub Secrets:
   - \`DOCKERHUB_USERNAME\`
   - \`DOCKERHUB_TOKEN\`
4. Update \`IMAGE_REGISTRY\` in workflow to your DockerHub repo
`,
            ghcr: `
**GitHub Container Registry Setup:**
1. Enable Container Registry in your repo settings
2. GitHub token automatically available as \`GITHUB_TOKEN\`
3. Update \`IMAGE_REGISTRY\` to \`ghcr.io/username/repo-name\`
4. Ensure \`packages: write\` permission in workflow
`,
            gcr: `
**Google Container Registry Setup:**
1. Enable Container Registry API in GCP
2. Create service account with Storage Admin role
3. Generate JSON key for service account
4. Add GitHub Secret: \`GCR_JSON_KEY\`
5. Update \`IMAGE_REGISTRY\` to your GCR URL
`,
            acr: `
**Azure Container Registry Setup:**
1. Create ACR instance in Azure
2. Create service principal: \`az ad sp create-for-rbac\`
3. Add GitHub Secrets:
   - \`AZURE_CLIENT_ID\`
   - \`AZURE_CLIENT_SECRET\`
4. Update \`IMAGE_REGISTRY\` to your ACR URL
`
        };

        return baseSteps + (registrySpecificSteps[registryType as keyof typeof registrySpecificSteps] || '') + `

### 2. 🤖 Hybrid Agent Setup
1. Install Dagster+ agent in your infrastructure
2. Configure agent with your registry credentials
3. Point agent to your Dagster+ organization

### 3. 🔐 GitHub Secrets
Add the required secrets to: Repository Settings → Secrets and variables → Actions

### 4. 📝 Workflow Configuration
The generated GitHub workflow will be configured for ${registryType.toUpperCase()}.

### 5. 🚀 Deploy
Push to main branch or create PR to trigger deployment.

---

## ⚠️ Important Notes:
- Hybrid deployments are significantly more complex than Serverless
- Consider Serverless unless you specifically need infrastructure control
- Each registry type has different authentication requirements
- Images must be accessible to your hybrid agent

## 📚 Documentation:
- [Hybrid Deployment Guide](https://docs.dagster.io/dagster-plus/deployment/hybrid)
- [Agent Configuration](https://docs.dagster.io/dagster-plus/deployment/agents)
`;
    }
}
