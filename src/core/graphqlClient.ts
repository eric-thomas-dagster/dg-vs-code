import { GraphQLClient } from 'graphql-request';
import * as vscode from 'vscode';

export interface DagsterAsset {
    key: string;
    description?: string;
    computeKind?: string;
    metadataEntries: any[];
    assetMaterializations: any[];
}

export interface DagsterJob {
    name: string;
    description?: string;
    isJob: boolean;
    pipelineSnapshotId?: string;
    runs: any[];
    schedules: Array<{
        name: string;
        cronSchedule: string;
    }>;
    sensors: Array<{
        name: string;
    }>;
}

export interface DagsterRun {
    runId: string;
    status: string;
    pipelineName: string;
    startTime: string;
    endTime?: string;
    mode: string;
}

export interface MaterializationResult {
    success: boolean;
    runId?: string;
    error?: string;
    status?: string;
}

export interface RunStatus {
    runId: string;
    status: string;
    startTime?: string;
    endTime?: string;
    success?: boolean;
    stats?: {
        stepsSucceeded: number;
        stepsFailed: number;
        materializations: number;
    };
    runConfigYaml?: string;
    tags?: Array<{ key: string; value: string }>;
    executionPlan?: {
        steps: Array<{
            key: string;
            kind: string;
        }>;
    };
}

export class DagsterGraphQLClient {
    private client: GraphQLClient | null = null;
    private baseUrl: string;

    constructor() {
        this.baseUrl = this.getConfiguration().graphqlUrl;
        this.initializeClient();
    }

    private getConfiguration() {
        const config = vscode.workspace.getConfiguration('dagster');
        return {
            webserverUrl: config.get<string>('webserverUrl', 'http://localhost:3000'),
            graphqlUrl: config.get<string>('graphqlUrl', 'http://localhost:3000/graphql')
        };
    }

