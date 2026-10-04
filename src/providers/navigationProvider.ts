import * as vscode from 'vscode';
import { DagsterGraphQLClient, DagsterAsset } from '../core/graphqlClient';

interface AssetLineageDependency {
    asset: {
        id: string;
        assetKey: {
            path: string[];
        };
    };
}

interface AssetLineage {
    id: string;
    assetKey: {
        path: string[];
    };
    dependencies: AssetLineageDependency[];
    dependedBy: AssetLineageDependency[];
}

interface DagsterEntity {
    type: 'asset' | 'job' | 'schedule' | 'sensor' | 'asset_check' | 'op' | 'resource' | 'io_manager' | 'graph' | 'config' | 'partition' | 'logger' | 'executor' | 'hook' | 'solid';
    name: string;
    decoratorLine: number;
    functionLine: number;
}

interface JobAssetMapping {
    jobName: string;
    assets: string[];
    ops: string[];
}

interface ScheduleSensorTarget {
    name: string;
    type: 'schedule' | 'sensor';
    targetJob?: string;
    targetAssets?: string[];
    cronSchedule?: string;
    description?: string;
}

interface AssetCheckMapping {
    checkName: string;
    targetAsset: string;
    severity?: string;
    description?: string;
}

/**
 * Provides smart navigation features for all Dagster entities (assets, jobs, schedules, sensors, etc.)
 */
