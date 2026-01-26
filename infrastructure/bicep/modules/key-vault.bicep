/**
 * Azure Key Vault Module
 * 
 * Deploys Azure Key Vault for secrets management.
 * 
 * @requirement 11.3 - Configure Azure Key Vault for secrets management
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Key Vault name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('Enable soft delete')
param enableSoftDelete bool = true

@description('Enable purge protection')
param enablePurgeProtection bool = false

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enabledForDeployment: true
    enabledForDiskEncryption: true
    enabledForTemplateDeployment: true
    enableSoftDelete: enableSoftDelete
    enablePurgeProtection: enablePurgeProtection ? true : null
    softDeleteRetentionInDays: 90
    enableRbacAuthorization: true
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

@description('Key Vault name')
output name string = keyVault.name

@description('Key Vault resource ID')
output id string = keyVault.id

@description('Key Vault URI')
output uri string = keyVault.properties.vaultUri
