#!/bin/bash

# RetailFixIt Vendor Dispatch System - Deployment Script
#
# @requirement 12.4 - Include deployment scripts for automated provisioning
# @requirement 12.2 - Support multiple environments (dev, staging, production)

set -e

# Default values
ENVIRONMENT="${ENVIRONMENT:-dev}"
LOCATION="${LOCATION:-eastus}"
RESOURCE_GROUP="${RESOURCE_GROUP:-retailfixit-${ENVIRONMENT}-rg}"
BASE_NAME="${BASE_NAME:-retailfixit}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment    Environment (dev, staging, production). Default: dev"
    echo "  -l, --location       Azure region. Default: eastus"
    echo "  -g, --resource-group Resource group name. Default: retailfixit-{env}-rg"
    echo "  -n, --name           Base name for resources. Default: retailfixit"
    echo "  -h, --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -e dev -l eastus"
    echo "  $0 --environment production --location westus2"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -l|--location)
            LOCATION="$2"
            shift 2
            ;;
        -g|--resource-group)
            RESOURCE_GROUP="$2"
            shift 2
            ;;
        -n|--name)
            BASE_NAME="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
    log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or production."
    exit 1
fi

# Update resource group name if using default
if [[ "$RESOURCE_GROUP" == "retailfixit-dev-rg" ]]; then
    RESOURCE_GROUP="retailfixit-${ENVIRONMENT}-rg"
fi

log_info "Starting deployment..."
log_info "Environment: $ENVIRONMENT"
log_info "Location: $LOCATION"
log_info "Resource Group: $RESOURCE_GROUP"
log_info "Base Name: $BASE_NAME"

# Check if logged in to Azure
log_info "Checking Azure CLI login status..."
if ! az account show &> /dev/null; then
    log_error "Not logged in to Azure CLI. Please run 'az login' first."
    exit 1
fi

# Create resource group if it doesn't exist
log_info "Creating resource group if it doesn't exist..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --tags project=RetailFixIt component=VendorDispatch environment="$ENVIRONMENT" \
    --output none

# Validate Bicep template
log_info "Validating Bicep template..."
az deployment group validate \
    --resource-group "$RESOURCE_GROUP" \
    --template-file ../bicep/main.bicep \
    --parameters environment="$ENVIRONMENT" baseName="$BASE_NAME" \
    --output none

log_info "Bicep template validation successful."

# Deploy infrastructure
log_info "Deploying infrastructure..."
DEPLOYMENT_OUTPUT=$(az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file ../bicep/main.bicep \
    --parameters environment="$ENVIRONMENT" baseName="$BASE_NAME" \
    --output json)

# Extract outputs
KEY_VAULT_NAME=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.keyVaultName.value')
FUNCTION_APP_NAME=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.functionAppName.value')
COSMOS_DB_ENDPOINT=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.cosmosDbEndpoint.value')

log_info "Deployment completed successfully!"
echo ""
log_info "Deployment Outputs:"
echo "  Key Vault Name: $KEY_VAULT_NAME"
echo "  Function App Name: $FUNCTION_APP_NAME"
echo "  Cosmos DB Endpoint: $COSMOS_DB_ENDPOINT"
echo ""
log_info "Next steps:"
echo "  1. Deploy function code: func azure functionapp publish $FUNCTION_APP_NAME"
echo "  2. Configure Event Grid subscriptions"
echo "  3. Deploy ML models to Azure ML workspace"
