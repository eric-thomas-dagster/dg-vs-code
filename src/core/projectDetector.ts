import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DagsterProjectDetector {
    
    async isDagsterProject(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return false;
        }

        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            
            // Skip if this is clearly a VS Code extension development project
            if (await this.isVSCodeExtensionProject(folderPath)) {
                return false;
            }
            
            // Check for common Dagster project indicators
            const indicators = [
                'dagster.yaml',
                'pyproject.toml',
                'setup.py',
                'setup.cfg'
            ];

            // Check in root directory
            for (const indicator of indicators) {
                const filePath = path.join(folderPath, indicator);
                if (await this.fileExists(filePath)) {
                    // If it's a Python file, check for Dagster imports
                    if (indicator.endsWith('.toml') || indicator.endsWith('.py') || indicator.endsWith('.cfg')) {
                        const hasDagsterDependency = await this.checkForDagsterDependency(filePath);
                        if (hasDagsterDependency) {
                            return true;
                        }
                    }
                    // dagster.yaml is a definitive indicator
                    if (indicator === 'dagster.yaml') {
                        return true;
                    }
                }
            }

            // Also check common subdirectories for Dagster projects
            const commonSubdirs = ['example', 'examples', 'src', 'app', 'dagster', 'project'];
            for (const subdir of commonSubdirs) {
                const subdirPath = path.join(folderPath, subdir);
                if (await this.directoryExists(subdirPath)) {
                    for (const indicator of indicators) {
                        const filePath = path.join(subdirPath, indicator);
                        if (await this.fileExists(filePath)) {
                            // If it's a Python file, check for Dagster imports
                            if (indicator.endsWith('.toml') || indicator.endsWith('.py') || indicator.endsWith('.cfg')) {
                                const hasDagsterDependency = await this.checkForDagsterDependency(filePath);
                                if (hasDagsterDependency) {
                                    return true;
                                }
                            }
                            // dagster.yaml is a definitive indicator
                            if (indicator === 'dagster.yaml') {
                                return true;
                            }
                        }
                    }
                }
            }

            // Check for Python files with Dagster imports
            const hasDagsterImports = await this.searchForDagsterImports(folderPath);
            if (hasDagsterImports) {
                return true;
            }
        }

        return false;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    private async isVSCodeExtensionProject(folderPath: string): Promise<boolean> {
        try {
            // Check for package.json with VS Code extension indicators
            const packageJsonPath = path.join(folderPath, 'package.json');
            if (await this.fileExists(packageJsonPath)) {
                const content = await fs.promises.readFile(packageJsonPath, 'utf8');
                const packageJson = JSON.parse(content);
                
                // VS Code extension indicators
                if (packageJson.engines?.vscode || 
                    packageJson.categories?.includes('Other') || 
                    packageJson.main?.includes('extension') ||
                    packageJson.name?.includes('dagster-power-user')) {
                    return true;
                }
            }
            
            // Check for TypeScript config and src directory (common in VS Code extensions)
            const tsconfigPath = path.join(folderPath, 'tsconfig.json');
            const srcDirPath = path.join(folderPath, 'src');
            if (await this.fileExists(tsconfigPath) && await this.directoryExists(srcDirPath)) {
                return true;
            }
            
            return false;
        } catch {
            return false;
        }
    }

    private async checkForDagsterDependency(filePath: string): Promise<boolean> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            
            // Special case: if this looks like VS Code extension development, ignore it
            if (content.includes('vscode') && content.includes('dagster-power-user')) {
                return false;
            }
            
            // Check for dagster in dependencies
            const dagsterPatterns = [
                /dagster[>=<~\s]/,          // dagster dependency
                /from\s+dagster/,          // dagster import
                /import\s+dagster/,        // dagster import
                /@(?:\w+\.)?asset/,        // asset decorator (supports @asset, @dg.asset, @dagster.asset)
                /@(?:\w+\.)?op/,           // op decorator
                /@(?:\w+\.)?job/,          // job decorator
                /@(?:\w+\.)?graph/,        // graph decorator
                /@(?:\w+\.)?schedule/,     // schedule decorator
                /@(?:\w+\.)?sensor/,       // sensor decorator
                /Definitions/              // Definitions class
            ];

            return dagsterPatterns.some(pattern => pattern.test(content));
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            return false;
        }
    }

    private async searchForDagsterImports(folderPath: string): Promise<boolean> {
        try {
            // Find Python files recursively
            const pythonFiles = await this.findPythonFiles(folderPath);
            
            // Check first few Python files for Dagster imports
            const filesToCheck = pythonFiles.slice(0, 10); // Limit to avoid performance issues
            
            for (const file of filesToCheck) {
                const hasDagster = await this.checkForDagsterDependency(file);
                if (hasDagster) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error(`Error searching for Dagster imports in ${folderPath}:`, error);
            return false;
        }
    }

    private async findPythonFiles(dir: string, maxDepth: number = 3): Promise<string[]> {
        const pythonFiles: string[] = [];
        
        if (maxDepth <= 0) {
            return pythonFiles;
        }

        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isFile() && entry.name.endsWith('.py')) {
                    pythonFiles.push(fullPath);
                } else if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
                    const subFiles = await this.findPythonFiles(fullPath, maxDepth - 1);
                    pythonFiles.push(...subFiles);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}:`, error);
        }
        
        return pythonFiles;
    }

    private shouldSkipDirectory(dirName: string): boolean {
        const skipDirs = [
            'node_modules',
            '.git',
            '__pycache__',
            '.pytest_cache',
            '.vscode',
            '.idea',
            'venv',
            'env',
            '.env',
            'dist',
            'build',
            '.tox'
        ];
        
        return skipDirs.includes(dirName) || dirName.startsWith('.');
    }

    async findDagsterFiles(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const dagsterFiles: string[] = [];

        for (const folder of workspaceFolders) {
            const pythonFiles = await this.findPythonFiles(folder.uri.fsPath);
            
            for (const file of pythonFiles) {
                const hasDagster = await this.checkForDagsterDependency(file);
                if (hasDagster) {
                    dagsterFiles.push(file);
                }
            }
        }

        return dagsterFiles;
    }

    async extractAssetsFromFile(filePath: string): Promise<string[]> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            const assets: string[] = [];
            
            // Regular expression to find asset definitions (supports @asset, @dg.asset, @dagster.asset)
            const assetRegex = /@(?:\w+\.)?asset(?:\([^)]*\))?\s*\n\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
            let match;
            
            while ((match = assetRegex.exec(content)) !== null) {
                assets.push(match[1]);
            }
            
            return assets;
        } catch (error) {
            console.error(`Error extracting assets from file ${filePath}:`, error);
            return [];
        }
    }
}
