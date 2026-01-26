/**
 * Staging Environment Parameters
 * 
 * @requirement 12.2 - Support multiple environments (dev, staging, production)
 * @requirement 12.5 - Parameterize for environment-specific configuration
 */

using '../main.bicep'

param environment = 'staging'
param baseName = 'retailfixit'
param tags = {
  project: 'RetailFixIt'
  component: 'VendorDispatch'
  environment: 'staging'
  costCenter: 'staging'
}