    private initializeClient() {
        try {
            console.log(`🔧 Initializing GraphQL client with URL: ${this.baseUrl}`);
            this.client = new GraphQLClient(this.baseUrl, {
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            console.log('✅ GraphQL client initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize GraphQL client:', error);
            this.client = null;
        }
    }

    async testConnection(): Promise<boolean> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        try {
            const query = `
                query TestConnection {
                    __schema {
                        types {
                            name
                        }
                    }
                }
            `;

            await this.client.request(query);
            return true;
        } catch (error) {
            console.error('Connection test failed:', error);
            throw error;
        }
    }

    async getAssets(): Promise<DagsterAsset[]> {
        console.log('🔍 getAssets called, checking client initialization...');
        if (!this.client) {
            console.error('❌ GraphQL client not initialized!');
            throw new Error('GraphQL client not initialized');
        }
        console.log('✅ GraphQL client is initialized');

        const query = `
            query GetAssets {
                assetsOrError {
                    ... on AssetConnection {
                        nodes {
                            key {
                                path
                            }
                            definition {
                                description
                                computeKind
                                metadataEntries {
                                    label
                                    description
                                    ... on TextMetadataEntry {
                                        text
                                    }
                                }
                            }
                            assetMaterializations(limit: 1) {
                                timestamp
                                runId
                            }
                        }
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                }
            }
        `;

        try {
            console.log('🚀 Making GraphQL request to get assets...');
            const response: any = await this.client.request(query);
            console.log('📡 GraphQL response received:', JSON.stringify(response, null, 2));
            
            if (response.assetsOrError.__typename === 'PythonError') {
                console.error('🚨 Python error from Dagster:', response.assetsOrError.message);
                throw new Error(response.assetsOrError.message);
            }

            const assets = response.assetsOrError.nodes.map((node: any) => ({
                key: node.key.path.join('.'),
                description: node.definition?.description,
                computeKind: node.definition?.computeKind,
                metadataEntries: node.definition?.metadataEntries || [],
                assetMaterializations: node.assetMaterializations || []
            }));
            
            console.log(`✅ Successfully mapped ${assets.length} assets from GraphQL response`);
            return assets;
        } catch (error) {
            console.error('❌ Failed to fetch assets:', error);
            throw error;
        }
    }

    async getJobs(): Promise<DagsterJob[]> {
        console.log('🔍 getJobs called, checking client initialization...');
        if (!this.client) {
            console.log('❌ GraphQL client not initialized');
            throw new Error('GraphQL client not initialized');
        }

        try {
            console.log('🚀 Making GraphQL request to get jobs...');
            
            // First, get the workspace structure to find repository information
            const workspaceQuery = `
                query GetWorkspace {
                    workspaceOrError {
                        __typename
                        ... on Workspace {
                            locationEntries {
                                __typename
                                ... on WorkspaceLocationEntry {
                                    name
                                    locationOrLoadError {
                                        __typename
                                        ... on RepositoryLocation {
                                            name
                                            repositories {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        ... on PythonError {
                            message
                            stack
                        }
                    }
                }
            `;

            const workspaceResponse: any = await this.client.request(workspaceQuery);
            console.log('📡 Workspace response:', JSON.stringify(workspaceResponse, null, 2));

            if (workspaceResponse.workspaceOrError?.__typename === 'PythonError') {
                console.error('🚨 Python error from Dagster workspace query:', workspaceResponse.workspaceOrError.message);
                throw new Error(workspaceResponse.workspaceOrError.message);
            }

            // Extract repository information
            const locationEntries = workspaceResponse.workspaceOrError?.locationEntries || [];
            if (locationEntries.length === 0) {
                console.log('📝 No location entries found');
                return [];
            }

            const locationEntry = locationEntries[0];
            if (locationEntry?.locationOrLoadError?.__typename !== 'RepositoryLocation') {
                console.log('📝 No valid repository location found');
                return [];
            }

            const repositoryLocationName = locationEntry.name;
            const repositories = locationEntry.locationOrLoadError.repositories || [];
            
            if (repositories.length === 0) {
                console.log('📝 No repositories found in location');
                return [];
            }

            const repositoryName = repositories[0].name;
            console.log(`🎯 Using repository: ${repositoryName} in location: ${repositoryLocationName}`);

            // Now query for jobs using the repository selector
            const jobsQuery = `
                query ListJobs($repositoryLocationName: String!, $repositoryName: String!) {
                    repositoryOrError(
                        repositorySelector: {
                            repositoryLocationName: $repositoryLocationName,
                            repositoryName: $repositoryName
                        }
                    ) {
                        __typename
                        ... on Repository {
                            id
                            name
                            pipelines {
                                name
                                description
                                isJob
                            }
                        }
                        ... on PythonError {
                            message
                            stack
                        }
                    }
                }
            `;

            const variables = {
                repositoryLocationName,
                repositoryName
            };

            const response: any = await this.client.request(jobsQuery, variables);
            console.log('📡 Jobs GraphQL response received:', JSON.stringify(response, null, 2));

            if (response.repositoryOrError?.__typename === 'PythonError') {
                console.error('🚨 Python error from Dagster jobs query:', response.repositoryOrError.message);
                throw new Error(response.repositoryOrError.message);
            }

            if (response.repositoryOrError?.__typename === 'Repository') {
                const pipelines = response.repositoryOrError.pipelines || [];
                const jobs: DagsterJob[] = pipelines
                    .filter((pipeline: any) => pipeline.isJob)
                    .map((pipeline: any) => ({
                        name: pipeline.name,
                        description: pipeline.description,
                        isJob: pipeline.isJob,
                        runs: [], // We'll populate this separately if needed
                        schedules: [], // We'll populate this separately if needed
                        sensors: [] // We'll populate this separately if needed
                    }));

                console.log(`✅ Successfully mapped ${jobs.length} jobs from GraphQL response`);
                return jobs;
            } else {
                console.log('📝 No jobs found or unexpected response format');
                return [];
            }
        } catch (error) {
            console.error('❌ Failed to fetch jobs:', error);
            throw error;
        }
    }

    async getAssetLineage(assetKey: string): Promise<any> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const query = `
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
                    ... on AssetNotFoundError {
                        message
                    }
                }
            }
        `;

        try {
            const variables = {
                assetKey: {
                    path: assetKey.split('.')
                }
            };

            const response: any = await this.client.request(query, variables);
            
            if (response.assetNodeOrError.__typename === 'AssetNotFoundError') {
                throw new Error(response.assetNodeOrError.message);
            }

            return response.assetNodeOrError;
        } catch (error) {
            console.error('Failed to fetch asset lineage:', error);
            throw error;
        }
    }

