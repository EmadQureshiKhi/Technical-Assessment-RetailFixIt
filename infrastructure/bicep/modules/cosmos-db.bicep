/**
 * Azure Cosmos DB Module
 * 
 * Deploys Cosmos DB for vendor profiles, jobs, and recommendations.
 * 
 * @requirement 11.3 - Enable encryption at rest for Cosmos DB
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Cosmos DB account name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('Enable serverless mode')
param enableServerless bool = true

@description('Key Vault name for storing connection string')
param keyVaultName string

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: !enableServerless
    enableMultipleWriteLocations: false
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: enableServerless ? [
      {
        name: 'EnableServerless'
      }
    ] : []
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous7Days'
      }
    }
    // Encryption at rest is enabled by default with service-managed keys
    // For customer-managed keys, additional configuration is required
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: 'retailfixit'
  properties: {
    resource: {
      id: 'retailfixit'
    }
  }
}

resource vendorProfilesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'vendor-profiles'
  properties: {
    resource: {
      id: 'vendor-profiles'
      partitionKey: {
        paths: ['/partitionKey']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
      }
      defaultTtl: -1
    }
  }
}

resource jobsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'jobs'
  properties: {
    resource: {
      id: 'jobs'
      partitionKey: {
        paths: ['/jobId']
        kind: 'Hash'
      }
      defaultTtl: 2592000 // 30 days
    }
  }
}

resource recommendationsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: 'recommendations'
  properties: {
    resource: {
      id: 'recommendations'
      partitionKey: {
        paths: ['/jobId']
        kind: 'Hash'
      }
      defaultTtl: 604800 // 7 days
    }
  }
}

// Store connection string in Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource cosmosConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cosmos-connection-string'
  properties: {
    value: cosmosAccount.listConnectionStrings().connectionStrings[0].connectionString
  }
}

@description('Cosmos DB account name')
output name string = cosmosAccount.name

@description('Cosmos DB endpoint')
output endpoint string = cosmosAccount.properties.documentEndpoint

@description('Cosmos DB database name')
output databaseName string = database.name
