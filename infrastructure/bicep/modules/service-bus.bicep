/**
 * Azure Service Bus Module
 * 
 * Deploys Service Bus namespace with queues for event processing.
 * 
 * @requirement 4.3 - Dead-letter handling for failed event processing
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Service Bus namespace name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('SKU name')
@allowed(['Basic', 'Standard', 'Premium'])
param skuName string = 'Standard'

@description('Key Vault name for storing connection string')
param keyVaultName string

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// Scoring queue for job scoring requests
resource scoringQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'scoring-requests'
  properties: {
    lockDuration: 'PT5M'
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    enablePartitioning: false
    enableBatchedOperations: true
  }
}

// Dead letter queue for failed messages
resource deadLetterQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'dead-letter'
  properties: {
    lockDuration: 'PT5M'
    maxSizeInMegabytes: 1024
    maxDeliveryCount: 1
    enablePartitioning: false
    enableBatchedOperations: true
  }
}

// Recommendations queue for publishing recommendations
resource recommendationsQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'recommendations'
  properties: {
    lockDuration: 'PT5M'
    maxSizeInMegabytes: 1024
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    enablePartitioning: false
    enableBatchedOperations: true
  }
}

// Store connection string in Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource serviceBusConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'servicebus-connection-string'
  properties: {
    value: listKeys('${serviceBusNamespace.id}/AuthorizationRules/RootManageSharedAccessKey', serviceBusNamespace.apiVersion).primaryConnectionString
  }
}

@description('Service Bus namespace name')
output name string = serviceBusNamespace.name

@description('Service Bus namespace')
output namespace string = '${serviceBusNamespace.name}.servicebus.windows.net'

@description('Scoring queue name')
output scoringQueueName string = scoringQueue.name

@description('Dead letter queue name')
output deadLetterQueueName string = deadLetterQueue.name
