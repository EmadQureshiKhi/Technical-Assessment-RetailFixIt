/**
 * Azure SQL Module
 * 
 * Deploys Azure SQL Server and Database for audit logs and analytics.
 * 
 * @requirement 11.3 - Enable encryption at rest for Azure SQL (TDE)
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('SQL Server name')
param serverName string

@description('Database name')
param databaseName string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('SKU name')
@allowed(['Basic', 'S0', 'S1', 'S2', 'S3', 'P1', 'P2'])
param skuName string = 'Basic'

@description('Key Vault name for storing connection string')
param keyVaultName string

@description('SQL Admin username')
@secure()
param adminUsername string = 'sqladmin'

@description('SQL Admin password')
@secure()
param adminPassword string = newGuid()

resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: serverName
  location: location
  tags: tags
  properties: {
    administratorLogin: adminUsername
    administratorLoginPassword: adminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-05-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName == 'Basic' ? 'Basic' : (startsWith(skuName, 'S') ? 'Standard' : 'Premium')
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648 // 2GB
    // TDE is enabled by default for Azure SQL
  }
}

// Enable Transparent Data Encryption (TDE)
resource tde 'Microsoft.Sql/servers/databases/transparentDataEncryption@2023-05-01-preview' = {
  parent: sqlDatabase
  name: 'current'
  properties: {
    state: 'Enabled'
  }
}

// Allow Azure services to access
resource firewallRule 'Microsoft.Sql/servers/firewallRules@2023-05-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Store connection string in Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource sqlConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'sql-connection-string'
  properties: {
    value: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${databaseName};Persist Security Info=False;User ID=${adminUsername};Password=${adminPassword};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
  }
}

resource sqlAdminPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'sql-admin-password'
  properties: {
    value: adminPassword
  }
}

@description('SQL Server name')
output serverName string = sqlServer.name

@description('SQL Server FQDN')
output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('Database name')
output databaseName string = sqlDatabase.name
