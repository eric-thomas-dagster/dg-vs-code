# Dagster Power User VS Code Extension

A powerful VS Code extension for Dagster development that provides enhanced local development experience with lineage visualization, auto-completion, and local execution capabilities.

## Features

### 🎯 Core Features
- **Asset Lineage Visualization**: Interactive lineage viewer embedded directly in VS Code
- **Smart Auto-completion**: IntelliSense for assets, ops, resources, and Dagster decorators  
- **One-Click Asset Materialization**: Execute assets locally with a single click
- **Local Run Monitoring**: View run status and logs in real-time
- **Go-to-Definition Navigation**: Click to jump between asset definitions

### 🚀 Development Workflow
- **Project Detection**: Automatically detects Dagster projects
- **Asset Tree View**: Organized view of all assets in your project
- **Status Bar Integration**: Quick access to Dagster actions and connection status
- **Command Palette**: Fast access to common Dagster operations

## Prerequisites

- VS Code 1.85.0 or higher
- Python with Dagster installed
- Local Dagster instance running (for full functionality)

## Getting Started

1. **Install the Extension**: Install from VS Code marketplace or load from VSIX
2. **Open Dagster Project**: Open a workspace containing Dagster code
3. **Start Dagster**: Run `dagster dev` in your terminal
4. **Explore**: Use Command Palette (`Cmd+Shift+P`) and search for "Dagster" commands

## Commands

### 🎯 Core Features

| Command | Description |
|---------|-------------|
| `Dagster: Show Asset Lineage` | Display interactive lineage viewer for assets |
| `Dagster: 📊 Show Dependency Graph` | Show comprehensive dependency visualization |
| `Dagster: 🔍 Analyze Imports` | Analyze import dependencies in your project |
| `Dagster: 📚 Asset Catalog` | Browse all assets in your project |
| `Dagster: Materialize Current Asset` | Execute the asset in the current file |
| `Dagster: Start Local Webserver` | Launch `dagster dev` in terminal |
| `Dagster: Reload Code Location` | Refresh Dagster code location |
| `Dagster: Show Run History` | View recent run history |
| `Dagster: Quick Start - Launch Dagster Dev` | Quick way to start Dagster development server |
| `Dagster: Find Running Dagster Instance` | Automatically detect running Dagster instances |

### 🚀 Dagster+ Cloud Features

| Command | Description |
|---------|-------------|
| `Dagster: 🚀 Publish to Dagster+` | Deploy your project to Dagster+ |
| `Dagster: ⚡ Instant Deploy to Dagster+` | Quick deployment to Dagster+ |
| `Dagster: ⚡ Setup Dagster+ Deployment` | Configure Dagster+ deployment settings |
| `Dagster: 🌿 Deploy Current Branch` | Deploy current Git branch to Dagster+ |
| `Dagster: 🔐 Manage API Token` | Manage Dagster+ API tokens |
| `Dagster: Cloud Config Doctor` | Diagnose Dagster+ configuration issues |

### 🔧 DG CLI Integration

| Command | Description |
|---------|-------------|
| `Dagster: 🔍 DG Check Definitions` | Validate Dagster definitions |
| `Dagster: 🔍 DG Check TOML` | Validate pyproject.toml configuration |
| `Dagster: 🔍 DG Check YAML` | Validate YAML configuration files |
| `Dagster: 🚀 DG Dev Server` | Start development server with DG CLI |
| `Dagster: 🎯 DG Launch Run` | Launch a run using DG CLI |
| `Dagster: 📋 DG List Definitions` | List all Dagster definitions |
| `Dagster: 📋 DG List Components` | List all project components |
| `Dagster: 📋 DG List Projects` | List available Dagster projects |

### 🏗️ Code Generation

| Command | Description |
|---------|-------------|
| `Dagster: 🏗️ DG Scaffold Asset` | Generate new asset code |
| `Dagster: 🏗️ DG Scaffold Job` | Generate new job code |
| `Dagster: 🏗️ DG Scaffold Schedule` | Generate new schedule code |
| `Dagster: 🏗️ DG Scaffold Dockerfile` | Generate Dockerfile for deployment |
| `Dagster: 🏗️ DG Scaffold GitHub Actions` | Generate CI/CD workflow files |

### 📦 Project Setup

| Command | Description |
|---------|-------------|
| `Dagster: ⚡ Instant Project Setup` | Automated Dagster project setup |
| `Dagster: 📥 Clone → Setup → Deploy` | Complete project workflow from clone to deploy |

### 🎯 Asset Operations

| Command | Description |
|---------|-------------|
| `Dagster: Find Asset References` | Find all references to an asset |
| `Dagster: Go to Asset Definition` | Navigate to asset definition |
| `Dagster: 🎯 DG Launch Asset` | Execute a specific asset |

### ⚙️ Job Operations

| Command | Description |
|---------|-------------|
| `Dagster: Execute Job` | Run a specific job |
| `Dagster: Find Job References` | Find all references to a job |
| `Dagster: Go to Job Definition` | Navigate to job definition |
| `Dagster: Show Job Lineage` | Display job lineage visualization |
| `Dagster: 🔧 DG Launch Job` | Execute job using DG CLI |

### 📅 Schedule Operations

| Command | Description |
|---------|-------------|
| `Dagster: Find Schedule References` | Find all references to a schedule |
| `Dagster: Go to Schedule Definition` | Navigate to schedule definition |
| `Dagster: 🎯 DG Launch Schedule` | Execute schedule using DG CLI |

### 📡 Sensor Operations

| Command | Description |
|---------|-------------|
| `Dagster: Find Sensor References` | Find all references to a sensor |
| `Dagster: Go to Sensor Definition` | Navigate to sensor definition |
| `Dagster: 🎯 DG Launch Sensor` | Execute sensor using DG CLI |

### ⚙️ Op Operations

| Command | Description |
|---------|-------------|
| `Dagster: Find Op References` | Find all references to an op |
| `Dagster: Go to Op Definition` | Navigate to op definition |
| `Dagster: 🎯 DG Launch Op` | Execute op using DG CLI |

### 📊 Advanced Features

| Command | Description |
|---------|-------------|
| `Dagster: 📅 DG Launch Partition` | Execute specific partition |

## Configuration

Configure the extension via VS Code settings:

```json
{
  "dagster.webserverUrl": "http://localhost:3000",
  "dagster.graphqlUrl": "http://localhost:3000/graphql",
  "dagster.enableAutoCompletion": true,
  "dagster.enableLineagePreview": true
}
```

## Development

### Building from Source

1. Clone the repository
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Package: `npm run package`

### Testing

1. Press `F5` to open Extension Development Host
2. Open a Dagster project
3. Test the features

## Features Comparison with dbt Power User

This extension is inspired by the excellent [dbt Power User](https://github.com/AltimateAI/vscode-dbt-power-user) extension and brings similar productivity enhancements to Dagster development:

- ✅ Asset lineage visualization (similar to dbt model lineage)
- ✅ Auto-completion for Dagster concepts
- ✅ One-click local execution
- ✅ Project health checks
- ✅ Smart navigation and go-to-definition

## Contributing

Contributions are welcome! Please open issues and pull requests on GitHub.

## License

MIT License