export class DagsterNavigationProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
    constructor(private dagsterClient: DagsterGraphQLClient) {}

    /**
     * Provides hover information for all Dagster entities
     */
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        try {
            console.log('Dagster hover provider triggered at position:', position.line, position.character);
            const line = document.lineAt(position.line).text;
            console.log('Line content:', line);
            
            // Detect what type of Dagster entity we're hovering over
            const entity = this.getDagsterEntityAtPosition(document, position);
            console.log('Detected entity:', entity);
            
            if (!entity) {
                console.log('No Dagster entity detected at this position');
                return undefined;
            }

            switch (entity.type) {
                case 'asset':
                    return await this.provideAssetHover(entity.name, document);
                case 'job':
                    return await this.provideJobHover(entity.name, document);
                case 'schedule':
                    return await this.provideScheduleHover(entity.name, document);
                case 'sensor':
                    return await this.provideSensorHover(entity.name, document);
                case 'asset_check':
                    return await this.provideAssetCheckHover(entity.name, document);
                case 'op':
                case 'solid': // Legacy solid support
                    return await this.provideOpHover(entity.name, document);
                case 'resource':
                    return await this.provideResourceHover(entity.name, document);
                case 'io_manager':
                    return await this.provideIOManagerHover(entity.name, document);
                case 'graph':
                    return await this.provideGraphHover(entity.name, document);
                case 'config':
                    return await this.provideConfigHover(entity.name, document);
                case 'partition':
                    return await this.providePartitionHover(entity.name, document);
                case 'logger':
                    return await this.provideLoggerHover(entity.name, document);
                case 'executor':
                    return await this.provideExecutorHover(entity.name, document);
                case 'hook':
                    return await this.provideHookHover(entity.name, document);
                default:
                    return undefined;
            }
        } catch (error) {
            console.log(`Failed to provide hover:`, error);
            return undefined;
        }
    }

    private async provideAssetHover(assetName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            console.log(`🔍 provideAssetHover called for asset: "${assetName}"`);
            
            // First, try static analysis (always works)
            const staticInfo = this.getStaticEntityInfo(assetName, 'asset', document);
            
            // Get static dependents (async, but we'll show them when available)
            const staticDependents = await this.findStaticDependents(assetName, document);
            staticInfo.dependents = staticDependents;
            
            // Then, try to enhance with live Dagster data (optional)
            let dynamicInfo = null;
            try {
                const assets = await this.dagsterClient.getAssets();
                console.log(`📦 Retrieved ${assets?.length || 0} assets from Dagster`);
                const asset = assets.find(a => a.key === assetName);
                
                if (asset) {
                    console.log(`🎯 Found matching asset in Dagster: YES`);
                    const lineage: AssetLineage = await this.dagsterClient.getAssetLineage(assetName);
                    dynamicInfo = { asset, lineage };
                }
            } catch (error) {
                console.log(`📡 Dagster not available, using static analysis only:`, error instanceof Error ? error.message : String(error));
            }
            
            const hoverContent = new vscode.MarkdownString();
            console.log(`✨ Creating hover content for asset: ${assetName}`);
            
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🎯 Asset: \`${assetName}\`\n\n`);
            
            // Display static info (always available)
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.dependencies.length > 0) {
                hoverContent.appendMarkdown(`**Dependencies (${staticInfo.dependencies.length}):**\n`);
                staticInfo.dependencies.forEach(dep => {
                    const cmdArgs = JSON.stringify([dep]);
                    hoverContent.appendMarkdown(`- [${dep}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            if (staticInfo.dependents && staticInfo.dependents.length > 0) {
                hoverContent.appendMarkdown(`**⬆️ Dependents (${staticInfo.dependents.length}):**\n`);
                staticInfo.dependents.forEach(dep => {
                    const cmdArgs = JSON.stringify([dep]);
                    hoverContent.appendMarkdown(`- [${dep}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            if (staticInfo.computeKind) {
                hoverContent.appendMarkdown(`**Compute Kind:** \`${staticInfo.computeKind}\`\n\n`);
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            // Display dynamic info (if Dagster is available)
            if (dynamicInfo?.asset?.description && !staticInfo.description) {
                hoverContent.appendMarkdown(`**Live Description:** ${dynamicInfo.asset.description}\n\n`);
            }

            // Show dynamic dependencies (if available and different from static)
            if (dynamicInfo?.lineage?.dependencies && dynamicInfo.lineage.dependencies.length > 0) {
                hoverContent.appendMarkdown(`**⬇️ Live Dependencies (${dynamicInfo.lineage.dependencies.length}):**\n`);
                dynamicInfo.lineage.dependencies.forEach((dep: AssetLineageDependency) => {
                    const assetKey = dep.asset.assetKey.path.join('.');
                    const cmdArgs = JSON.stringify([assetKey]);
                    hoverContent.appendMarkdown(`- [${assetKey}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown('\n');
            }

            // Show live dependents
            if (dynamicInfo?.lineage?.dependedBy && dynamicInfo.lineage.dependedBy.length > 0) {
                hoverContent.appendMarkdown(`**⬆️ Live Dependents (${dynamicInfo.lineage.dependedBy.length}):**\n`);
                dynamicInfo.lineage.dependedBy.forEach((dep: AssetLineageDependency) => {
                    const assetKey = dep.asset.assetKey.path.join('.');
                    const cmdArgs = JSON.stringify([assetKey]);
                    hoverContent.appendMarkdown(`- [${assetKey}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown('\n');
            }
            
            // Add status indicator
            const statusIcon = dynamicInfo ? "🟢 Connected to Dagster" : "🟡 Static Analysis Only";
            hoverContent.appendMarkdown(`**Status:** ${statusIcon}\n\n`);

            // TODO: Show jobs that include this asset
            // TODO: Show asset checks for this asset
            hoverContent.appendMarkdown(`**💡 Enhanced navigation:** Jobs and asset checks will be shown here\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(play) Materialize](command:dagster.materializeAsset?${JSON.stringify([assetName])}) • `);
            hoverContent.appendMarkdown(`[$(rocket) DG Launch](command:dagster.dgLaunchAsset?${JSON.stringify([assetName])}) • `);
            hoverContent.appendMarkdown(`[$(git-branch) Show Lineage](command:dagster.showLineage?${JSON.stringify([assetName])}) • `);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findAssetReferences?${JSON.stringify([assetName])})`);

            console.log(`🎉 Returning hover content for asset: ${assetName}`);
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get asset hover for ${assetName}:`, error);
            return undefined;
        }
    }

    private async provideJobHover(jobName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            // Get static analysis info
            const staticInfo = this.getStaticEntityInfo(jobName, 'job', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🔧 Job: \`${jobName}\`\n\n`);
            
            // Display static info
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.partitionBy) {
                hoverContent.appendMarkdown(`**Partitioned By:** \`${staticInfo.partitionBy}\`\n\n`);
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            // Show assets in this job
            if (staticInfo.assetsInJob && staticInfo.assetsInJob.length > 0) {
                hoverContent.appendMarkdown(`**🎯 Assets in Job (${staticInfo.assetsInJob.length}):**\n`);
                staticInfo.assetsInJob.forEach(asset => {
                    const cmdArgs = JSON.stringify([asset]);
                    hoverContent.appendMarkdown(`- [${asset}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            // Show schedules targeting this job
            if (staticInfo.schedulesForJob && staticInfo.schedulesForJob.length > 0) {
                hoverContent.appendMarkdown(`**📅 Schedules (${staticInfo.schedulesForJob.length}):**\n`);
                staticInfo.schedulesForJob.forEach(schedule => {
                    const cmdArgs = JSON.stringify([schedule]);
                    hoverContent.appendMarkdown(`- [${schedule}](command:dagster.goToScheduleDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            // Show sensors targeting this job
            if (staticInfo.sensorsForJob && staticInfo.sensorsForJob.length > 0) {
                hoverContent.appendMarkdown(`**📡 Sensors (${staticInfo.sensorsForJob.length}):**\n`);
                staticInfo.sensorsForJob.forEach(sensor => {
                    const cmdArgs = JSON.stringify([sensor]);
                    hoverContent.appendMarkdown(`- [${sensor}](command:dagster.goToSensorDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            // Add status indicator
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`**🚀 Quick Actions:**\n`);
            hoverContent.appendMarkdown(`[$(play) Execute Job](command:dagster.executeJob?${JSON.stringify([jobName])}) • `);
            hoverContent.appendMarkdown(`[$(rocket) DG Launch](command:dagster.dgLaunchJob?${JSON.stringify([jobName])}) • `);
            hoverContent.appendMarkdown(`[$(git-branch) Show Lineage](command:dagster.showJobLineage?${JSON.stringify([jobName])}) • `);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findJobReferences?${JSON.stringify([jobName])})`);

            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get job hover for ${jobName}:`, error);
            return undefined;
        }
    }

    private async provideScheduleHover(scheduleName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            // Get static analysis info
            const staticInfo = this.getStaticEntityInfo(scheduleName, 'schedule', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 📅 Schedule: \`${scheduleName}\`\n\n`);
            
            // Display static info
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.cronSchedule) {
                hoverContent.appendMarkdown(`**Cron Schedule:** \`${staticInfo.cronSchedule}\`\n\n`);
            }
            
            if (staticInfo.targetJob) {
                const cmdArgs = JSON.stringify([staticInfo.targetJob]);
                hoverContent.appendMarkdown(`**Target Job:** [${staticInfo.targetJob}](command:dagster.goToJobDefinition?${encodeURIComponent(cmdArgs)})\n\n`);
                
                // Find assets in the target job
                const targetJobInfo = this.getStaticEntityInfo(staticInfo.targetJob, 'job', document);
                if (targetJobInfo.assetsInJob && targetJobInfo.assetsInJob.length > 0) {
                    hoverContent.appendMarkdown(`**🎯 Assets in Target Job (${targetJobInfo.assetsInJob.length}):**\n`);
                    targetJobInfo.assetsInJob.forEach(asset => {
                        const assetCmdArgs = JSON.stringify([asset]);
                        hoverContent.appendMarkdown(`- [${asset}](command:dagster.goToAssetDefinition?${encodeURIComponent(assetCmdArgs)})\n`);
                    });
                    hoverContent.appendMarkdown(`\n`);
                }
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            // Add status indicator
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(calendar) View Schedule](command:dagster.viewSchedule?${JSON.stringify([scheduleName])}) • `);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findScheduleReferences?${JSON.stringify([scheduleName])})`);

            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get schedule hover for ${scheduleName}:`, error);
            return undefined;
        }
    }

    private async provideSensorHover(sensorName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            // Get static analysis info
            const staticInfo = this.getStaticEntityInfo(sensorName, 'sensor', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 📡 Sensor: \`${sensorName}\`\n\n`);
            
            // Display static info
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.targetJob) {
                const cmdArgs = JSON.stringify([staticInfo.targetJob]);
                hoverContent.appendMarkdown(`**Target Job:** [${staticInfo.targetJob}](command:dagster.goToJobDefinition?${encodeURIComponent(cmdArgs)})\n\n`);
                
                // Find assets in the target job
                const targetJobInfo = this.getStaticEntityInfo(staticInfo.targetJob, 'job', document);
                if (targetJobInfo.assetsInJob && targetJobInfo.assetsInJob.length > 0) {
                    hoverContent.appendMarkdown(`**🎯 Assets in Target Job (${targetJobInfo.assetsInJob.length}):**\n`);
                    targetJobInfo.assetsInJob.forEach(asset => {
                        const assetCmdArgs = JSON.stringify([asset]);
                        hoverContent.appendMarkdown(`- [${asset}](command:dagster.goToAssetDefinition?${encodeURIComponent(assetCmdArgs)})\n`);
                    });
                    hoverContent.appendMarkdown(`\n`);
                }
            }
            
            if (staticInfo.targetAssets && staticInfo.targetAssets.length > 0) {
                hoverContent.appendMarkdown(`**🎯 Target Assets (${staticInfo.targetAssets.length}):**\n`);
                staticInfo.targetAssets.forEach(asset => {
                    const cmdArgs = JSON.stringify([asset]);
                    hoverContent.appendMarkdown(`- [${asset}](command:dagster.goToAssetDefinition?${encodeURIComponent(cmdArgs)})\n`);
                });
                hoverContent.appendMarkdown(`\n`);
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            // Add status indicator
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(radio-tower) View Sensor](command:dagster.viewSensor?${JSON.stringify([sensorName])}) • `);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findSensorReferences?${JSON.stringify([sensorName])})`);

            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get sensor hover for ${sensorName}:`, error);
            return undefined;
        }
    }

    private async provideAssetCheckHover(checkName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### ✅ Asset Check: \`${checkName}\`\n\n`);
            hoverContent.appendMarkdown(`**💡 Enhanced navigation:** Target asset and severity will be shown here\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(check) Execute Check](command:dagster.executeAssetCheck?${JSON.stringify([checkName])}) • `);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findAssetCheckReferences?${JSON.stringify([checkName])})`);

            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get asset check hover for ${checkName}:`, error);
            return undefined;
        }
    }

    private async provideOpHover(opName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            // Get static analysis info
            const staticInfo = this.getStaticEntityInfo(opName, 'op', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### ⚙️ Op: \`${opName}\`\n\n`);
            
            // Display static info
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.retryPolicy) {
                hoverContent.appendMarkdown(`**Retry Policy:** ${staticInfo.retryPolicy}\n\n`);
            }
            
            if (staticInfo.computeKind) {
                hoverContent.appendMarkdown(`**Compute Kind:** \`${staticInfo.computeKind}\`\n\n`);
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            // Add status indicator
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);

            // Add quick actions
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findOpReferences?${JSON.stringify([opName])})`);

            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get op hover for ${opName}:`, error);
            return undefined;
        }
    }

    /**
     * Provides definition locations for asset dependencies
     */
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const assetName = this.getAssetNameAtPosition(document, position);
        if (!assetName) {
            return undefined;
        }

        try {
            // Find the asset definition in the workspace
            const assetLocation = await this.findAssetDefinition(assetName);
            if (assetLocation) {
                return assetLocation;
            }

            return undefined;
        } catch (error) {
            console.log(`Failed to find definition for ${assetName}:`, error);
            return undefined;
        }
    }

    /**
     * Detect any Dagster entity at the current position
     */
    private getDagsterEntityAtPosition(document: vscode.TextDocument, position: vscode.Position): DagsterEntity | undefined {
        const line = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }
        const word = document.getText(wordRange);

        // Check if we're on a decorator line or function definition
        // Support both @decorator and @module.decorator (like @dg.asset, @dagster.asset)
        // Also handle decorators with parameters like @dg.asset(...)
        const decoratorPattern = /@(?:\w+\.)?(asset|job|schedule|sensor|asset_check|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/;
        console.log('Testing regex pattern against line:', line);
        console.log('Regex pattern:', decoratorPattern.toString());
        const decoratorMatch = line.match(decoratorPattern);
        console.log('Regex match result:', decoratorMatch);
        
        if (decoratorMatch) {
            const decoratorType = decoratorMatch[1] as DagsterEntity['type'];
            
            // Find the function name after this decorator
            const functionName = this.findFunctionNameAfterDecorator(document, position.line);
            if (functionName) {
                return {
                    type: decoratorType,
                    name: functionName,
                    decoratorLine: position.line,
                    functionLine: this.findFunctionLineAfterDecorator(document, position.line)
                };
            }
        }

        // Check if we're on a function definition with a decorator above
        const funcMatch = line.match(/def\s+(\w+)\s*\(/);
        if (funcMatch) {
            const functionName = funcMatch[1];
            const decoratorType = this.findDecoratorBeforeFunction(document, position.line);
            if (decoratorType) {
                return {
                    type: decoratorType,
                    name: functionName,
                    decoratorLine: this.findDecoratorLineBeforeFunction(document, position.line),
                    functionLine: position.line
                };
            }
        }

        // Check if we're hovering over an asset reference (original asset logic)
        const assetName = this.getAssetNameAtPosition(document, position);
        if (assetName) {
            return {
                type: 'asset',
                name: assetName,
                decoratorLine: -1,
                functionLine: -1
            };
        }

        return undefined;
    }

    private getStaticEntityInfo(entityName: string, entityType: string, document: vscode.TextDocument): {
        description?: string;
        dependencies: string[];
        dependents?: string[];
        computeKind?: string;
        groupName?: string;
        cronSchedule?: string;
        targetJob?: string;
        targetAssets?: string[];
        targetJobs?: string[];
        assetsInJob?: string[];
        opsInJob?: string[];
        schedulesForJob?: string[];
        sensorsForJob?: string[];
        relatedEntities?: string[];
        retryPolicy?: string;
        partitionBy?: string;
        configSchema?: string;
        requiredResources?: string[];
        partitionStart?: string;
        partitionEnd?: string;
    } {
        const info: {
            description?: string;
            dependencies: string[];
            dependents?: string[];
            computeKind?: string;
            groupName?: string;
            cronSchedule?: string;
            targetJob?: string;
            targetAssets?: string[];
            targetJobs?: string[];
            assetsInJob?: string[];
            opsInJob?: string[];
            schedulesForJob?: string[];
            sensorsForJob?: string[];
            relatedEntities?: string[];
            retryPolicy?: string;
            partitionBy?: string;
            configSchema?: string;
            requiredResources?: string[];
            partitionStart?: string;
            partitionEnd?: string;
        } = {
            dependencies: [] as string[],
            targetAssets: [] as string[],
            targetJobs: [] as string[],
            assetsInJob: [] as string[],
            opsInJob: [] as string[],
            schedulesForJob: [] as string[],
            sensorsForJob: [] as string[],
            relatedEntities: [] as string[],
            requiredResources: [] as string[],
        };

        try {
            // Find the entity function definition
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                
                // Look for function definition matching our entity name
                const funcMatch = line.match(new RegExp(`def\\s+${entityName}\\s*\\(`));
                if (funcMatch) {
                    // Found the function, now look backwards for the decorator
                    let decoratorStartLine = -1;
                    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
                        const decoratorLine = document.lineAt(j).text;
                        const decoratorPattern = new RegExp(`@(?:\\w+\\.)?(${entityType}|dg\\.${entityType})`);
                        if (decoratorLine.match(decoratorPattern)) {
                            decoratorStartLine = j;
                            break;
                        }
                    }
                    
                    if (decoratorStartLine >= 0) {
                        // Parse decorator arguments
                        let decoratorText = '';
                        let parenCount = 0;
                        let foundOpenParen = false;
                        
                        for (let k = decoratorStartLine; k < i; k++) {
                            const line = document.lineAt(k).text;
                            decoratorText += line + '\n';
                            
                            for (const char of line) {
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
                        
                        // Common parsing for all entity types
                        this.parseCommonFields(decoratorText, info);
                        
                        // Entity-specific parsing
                        if (entityType === 'asset') {
                            this.parseAssetFields(decoratorText, info);
                        } else if (entityType === 'schedule') {
                            this.parseScheduleFields(decoratorText, info);
                        } else if (entityType === 'job') {
                            this.parseJobFields(decoratorText, info);
                        } else if (entityType === 'op' || entityType === 'solid') {
                            this.parseOpFields(decoratorText, info);
                        } else if (entityType === 'sensor') {
                            this.parseSensorFields(decoratorText, info);
                        } else if (entityType === 'resource') {
                            this.parseResourceFields(decoratorText, info);
                        } else if (entityType === 'io_manager') {
                            this.parseIOManagerFields(decoratorText, info);
                        } else if (entityType === 'graph') {
                            this.parseGraphFields(decoratorText, info);
                        } else if (entityType === 'partition') {
                            this.parsePartitionFields(decoratorText, info);
                        } else if (entityType === 'logger') {
                            this.parseLoggerFields(decoratorText, info);
                        } else if (entityType === 'executor') {
                            this.parseExecutorFields(decoratorText, info);
                        } else if (entityType === 'hook') {
                            this.parseHookFields(decoratorText, info);
                        }
                    }
                    
                    // Extract description from function docstring
                    this.parseDocstring(document, i, info);
                    break;
                }
            }
            
            // Find static dependents for assets (will be handled separately due to async nature)
            if (entityType === 'asset') {
                // Start the async search but don't wait for it in this sync method
                // We'll handle this in the hover method itself
                info.dependents = [];
            }
            
            // Find cross-entity relationships
            this.findCrossEntityRelationships(entityName, entityType, document, info);
        } catch (error) {
            console.error(`Error parsing static ${entityType} info:`, error);
        }

        return info;
    }

    private async findStaticDependents(entityName: string, document: vscode.TextDocument): Promise<string[]> {
        const dependents: string[] = [];
        
        try {
            // Search the current document first for quick results
            await this.searchDocumentForDependents(document, entityName, dependents);
            
            // Also search other Python files in the workspace
            const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 50);
            
            for (const file of pythonFiles) {
                if (file.fsPath !== document.uri.fsPath) {
                    try {
                        const otherDoc = await vscode.workspace.openTextDocument(file);
                        await this.searchDocumentForDependents(otherDoc, entityName, dependents);
                    } catch (error) {
                        // Skip files that can't be opened
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding static dependents:', error);
        }
        
        return [...new Set(dependents)]; // Remove duplicates
    }

    private async searchDocumentForDependents(document: vscode.TextDocument, entityName: string, dependents: string[]): Promise<void> {
        try {
            // Search the document for assets that depend on this one
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                
                // Look for @asset or @dg.asset decorators
                if (line.match(/@(?:\w+\.)?(asset|dg\.asset)/)) {
                    // Found an asset decorator, now look for its dependencies
                    let decoratorText = '';
                    let parenCount = 0;
                    let foundOpenParen = false;
                    let assetName = '';
                    
                    // Collect the full decorator
                    for (let k = i; k < Math.min(i + 15, document.lineCount); k++) {
                        const currentLine = document.lineAt(k).text;
                        decoratorText += currentLine + '\n';
                        
                        // Track parentheses to find decorator end
                        for (const char of currentLine) {
                            if (char === '(') {
                                foundOpenParen = true;
                                parenCount++;
                            } else if (char === ')') {
                                parenCount--;
                            }
                        }
                        
                        // Look for the function definition to get asset name
                        const funcMatch = currentLine.match(/def\s+(\w+)\s*\(/);
                        if (funcMatch) {
                            assetName = funcMatch[1];
                        }
                        
                        if (foundOpenParen && parenCount === 0) {
                            break;
                        }
                    }
                    
                    // Check if this asset depends on our target entity
                    if (assetName && this.decoratorDependsOn(decoratorText, entityName)) {
                        dependents.push(assetName);
                    }
                }
            }
        } catch (error) {
            console.error('Error searching document for dependents:', error);
        }
    }

    private findCrossEntityRelationships(entityName: string, entityType: string, document: vscode.TextDocument, info: any): void {
        try {
            // Search the entire document for related entities
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                
                // Look for different types of decorators
                const decoratorMatch = line.match(/@(?:\w+\.)?(asset|job|schedule|sensor|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/);
                if (decoratorMatch) {
                    const foundEntityType = decoratorMatch[1];
                    
                    // Get the full decorator and function name
                    const { decoratorText, functionName } = this.extractDecoratorInfo(document, i);
                    
                    if (!functionName) continue;
                    
                    // Find relationships based on entity types
                    if (entityType === 'job') {
                        this.findJobRelationships(entityName, foundEntityType, functionName, decoratorText, info);
                    } else if (entityType === 'schedule') {
                        this.findScheduleRelationships(entityName, foundEntityType, functionName, decoratorText, info);
                    } else if (entityType === 'sensor') {
                        this.findSensorRelationships(entityName, foundEntityType, functionName, decoratorText, info);
                    }
                }
            }
        } catch (error) {
            console.error('Error finding cross-entity relationships:', error);
        }
    }

    private extractDecoratorInfo(document: vscode.TextDocument, startLine: number): { decoratorText: string, functionName: string | null } {
        let decoratorText = '';
        let functionName: string | null = null;
        let parenCount = 0;
        let foundOpenParen = false;
        
        // Collect the full decorator
        for (let k = startLine; k < Math.min(startLine + 15, document.lineCount); k++) {
            const currentLine = document.lineAt(k).text;
            decoratorText += currentLine + '\n';
            
            // Track parentheses to find decorator end
            for (const char of currentLine) {
                if (char === '(') {
                    foundOpenParen = true;
                    parenCount++;
                } else if (char === ')') {
                    parenCount--;
                }
            }
            
            // Look for the function definition to get entity name
            const funcMatch = currentLine.match(/def\s+(\w+)\s*\(/);
            if (funcMatch) {
                functionName = funcMatch[1];
            }
            
            if (foundOpenParen && parenCount === 0) {
                break;
            }
        }
        
        return { decoratorText, functionName };
    }

    private findJobRelationships(jobName: string, foundEntityType: string, functionName: string, decoratorText: string, info: any): void {
        if (foundEntityType === 'asset') {
            // Check if this asset belongs to our job (via @asset decorator or job parameter)
            if (decoratorText.includes(`job=${jobName}`) || decoratorText.includes(`"${jobName}"`)) {
                info.assetsInJob.push(functionName);
            }
        } else if (foundEntityType === 'op' || foundEntityType === 'solid') {
            // Ops that might be used in this job (this is harder to detect statically)
            // For now, we'll rely on job definition parsing
        } else if (foundEntityType === 'schedule') {
            // Check if this schedule targets our job
            if (decoratorText.includes(`job=${jobName}`) || decoratorText.includes(`job_name="${jobName}"`)) {
                info.schedulesForJob.push(functionName);
            }
        } else if (foundEntityType === 'sensor') {
            // Check if this sensor targets our job
            if (decoratorText.includes(`job=${jobName}`) || decoratorText.includes(`job_name="${jobName}"`)) {
                info.sensorsForJob.push(functionName);
            }
        }
    }

    private findScheduleRelationships(scheduleName: string, foundEntityType: string, functionName: string, decoratorText: string, info: any): void {
        // For schedules, we mainly want to know what job they target (already parsed)
        // And what assets are in that target job (we'll resolve this in the hover method)
    }

    private findSensorRelationships(sensorName: string, foundEntityType: string, functionName: string, decoratorText: string, info: any): void {
        // For sensors, we mainly want to know what job/assets they target (already parsed)
        // And what assets are in that target job (we'll resolve this in the hover method)
    }

    private decoratorDependsOn(decoratorText: string, targetAsset: string): boolean {
        // Check deps= parameter for the target asset
        const depsMatch = decoratorText.match(/deps\s*=\s*\[(.*?)\]/s);
        if (depsMatch) {
            const depsContent = depsMatch[1];
            
            // Check for direct reference
            if (depsContent.includes(targetAsset)) {
                return true;
            }
            
            // Check for AssetKey reference
            const assetKeyPattern = new RegExp(`AssetKey\\(\\["[^"]*${targetAsset}[^"]*"\\]\\)`);
            if (assetKeyPattern.test(depsContent)) {
                return true;
            }
        }
        
        return false;
    }

    private parseCommonFields(decoratorText: string, info: any): void {
        // Extract group name
        const groupMatch = decoratorText.match(/group_name\s*=\s*["']([^"']+)["']/);
        if (groupMatch) {
            info.groupName = groupMatch[1];
        }
    }

    private parseAssetFields(decoratorText: string, info: any): void {
        // Extract dependencies from deps= parameter
        const depsMatch = decoratorText.match(/deps\s*=\s*\[(.*?)\]/s);
        if (depsMatch) {
            const depsContent = depsMatch[1];
            // Parse asset dependencies (simple heuristic)
            const assetKeyMatches = depsContent.match(/(?:dg\.)?AssetKey\(\["([^"]+)"(?:,\s*"([^"]+)")*\]\)/g);
            if (assetKeyMatches) {
                assetKeyMatches.forEach(match => {
                    const keyMatch = match.match(/"([^"]+)"/g);
                    if (keyMatch) {
                        const assetKey = keyMatch.map(k => k.replace(/"/g, '')).join('.');
                        info.dependencies.push(assetKey);
                    }
                });
            }
            
            // Also look for direct asset references
            const directRefs = depsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
            if (directRefs) {
                directRefs.forEach(ref => {
                    if (!ref.match(/^(AssetKey|dg)$/)) {
                        info.dependencies.push(ref);
                    }
                });
            }
        }
        
        // Extract compute kind
        const kindMatch = decoratorText.match(/kinds\s*=\s*\{["']([^"']+)["']\}/);
        if (kindMatch) {
            info.computeKind = kindMatch[1];
        }
    }

    private parseScheduleFields(decoratorText: string, info: any): void {
        // Extract cron schedule
        const cronMatch = decoratorText.match(/cron_schedule\s*=\s*["']([^"']+)["']/);
        if (cronMatch) {
            info.cronSchedule = cronMatch[1];
        }
        
        // Extract target job
        const jobMatch = decoratorText.match(/job\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (jobMatch) {
            info.targetJob = jobMatch[1];
        }
    }

    private parseJobFields(decoratorText: string, info: any): void {
        // Extract partitions
        const partitionMatch = decoratorText.match(/partitions_def\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (partitionMatch) {
            info.partitionBy = partitionMatch[1];
        }
    }

    private parseOpFields(decoratorText: string, info: any): void {
        // Extract retry policy
        const retryMatch = decoratorText.match(/retry_policy\s*=\s*RetryPolicy\(max_retries=(\d+)\)/);
        if (retryMatch) {
            info.retryPolicy = `Max retries: ${retryMatch[1]}`;
        }
        
        // Extract compute kind
        const kindMatch = decoratorText.match(/compute_kind\s*=\s*["']([^"']+)["']/);
        if (kindMatch) {
            info.computeKind = kindMatch[1];
        }
    }

    private parseSensorFields(decoratorText: string, info: any): void {
        // Extract target job
        const jobMatch = decoratorText.match(/job\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (jobMatch) {
            info.targetJob = jobMatch[1];
        }
        
        // Extract target assets
        const assetMatch = decoratorText.match(/asset_selection\s*=\s*\[(.*?)\]/s);
        if (assetMatch) {
            const assetsContent = assetMatch[1];
            const assetRefs = assetsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
            if (assetRefs) {
                info.targetAssets = assetRefs;
            }
        }
    }

    private parseResourceFields(decoratorText: string, info: any): void {
        // Resources can have required config schema
        const configMatch = decoratorText.match(/config_schema\s*=\s*\{([^}]+)\}/);
        if (configMatch) {
            info.configSchema = configMatch[1];
        }
        
        // Check for required resources
        const requiredMatch = decoratorText.match(/required_resource_keys\s*=\s*\{([^}]+)\}/);
        if (requiredMatch) {
            info.requiredResources = requiredMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        }
    }

    private parseIOManagerFields(decoratorText: string, info: any): void {
        // Similar to resource parsing
        this.parseResourceFields(decoratorText, info);
    }

    private parseGraphFields(decoratorText: string, info: any): void {
        // Graphs contain ops - this would need more complex parsing
        // For now, just capture basic info
    }

    private parsePartitionFields(decoratorText: string, info: any): void {
        // Extract partition configuration
        const startMatch = decoratorText.match(/start\s*=\s*["']([^"']+)["']/);
        if (startMatch) {
            info.partitionStart = startMatch[1];
        }
        
        const endMatch = decoratorText.match(/end\s*=\s*["']([^"']+)["']/);
        if (endMatch) {
            info.partitionEnd = endMatch[1];
        }
        
        const cronMatch = decoratorText.match(/cron_schedule\s*=\s*["']([^"']+)["']/);
        if (cronMatch) {
            info.cronSchedule = cronMatch[1];
        }
    }

    private parseLoggerFields(decoratorText: string, info: any): void {
        // Extract logger configuration
        const configMatch = decoratorText.match(/config_schema\s*=\s*\{([^}]+)\}/);
        if (configMatch) {
            info.configSchema = configMatch[1];
        }
    }

    private parseExecutorFields(decoratorText: string, info: any): void {
        // Extract executor configuration
        const configMatch = decoratorText.match(/config_schema\s*=\s*\{([^}]+)\}/);
        if (configMatch) {
            info.configSchema = configMatch[1];
        }
    }

    private parseHookFields(decoratorText: string, info: any): void {
        // Extract hook configuration
        const requiredMatch = decoratorText.match(/required_resource_keys\s*=\s*\{([^}]+)\}/);
        if (requiredMatch) {
            info.requiredResources = requiredMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        }
    }

    private parseDocstring(document: vscode.TextDocument, functionLine: number, info: any): void {
        if (functionLine + 1 < document.lineCount) {
            const nextLine = document.lineAt(functionLine + 1).text.trim();
            if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
                const quote = nextLine.startsWith('"""') ? '"""' : "'''";
                let docstring = '';
                
                if (nextLine.length > 3 && nextLine.endsWith(quote)) {
                    // Single line docstring
                    docstring = nextLine.slice(3, -3).trim();
                } else {
                    // Multi-line docstring
                    docstring = nextLine.slice(3);
                    for (let k = functionLine + 2; k < Math.min(functionLine + 10, document.lineCount); k++) {
                        const docLine = document.lineAt(k).text;
                        if (docLine.includes(quote)) {
                            docstring += ' ' + docLine.substring(0, docLine.indexOf(quote)).trim();
                            break;
                        }
                        docstring += ' ' + docLine.trim();
                    }
                }
                
                if (docstring) {
                    info.description = docstring.trim();
                }
            }
        }
    }

    private getStaticAssetInfo(assetName: string, document: vscode.TextDocument): {
        description?: string;
        dependencies: string[];
        computeKind?: string;
        groupName?: string;
    } {
        const info: {
            description?: string;
            dependencies: string[];
            computeKind?: string;
            groupName?: string;
        } = {
            dependencies: [] as string[],
        };

        try {
            // Find the asset function definition
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i).text;
                
                // Look for function definition matching our asset name
                const funcMatch = line.match(new RegExp(`def\\s+${assetName}\\s*\\(`));
                if (funcMatch) {
                    // Found the function, now look backwards for the decorator
                    let decoratorStartLine = -1;
                    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
                        const decoratorLine = document.lineAt(j).text;
                        if (decoratorLine.match(/@(?:\w+\.)?(asset|dg\.asset)/)) {
                            decoratorStartLine = j;
                            break;
                        }
                    }
                    
                    if (decoratorStartLine >= 0) {
                        // Parse decorator arguments
                        let decoratorText = '';
                        let parenCount = 0;
                        let foundOpenParen = false;
                        
                        for (let k = decoratorStartLine; k < i; k++) {
                            const line = document.lineAt(k).text;
                            decoratorText += line + '\n';
                            
                            for (const char of line) {
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
                        
                        // Extract dependencies from deps= parameter
                        const depsMatch = decoratorText.match(/deps\s*=\s*\[(.*?)\]/s);
                        if (depsMatch) {
                            const depsContent = depsMatch[1];
                            // Parse asset dependencies (simple heuristic)
                            const assetKeyMatches = depsContent.match(/(?:dg\.)?AssetKey\(\["([^"]+)"(?:,\s*"([^"]+)")*\]\)/g);
                            if (assetKeyMatches) {
                                assetKeyMatches.forEach(match => {
                                    const keyMatch = match.match(/"([^"]+)"/g);
                                    if (keyMatch) {
                                        const assetKey = keyMatch.map(k => k.replace(/"/g, '')).join('.');
                                        info.dependencies.push(assetKey);
                                    }
                                });
                            }
                            
                            // Also look for direct asset references (asset names without AssetKey wrapper)
                            const directRefs = depsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
                            if (directRefs) {
                                directRefs.forEach(ref => {
                                    if (!ref.match(/^(AssetKey|dg)$/)) {
                                        info.dependencies.push(ref);
                                    }
                                });
                            }
                        }
                        
                        // Extract compute kind
                        const kindMatch = decoratorText.match(/kinds\s*=\s*\{["']([^"']+)["']\}/);
                        if (kindMatch) {
                            info.computeKind = kindMatch[1];
                        }
                        
                        // Extract group name
                        const groupMatch = decoratorText.match(/group_name\s*=\s*["']([^"']+)["']/);
                        if (groupMatch) {
                            info.groupName = groupMatch[1];
                        }
                    }
                    
                    // Extract description from function docstring
                    if (i + 1 < document.lineCount) {
                        const nextLine = document.lineAt(i + 1).text.trim();
                        if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
                            const quote = nextLine.startsWith('"""') ? '"""' : "'''";
                            let docstring = '';
                            
                            if (nextLine.length > 3 && nextLine.endsWith(quote)) {
                                // Single line docstring
                                docstring = nextLine.slice(3, -3).trim();
                            } else {
                                // Multi-line docstring
                                docstring = nextLine.slice(3);
                                for (let k = i + 2; k < Math.min(i + 10, document.lineCount); k++) {
                                    const docLine = document.lineAt(k).text;
                                    if (docLine.includes(quote)) {
                                        docstring += ' ' + docLine.substring(0, docLine.indexOf(quote)).trim();
                                        break;
                                    }
                                    docstring += ' ' + docLine.trim();
                                }
                            }
                            
                            if (docstring) {
                                info.description = docstring.trim();
                            }
                        }
                    }
                    
                    break;
                }
            }
        } catch (error) {
            console.error('Error parsing static asset info:', error);
        }

        return info;
    }

    private async provideResourceHover(resourceName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(resourceName, 'resource', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🔧 Resource: \`${resourceName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.configSchema) {
                hoverContent.appendMarkdown(`**Config Schema:** \`${staticInfo.configSchema}\`\n\n`);
            }
            
            if (staticInfo.requiredResources && staticInfo.requiredResources.length > 0) {
                hoverContent.appendMarkdown(`**Required Resources:** \`${staticInfo.requiredResources.join('`, `')}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findResourceReferences?${JSON.stringify([resourceName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get resource hover for ${resourceName}:`, error);
            return undefined;
        }
    }

    private async provideIOManagerHover(ioManagerName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(ioManagerName, 'io_manager', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 💾 IO Manager: \`${ioManagerName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.configSchema) {
                hoverContent.appendMarkdown(`**Config Schema:** \`${staticInfo.configSchema}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findIOManagerReferences?${JSON.stringify([ioManagerName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get IO manager hover for ${ioManagerName}:`, error);
            return undefined;
        }
    }

    private async provideGraphHover(graphName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(graphName, 'graph', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🔀 Graph: \`${graphName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.groupName) {
                hoverContent.appendMarkdown(`**Group:** \`${staticInfo.groupName}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findGraphReferences?${JSON.stringify([graphName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get graph hover for ${graphName}:`, error);
            return undefined;
        }
    }

    private async provideConfigHover(configName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(configName, 'config', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### ⚙️ Config: \`${configName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findConfigReferences?${JSON.stringify([configName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get config hover for ${configName}:`, error);
            return undefined;
        }
    }

    private async providePartitionHover(partitionName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(partitionName, 'partition', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 📅 Partition: \`${partitionName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.partitionStart) {
                hoverContent.appendMarkdown(`**Start:** \`${staticInfo.partitionStart}\`\n\n`);
            }
            
            if (staticInfo.partitionEnd) {
                hoverContent.appendMarkdown(`**End:** \`${staticInfo.partitionEnd}\`\n\n`);
            }
            
            if (staticInfo.cronSchedule) {
                hoverContent.appendMarkdown(`**Cron Schedule:** \`${staticInfo.cronSchedule}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findPartitionReferences?${JSON.stringify([partitionName])}) • `);
            hoverContent.appendMarkdown(`[$(rocket) Launch Partition](command:dagster.dgLaunchPartition?${JSON.stringify([partitionName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get partition hover for ${partitionName}:`, error);
            return undefined;
        }
    }

    private async provideLoggerHover(loggerName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(loggerName, 'logger', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 📝 Logger: \`${loggerName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.configSchema) {
                hoverContent.appendMarkdown(`**Config Schema:** \`${staticInfo.configSchema}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findLoggerReferences?${JSON.stringify([loggerName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get logger hover for ${loggerName}:`, error);
            return undefined;
        }
    }

    private async provideExecutorHover(executorName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(executorName, 'executor', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🚀 Executor: \`${executorName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.configSchema) {
                hoverContent.appendMarkdown(`**Config Schema:** \`${staticInfo.configSchema}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findExecutorReferences?${JSON.stringify([executorName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get executor hover for ${executorName}:`, error);
            return undefined;
        }
    }

    private async provideHookHover(hookName: string, document: vscode.TextDocument): Promise<vscode.Hover | undefined> {
        try {
            const staticInfo = this.getStaticEntityInfo(hookName, 'hook', document);
            
            const hoverContent = new vscode.MarkdownString();
            hoverContent.isTrusted = true;
            
            hoverContent.appendMarkdown(`### 🪝 Hook: \`${hookName}\`\n\n`);
            
            if (staticInfo.description) {
                hoverContent.appendMarkdown(`**Description:** ${staticInfo.description}\n\n`);
            }
            
            if (staticInfo.requiredResources && staticInfo.requiredResources.length > 0) {
                hoverContent.appendMarkdown(`**Required Resources:** \`${staticInfo.requiredResources.join('`, `')}\`\n\n`);
            }
            
            hoverContent.appendMarkdown(`**Status:** 🟡 Static Analysis Only\n\n`);
            hoverContent.appendMarkdown(`---\n`);
            hoverContent.appendMarkdown(`[$(search) Find References](command:dagster.findHookReferences?${JSON.stringify([hookName])})`);
            
            return new vscode.Hover(hoverContent);
        } catch (error) {
            console.log(`Failed to get hook hover for ${hookName}:`, error);
            return undefined;
        }
    }

    private findFunctionNameAfterDecorator(document: vscode.TextDocument, decoratorLine: number): string | undefined {
        console.log('Looking for function after decorator on line:', decoratorLine);
        for (let i = decoratorLine + 1; i < Math.min(decoratorLine + 10, document.lineCount); i++) {
            const line = document.lineAt(i).text;
            console.log(`  Line ${i}: "${line}"`);
            const funcMatch = line.match(/def\s+(\w+)\s*\(/);
            if (funcMatch) {
                console.log(`  Found function: ${funcMatch[1]}`);
                return funcMatch[1];
            }
        }
        console.log('  No function found after decorator');
        return undefined;
    }

    private findFunctionLineAfterDecorator(document: vscode.TextDocument, decoratorLine: number): number {
        for (let i = decoratorLine + 1; i < Math.min(decoratorLine + 10, document.lineCount); i++) {
            const line = document.lineAt(i).text;
            if (line.trim().startsWith('def ')) {
                return i;
            }
        }
        return -1;
    }

    private findDecoratorBeforeFunction(document: vscode.TextDocument, functionLine: number): DagsterEntity['type'] | undefined {
        for (let i = functionLine - 1; i >= Math.max(0, functionLine - 5); i--) {
            const line = document.lineAt(i).text;
            // Support both @decorator and @module.decorator (like @dg.asset, @dagster.asset)
            // Also handle decorators with parameters like @dg.asset(...)
            const decoratorMatch = line.match(/@(?:\w+\.)?(asset|job|schedule|sensor|asset_check|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/);
            if (decoratorMatch) {
                return decoratorMatch[1] as DagsterEntity['type'];
            }
        }
        return undefined;
    }

    private findDecoratorLineBeforeFunction(document: vscode.TextDocument, functionLine: number): number {
        for (let i = functionLine - 1; i >= Math.max(0, functionLine - 5); i--) {
            const line = document.lineAt(i).text;
            // Support both @decorator and @module.decorator (like @dg.asset, @dagster.asset)
            // Also handle decorators with parameters like @dg.asset(...)
            if (line.match(/@(?:\w+\.)?(asset|job|schedule|sensor|asset_check|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Extract asset name from the current position (legacy method for backward compatibility)
     */
    public getJobNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if we're in a job definition or reference
        // Look for patterns like:
        // - @job decorator followed by function name
        // - job references in schedule/sensor definitions
        
        // Check if cursor is on a word that might be a job name
        if (word && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
            // Look backwards to see if there's a @job decorator
            for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
                const currentLine = document.lineAt(i).text;
                if (currentLine.includes('@job')) {
                    // Check if the word is the function name after the decorator
                    const functionPattern = new RegExp(`def\\s+${word}\\s*\\(`);
                    for (let j = i; j <= Math.min(position.line + 5, document.lineCount - 1); j++) {
                        const funcLine = document.lineAt(j).text;
                        if (functionPattern.test(funcLine)) {
                            return word;
                        }
                    }
                }
            }
            
            // Check if it's a job reference in schedule/sensor
            if (line.includes('job=') && line.includes(word)) {
                return word;
            }
        }

        return undefined;
    }

    public getScheduleNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if we're in a schedule definition or reference
        if (word && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
            // Look backwards to see if there's a @schedule decorator
            for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
                const currentLine = document.lineAt(i).text;
                if (currentLine.includes('@schedule')) {
                    // Check if the word is the function name after the decorator
                    const functionPattern = new RegExp(`def\\s+${word}\\s*\\(`);
                    for (let j = i; j <= Math.min(position.line + 5, document.lineCount - 1); j++) {
                        const funcLine = document.lineAt(j).text;
                        if (functionPattern.test(funcLine)) {
                            return word;
                        }
                    }
                }
            }
            
            // Check if it's a schedule reference
            if (line.includes('schedule=') && line.includes(word)) {
                return word;
            }
        }

        return undefined;
    }

    public getSensorNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if we're in a sensor definition or reference
        if (word && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
            // Look backwards to see if there's a @sensor decorator
            for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
                const currentLine = document.lineAt(i).text;
                if (currentLine.includes('@sensor')) {
                    // Check if the word is the function name after the decorator
                    const functionPattern = new RegExp(`def\\s+${word}\\s*\\(`);
                    for (let j = i; j <= Math.min(position.line + 5, document.lineCount - 1); j++) {
                        const funcLine = document.lineAt(j).text;
                        if (functionPattern.test(funcLine)) {
                            return word;
                        }
                    }
                }
            }
            
            // Check if it's a sensor reference
            if (line.includes('sensor=') && line.includes(word)) {
                return word;
            }
        }

        return undefined;
    }

    public getOpNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if we're in an op definition or reference
        if (word && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
            // Look backwards to see if there's a @op decorator
            for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
                const currentLine = document.lineAt(i).text;
                if (currentLine.includes('@op')) {
                    // Check if the word is the function name after the decorator
                    const functionPattern = new RegExp(`def\\s+${word}\\s*\\(`);
                    for (let j = i; j <= Math.min(position.line + 5, document.lineCount - 1); j++) {
                        const funcLine = document.lineAt(j).text;
                        if (functionPattern.test(funcLine)) {
                            return word;
                        }
                    }
                }
            }
            
            // Check if it's an op reference in job definitions
            if ((line.includes('ops=') || line.includes('op(')) && line.includes(word)) {
                return word;
            }
        }

        return undefined;
    }

    public getAssetNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const line = document.lineAt(position.line).text;

        // Check if this looks like an asset reference
        // Look for patterns like:
        // - deps=[asset_name]
        // - @asset(deps=[asset_name])
        // - function parameter: asset_name: pd.DataFrame
        // - AssetIn("asset_name")

        // Pattern 1: deps=[asset_name] or deps=[..., asset_name, ...]
        const depsPattern = /deps\s*=\s*\[([^\]]*)\]/;
        const depsMatch = line.match(depsPattern);
        if (depsMatch) {
            const depsList = depsMatch[1];
            if (depsList.includes(word)) {
                return word;
            }
        }

        // Pattern 2: AssetIn("asset_name")
        const assetInPattern = /AssetIn\s*\(\s*["']([^"']+)["']\s*\)/;
        const assetInMatch = line.match(assetInPattern);
        if (assetInMatch && assetInMatch[1] === word) {
            return word;
        }

        // Pattern 3: Function parameter that matches an asset name
        const paramPattern = new RegExp(`\\b${word}\\s*:\\s*\\w+`);
        if (paramPattern.test(line)) {
            // This could be an asset parameter, we'll verify it exists
            return word;
        }

        // Pattern 4: Check if we're in a function that has @asset decorator
        const functionStartLine = this.findFunctionStart(document, position.line);
        if (functionStartLine !== -1) {
            const functionText = document.getText(new vscode.Range(functionStartLine, 0, position.line + 1, 0));
            if (functionText.includes('@asset')) {
                // Check if this word appears in function parameters
                const funcDefMatch = functionText.match(/def\s+\w+\s*\(([^)]*)\)/);
                if (funcDefMatch && funcDefMatch[1].includes(word)) {
                    return word;
                }
            }
        }

        return undefined;
    }

    /**
     * Find the start line of the function containing the current position
     */
    private findFunctionStart(document: vscode.TextDocument, currentLine: number): number {
        for (let i = currentLine; i >= Math.max(0, currentLine - 20); i--) {
            const line = document.lineAt(i).text;
            if (line.trim().startsWith('def ')) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find the definition location of an asset in the workspace
     */
    private async findAssetDefinition(assetName: string): Promise<vscode.Location | undefined> {
        // Search for @asset decorator followed by function with this name
        const searchPattern = new RegExp(`@asset[\\s\\S]*?def\\s+(${assetName})\\s*\\(`, 'g');
        
        // Get all Python files in the workspace
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                
                let match;
                while ((match = searchPattern.exec(text)) !== null) {
                    const position = document.positionAt(match.index);
                    const functionMatch = text.substring(match.index).match(/def\s+(\w+)\s*\(/);
                    if (functionMatch && functionMatch[1] === assetName) {
                        const functionPosition = document.positionAt(match.index + text.substring(match.index).indexOf('def'));
                        return new vscode.Location(file, functionPosition);
                    }
                }
            } catch (error) {
                console.log(`Error searching in ${file.path}:`, error);
            }
        }

        return undefined;
    }
}

