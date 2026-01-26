/**
 * Azure Cache for Redis Module
 * 
 * Deploys Azure Cache for Redis for caching vendor profiles and ML features.
 * 
 * @requirement Performance optimization - Caching layer
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Redis cache name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('SKU name')
@allowed(['Basic', 'Standard', 'Premium'])
param skuName string = 'Basic'

@description('SKU family')
@allowed(['C', 'P'])
param skuFamily string = 'C'

@description('SKU capacity')
@allowed([0, 1, 2, 3, 4, 5, 6])
param skuCapacity int = 0

@description('Key Vault name for storing connection string')
param keyVaultName string

var skuConfig = {
  Basic: {
    family: 'C'
    capacity: 0
  }
  Standard: {
    family: 'C'
    capacity: 1
  }
  Premium: {
    family: 'P'
    capacity: 1
  }
}

resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: skuName
      family: skuConfig[skuName].family
      capacity: skuConfig[skuName].capacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'maxmemory-policy': 'volatile-lru'
    }
  }
}

// Store connection string in Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource redisConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'redis-connection-string'
  properties: {
    value: '${redisCache.properties.hostName}:${redisCache.properties.sslPort},password=${redisCache.listKeys().primaryKey},ssl=True,abortConnect=False'
  }
}

@description('Redis cache name')
output name string = redisCache.name

@description('Redis cache hostname')
output hostname string = redisCache.properties.hostName

@description('Redis cache SSL port')
output sslPort int = redisCache.properties.sslPort
