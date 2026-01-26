/**
 * Security Configuration Module
 * 
 * Configures network security groups, private endpoints, and encryption settings.
 * 
 * @requirement 11.3 - Encryption at rest and in transit
 * @requirement 12.3 - Implement Azure best practices for networking and security
 */

@description('Resource prefix')
param resourcePrefix string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

@description('Virtual Network address prefix')
param vnetAddressPrefix string = '10.0.0.0/16'

@description('Enable private endpoints (production only)')
param enablePrivateEndpoints bool = false

// Virtual Network for private endpoints
resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = if (enablePrivateEndpoints) {
  name: '${resourcePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.0.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'functions'
        properties: {
          addressPrefix: '10.0.3.0/24'
          delegations: [
            {
              name: 'Microsoft.Web.serverFarms'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
    ]
  }
}

// Network Security Group for private endpoints subnet
resource nsgPrivateEndpoints 'Microsoft.Network/networkSecurityGroups@2023-05-01' = if (enablePrivateEndpoints) {
  name: '${resourcePrefix}-nsg-pe'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowVnetInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '*'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// Network Security Group for Functions subnet
resource nsgFunctions 'Microsoft.Network/networkSecurityGroups@2023-05-01' = if (enablePrivateEndpoints) {
  name: '${resourcePrefix}-nsg-func'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHTTPS'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowAzureLoadBalancer'
        properties: {
          priority: 200
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// Private DNS Zone for Cosmos DB
resource privateDnsZoneCosmos 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.documents.azure.com'
  location: 'global'
  tags: tags
}

// Private DNS Zone for SQL
resource privateDnsZoneSql 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.database.windows.net'
  location: 'global'
  tags: tags
}

// Private DNS Zone for Service Bus
resource privateDnsZoneServiceBus 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.servicebus.windows.net'
  location: 'global'
  tags: tags
}

// Private DNS Zone for Key Vault
resource privateDnsZoneKeyVault 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePrivateEndpoints) {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

// Link DNS zones to VNet
resource vnetLinkCosmos 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: privateDnsZoneCosmos
  name: '${resourcePrefix}-cosmos-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource vnetLinkSql 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: privateDnsZoneSql
  name: '${resourcePrefix}-sql-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource vnetLinkServiceBus 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: privateDnsZoneServiceBus
  name: '${resourcePrefix}-sb-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource vnetLinkKeyVault 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePrivateEndpoints) {
  parent: privateDnsZoneKeyVault
  name: '${resourcePrefix}-kv-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

@description('Virtual Network ID')
output vnetId string = enablePrivateEndpoints ? vnet.id : ''

@description('Private Endpoints Subnet ID')
output privateEndpointsSubnetId string = enablePrivateEndpoints ? vnet.properties.subnets[1].id : ''

@description('Functions Subnet ID')
output functionsSubnetId string = enablePrivateEndpoints ? vnet.properties.subnets[2].id : ''

@description('Cosmos DB Private DNS Zone ID')
output cosmosDnsZoneId string = enablePrivateEndpoints ? privateDnsZoneCosmos.id : ''

@description('SQL Private DNS Zone ID')
output sqlDnsZoneId string = enablePrivateEndpoints ? privateDnsZoneSql.id : ''

@description('Service Bus Private DNS Zone ID')
output serviceBusDnsZoneId string = enablePrivateEndpoints ? privateDnsZoneServiceBus.id : ''

@description('Key Vault Private DNS Zone ID')
output keyVaultDnsZoneId string = enablePrivateEndpoints ? privateDnsZoneKeyVault.id : ''
