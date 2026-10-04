import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationResult {
    isValid: boolean;
    issues: ValidationIssue[];
    score: number; // 0-100 Cloud readiness score
}

export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    field: string;
    message: string;
    fix?: CloudConfigFix;
}

export interface CloudConfigFix {
    description: string;
    action: 'add' | 'remove' | 'replace';
    field: string;
    value?: any;
}

export interface CloudConfig {
    locations?: Location[];
    build?: BuildConfig;
    deployment?: DeploymentConfig;
    [key: string]: any;
}

interface Location {
    location_name: string;
    code_source?: {
        file?: string;
        directory?: string;
        package_name?: string;
    };
    working_directory?: string;
    container_context?: any;
}

interface BuildConfig {
    registry?: string;
    repository?: string;
    tag?: string;
}

interface DeploymentConfig {
    branch_deployment?: boolean;
    environment_variables?: Record<string, string> | string[];
}

export class DagsterCloudValidator {
    private workspaceRoot: string;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    async findCloudConfigFiles(): Promise<string[]> {
        const files: string[] = [];
        const patterns = [
            '**/dagster_cloud.yaml',
            '**/dagster_cloud.yml',
            '**/.dagster_cloud.yaml',
            '**/.dagster_cloud.yml'
        ];

        for (const pattern of patterns) {
            const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            files.push(...uris.map(uri => uri.fsPath));
        }

        return files;
    }

