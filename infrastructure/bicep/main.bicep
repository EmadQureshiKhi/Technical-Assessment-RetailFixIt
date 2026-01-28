/**
 * RetailFixIt Vendor Dispatch System - Main Infrastructure Template
 * 
 * Deploys all Azure resources required for the AI-Orchestrated Vendor Dispatch System.
 * 
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 * @requirement 12.2 - Support multiple environments (dev, staging, production)
 * @requirement 12.3 - Implement Azure best practices for networking, security, and resource organization
 * @requirement 12.4 - Include deployment scripts for automated provisioning
 * @requirement 12.5 - Parameterize for environment-specific configuration
 */

// ============================================================================
// Parameters
// ============================================================================

@description('Environment name (dev, staging, production)')
@allowed(['dev', 'staging', 'production'])
param environment string = 'dev'

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('Base name for all resources')
param baseName string = 'retailfixit'

@description('Tags to apply to all resources')
param tags object = {
  project: 'RetailFixIt'
  component: 'VendorDispatch'
  environment: environment
}

// ============================================================================
// Variables
// ============================================================================

var resourcePrefix = '${baseName}-${environment}'
var uniqueSuffix = uniqueString(resourceGroup().id)

// SKU configurations per environment
var skuConfig = {
  dev: {
    functionPlan: 'Y1'
    cosmosDb: 'Serverless'
    sql: 'Basic'
    serviceBus: 'Standard'
    redis: 'Basic'
    appInsights: 'PerGB2018'
  }
  staging: {
    functionPlan: 'EP1'
    cosmosDb: 'Autoscale'
    sql: 'S1'
    serviceBus: 'Standard'
    redis: 'Standard'
    appInsights: 'PerGB2018'
  }
  production: {
    functionPlan: 'EP2'
    cosmosDb: 'Autoscale'
    sql: 'S2'
    serviceBus: 'Premium'
    redis: 'Premium'
    appInsights: 'PerGB2018'
  }
}

var currentSku = skuConfig[environment]

// ============================================================================
// Module Deployments
// ============================================================================

// Key Vault - Deploy first for secrets management
// Key Vault name must be 3-24 chars, alphanumeric only
module keyVault 'modules/key-vault.bicep' = {
  name: 'keyVault-deployment'
  params: {
    name: 'rfixit${environment}kv${substring(uniqueSuffix, 0, 6)}'
    location: location
    tags: tags
    enableSoftDelete: true  // Always enable - can't be disabled once enabled
    enablePurgeProtection: environment == 'production'
  }
}

// Application Insights
module appInsights 'modules/app-insights.bicep' = {
  name: 'appInsights-deployment'
  params: {
    name: '${resourcePrefix}-ai'
    location: location
    tags: tags
  }
}

// Cosmos DB
module cosmosDb 'modules/cosmos-db.bicep' = {
  name: 'cosmosDb-deployment'
  params: {
    name: '${resourcePrefix}-cosmos-${uniqueSuffix}'
    location: location
    tags: tags
    enableServerless: currentSku.cosmosDb == 'Serverless'
    keyVaultName: keyVault.outputs.name
  }
}

// Azure SQL
module sqlServer 'modules/azure-sql.bicep' = {
  name: 'sqlServer-deployment'
  params: {
    serverName: '${resourcePrefix}-sql-${uniqueSuffix}'
    databaseName: '${resourcePrefix}-db'
    location: location
    tags: tags
    skuName: currentSku.sql
    keyVaultName: keyVault.outputs.name
  }
}

// Service Bus
module serviceBus 'modules/service-bus.bicep' = {
  name: 'serviceBus-deployment'
  params: {
    name: '${resourcePrefix}-sb-${uniqueSuffix}'
    location: location
    tags: tags
    skuName: currentSku.serviceBus
    keyVaultName: keyVault.outputs.name
  }
}

// Event Grid
module eventGrid 'modules/event-grid.bicep' = {
  name: 'eventGrid-deployment'
  params: {
    name: '${resourcePrefix}-eg'
    location: location
    tags: tags
  }
}

// Azure ML Workspace
module mlWorkspace 'modules/ml-workspace.bicep' = {
  name: 'mlWorkspace-deployment'
  params: {
    name: '${resourcePrefix}-ml'
    location: location
    tags: tags
    keyVaultId: keyVault.outputs.id
    appInsightsId: appInsights.outputs.id
  }
}

// Azure Functions
module functions 'modules/azure-functions.bicep' = {
  name: 'functions-deployment'
  params: {
    name: '${resourcePrefix}-func'
    location: location
    tags: tags
    planSku: currentSku.functionPlan
    appInsightsConnectionString: appInsights.outputs.connectionString
    keyVaultName: keyVault.outputs.name
    cosmosDbEndpoint: cosmosDb.outputs.endpoint
    serviceBusNamespace: serviceBus.outputs.namespace
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Key Vault name')
output keyVaultName string = keyVault.outputs.name

@description('Application Insights connection string')
output appInsightsConnectionString string = appInsights.outputs.connectionString

@description('Cosmos DB endpoint')
output cosmosDbEndpoint string = cosmosDb.outputs.endpoint

@description('SQL Server FQDN')
output sqlServerFqdn string = sqlServer.outputs.serverFqdn

@description('Service Bus namespace')
output serviceBusNamespace string = serviceBus.outputs.namespace

@description('Event Grid topic endpoint')
output eventGridEndpoint string = eventGrid.outputs.topicEndpoint

@description('ML Workspace name')
output mlWorkspaceName string = mlWorkspace.outputs.name

@description('Function App name')
output functionAppName string = functions.outputs.name
