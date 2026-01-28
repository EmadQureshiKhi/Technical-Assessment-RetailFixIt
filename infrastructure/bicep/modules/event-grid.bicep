/**
 * Azure Event Grid Module
 * 
 * Deploys Event Grid topic for event routing.
 * 
 * @requirement 4.1 - JobCreated event consumption via Event Grid
 * @requirement 4.2 - VendorRecommendationGenerated event publishing
 * @requirement 12.1 - Define all Azure infrastructure using Bicep
 */

@description('Event Grid topic name')
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object

resource eventGridTopic 'Microsoft.EventGrid/topics@2023-12-15-preview' = {
  name: name
  location: location
  tags: tags
  properties: {
    inputSchema: 'CloudEventSchemaV1_0'
    publicNetworkAccess: 'Enabled'
    minimumTlsVersionAllowed: '1.2'
  }
}

// System topic for Azure resource events (optional, for monitoring)
// Note: System topic location must match the source resource location
resource systemTopic 'Microsoft.EventGrid/systemTopics@2023-12-15-preview' = {
  name: '${name}-system'
  location: 'global'  // Resource group events require global location
  tags: tags
  properties: {
    source: resourceGroup().id
    topicType: 'Microsoft.Resources.ResourceGroups'
  }
}

@description('Event Grid topic name')
output name string = eventGridTopic.name

@description('Event Grid topic endpoint')
output topicEndpoint string = eventGridTopic.properties.endpoint

@description('Event Grid topic ID')
output topicId string = eventGridTopic.id