    async validateConfig(filePath?: string): Promise<ValidationResult> {
        try {
            const configPath = filePath || await this.getDefaultConfigPath();
            if (!configPath || !fs.existsSync(configPath)) {
                return {
                    isValid: false,
                    issues: [{
                        type: 'error',
                        field: 'file',
                        message: 'dagster_cloud.yaml not found',
                        fix: {
                            description: 'Create a basic dagster_cloud.yaml file',
                            action: 'add',
                            field: 'file',
                            value: this.getDefaultConfig()
                        }
                    }],
                    score: 0
                };
            }

            const content = fs.readFileSync(configPath, 'utf8');
            const config = yaml.load(content) as CloudConfig;

            return this.validateConfigObject(config);
        } catch (error) {
            return {
                isValid: false,
                issues: [{
                    type: 'error',
                    field: 'syntax',
                    message: `YAML syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }],
                score: 0
            };
        }
    }

    private validateConfigObject(config: CloudConfig): ValidationResult {
        const issues: ValidationIssue[] = [];
        let score = 100;

        // Validate locations
        if (!config.locations || !Array.isArray(config.locations) || config.locations.length === 0) {
            issues.push({
                type: 'error',
                field: 'locations',
                message: 'At least one location must be defined',
                fix: {
                    description: 'Add a basic location configuration',
                    action: 'add',
                    field: 'locations',
                    value: [{
                        location_name: 'main',
                        code_source: { file: 'dagster_example.py' }
                    }]
                }
            });
            score -= 30;
        } else {
            for (let i = 0; i < config.locations.length; i++) {
                const location = config.locations[i];
                const locationIssues = this.validateLocation(location, i);
                issues.push(...locationIssues);
                score -= locationIssues.filter(issue => issue.type === 'error').length * 10;
                score -= locationIssues.filter(issue => issue.type === 'warning').length * 5;
            }
        }

        // Validate build configuration
        if (!config.build) {
            issues.push({
                type: 'warning',
                field: 'build',
                message: 'Build configuration is recommended for production deployments',
                fix: {
                    description: 'Add basic build configuration',
                    action: 'add',
                    field: 'build',
                    value: {
                        registry: 'your-registry.com',
                        repository: 'your-repo'
                    }
                }
            });
            score -= 15;
        } else {
            const buildIssues = this.validateBuild(config.build);
            issues.push(...buildIssues);
            score -= buildIssues.filter(issue => issue.type === 'error').length * 10;
            score -= buildIssues.filter(issue => issue.type === 'warning').length * 5;
        }

        // Validate deployment configuration
        if (config.deployment) {
            const deploymentIssues = this.validateDeployment(config.deployment);
            issues.push(...deploymentIssues);
            score -= deploymentIssues.filter(issue => issue.type === 'error').length * 10;
            score -= deploymentIssues.filter(issue => issue.type === 'warning').length * 5;
        }

        score = Math.max(0, score);
        return {
            isValid: issues.filter(issue => issue.type === 'error').length === 0,
            issues,
            score
        };
    }

    private validateLocation(location: Location, index: number): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const prefix = `locations[${index}]`;

        if (!location.location_name) {
            issues.push({
                type: 'error',
                field: `${prefix}.location_name`,
                message: 'location_name is required',
                fix: {
                    description: 'Add a location name',
                    action: 'add',
                    field: `${prefix}.location_name`,
                    value: `location-${index}`
                }
            });
        }

        if (!location.code_source) {
            issues.push({
                type: 'error',
                field: `${prefix}.code_source`,
                message: 'code_source is required',
                fix: {
                    description: 'Add code source configuration',
                    action: 'add',
                    field: `${prefix}.code_source`,
                    value: { file: 'dagster_example.py' }
                }
            });
        } else {
            if (!location.code_source.file && !location.code_source.directory && !location.code_source.package_name) {
                issues.push({
                    type: 'error',
                    field: `${prefix}.code_source`,
                    message: 'code_source must specify file, directory, or package_name'
                });
            }

            // Check if the specified file/directory exists
            if (location.code_source.file) {
                const filePath = path.join(this.workspaceRoot, location.code_source.file);
                if (!fs.existsSync(filePath)) {
                    issues.push({
                        type: 'warning',
                        field: `${prefix}.code_source.file`,
                        message: `File "${location.code_source.file}" not found in workspace`
                    });
                }
            }
        }

        // Validate working_directory
        if (location.working_directory) {
            if (location.working_directory.startsWith('/tmp/') || 
                location.working_directory.includes('/invalid/')) {
                issues.push({
                    type: 'error',
                    field: `${prefix}.working_directory`,
                    message: 'Invalid working directory path',
                    fix: {
                        description: 'Use relative path from repository root',
                        action: 'replace',
                        field: `${prefix}.working_directory`,
                        value: '.'
                    }
                });
            }
        }

        return issues;
    }

    private validateBuild(build: BuildConfig): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!build.registry) {
            issues.push({
                type: 'warning',
                field: 'build.registry',
                message: 'Registry should be specified for container builds',
                fix: {
                    description: 'Add your container registry',
                    action: 'add',
                    field: 'build.registry',
                    value: 'your-registry.com'
                }
            });
        }

        if (!build.repository) {
            issues.push({
                type: 'error',
                field: 'build.repository',
                message: 'Repository name is required for builds',
                fix: {
                    description: 'Add repository name',
                    action: 'add',
                    field: 'build.repository',
                    value: 'your-dagster-app'
                }
            });
        }

        return issues;
    }

    private validateDeployment(deployment: DeploymentConfig): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (typeof deployment.branch_deployment === 'string') {
            issues.push({
                type: 'error',
                field: 'deployment.branch_deployment',
                message: 'branch_deployment should be a boolean, not a string',
                fix: {
                    description: 'Convert to boolean value',
                    action: 'replace',
                    field: 'deployment.branch_deployment',
                    value: (deployment.branch_deployment as string).toLowerCase() === 'true'
                }
            });
        }

        if (deployment.environment_variables && Array.isArray(deployment.environment_variables)) {
            // Check for wrong format: ["FOO=bar"] instead of {"FOO": "bar"}
            const hasWrongFormat = deployment.environment_variables.some(item => 
                typeof item === 'string' && item.includes('=')
            );
            
            if (hasWrongFormat) {
                issues.push({
                    type: 'error',
                    field: 'deployment.environment_variables',
                    message: 'Environment variables should be key-value pairs, not strings with =',
                    fix: {
                        description: 'Convert to proper key-value format',
                        action: 'replace',
                        field: 'deployment.environment_variables',
                        value: this.parseEnvVarsToObject(deployment.environment_variables)
                    }
                });
            }
        }

        return issues;
    }

    private parseEnvVarsToObject(envVars: string[]): Record<string, string> {
        const result: Record<string, string> = {};
        envVars.forEach(item => {
            if (typeof item === 'string' && item.includes('=')) {
                const [key, ...valueParts] = item.split('=');
                result[key] = valueParts.join('=');
            }
        });
        return result;
    }

    async autoFix(filePath?: string): Promise<ValidationResult> {
        const configPath = filePath || await this.getDefaultConfigPath();
        
        if (!configPath) {
            // Create new file
            const newConfigPath = path.join(this.workspaceRoot, 'dagster_cloud.yaml');
            const defaultConfig = this.getDefaultConfig();
            fs.writeFileSync(newConfigPath, yaml.dump(defaultConfig, { indent: 2 }));
            return this.validateConfig(newConfigPath);
        }

        const validation = await this.validateConfig(configPath);
        
        if (validation.isValid) {
            return validation;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            let config = yaml.load(content) as CloudConfig;

            // Apply fixes
            for (const issue of validation.issues) {
                if (issue.fix) {
                    config = this.applyFix(config, issue.fix);
                }
            }

            const newContent = yaml.dump(config, { indent: 2 });
            fs.writeFileSync(configPath, newContent);

            return this.validateConfig(configPath);
        } catch (error) {
            throw new Error(`Failed to auto-fix config: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private applyFix(config: CloudConfig, fix: CloudConfigFix): CloudConfig {
        const newConfig = JSON.parse(JSON.stringify(config)); // Deep clone

        const fieldParts = fix.field.split('.');
        let current = newConfig;

        // Navigate to the parent object
        for (let i = 0; i < fieldParts.length - 1; i++) {
            const part = fieldParts[i];
            if (part.includes('[') && part.includes(']')) {
                // Handle array index like "locations[0]"
                const [arrayName, indexStr] = part.split('[');
                const index = parseInt(indexStr.replace(']', ''));
                if (!current[arrayName]) {
                    current[arrayName] = [];
                }
                if (!current[arrayName][index]) {
                    current[arrayName][index] = {};
                }
                current = current[arrayName][index];
            } else {
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
            }
        }

        const lastField = fieldParts[fieldParts.length - 1];

        switch (fix.action) {
            case 'add':
                if (lastField === 'file' && fix.field === 'file') {
                    // Special case: creating the entire config
                    return fix.value as CloudConfig;
                }
                current[lastField] = fix.value;
                break;
            case 'replace':
                current[lastField] = fix.value;
                break;
            case 'remove':
                delete current[lastField];
                break;
        }

        return newConfig;
    }

    private async getDefaultConfigPath(): Promise<string | null> {
        const files = await this.findCloudConfigFiles();
        return files.length > 0 ? files[0] : null;
    }

    private getDefaultConfig(): CloudConfig {
        return {
            locations: [
                {
                    location_name: 'main',
                    code_source: {
                        file: 'dagster_example.py'
                    }
                }
            ],
            build: {
                registry: 'your-registry.com',
                repository: 'your-dagster-app'
            }
        };
    }
}
