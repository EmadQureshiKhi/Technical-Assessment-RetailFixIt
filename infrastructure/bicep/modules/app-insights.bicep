/**
 * Application Insights Module
 * 
 * Deploys Application Insights for observability and monitoring.
 * 
 * @requirement 10.2 - Implement distributed tracing with correlation IDs
 * @requirement 10.4 - Publish metrics to Azure Monitor
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Application Insights name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${name}-law'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 90
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    RetentionInDays: 90
  }
}

@description('Application Insights name')
output name string = appInsights.name

@description('Application Insights resource ID')
output id string = appInsights.id

@description('Application Insights connection string')
output connectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key')
output instrumentationKey string = appInsights.properties.InstrumentationKey

@description('Log Analytics Workspace ID')
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
