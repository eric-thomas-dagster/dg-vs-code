import * as vscode from 'vscode';
import { DagsterGraphQLClient, DagsterAsset } from '../core/graphqlClient';

export class AssetTreeProvider implements vscode.TreeDataProvider<AssetTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AssetTreeItem | undefined | void> = new vscode.EventEmitter<AssetTreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<AssetTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    private assets: DagsterAsset[] = [];

    constructor(private dagsterClient: DagsterGraphQLClient) {
        this.refresh();
    }

    refresh(): void {
        this.loadAssets();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AssetTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AssetTreeItem): Thenable<AssetTreeItem[]> {
        if (!element) {
            // Root level - return asset groups or individual assets
            return Promise.resolve(this.getAssetGroups());
        } else if (element.contextValue === 'assetGroup') {
            // Return assets in this group
            return Promise.resolve(this.getAssetsInGroup(element.label as string));
        }
        
        return Promise.resolve([]);
    }

    private async loadAssets() {
        try {
            this.assets = await this.dagsterClient.getAssets();
        } catch (error) {
            console.error('Failed to load assets:', error);
            this.assets = [];
        }
    }

    private getAssetGroups(): AssetTreeItem[] {
        if (this.assets.length === 0) {
            return [new AssetTreeItem(
                'No assets found',
                vscode.TreeItemCollapsibleState.None,
                'noAssets',
                'Make sure Dagster is running and assets are available'
            )];
        }

        // Group assets by their prefix (before the first dot)
        const groups = new Map<string, DagsterAsset[]>();
        const ungroupedAssets: DagsterAsset[] = [];

        for (const asset of this.assets) {
            const parts = asset.key.split('.');
            if (parts.length > 1) {
                const groupName = parts[0];
                if (!groups.has(groupName)) {
                    groups.set(groupName, []);
                }
                groups.get(groupName)!.push(asset);
            } else {
                ungroupedAssets.push(asset);
            }
        }

        const treeItems: AssetTreeItem[] = [];

        // Add grouped assets
        for (const [groupName, groupAssets] of groups) {
            const groupItem = new AssetTreeItem(
                groupName,
                vscode.TreeItemCollapsibleState.Collapsed,
                'assetGroup',
                `${groupAssets.length} assets`
            );
            groupItem.iconPath = new vscode.ThemeIcon('folder');
            treeItems.push(groupItem);
        }

        // Add ungrouped assets
        for (const asset of ungroupedAssets) {
            const assetItem = this.createAssetTreeItem(asset);
            treeItems.push(assetItem);
        }

        return treeItems;
    }

    private getAssetsInGroup(groupName: string): AssetTreeItem[] {
        const groupAssets = this.assets.filter(asset => asset.key.startsWith(groupName + '.'));
        return groupAssets.map(asset => this.createAssetTreeItem(asset, groupName));
    }

    private createAssetTreeItem(asset: DagsterAsset, groupPrefix?: string): AssetTreeItem {
        let displayName = asset.key;
        if (groupPrefix) {
            displayName = asset.key.substring(groupPrefix.length + 1);
        }

        const hasRecentMaterialization = asset.assetMaterializations && asset.assetMaterializations.length > 0;
        const tooltip = asset.description || asset.key;

        const treeItem = new AssetTreeItem(
            displayName,
            vscode.TreeItemCollapsibleState.None,
            'asset',
            tooltip
        );

        // Set icon based on materialization status
        if (hasRecentMaterialization) {
            treeItem.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.yellow'));
        }

        // Add commands
        treeItem.command = {
            command: 'dagster.showAssetDetails',
            title: 'Show Asset Details',
            arguments: [asset.key]
        };

        // Context value is set in constructor

        return treeItem;
    }
}

export class AssetTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        contextValue: string,
        public readonly tooltip?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.contextValue = contextValue;
    }
}
