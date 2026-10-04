import * as vscode from 'vscode';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface SetupOptions {
    createVenv?: boolean;
    installDagster?: boolean;
    installDgCli?: boolean;
    installDependencies?: boolean;
    pythonVersion?: string;
    packageManager?: 'pip' | 'poetry' | 'uv' | 'pipenv';
}

export interface SetupResult {
    success: boolean;
    steps: SetupStep[];
    errors: string[];
}

export interface SetupStep {
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    output?: string;
    error?: string;
}

/**
 * Manages comprehensive Dagster project setup
 */
export class ProjectSetupManager {
    private workspaceRoot: string;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.outputChannel = vscode.window.createOutputChannel('Dagster Project Setup');
    }

    /**
     * One-click project setup: dependencies + dg CLI + venv + instant deploy
     */
    async instantSetup(options: SetupOptions = {}): Promise<SetupResult> {
        const steps: SetupStep[] = [
            { name: 'Detect Project Structure', status: 'pending' },
            { name: 'Setup Python Environment', status: 'pending' },
            { name: 'Install Dependencies', status: 'pending' },
            { name: 'Install Dagster & DG CLI', status: 'pending' },
            { name: 'Validate Installation', status: 'pending' },
            { name: 'Ready for Development', status: 'pending' }
        ];

        const result: SetupResult = {
            success: false,
            steps,
            errors: []
        };

        this.outputChannel.show();
        this.outputChannel.appendLine('🚀 Starting Dagster Project Instant Setup...');
        this.outputChannel.appendLine('=' .repeat(50));

        try {
            // Step 1: Detect Project Structure
            await this.executeStep(steps[0], async () => {
                const projectInfo = await this.detectProjectStructure();
                this.outputChannel.appendLine(`📁 Project type: ${projectInfo.type}`);
                this.outputChannel.appendLine(`🐍 Python files detected: ${projectInfo.hasPythonFiles}`);
                this.outputChannel.appendLine(`📦 Dependency files: ${projectInfo.dependencyFiles.join(', ') || 'None'}`);
                
                // Auto-detect package manager
                if (!options.packageManager) {
                    options.packageManager = projectInfo.preferredPackageManager;
                }
                
                return projectInfo;
            });

            // Step 2: Setup Python Environment
            await this.executeStep(steps[1], async () => {
                if (options.createVenv !== false) {
                    await this.setupPythonEnvironment(options);
                } else {
                    this.outputChannel.appendLine('⏭️ Skipping virtual environment setup');
                }
            });

            // Step 3: Install Dependencies
            await this.executeStep(steps[2], async () => {
                if (options.installDependencies !== false) {
                    await this.installProjectDependencies(options);
                } else {
                    this.outputChannel.appendLine('⏭️ Skipping dependency installation');
                }
            });

            // Step 4: Install Dagster & DG CLI
            await this.executeStep(steps[3], async () => {
                if (options.installDagster !== false) {
                    await this.installDagsterAndCli(options);
                } else {
                    this.outputChannel.appendLine('⏭️ Skipping Dagster installation');
                }
            });

            // Step 5: Validate Installation
            await this.executeStep(steps[4], async () => {
                await this.validateInstallation();
            });

            // Step 6: Ready
            steps[5].status = 'completed';
            result.success = true;
            
            this.outputChannel.appendLine('=' .repeat(50));
            this.outputChannel.appendLine('🎉 Dagster Project Setup Complete!');
            this.outputChannel.appendLine('✅ Ready for development and deployment');

        } catch (error: any) {
            result.errors.push(error.message);
            this.outputChannel.appendLine(`❌ Setup failed: ${error.message}`);
        }

        return result;
    }

    /**
     * Quick environment setup for existing projects
     */
    async quickEnvironmentSetup(): Promise<SetupResult> {
        return this.instantSetup({
            createVenv: true,
            installDependencies: true,
            installDagster: true,
            installDgCli: true
        });
    }

    /**
     * Install only Dagster and DG CLI
     */
    async installDagsterOnly(): Promise<SetupResult> {
        return this.instantSetup({
            createVenv: false,
            installDependencies: false,
            installDagster: true,
            installDgCli: true
        });
    }

    /**
     * Full development environment setup
     */
    async fullDevSetup(): Promise<SetupResult> {
        return this.instantSetup({
            createVenv: true,
            installDependencies: true,
            installDagster: true,
            installDgCli: true,
            packageManager: await this.detectBestPackageManager()
        });
    }

    // =================== PRIVATE METHODS ===================

    private async executeStep(step: SetupStep, operation: () => Promise<any>): Promise<void> {
        step.status = 'running';
        this.outputChannel.appendLine(`🔄 ${step.name}...`);
        
        try {
            await operation();
            step.status = 'completed';
            this.outputChannel.appendLine(`✅ ${step.name} completed`);
        } catch (error: any) {
            step.status = 'failed';
            step.error = error.message;
            this.outputChannel.appendLine(`❌ ${step.name} failed: ${error.message}`);
            throw error;
        }
    }

    private async detectProjectStructure(): Promise<{
        type: 'dagster' | 'python' | 'empty';
        hasPythonFiles: boolean;
        dependencyFiles: string[];
        preferredPackageManager: 'pip' | 'poetry' | 'uv' | 'pipenv';
    }> {
        const files = await fs.promises.readdir(this.workspaceRoot);
        
        const dependencyFiles = files.filter(file => 
            ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py', 'setup.cfg'].includes(file)
        );

        const hasPythonFiles = files.some(file => file.endsWith('.py')) ||
            await this.hasNestedPythonFiles();

        const isDagsterProject = files.includes('dagster_cloud.yaml') ||
            files.includes('workspace.yaml') ||
            await this.containsDagsterImports();

        let preferredPackageManager: 'pip' | 'poetry' | 'uv' | 'pipenv' = 'pip';
        if (files.includes('pyproject.toml')) {
            const pyprojectContent = await fs.promises.readFile(
                path.join(this.workspaceRoot, 'pyproject.toml'), 'utf8'
            );
            if (pyprojectContent.includes('[tool.poetry]')) {
                preferredPackageManager = 'poetry';
            } else if (pyprojectContent.includes('[tool.uv]')) {
                preferredPackageManager = 'uv';
            }
        } else if (files.includes('Pipfile')) {
            preferredPackageManager = 'pipenv';
        }

        return {
            type: isDagsterProject ? 'dagster' : (hasPythonFiles ? 'python' : 'empty'),
            hasPythonFiles,
            dependencyFiles,
            preferredPackageManager
        };
    }

    private async hasNestedPythonFiles(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('find . -name "*.py" -type f | head -1', { cwd: this.workspaceRoot });
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    private async containsDagsterImports(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('grep -r "import dagster\\|from dagster" . --include="*.py" | head -1', { cwd: this.workspaceRoot });
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    private async setupPythonEnvironment(options: SetupOptions): Promise<void> {
        const venvPath = path.join(this.workspaceRoot, '.venv');
        
        // Check if .venv already exists
        try {
            await fs.promises.access(venvPath);
            this.outputChannel.appendLine('📁 Virtual environment already exists');
            return;
        } catch {
            // .venv doesn't exist, create it
        }

        this.outputChannel.appendLine('🐍 Creating Python virtual environment...');
        
        const pythonCmd = options.pythonVersion ? `python${options.pythonVersion}` : 'python3';
        
        try {
            await execAsync(`${pythonCmd} -m venv .venv`, { cwd: this.workspaceRoot });
            this.outputChannel.appendLine('✅ Virtual environment created at .venv');
        } catch (error) {
            // Try with just 'python' if python3 fails
            await execAsync('python -m venv .venv', { cwd: this.workspaceRoot });
            this.outputChannel.appendLine('✅ Virtual environment created at .venv');
        }

        // Activate venv for subsequent commands
        this.outputChannel.appendLine('💡 Virtual environment ready. Use: source .venv/bin/activate');
    }

    private async installProjectDependencies(options: SetupOptions): Promise<void> {
        const packageManager = options.packageManager || 'pip';
        const activateCmd = this.getActivateCommand();

        this.outputChannel.appendLine(`📦 Installing dependencies with ${packageManager}...`);

        switch (packageManager) {
            case 'poetry':
                await execAsync('poetry install', { cwd: this.workspaceRoot });
                break;
            case 'pipenv':
                await execAsync('pipenv install', { cwd: this.workspaceRoot });
                break;
            case 'uv':
                await execAsync('uv pip install -r requirements.txt', { cwd: this.workspaceRoot });
                break;
            default: // pip
                if (await this.fileExists('requirements.txt')) {
                await execAsync(`${activateCmd} pip install -r requirements.txt`, { 
                    cwd: this.workspaceRoot
                });
                } else if (await this.fileExists('pyproject.toml')) {
                    await execAsync(`${activateCmd} pip install -e .`, { 
                        cwd: this.workspaceRoot
                    });
                }
                break;
        }

        this.outputChannel.appendLine('✅ Project dependencies installed');
    }

    private async installDagsterAndCli(options: SetupOptions): Promise<void> {
        const activateCmd = this.getActivateCommand();
        const packageManager = options.packageManager || 'pip';

        this.outputChannel.appendLine('🔧 Installing Dagster and DG CLI...');

        const dagsterPackages = [
            'dagster',
            'dagster-webserver',
            'dagster-dg'  // Contains the dg CLI
        ];

        switch (packageManager) {
            case 'poetry':
                for (const pkg of dagsterPackages) {
                    await execAsync(`poetry add ${pkg}`, { cwd: this.workspaceRoot });
                }
                break;
            case 'pipenv':
                await execAsync(`pipenv install ${dagsterPackages.join(' ')}`, { cwd: this.workspaceRoot });
                break;
            case 'uv':
                await execAsync(`uv pip install ${dagsterPackages.join(' ')}`, { cwd: this.workspaceRoot });
                break;
            default: // pip
                await execAsync(`${activateCmd} pip install ${dagsterPackages.join(' ')}`, { 
                    cwd: this.workspaceRoot
                });
                break;
        }

        this.outputChannel.appendLine('✅ Dagster and DG CLI installed');
    }

    private async validateInstallation(): Promise<void> {
        this.outputChannel.appendLine('🔍 Validating installation...');
        
        const activateCmd = this.getActivateCommand();

        try {
            // Test dagster import
            await execAsync(`${activateCmd} python -c "import dagster; print('Dagster version:', dagster.__version__)"`, {
                cwd: this.workspaceRoot
            });
            this.outputChannel.appendLine('✅ Dagster import successful');

            // Test dg CLI
            await execAsync(`${activateCmd} dg --version`, {
                cwd: this.workspaceRoot
            });
            this.outputChannel.appendLine('✅ DG CLI available');

        } catch (error: any) {
            this.outputChannel.appendLine(`⚠️ Validation warning: ${error.message}`);
            // Don't throw - partial success is still useful
        }
    }

    private getActivateCommand(): string {
        const isWindows = process.platform === 'win32';
        return isWindows ? '.venv\\Scripts\\activate &&' : 'source .venv/bin/activate &&';
    }

    private async fileExists(filename: string): Promise<boolean> {
        try {
            await fs.promises.access(path.join(this.workspaceRoot, filename));
            return true;
        } catch {
            return false;
        }
    }

    private async detectBestPackageManager(): Promise<'pip' | 'poetry' | 'uv' | 'pipenv'> {
        // Check for package manager availability
        const managers = ['uv', 'poetry', 'pipenv', 'pip'];
        
        for (const manager of managers) {
            try {
                await execAsync(`${manager} --version`);
                return manager as any;
            } catch {
                continue;
            }
        }
        
        return 'pip'; // fallback
    }

    /**
     * Clone → Setup → Deploy workflow
     */
    async cloneSetupDeploy(repoUrl: string, deployToDagsterPlus: boolean = true): Promise<SetupResult> {
        this.outputChannel.appendLine('🚀 Starting Clone → Setup → Deploy workflow...');
        
        try {
            // Step 1: Clone (if URL provided)
            if (repoUrl) {
                this.outputChannel.appendLine(`📥 Cloning repository: ${repoUrl}`);
                const repoName = path.basename(repoUrl, '.git');
                await execAsync(`git clone ${repoUrl}`, { cwd: path.dirname(this.workspaceRoot) });
                
                // Update workspace root to cloned directory
                this.workspaceRoot = path.join(path.dirname(this.workspaceRoot), repoName);
            }

            // Step 2: Setup
            const setupResult = await this.instantSetup();
            if (!setupResult.success) {
                return setupResult;
            }

            // Step 3: Deploy (optional)
            if (deployToDagsterPlus) {
                this.outputChannel.appendLine('🚀 Triggering instant deploy to Dagster+...');
                vscode.commands.executeCommand('dagster.instantDeploy');
            }

            return setupResult;

        } catch (error: any) {
            return {
                success: false,
                steps: [],
                errors: [error.message]
            };
        }
    }

    /**
     * Show output channel
     */
    showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Clear output channel
     */
    clearOutput(): void {
        this.outputChannel.clear();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}