/**
 * Provides reference finding for Dagster assets
 */
export class DagsterReferenceProvider implements vscode.ReferenceProvider {
    constructor(private dagsterClient: DagsterGraphQLClient) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const assetName = this.getAssetNameAtPosition(document, position);
        if (!assetName) {
            return [];
        }

        const references: vscode.Location[] = [];

        // Include definition if requested
        if (context.includeDeclaration) {
            const navigationProvider = new DagsterNavigationProvider(this.dagsterClient);
            const definition = await navigationProvider.provideDefinition(document, position, token);
            if (definition && definition instanceof vscode.Location) {
                references.push(definition);
            }
        }

        // Find all references to this asset
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Search for various patterns where this asset might be referenced
                const patterns = [
                    // In deps list: deps=[asset_name] or deps=[..., asset_name, ...]
                    new RegExp(`deps\\s*=\\s*\\[[^\\]]*\\b${assetName}\\b[^\\]]*\\]`, 'g'),
                    // In AssetIn: AssetIn("asset_name")
                    new RegExp(`AssetIn\\s*\\(\\s*["']${assetName}["']\\s*\\)`, 'g'),
                    // As function parameter: asset_name: Type
                    new RegExp(`\\b${assetName}\\s*:\\s*\\w+`, 'g'),
                    // Direct reference in function body
                    new RegExp(`\\b${assetName}\\b(?!\\s*\\()`, 'g')
                ];

