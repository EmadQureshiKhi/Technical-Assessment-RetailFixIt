/**
 * Azure Functions Module
 * 
 * Deploys Azure Functions for the Vendor Scoring Service.
 * 
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Function App name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('App Service Plan SKU')
@allowed(['Y1', 'EP1', 'EP2', 'EP3'])
param planSku string = 'Y1'

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Key Vault name')
param keyVaultName string

@description('Cosmos DB endpoint')
param cosmosDbEndpoint string

@description('Service Bus namespace')
param serviceBusNamespace string

// Storage account for Functions
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: replace('${name}storage', '-', '')
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: planSku
    tier: planSku == 'Y1' ? 'Dynamic' : 'ElasticPremium'
  }
  properties: {
    reserved: true // Linux
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'KEY_VAULT_NAME'
          value: keyVaultName
        }
        {
          name: 'COSMOS_DB_ENDPOINT'
          value: cosmosDbEndpoint
        }
        {
          name: 'SERVICE_BUS_NAMESPACE'
          value: serviceBusNamespace
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
      ]
    }
  }
}

// Grant Function App access to Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource keyVaultAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: functionApp.identity.principalId
        permissions: {
          secrets: ['get', 'list']
        }
      }
    ]
  }
}

@description('Function App name')
output name string = functionApp.name

@description('Function App hostname')
output hostname string = functionApp.properties.defaultHostName

@description('Function App principal ID')
output principalId string = functionApp.identity.principalId