    async materializeAsset(assetKey: string): Promise<MaterializationResult> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const mutation = `
            mutation MaterializeAsset($selector: JobOrPipelineSelector!) {
                launchRun(
                    executionParams: {
                        selector: $selector
                    }
                ) {
                    __typename
                    ... on LaunchRunSuccess {
                        run {
                            runId
                            status
                        }
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                    ... on InvalidStepError {
                        invalidStepKey
                    }
                    ... on InvalidOutputError {
                        stepKey
                        invalidOutputName
                    }
                    ... on RunConfigValidationInvalid {
                        errors {
                            message
                        }
                    }
                    ... on PipelineNotFoundError {
                        message
                    }
                }
            }
        `;

        try {
            // Get repository location name first
            const locationName = await this.getCurrentRepositoryLocationName();
            
            const variables = {
                selector: {
                    jobName: "__ASSET_JOB", // Dagster's default asset job
                    repositoryName: "__repository__", // Actual repo name from GraphQL
                    repositoryLocationName: locationName,
                    assetSelection: [{
                        path: assetKey.split('.')
                    }]
                }
            };

            const response: any = await this.client.request(mutation, variables);
            const result = response.launchRun;

            // Debug logging (commented out for production)
            // console.log('GraphQL Response:', JSON.stringify(response, null, 2));
            // console.log('LaunchRun Result:', JSON.stringify(result, null, 2));

            // Check if we have a run object (indicates success)
            if (result && result.run && result.run.runId) {
                return {
                    success: true,
                    runId: result.run.runId,
                    status: result.run.status
                };
            } else if (result.__typename === 'LaunchRunSuccess') {
                return {
                    success: true,
                    runId: result.run?.runId || 'Unknown run ID',
                    status: result.run?.status
                };
            } else {
                // Handle various error types
                const errorMessage = result.message || 
                                   result.errors?.[0]?.message || 
                                   (result.__typename && `Error: ${result.__typename}`) ||
                                   'Unknown error occurred';
                return {
                    success: false,
                    error: errorMessage
                };
            }
        } catch (error) {
            console.error('Failed to materialize asset:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async getRunStatus(runId: string): Promise<RunStatus> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const query = `
            query GetRunStatus($runId: ID!) {
                runOrError(runId: $runId) {
                    __typename
                    ... on Run {
                        runId
                        status
                        startTime
                        endTime
                        mode
                        runConfigYaml
                        tags {
                            key
                            value
                        }
                        stats {
                            ... on RunStatsSnapshot {
                                stepsSucceeded
                                stepsFailed
                                materializations
                            }
                        }
                        executionPlan {
                            steps {
                                key
                                kind
                            }
                        }
                    }
                    ... on RunNotFoundError {
                        message
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                }
            }
        `;

        try {
            const variables = { runId };
            console.log(`🔍 Querying run status for runId: ${runId}`);
            const response: any = await this.client.request(query, variables);
            console.log(`📊 Raw GraphQL response for getRunStatus:`, JSON.stringify(response, null, 2));
            const result = response.runOrError;
            console.log(`🎯 Run result object:`, JSON.stringify(result, null, 2));
            console.log(`🏷️ Result typename: ${result?.__typename}`);

            if (result.__typename === 'Run') {
                return {
                    runId: result.runId,
                    status: result.status,
                    startTime: result.startTime ? new Date(parseInt(result.startTime) * 1000).toLocaleString() : undefined,
                    endTime: result.endTime ? new Date(parseInt(result.endTime) * 1000).toLocaleString() : undefined,
                    success: result.status === 'SUCCESS',
                    stats: result.stats,
                    runConfigYaml: result.runConfigYaml,
                    tags: result.tags,
                    executionPlan: result.executionPlan
                };
            } else {
                throw new Error(result.message || 'Failed to get run status');
            }
        } catch (error) {
            console.error('Failed to get run status:', error);
            throw error;
        }
    }

    async getRecentRuns(limit: number = 10): Promise<DagsterRun[]> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const query = `
            query GetRecentRuns($limit: Int!) {
                runsOrError(limit: $limit) {
                    ... on Runs {
                        results {
                            runId
                            status
                            pipelineName
                            startTime
                            endTime
                            mode
                        }
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                }
            }
        `;

        try {
            const variables = { limit };
            const response: any = await this.client.request(query, variables);
            
            if (response.runsOrError.__typename === 'PythonError') {
                throw new Error(response.runsOrError.message);
            }

            return response.runsOrError.results.map((run: any) => ({
                runId: run.runId,
                status: run.status,
                pipelineName: run.pipelineName,
                startTime: new Date(parseInt(run.startTime) * 1000).toLocaleString(),
                endTime: run.endTime ? new Date(parseInt(run.endTime) * 1000).toLocaleString() : undefined,
                mode: run.mode
            }));
        } catch (error) {
            console.error('Failed to fetch recent runs:', error);
            throw error;
        }
    }

    async reloadCodeLocation(): Promise<void> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const mutation = `
            mutation ReloadRepositoryLocation($repositoryLocationName: String!) {
                reloadRepositoryLocation(repositoryLocationName: $repositoryLocationName) {
                    ... on WorkspaceLocationEntry {
                        name
                    }
                    ... on ReloadNotSupported {
                        message
                    }
                    ... on RepositoryLocationNotFound {
                        message
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                }
            }
        `;

        try {
            // First, get the current repository location name
            const repositoryLocationName = await this.getCurrentRepositoryLocationName();
            
            const variables = { repositoryLocationName };
            const response: any = await this.client.request(mutation, variables);
            
            const result = response.reloadRepositoryLocation;
            
            if (result.__typename !== 'WorkspaceLocationEntry') {
                throw new Error(result.message || 'Failed to reload code location');
            }
        } catch (error) {
            console.error('Failed to reload code location:', error);
            throw error;
        }
    }


    private async getCurrentRepositoryLocationName(): Promise<string> {
        if (!this.client) {
            throw new Error('GraphQL client not initialized');
        }

        const query = `
            query GetWorkspace {
                workspaceOrError {
                    ... on Workspace {
                        locationEntries {
                            name
                        }
                    }
                    ... on PythonError {
                        message
                        stack
                    }
                }
            }
        `;

        try {
            const response: any = await this.client.request(query);
            
            if (response.workspaceOrError.__typename === 'PythonError') {
                throw new Error(response.workspaceOrError.message);
            }

            const locationEntries = response.workspaceOrError.locationEntries;
            
            if (locationEntries.length === 0) {
                throw new Error('No repository locations found');
            }

            // Return the first location (for simplicity)
            return locationEntries[0].name;
        } catch (error) {
            console.error('Failed to get repository location name:', error);
            throw error;
        }
    }

    refreshClient() {
        const newConfig = this.getConfiguration();
        if (newConfig.graphqlUrl !== this.baseUrl) {
            this.baseUrl = newConfig.graphqlUrl;
            this.initializeClient();
        }
    }
}
