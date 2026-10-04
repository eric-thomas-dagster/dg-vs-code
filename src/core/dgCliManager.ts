import * as vscode from 'vscode';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DgCheckResult {
    success: boolean;
    output: string;
    errors: string[];
    warnings: string[];
}

export interface DgListResult {
    success: boolean;
    data: any;
    output: string;
}

export interface DgDevOptions {
    port?: number;
    host?: string;
    livePollRate?: number;
    logLevel?: 'critical' | 'error' | 'warning' | 'info' | 'debug';
    checkYaml?: boolean;
    moduleName?: string;
    pythonFile?: string;
    workingDirectory?: string;
}

export interface DgLaunchOptions {
    assets?: string;
    job?: string;
    partition?: string;
    partitionRange?: string;
    configJson?: string;
    config?: string;
    moduleName?: string;
    pythonFile?: string;
    workingDirectory?: string;
}

export interface DgScaffoldOptions {
    componentType: string;
    outputPath: string;
    name?: string;
}

/**
 * Comprehensive manager for Dagster dg CLI operations
 */
export class DgCliManager {
    private workspaceRoot: string;
    private dagsterProjectRoot: string;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.dagsterProjectRoot = this.detectDagsterProjectRoot();
        this.outputChannel = vscode.window.createOutputChannel('Dagster DG CLI');
    }

    /**
     * Detect the correct Dagster project directory
     * Starts from the currently active file and walks up to find the nearest Dagster project
     */
    private detectDagsterProjectRoot(): string {
        const fs = require('fs');
        const path = require('path');
        
        // Try to get the currently active file's directory
        const activeEditor = vscode.window.activeTextEditor;
        let startingPath = this.workspaceRoot;
        
        if (activeEditor && activeEditor.document.uri.scheme === 'file') {
            startingPath = path.dirname(activeEditor.document.uri.fsPath);
            console.log(`🔍 Starting Dagster project detection from active file: ${startingPath}`);
        } else {
            console.log(`🔍 No active file, starting from workspace root: ${startingPath}`);
        }
        
        // Walk up the directory tree to find a Dagster project
        const dagsterProjectPath = this.findDagsterProjectRoot(startingPath);
        if (dagsterProjectPath) {
            console.log(`✅ Found Dagster project at: ${dagsterProjectPath}`);
            return dagsterProjectPath;
        }
        
        // Fallback: Check workspace root and example/ subdirectory (for compatibility)
        console.log(`📁 No Dagster project found, checking workspace root and example/`);
        const hasDagsterInRoot = this.isDagsterProject(this.workspaceRoot);
        
        if (!hasDagsterInRoot && fs.existsSync(path.join(this.workspaceRoot, 'example'))) {
            const examplePath = path.join(this.workspaceRoot, 'example');
            if (this.isDagsterProject(examplePath)) {
                console.log(`✅ Using example/ directory: ${examplePath}`);
                return examplePath;
            }
        }
        
        console.log(`⚠️ No Dagster project detected, using workspace root: ${this.workspaceRoot}`);
        return this.workspaceRoot;
    }

    /**
     * Walk up the directory tree to find the nearest Dagster project
     */
    private findDagsterProjectRoot(startPath: string): string | null {
        const fs = require('fs');
        const path = require('path');
        
        let currentPath = startPath;
        
        // Don't go above the workspace root
        while (currentPath && currentPath.startsWith(this.workspaceRoot)) {
            if (this.isDagsterProject(currentPath)) {
                return currentPath;
            }
            
            const parentPath = path.dirname(currentPath);
            // Prevent infinite loop if we reach the root
            if (parentPath === currentPath) {
                break;
            }
            currentPath = parentPath;
        }
        
        return null;
    }

    /**
     * Check if a directory contains a Dagster project
     */
    private isDagsterProject(dirPath: string): boolean {
        const fs = require('fs');
        const path = require('path');
        
        // Check for common Dagster files
        const dagsterFiles = [
            'dagster_example.py',
            'workspace.yaml',
            'dagster.yaml'
        ];
        
        for (const file of dagsterFiles) {
            if (fs.existsSync(path.join(dirPath, file))) {
                console.log(`🎯 Found Dagster file: ${file} in ${dirPath}`);
                return true;
            }
        }
        
        // Check for pyproject.toml with Dagster configuration
        const pyprojectPath = path.join(dirPath, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath)) {
            try {
                const content = fs.readFileSync(pyprojectPath, 'utf8');
                if (content.includes('[tool.dg]') || content.includes('dagster')) {
                    console.log(`🎯 Found pyproject.toml with Dagster config in ${dirPath}`);
                    return true;
                }
            } catch (error) {
                console.log(`⚠️ Could not read pyproject.toml in ${dirPath}:`, error);
            }
        }
        
        return false;
    }

    /**
     * Detect the virtual environment for the current project
     */
    private detectVirtualEnvironment(): string | null {
        const fs = require('fs');
        const path = require('path');
        
        // Common virtual environment locations
        const venvPaths = [
            path.join(this.dagsterProjectRoot, '.venv'),
            path.join(this.dagsterProjectRoot, 'venv'),
            path.join(this.dagsterProjectRoot, '.env'),
            path.join(this.dagsterProjectRoot, 'env')
        ];
        
        for (const venvPath of venvPaths) {
            const activateScript = path.join(venvPath, 'bin', 'activate');
            const pythonBinary = path.join(venvPath, 'bin', 'python');
            
            if (fs.existsSync(activateScript) && fs.existsSync(pythonBinary)) {
                console.log(`🐍 Found virtual environment: ${venvPath}`);
                return venvPath;
            }
        }
        
        console.log(`📝 No virtual environment found in project root: ${this.dagsterProjectRoot}`);
        return null;
    }

    /**
     * Build command with virtual environment activation if needed
     */
    private async buildCommandWithVenv(command: string): Promise<string> {
        const venvPath = this.detectVirtualEnvironment();
        
        if (venvPath) {
            const path = require('path');
            const activateScript = path.join(venvPath, 'bin', 'activate');
            // Use shell command to source the activate script and then run the command
            const wrappedCommand = `source "${activateScript}" && ${command}`;
            console.log(`🔧 Wrapping command with venv activation: ${wrappedCommand}`);
            return wrappedCommand;
        }
        
        console.log(`📝 No virtual environment detected`);
        
        // Offer to create virtual environment
        const shouldCreateVenv = await this.promptForVenvCreation();
        if (shouldCreateVenv) {
            const createdVenvPath = await this.createVirtualEnvironment();
            if (createdVenvPath) {
                const path = require('path');
                const activateScript = path.join(createdVenvPath, 'bin', 'activate');
                const wrappedCommand = `source "${activateScript}" && ${command}`;
                console.log(`🔧 Wrapping command with newly created venv: ${wrappedCommand}`);
                return wrappedCommand;
            }
        }
        
        console.log(`🔧 Using command without venv: ${command}`);
        return command;
    }

    /**
     * Prompt user to create a virtual environment
     */
    private async promptForVenvCreation(): Promise<boolean> {
        const choice = await vscode.window.showInformationMessage(
            '🐍 No virtual environment detected for this Dagster project. Would you like to create one?',
            { modal: true },
            'Yes, create .venv',
            'No, continue without'
        );
        
        return choice === 'Yes, create .venv';
    }

    /**
     * Create virtual environment and install dependencies
     */
    private async createVirtualEnvironment(): Promise<string | null> {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const venvPath = path.join(this.dagsterProjectRoot, '.venv');
            
            this.outputChannel.show();
            this.outputChannel.appendLine('🐍 Creating virtual environment...');
            
            // Create virtual environment
            await execAsync('python3 -m venv .venv', { 
                cwd: this.dagsterProjectRoot,
                shell: '/bin/bash'
            });
            
            this.outputChannel.appendLine('✅ Virtual environment created');
            
            // Install dependencies
            await this.installDependencies(venvPath);
            
            console.log(`✅ Virtual environment created and configured: ${venvPath}`);
            return venvPath;
            
        } catch (error) {
            console.error('❌ Failed to create virtual environment:', error);
            vscode.window.showErrorMessage(`Failed to create virtual environment: ${error}`);
            return null;
        }
    }

    /**
     * Install dependencies in the virtual environment
     */
    private async installDependencies(venvPath: string): Promise<void> {
        const fs = require('fs');
        const path = require('path');
        
        const activateScript = path.join(venvPath, 'bin', 'activate');
        const pyprojectPath = path.join(this.dagsterProjectRoot, 'pyproject.toml');
        const requirementsPath = path.join(this.dagsterProjectRoot, 'requirements.txt');
        
        try {
            if (fs.existsSync(pyprojectPath)) {
                this.outputChannel.appendLine('📦 Installing dependencies from pyproject.toml...');
                await execAsync(`source "${activateScript}" && pip install -e .`, {
                    cwd: this.dagsterProjectRoot,
                    shell: '/bin/bash'
                });
                this.outputChannel.appendLine('✅ Dependencies installed from pyproject.toml');
                
            } else if (fs.existsSync(requirementsPath)) {
                this.outputChannel.appendLine('📦 Installing dependencies from requirements.txt...');
                await execAsync(`source "${activateScript}" && pip install -r requirements.txt`, {
                    cwd: this.dagsterProjectRoot,
                    shell: '/bin/bash'
                });
                this.outputChannel.appendLine('✅ Dependencies installed from requirements.txt');
                
            } else {
                // Install basic Dagster dependencies
                this.outputChannel.appendLine('📦 Installing basic Dagster dependencies...');
                await execAsync(`source "${activateScript}" && pip install dagster dagster-webserver`, {
                    cwd: this.dagsterProjectRoot,
                    shell: '/bin/bash'
                });
                this.outputChannel.appendLine('✅ Basic Dagster dependencies installed');
            }
            
        } catch (error) {
            console.error('⚠️ Failed to install dependencies:', error);
            vscode.window.showWarningMessage(`Warning: Failed to install dependencies: ${error}`);
        }
    }

    /**
     * Refresh the Dagster project root based on the currently active file
     * Call this before executing commands to ensure we're in the right project
     */
    public refreshProjectRoot(): void {
        const newProjectRoot = this.detectDagsterProjectRoot();
        if (newProjectRoot !== this.dagsterProjectRoot) {
            console.log(`🔄 Switching Dagster project from ${this.dagsterProjectRoot} to ${newProjectRoot}`);
            this.dagsterProjectRoot = newProjectRoot;
        }
    }

    /**
     * Get the current Dagster project root
     */
    public getCurrentProjectRoot(): string {
        return this.dagsterProjectRoot;
    }

    // =================== DG CHECK COMMANDS ===================

    /**
     * Run dg check defs - validates Dagster definitions
     */
    async checkDefs(options: {
        logLevel?: string;
        verbose?: boolean;
        checkYaml?: boolean;
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildCheckDefsCommand(options);
        return this.executeCheckCommand(cmd, 'Checking Dagster definitions...');
    }

    /**
     * Run dg check toml - validates TOML configuration files
     */
    async checkToml(options: {
        verbose?: boolean;
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildCheckTomlCommand(options);
        return this.executeCheckCommand(cmd, 'Checking TOML configuration...');
    }

    /**
     * Run dg check yaml - validates YAML files against schemas
     */
    async checkYaml(options: {
        paths?: string[];
        watch?: boolean;
        validateRequirements?: boolean;
        verbose?: boolean;
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildCheckYamlCommand(options);
        return this.executeCheckCommand(cmd, 'Checking YAML configuration...');
    }

    // =================== DG DEV COMMAND ===================

    /**
     * Start dg dev - local Dagster development server
     */
    async startDev(options: DgDevOptions = {}): Promise<vscode.Disposable> {
        // Refresh project root based on currently active file
        this.refreshProjectRoot();
        const cmd = this.buildDevCommand(options);
        const expectedPort = options.port || 3000;
        
        this.outputChannel.show();
        this.outputChannel.appendLine(`🚀 Starting Dagster dev server...`);
        this.outputChannel.appendLine(`Command: ${cmd}`);
        this.outputChannel.appendLine(`Expected port: ${expectedPort}`);

        return new Promise(async (resolve, reject) => {
            // Wrap command with virtual environment activation if available
            const wrappedCommand = await this.buildCommandWithVenv(cmd);
            this.outputChannel.appendLine(`Executing: ${wrappedCommand}`);
            
            const process = spawn(wrappedCommand, [], {
                cwd: this.dagsterProjectRoot,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let serverStarted = false;
            let detectedPort: number | null = null;

            process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(output);
                
                // Try to detect the port from server output
                if (!serverStarted && (output.includes('Running on') || output.includes('Serving dagster-webserver'))) {
                    // Look for port patterns in the output
                    const portMatches = output.match(/(?:port\s+|:)(\d{4,5})/i) || output.match(/localhost:(\d{4,5})/);
                    if (portMatches) {
                        detectedPort = parseInt(portMatches[1]);
                        this.outputChannel.appendLine(`📍 Detected server on port ${detectedPort}`);
                        
                        // Show success notification with port info
                        vscode.window.showInformationMessage(
                            `✅ Dagster dev server is running on port ${detectedPort}!`, 
                            'Open UI'
                        ).then(selection => {
                            if (selection === 'Open UI') {
                                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${detectedPort}`));
                            }
                        });
                        
                        // Update VS Code configuration for this port
                        this.updateVSCodeConfiguration(detectedPort);
                        
                        serverStarted = true;
                    }
                }
            });

            process.stderr?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`ERROR: ${output}`);
                
                // Also check stderr for port information (some servers log to stderr)
                if (!serverStarted && (output.includes('Running on') || output.includes('Serving'))) {
                    const portMatches = output.match(/(?:port\s+|:)(\d{4,5})/i) || output.match(/localhost:(\d{4,5})/);
                    if (portMatches) {
                        detectedPort = parseInt(portMatches[1]);
                        this.outputChannel.appendLine(`📍 Detected server on port ${detectedPort}`);
                        
                        vscode.window.showInformationMessage(
                            `✅ Dagster dev server is running on port ${detectedPort}!`, 
                            'Open UI'
                        ).then(selection => {
                            if (selection === 'Open UI') {
                                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${detectedPort}`));
                            }
                        });
                        
                        // Update VS Code configuration for this port
                        this.updateVSCodeConfiguration(detectedPort);
                        
                        serverStarted = true;
                    }
                }
            });

            process.on('spawn', () => {
                this.outputChannel.appendLine('✅ Dagster dev server process started');
                
                // Set a timeout to show success message if we don't detect port from output
                setTimeout(() => {
                    if (!serverStarted) {
                        const portToUse = detectedPort || expectedPort;
                        this.outputChannel.appendLine(`📍 Assuming server is on port ${portToUse}`);
                        vscode.window.showInformationMessage(
                            `✅ Dagster dev server started (port ${portToUse})!`, 
                            'Open UI'
                        ).then(selection => {
                            if (selection === 'Open UI') {
                                vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${portToUse}`));
                            }
                        });
                    }
                }, 5000); // Give it 5 seconds to detect the port
                
                // Return disposable to stop the process
                resolve({
                    dispose: () => {
                        process.kill();
                        this.outputChannel.appendLine('🛑 Dagster dev server stopped');
                    }
                });
            });

            process.on('error', (error) => {
                this.outputChannel.appendLine(`❌ Failed to start dev server: ${error.message}`);
                reject(error);
            });
        });
    }

    // =================== DG LAUNCH COMMAND ===================

    /**
     * Launch a Dagster run
     */
    async launch(options: DgLaunchOptions = {}): Promise<DgCheckResult> {
        // Refresh project root based on currently active file
        this.refreshProjectRoot();
        
        // If launching a specific job, first check if it exists in CLI
        if (options.job) {
            const jobExists = await this.verifyJobExists(options.job);
            if (!jobExists) {
                // Try to suggest available jobs
                const availableJobs = await this.getAvailableJobs();
                const suggestion = availableJobs.length > 0 
                    ? `Available jobs: ${availableJobs.join(', ')}`
                    : 'No jobs found via CLI. Try using the GraphQL "Execute Job" command instead.';
                
                return {
                    success: false,
                    output: '',
                    errors: [`Job "${options.job}" not found in CLI context. ${suggestion}`],
                    warnings: []
                };
            }
        }
        
        const cmd = this.buildLaunchCommand(options);
        return this.executeCommand(cmd, 'Launching Dagster run...');
    }

    /**
     * Verify if a job exists in the CLI context
     */
    private async verifyJobExists(jobName: string): Promise<boolean> {
        try {
            console.log(`🔍 Verifying job "${jobName}" exists in CLI context...`);
            const wrappedCommand = await this.buildCommandWithVenv('dg list defs --json');
            
            const { stdout } = await execAsync(wrappedCommand, {
                cwd: this.dagsterProjectRoot,
                shell: '/bin/bash'
            });
            
            const defsData = JSON.parse(stdout);
            const jobs = defsData.jobs || [];
            const jobExists = jobs.some((job: any) => job.name === jobName);
            
            console.log(`🎯 Job "${jobName}" ${jobExists ? 'found' : 'not found'} in CLI context`);
            return jobExists;
            
        } catch (error) {
            console.log(`⚠️ Could not verify job existence: ${error}`);
            return true; // Assume it exists if we can't check
        }
    }

    /**
     * Get list of available jobs from CLI
     */
    private async getAvailableJobs(): Promise<string[]> {
        try {
            const wrappedCommand = await this.buildCommandWithVenv('dg list defs --json');
            
            const { stdout } = await execAsync(wrappedCommand, {
                cwd: this.dagsterProjectRoot,
                shell: '/bin/bash'
            });
            
            const defsData = JSON.parse(stdout);
            const jobs = defsData.jobs || [];
            return jobs.map((job: any) => job.name);
            
        } catch (error) {
            console.log(`⚠️ Could not get available jobs: ${error}`);
            return [];
        }
    }

    // =================== DG LIST COMMANDS ===================

    /**
     * List Dagster definitions
     */
    async listDefs(options: {
        json?: boolean;
        path?: string;
        assets?: string;
        columns?: string[];
        targetPath?: string;
    } = {}): Promise<DgListResult> {
        // Refresh project root based on currently active file
        this.refreshProjectRoot();
        const cmd = this.buildListDefsCommand(options);
        return this.executeListCommand(cmd, 'Listing definitions...');
    }

    /**
     * List available component types
     */
    async listComponents(options: {
        package?: string;
        json?: boolean;
        targetPath?: string;
    } = {}): Promise<DgListResult> {
        const cmd = this.buildListComponentsCommand(options);
        return this.executeListCommand(cmd, 'Listing components...');
    }

    /**
     * List environment variables
     */
    async listEnvs(options: {
        targetPath?: string;
    } = {}): Promise<DgListResult> {
        const cmd = this.buildListEnvsCommand(options);
        return this.executeListCommand(cmd, 'Listing environment variables...');
    }

    /**
     * List projects in workspace
     */
    async listProjects(options: {
        targetPath?: string;
    } = {}): Promise<DgListResult> {
        const cmd = this.buildListProjectsCommand(options);
        return this.executeListCommand(cmd, 'Listing projects...');
    }

    /**
     * List registry modules
     */
    async listRegistryModules(options: {
        json?: boolean;
        targetPath?: string;
    } = {}): Promise<DgListResult> {
        const cmd = this.buildListRegistryModulesCommand(options);
        return this.executeListCommand(cmd, 'Listing registry modules...');
    }

    // =================== DG SCAFFOLD COMMANDS ===================

    /**
     * Scaffold Dagster definitions
     */
    async scaffoldDefs(componentType: string, outputPath: string, options: {
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildScaffoldDefsCommand(componentType, outputPath, options);
        return this.executeCommand(cmd, `Scaffolding ${componentType}...`);
    }

    /**
     * Scaffold build artifacts (Dockerfile)
     */
    async scaffoldBuildArtifacts(options: {
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildScaffoldBuildArtifactsCommand(options);
        return this.executeCommand(cmd, 'Scaffolding build artifacts...');
    }

    /**
     * Scaffold GitHub Actions workflow
     */
    async scaffoldGithubActions(options: {
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildScaffoldGithubActionsCommand(options);
        return this.executeCommand(cmd, 'Scaffolding GitHub Actions workflow...');
    }

    /**
     * Scaffold custom component
     */
    async scaffoldComponent(name: string, options: {
        targetPath?: string;
    } = {}): Promise<DgCheckResult> {
        const cmd = this.buildScaffoldComponentCommand(name, options);
        return this.executeCommand(cmd, `Scaffolding component ${name}...`);
    }

    // =================== COMMAND BUILDERS ===================

    private buildCheckDefsCommand(options: any): string {
        let cmd = 'dg check defs';
        
        if (options.logLevel) cmd += ` --log-level ${options.logLevel}`;
        if (options.verbose) cmd += ' --verbose';
        if (options.checkYaml !== undefined) cmd += options.checkYaml ? ' --check-yaml' : ' --no-check-yaml';
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildCheckTomlCommand(options: any): string {
        let cmd = 'dg check toml';
        
        if (options.verbose) cmd += ' --verbose';
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildCheckYamlCommand(options: any): string {
        let cmd = 'dg check yaml';
        
        if (options.watch) cmd += ' --watch';
        if (options.validateRequirements !== undefined) {
            cmd += options.validateRequirements ? ' --validate-requirements' : ' --no-validate-requirements';
        }
        if (options.verbose) cmd += ' --verbose';
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        if (options.paths && options.paths.length > 0) {
            cmd += ` ${options.paths.join(' ')}`;
        }
        
        return cmd;
    }

    private buildDevCommand(options: DgDevOptions): string {
        let cmd = 'dg dev';
        
        if (options.port) cmd += ` --port ${options.port}`;
        if (options.host) cmd += ` --host ${options.host}`;
        if (options.livePollRate) cmd += ` --live-data-poll-rate ${options.livePollRate}`;
        if (options.logLevel) cmd += ` --log-level ${options.logLevel}`;
        if (options.checkYaml !== undefined) cmd += options.checkYaml ? ' --check-yaml' : ' --no-check-yaml';
        if (options.moduleName) cmd += ` --module-name ${options.moduleName}`;
        if (options.pythonFile) cmd += ` --python-file "${options.pythonFile}"`;
        if (options.workingDirectory) cmd += ` --working-directory "${options.workingDirectory}"`;
        
        return cmd;
    }

    private buildLaunchCommand(options: DgLaunchOptions): string {
        let cmd = 'dg launch';
        
        if (options.assets) cmd += ` --assets "${options.assets}"`;
        if (options.job) cmd += ` --job "${options.job}"`;
        if (options.partition) cmd += ` --partition "${options.partition}"`;
        if (options.partitionRange) cmd += ` --partition-range "${options.partitionRange}"`;
        if (options.configJson) cmd += ` --config-json '${options.configJson}'`;
        if (options.config) cmd += ` --config "${options.config}"`;
        if (options.moduleName) cmd += ` --module-name ${options.moduleName}`;
        if (options.pythonFile) cmd += ` --python-file "${options.pythonFile}"`;
        if (options.workingDirectory) cmd += ` --working-directory "${options.workingDirectory}"`;
        
        return cmd;
    }

    private buildListDefsCommand(options: any): string {
        let cmd = 'dg list defs';
        
        if (options.json) cmd += ' --json';
        if (options.path) cmd += ` --path "${options.path}"`;
        if (options.assets) cmd += ` --assets "${options.assets}"`;
        if (options.columns && options.columns.length > 0) {
            cmd += ` --columns ${options.columns.join(',')}`;
        }
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildListComponentsCommand(options: any): string {
        let cmd = 'dg list components';
        
        if (options.package) cmd += ` --package ${options.package}`;
        if (options.json) cmd += ' --json';
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildListEnvsCommand(options: any): string {
        let cmd = 'dg list envs';
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildListProjectsCommand(options: any): string {
        let cmd = 'dg list projects';
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildListRegistryModulesCommand(options: any): string {
        let cmd = 'dg list registry-modules';
        
        if (options.json) cmd += ' --json';
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildScaffoldDefsCommand(componentType: string, outputPath: string, options: any): string {
        let cmd = `dg scaffold defs ${componentType} "${outputPath}"`;
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildScaffoldBuildArtifactsCommand(options: any): string {
        let cmd = 'dg scaffold build-artifacts';
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildScaffoldGithubActionsCommand(options: any): string {
        let cmd = 'dg scaffold github-actions';
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    private buildScaffoldComponentCommand(name: string, options: any): string {
        let cmd = `dg scaffold component "${name}"`;
        
        if (options.targetPath) cmd += ` --target-path "${options.targetPath}"`;
        
        return cmd;
    }

    // =================== COMMAND EXECUTION ===================

    private async executeCheckCommand(command: string, description: string): Promise<DgCheckResult> {
        try {
            this.outputChannel.appendLine(`🔍 ${description}`);
            this.outputChannel.appendLine(`Command: ${command}`);

            // Wrap command with virtual environment activation if available
            const wrappedCommand = await this.buildCommandWithVenv(command);
            this.outputChannel.appendLine(`Executing: ${wrappedCommand}`);

            const { stdout, stderr } = await execAsync(wrappedCommand, { 
                cwd: this.dagsterProjectRoot,
                shell: '/bin/bash'  // Required for source command
            });
            
            const result: DgCheckResult = {
                success: true,
                output: stdout,
                errors: stderr ? [stderr] : [],
                warnings: []
            };

            // Parse output for warnings and errors
            this.parseCheckOutput(stdout, result);
            
            this.outputChannel.appendLine(`✅ ${description} completed`);
            this.outputChannel.appendLine(stdout);
            
            if (stderr) {
                this.outputChannel.appendLine(`Warnings/Errors: ${stderr}`);
            }

            return result;
        } catch (error: any) {
            const result: DgCheckResult = {
                success: false,
                output: error.stdout || '',
                errors: [error.message, error.stderr || ''].filter(Boolean),
                warnings: []
            };

            this.outputChannel.appendLine(`❌ ${description} failed`);
            this.outputChannel.appendLine(`Error: ${error.message}`);
            if (error.stderr) {
                this.outputChannel.appendLine(`Stderr: ${error.stderr}`);
            }

            return result;
        }
    }

    private async executeCommand(command: string, description: string): Promise<DgCheckResult> {
        return this.executeCheckCommand(command, description);
    }

    private async executeListCommand(command: string, description: string): Promise<DgListResult> {
        try {
            this.outputChannel.appendLine(`📋 ${description}`);
            this.outputChannel.appendLine(`Command: ${command}`);

            // Wrap command with virtual environment activation if available
            const wrappedCommand = await this.buildCommandWithVenv(command);
            this.outputChannel.appendLine(`Executing: ${wrappedCommand}`);

            const { stdout, stderr } = await execAsync(wrappedCommand, { 
                cwd: this.dagsterProjectRoot,
                shell: '/bin/bash'  // Required for source command
            });
            
            let data: any = {};
            
            // Try to parse JSON output
            if (command.includes('--json')) {
                try {
                    data = JSON.parse(stdout);
                } catch {
                    // If JSON parsing fails, treat as text output
                    data = { raw: stdout };
                }
            } else {
                data = { raw: stdout };
            }

            const result: DgListResult = {
                success: true,
                data,
                output: stdout
            };

            this.outputChannel.appendLine(`✅ ${description} completed`);
            this.outputChannel.appendLine(stdout);

            return result;
        } catch (error: any) {
            const result: DgListResult = {
                success: false,
                data: {},
                output: error.stdout || ''
            };

            this.outputChannel.appendLine(`❌ ${description} failed`);
            this.outputChannel.appendLine(`Error: ${error.message}`);

            return result;
        }
    }

    private parseCheckOutput(output: string, result: DgCheckResult): void {
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.toLowerCase().includes('error')) {
                result.errors.push(line);
                result.success = false;
            } else if (line.toLowerCase().includes('warning')) {
                result.warnings.push(line);
            }
        }
    }

    // =================== UTILITY METHODS ===================

    /**
     * Check if dg CLI is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            await execAsync('dg --help');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get dg CLI version
     */
    async getVersion(): Promise<string | null> {
        try {
            const { stdout } = await execAsync('dg --version');
            return stdout.trim();
        } catch {
            return null;
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
     * Update VS Code configuration with detected port
     */
    private async updateVSCodeConfiguration(port: number): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('dagster');
            await config.update('graphqlUrl', `http://localhost:${port}/graphql`, vscode.ConfigurationTarget.Workspace);
            await config.update('webserverUrl', `http://localhost:${port}`, vscode.ConfigurationTarget.Workspace);
            this.outputChannel.appendLine(`📝 Updated VS Code configuration for port ${port}`);
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Failed to update VS Code configuration: ${error}`);
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}