                for (const pattern of patterns) {
                    let match;
                    while ((match = pattern.exec(text)) !== null) {
                        const startPos = doc.positionAt(match.index);
                        const endPos = doc.positionAt(match.index + match[0].length);
                        
                        // Find the exact position of the asset name within the match
                        const assetIndex = match[0].indexOf(assetName);
                        if (assetIndex !== -1) {
                            const assetStartPos = doc.positionAt(match.index + assetIndex);
                            const assetEndPos = doc.positionAt(match.index + assetIndex + assetName.length);
                            references.push(new vscode.Location(file, new vscode.Range(assetStartPos, assetEndPos)));
                        }
                    }
                }
            } catch (error) {
                console.log(`Error searching references in ${file.path}:`, error);
            }
        }

        return references;
    }

    private getAssetNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }
        return document.getText(wordRange);
    }

    // =================== ENHANCED ENTITY HOVER FOR ALL DAGSTER ENTITIES ===================

    // =================== HELPER METHODS FOR ENTITY RELATIONSHIPS ===================

    // Helper methods for finding relationships between entities (basic implementations)
    
    private async findJobsContainingAsset(assetName: string, document: vscode.TextDocument): Promise<string[]> {
        const jobs: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @job decorators and check if the job references this asset
                // Look for @job decorators and check if the job references this asset
                const jobPattern = /@job[\s\S]*?def\s+(\w+)\s*\(/g;
                let jobMatch;
                while ((jobMatch = jobPattern.exec(text)) !== null) {
                    const jobName = jobMatch[1];
                    // Simple check if asset is referenced in the job
                    if (text.includes(assetName)) {
                        jobs.push(jobName);
                    }
                }
            } catch (error) {
                console.log(`Error searching jobs in ${file.path}:`, error);
            }
        }
        
        return jobs.filter((job, index) => jobs.indexOf(job) === index); // Remove duplicates
    }

    private async findAssetsInJob(jobName: string, document: vscode.TextDocument): Promise<string[]> {
        const assets: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Find the specific job definition and extract asset references
                const jobPattern = new RegExp(`@job[\\s\\S]*?def\\s+${jobName}\\s*\\(`);
                const jobMatch = text.match(jobPattern);
                if (jobMatch) {
                    // Simple heuristic: look for potential asset names
                    const allAssets = await this.dagsterClient.getAssets();
                    for (const asset of allAssets) {
                        if (text.includes(asset.key)) {
                            assets.push(asset.key);
                        }
                    }
                }
            } catch (error) {
                console.log(`Error searching assets in job ${jobName}:`, error);
            }
        }
        
        return assets.filter((asset, index) => assets.indexOf(asset) === index); // Remove duplicates
    }

    private async findOpsInJob(jobName: string, document: vscode.TextDocument): Promise<string[]> {
        const ops: string[] = [];
        // Basic implementation - could be enhanced with actual op detection
        return ops;
    }

    private async findSchedulesForJob(jobName: string, document: vscode.TextDocument): Promise<ScheduleSensorTarget[]> {
        const schedules: ScheduleSensorTarget[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                const schedulePattern = /@schedule[\s\S]*?def\s+(\w+)\s*\(/g;
                let scheduleMatch;
                while ((scheduleMatch = schedulePattern.exec(text)) !== null) {
                    const scheduleName = scheduleMatch[1];
                    // Check if this schedule targets the job
                    if (text.includes(jobName)) {
                        schedules.push({
                            name: scheduleName,
                            type: 'schedule',
                            targetJob: jobName
                        });
                    }
                }
            } catch (error) {
                console.log(`Error searching schedules for job ${jobName}:`, error);
            }
        }
        
        return schedules;
    }

    private async findSensorsForJob(jobName: string, document: vscode.TextDocument): Promise<ScheduleSensorTarget[]> {
        const sensors: ScheduleSensorTarget[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                const sensorPattern = /@sensor[\s\S]*?def\s+(\w+)\s*\(/g;
                let sensorMatch;
                while ((sensorMatch = sensorPattern.exec(text)) !== null) {
                    const sensorName = sensorMatch[1];
                    // Check if this sensor targets the job
                    if (text.includes(jobName)) {
                        sensors.push({
                            name: sensorName,
                            type: 'sensor',
                            targetJob: jobName
                        });
                    }
                }
            } catch (error) {
                console.log(`Error searching sensors for job ${jobName}:`, error);
            }
        }
        
        return sensors;
    }

    private async findAssetChecksForAsset(assetName: string, document: vscode.TextDocument): Promise<AssetCheckMapping[]> {
        const checks: AssetCheckMapping[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                const checkPattern = /@asset_check[\s\S]*?def\s+(\w+)\s*\(/g;
                let checkMatch;
                while ((checkMatch = checkPattern.exec(text)) !== null) {
                    const checkName = checkMatch[1];
                    // Check if this asset check targets the asset
                    if (text.includes(assetName)) {
                        checks.push({
                            checkName,
                            targetAsset: assetName
                        });
                    }
                }
            } catch (error) {
                console.log(`Error searching asset checks for ${assetName}:`, error);
            }
        }
        
        return checks;
    }

    private async findScheduleTargetJob(scheduleName: string, document: vscode.TextDocument): Promise<string | undefined> {
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                const schedulePattern = new RegExp(`@schedule[\\s\\S]*?def\\s+${scheduleName}\\s*\\(`);
                const scheduleMatch = text.match(schedulePattern);
                if (scheduleMatch) {
                    // Extract job reference from schedule
                    const jobMatch = text.match(/job\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
                    if (jobMatch) {
                        return jobMatch[1];
                    }
                }
            } catch (error) {
                console.log(`Error finding target job for schedule ${scheduleName}:`, error);
            }
        }
        
        return undefined;
    }

    private async findSensorTargetJob(sensorName: string, document: vscode.TextDocument): Promise<string | undefined> {
        // Similar implementation to findScheduleTargetJob
        return undefined;
    }

    private async findAssetCheckTargetAsset(checkName: string, document: vscode.TextDocument): Promise<string | undefined> {
        // Implementation to find target asset for asset check
        return undefined;
    }

    private async findJobsContainingOp(opName: string, document: vscode.TextDocument): Promise<string[]> {
        // Implementation to find jobs containing an op
        return [];
    }

    private async extractCronSchedule(scheduleName: string, document: vscode.TextDocument): Promise<string | undefined> {
        // Implementation to extract cron schedule
        return undefined;
    }

    private async extractAssetCheckSeverity(checkName: string, document: vscode.TextDocument): Promise<string | undefined> {
        // Implementation to extract severity
        return undefined;
    }

    // =================== HELPER METHODS FOR NEW DAGSTER ENTITIES ===================

    private async findAssetsUsingResource(resourceName: string, document: vscode.TextDocument): Promise<string[]> {
        const assets: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @asset decorators that reference this resource
                const assetPattern = /@asset[\s\S]*?def\s+(\w+)\s*\(/g;
                let assetMatch;
                while ((assetMatch = assetPattern.exec(text)) !== null) {
                    const assetName = assetMatch[1];
                    // Simple check if resource is referenced in the asset
                    if (text.includes(resourceName)) {
                        assets.push(assetName);
                    }
                }
            } catch (error) {
                console.log(`Error searching assets using resource ${resourceName}:`, error);
            }
        }
        
        return assets.filter((asset, index) => assets.indexOf(asset) === index); // Remove duplicates
    }

    private async findJobsUsingResource(resourceName: string, document: vscode.TextDocument): Promise<string[]> {
        const jobs: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @job decorators that reference this resource
                const jobPattern = /@job[\s\S]*?def\s+(\w+)\s*\(/g;
                let jobMatch;
                while ((jobMatch = jobPattern.exec(text)) !== null) {
                    const jobName = jobMatch[1];
                    // Simple check if resource is referenced in the job
                    if (text.includes(resourceName)) {
                        jobs.push(jobName);
                    }
                }
            } catch (error) {
                console.log(`Error searching jobs using resource ${resourceName}:`, error);
            }
        }
        
        return jobs.filter((job, index) => jobs.indexOf(job) === index); // Remove duplicates
    }

    private async findAssetsUsingIOManager(ioManagerName: string, document: vscode.TextDocument): Promise<string[]> {
        const assets: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @asset decorators that reference this IO manager
                const assetPattern = /@asset[\s\S]*?def\s+(\w+)\s*\(/g;
                let assetMatch;
                while ((assetMatch = assetPattern.exec(text)) !== null) {
                    const assetName = assetMatch[1];
                    // Check if IO manager is referenced (common patterns: io_manager_key, metadata)
                    if (text.includes(ioManagerName) || text.includes(`"${ioManagerName}"`)) {
                        assets.push(assetName);
                    }
                }
            } catch (error) {
                console.log(`Error searching assets using IO manager ${ioManagerName}:`, error);
            }
        }
        
        return assets.filter((asset, index) => assets.indexOf(asset) === index); // Remove duplicates
    }

    private async findOpsInGraph(graphName: string, document: vscode.TextDocument): Promise<string[]> {
        const ops: string[] = [];
        // Basic implementation - look for the graph definition and extract ops
        const text = document.getText();
        
        // Find the graph function and look for op calls within it
        const graphPattern = new RegExp(`@graph[\\s\\S]*?def\\s+${graphName}\\s*\\([\\s\\S]*?\\):[\\s\\S]*?(?=def|@|$)`, 'g');
        const graphMatch = graphPattern.exec(text);
        
        if (graphMatch) {
            const graphBody = graphMatch[0];
            // Look for op calls (function calls that might be ops)
            const opCallPattern = /(\w+)\(/g;
            let opMatch;
            while ((opMatch = opCallPattern.exec(graphBody)) !== null) {
                const potentialOp = opMatch[1];
                // Filter out common non-op calls
                if (!['def', 'return', 'if', 'for', 'while', 'print', 'len'].includes(potentialOp)) {
                    ops.push(potentialOp);
                }
            }
        }
        
        return ops.filter((op, index) => ops.indexOf(op) === index); // Remove duplicates
    }

    private async findJobsUsingGraph(graphName: string, document: vscode.TextDocument): Promise<string[]> {
        const jobs: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @job decorators that reference this graph
                const jobPattern = /@job[\s\S]*?def\s+(\w+)\s*\(/g;
                let jobMatch;
                while ((jobMatch = jobPattern.exec(text)) !== null) {
                    const jobName = jobMatch[1];
                    // Check if graph is referenced in the job
                    if (text.includes(graphName)) {
                        jobs.push(jobName);
                    }
                }
            } catch (error) {
                console.log(`Error searching jobs using graph ${graphName}:`, error);
            }
        }
        
        return jobs.filter((job, index) => jobs.indexOf(job) === index); // Remove duplicates
    }

    private async findEntitiesUsingConfig(configName: string, document: vscode.TextDocument): Promise<string[]> {
        const entities: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for any decorator that might reference this config
                const decoratorPattern = /@(asset|job|op|resource|io_manager)[\s\S]*?def\s+(\w+)\s*\(/g;
                let decoratorMatch;
                while ((decoratorMatch = decoratorPattern.exec(text)) !== null) {
                    const entityName = decoratorMatch[2];
                    // Check if config is referenced
                    if (text.includes(configName)) {
                        entities.push(entityName);
                    }
                }
            } catch (error) {
                console.log(`Error searching entities using config ${configName}:`, error);
            }
        }
        
        return entities.filter((entity, index) => entities.indexOf(entity) === index); // Remove duplicates
    }

    private async findAssetsUsingPartition(partitionName: string, document: vscode.TextDocument): Promise<string[]> {
        const assets: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @asset decorators that reference this partition
                const assetPattern = /@asset[\s\S]*?def\s+(\w+)\s*\(/g;
                let assetMatch;
                while ((assetMatch = assetPattern.exec(text)) !== null) {
                    const assetName = assetMatch[1];
                    // Check if partition is referenced (partitions_def parameter)
                    if (text.includes(partitionName)) {
                        assets.push(assetName);
                    }
                }
            } catch (error) {
                console.log(`Error searching assets using partition ${partitionName}:`, error);
            }
        }
        
        return assets.filter((asset, index) => assets.indexOf(asset) === index); // Remove duplicates
    }

    private async findJobsUsingPartition(partitionName: string, document: vscode.TextDocument): Promise<string[]> {
        const jobs: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @job decorators that reference this partition
                const jobPattern = /@job[\s\S]*?def\s+(\w+)\s*\(/g;
                let jobMatch;
                while ((jobMatch = jobPattern.exec(text)) !== null) {
                    const jobName = jobMatch[1];
                    // Check if partition is referenced
                    if (text.includes(partitionName)) {
                        jobs.push(jobName);
                    }
                }
            } catch (error) {
                console.log(`Error searching jobs using partition ${partitionName}:`, error);
            }
        }
        
        return jobs.filter((job, index) => jobs.indexOf(job) === index); // Remove duplicates
    }

    private async findEntitiesUsingHook(hookName: string, document: vscode.TextDocument): Promise<string[]> {
        const entities: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for any decorator that might reference this hook
                const decoratorPattern = /@(asset|job|op)[\s\S]*?def\s+(\w+)\s*\(/g;
                let decoratorMatch;
                while ((decoratorMatch = decoratorPattern.exec(text)) !== null) {
                    const entityName = decoratorMatch[2];
                    // Check if hook is referenced (hooks parameter)
                    if (text.includes(hookName)) {
                        entities.push(entityName);
                    }
                }
            } catch (error) {
                console.log(`Error searching entities using hook ${hookName}:`, error);
            }
        }
        
        return entities.filter((entity, index) => entities.indexOf(entity) === index); // Remove duplicates
    }

    private async findEntitiesUsingLogger(loggerName: string, document: vscode.TextDocument): Promise<string[]> {
        const entities: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for any decorator that might reference this logger
                const decoratorPattern = /@(asset|job|op)[\s\S]*?def\s+(\w+)\s*\(/g;
                let decoratorMatch;
                while ((decoratorMatch = decoratorPattern.exec(text)) !== null) {
                    const entityName = decoratorMatch[2];
                    // Check if logger is referenced
                    if (text.includes(loggerName)) {
                        entities.push(entityName);
                    }
                }
            } catch (error) {
                console.log(`Error searching entities using logger ${loggerName}:`, error);
            }
        }
        
        return entities.filter((entity, index) => entities.indexOf(entity) === index); // Remove duplicates
    }

    private async findJobsUsingExecutor(executorName: string, document: vscode.TextDocument): Promise<string[]> {
        const jobs: string[] = [];
        const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');
        
        for (const file of pythonFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const text = doc.getText();
                
                // Look for @job decorators that reference this executor
                const jobPattern = /@job[\s\S]*?def\s+(\w+)\s*\(/g;
                let jobMatch;
                while ((jobMatch = jobPattern.exec(text)) !== null) {
                    const jobName = jobMatch[1];
                    // Check if executor is referenced
                    if (text.includes(executorName)) {
                        jobs.push(jobName);
                    }
                }
            } catch (error) {
                console.log(`Error searching jobs using executor ${executorName}:`, error);
            }
        }
        
        return jobs.filter((job, index) => jobs.indexOf(job) === index); // Remove duplicates
    }

    /**
     * Detects what type of Dagster entity is at the given position
     */
    private getDagsterEntityAtPosition(document: vscode.TextDocument, position: vscode.Position): DagsterEntity | undefined {
        try {
            const line = document.lineAt(position.line).text;
            console.log('Testing regex pattern against line:', line);
            
            // First check if we're on a decorator line
            const decoratorRegex = /@(?:\w+\.)?(asset|job|schedule|sensor|asset_check|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/;
            console.log('Regex pattern:', decoratorRegex.toString());
            const decoratorMatch = line.match(decoratorRegex);
            console.log('Regex match result:', decoratorMatch);
            
            if (decoratorMatch) {
                // We're on a decorator line, find the function it decorates
                const entityType = decoratorMatch[1] as any;
                console.log(`Looking for function after decorator on line: ${position.line}`);
                
                // Look for the function definition on the next few lines
                for (let i = position.line + 1; i < Math.min(position.line + 5, document.lineCount); i++) {
                    const nextLine = document.lineAt(i).text;
                    console.log(`  Line ${i}: "${nextLine}"`);
                    const functionMatch = nextLine.match(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
                    if (functionMatch) {
                        const functionName = functionMatch[1];
                        console.log(`  Found function: ${functionName}`);
                        return {
                            type: entityType,
                            name: functionName,
                            decoratorLine: position.line,
                            functionLine: i
                        };
                    }
                }
            }
            
            // Check if we're on a variable assignment line for jobs (e.g., job_name = dg.define_asset_job(...))
            const jobDefMatch = line.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=.*(?:define_asset_job|define_job|AssetJob|Job)\s*\(/);
            if (jobDefMatch) {
                const jobName = jobDefMatch[1];
                console.log(`Found job definition: ${jobName}`);
                return {
                    type: 'job',
                    name: jobName,
                    decoratorLine: position.line,
                    functionLine: position.line
                };
            }
            
            // Check if cursor is on a function definition line (without decorator above)
            const functionMatch = line.match(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (functionMatch) {
                const functionName = functionMatch[1];
                
                // Look for decorator on previous lines
                for (let i = Math.max(0, position.line - 5); i < position.line; i++) {
                    const prevLine = document.lineAt(i).text;
                    const prevDecoratorMatch = prevLine.match(/@(?:\w+\.)?(asset|job|schedule|sensor|asset_check|op|solid|resource|io_manager|graph|config|partition|logger|executor|hook)/);
                    if (prevDecoratorMatch) {
                        const entityType = prevDecoratorMatch[1] as any;
                        return {
                            type: entityType,
                            name: functionName,
                            decoratorLine: i,
                            functionLine: position.line
                        };
                    }
                }
                
                // No decorator found, might be a regular function
                console.log(`Found function without decorator: ${functionName}`);
                return {
                    type: 'asset', // Default assumption for functions without decorators
                    name: functionName,
                    decoratorLine: position.line - 1,
                    functionLine: position.line
                };
            }
            
            // Check if we're hovering over an entity name (like in dependencies, etc.)
            const wordRange = document.getWordRangeAtPosition(position);
            if (wordRange) {
                const word = document.getText(wordRange);
                if (word && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word)) {
                    // This might be an asset reference, but we need more context
                    // For now, assume it's an asset
                    console.log(`Found potential entity reference: ${word}`);
                    return {
                        type: 'asset',
                        name: word,
                        decoratorLine: position.line,
                        functionLine: position.line
                    };
                }
            }
            
            return undefined;
        } catch (error) {
            console.log('Error in getDagsterEntityAtPosition:', error);
            return undefined;
        }
    }

    /**
     * Get job name at a specific position in the document
     */
    getJobNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const entity = this.getDagsterEntityAtPosition(document, position);
        if (entity && entity.type === 'job') {
            return entity.name;
        }
        return undefined;
    }

}
