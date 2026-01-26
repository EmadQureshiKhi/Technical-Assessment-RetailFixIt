# Security Configuration

This document describes the security configurations implemented in the RetailFixIt Vendor Dispatch System.

## Encryption at Rest

### Azure Cosmos DB
- **Default Encryption**: All data is encrypted at rest using service-managed keys (AES-256)
- **Customer-Managed Keys**: Can be enabled for production environments via Azure Key Vault integration
- **Backup Encryption**: Continuous backups are also encrypted

### Azure SQL Database
- **Transparent Data Encryption (TDE)**: Enabled by default
- **TDE Configuration**: `state: 'Enabled'` in `azure-sql.bicep`
- **Encryption Algorithm**: AES-256

### Azure Blob Storage
- **Storage Service Encryption (SSE)**: Enabled by default
- **Encryption at Rest**: All blobs are encrypted using Microsoft-managed keys

### Azure Service Bus
- **Encryption at Rest**: Enabled by default for all messages
- **Premium Tier**: Supports customer-managed keys

## Encryption in Transit

### TLS Configuration
All services are configured to require TLS 1.2 or higher:

### HTTPS Only
- Function App: `httpsOnly: true`
- Storage Account: `supportsHttpsTrafficOnly: true`

## Azure Key Vault

### Configuration
- **Soft Delete**: Enabled for production (90-day retention)
- **Purge Protection**: Enabled for production
- **RBAC Authorization**: Enabled for fine-grained access control
- **Network ACLs**: Allow Azure services bypass

### Secrets Stored
- `cosmos-connection-string`: Cosmos DB connection string
- `sql-connection-string`: Azure SQL connection string
- `sql-admin-password`: SQL admin password
- `servicebus-connection-string`: Service Bus connection string

## Network Security

### Network Security Groups (NSGs)
Configured for production environments with private endpoints:

1. **Private Endpoints NSG**
   - Allow VNet inbound traffic
   - Deny all other inbound traffic

2. **Functions NSG**
   - Allow HTTPS (port 443)
   - Allow Azure Load Balancer

### Private Endpoints (Production)
When enabled, private endpoints are created for:
- Azure Cosmos DB
- Azure SQL Database
- Azure Service Bus
- Azure Key Vault

### Private DNS Zones
- `privatelink.documents.azure.com` (Cosmos DB)
- `privatelink.database.windows.net` (SQL)
- `privatelink.servicebus.windows.net` (Service Bus)
- `privatelink.vaultcore.azure.net` (Key Vault)

## Access Control

### Azure AD Authentication
- All API endpoints require Azure AD authentication
- Function App uses system-assigned managed identity

### Role-Based Access Control (RBAC)
Key Vault uses RBAC authorization with the following permissions for Function App:
- `secrets: ['get', 'list']`

### Firewall Rules
- Azure SQL: Allow Azure services (`0.0.0.0` - `0.0.0.0`)
- Cosmos DB: Public network access enabled (can be restricted in production)

## Security Checklist

- [x] Azure AD authentication configured
- [x] RBAC roles defined and enforced
- [x] TLS 1.2+ for all connections
- [x] Encryption at rest enabled (Cosmos DB, SQL, Blob)
- [ ] PII masking in logs verified (implementation pending)
- [ ] Rate limiting configured (implementation pending)
- [ ] OWASP ZAP scan passed (testing pending)
- [ ] Snyk vulnerability scan passed (testing pending)
- [x] Network security groups configured
- [x] Private endpoints for sensitive services (production)


