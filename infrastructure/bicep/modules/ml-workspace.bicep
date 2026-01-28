/**
 * Azure ML Workspace Module
 * 
 * Deploys Azure Machine Learning workspace for model training and deployment.
 * 
 * @requirement 8.1 - Model versioning and lifecycle management
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('ML Workspace name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('Key Vault resource ID')
param keyVaultId string

@description('Application Insights resource ID')
param appInsightsId string

// Storage account for ML workspace
// Storage account name must be 3-24 chars, lowercase letters and numbers only
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: toLower(replace(replace('${name}storage', '-', ''), '_', ''))
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    encryption: {
      services: {
        blob: {
          enabled: true
        }
        file: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// Container registry for ML models
// Container registry name must be 5-50 chars, alphanumeric only
resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: toLower(replace(replace('${name}acr', '-', ''), '_', ''))
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// ML Workspace
resource mlWorkspace 'Microsoft.MachineLearningServices/workspaces@2023-10-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'RetailFixIt ML Workspace'
    description: 'ML workspace for vendor scoring models'
    keyVault: keyVaultId
    storageAccount: storageAccount.id
    applicationInsights: appInsightsId
    containerRegistry: containerRegistry.id
    publicNetworkAccess: 'Enabled'
  }
}

// Compute cluster for training
// Requires vCPU quota for Standard DSv2 family
resource computeCluster 'Microsoft.MachineLearningServices/workspaces/computes@2023-10-01' = {
  parent: mlWorkspace
  name: 'training-cluster'
  location: location
  properties: {
    computeType: 'AmlCompute'
    properties: {
      vmSize: 'Standard_DS3_v2'
      vmPriority: 'Dedicated'
      scaleSettings: {
        minNodeCount: 0
        maxNodeCount: 2
        nodeIdleTimeBeforeScaleDown: 'PT5M'
      }
    }
  }
}

@description('ML Workspace name')
output name string = mlWorkspace.name

@description('ML Workspace ID')
output id string = mlWorkspace.id

@description('Storage account name')
output storageAccountName string = storageAccount.name

@description('Container registry name')
output containerRegistryName string = containerRegistry.name
