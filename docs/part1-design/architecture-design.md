# RetailFixIt AI-Orchestrated Vendor Dispatch System
## Architecture Design Document

### Executive Summary

The RetailFixIt Vendor Dispatch System is an AI-orchestrated solution that automates vendor selection for retail service jobs. Built on Azure, it combines deterministic business rules with machine learning predictions to recommend optimal vendors based on historical performance, capacity, availability, and job characteristics.

### High-Level Architecture Diagram

![RetailFixIt Azure Architecture](diagrams/retailfixit_azure_architecture.png)

*See [diagrams/README.md](diagrams/README.md) for detailed component descriptions and connection legend.*

### System Architecture Overview

The system follows an event-driven microservices architecture with three core layers:

1. **Event Ingestion Layer**: Azure Event Grid and Service Bus handle job events from upstream systems, providing reliable message delivery with dead-letter support.

2. **AI Services Layer**: Azure Functions host the Vendor Scoring Service and Explainability Service, with Azure ML providing prediction endpoints.

3. **Data Layer**: Azure Cosmos DB stores vendor profiles and recommendations, Azure SQL maintains audit logs and historical metrics, and Redis provides low-latency caching.

### Azure Services and Rationale

| Service | Purpose | Why This Choice |
|---------|---------|-----------------|
| **Azure Functions** | Vendor Scoring, Explainability | Serverless execution scales automatically with job volume. Pay-per-execution model is cost-effective for variable workloads. Cold start mitigated by Premium plan for production. |
| **Azure Event Grid** | Event routing | Native Azure integration with push-based delivery. Topic filtering routes events to appropriate handlers without custom routing logic. |
| **Azure Service Bus** | Message queuing | Guaranteed delivery with sessions for ordered processing. Dead-letter queues capture failed messages for investigation and replay. |
| **Azure Cosmos DB** | Vendor profiles, recommendations | Sub-10ms reads for vendor lookups during scoring. Partition by service region aligns with query patterns. Global distribution ready for multi-region expansion. |
| **Azure SQL** | Audit logs, ML training data | Relational queries support compliance reporting. Strong consistency required for audit trail integrity. |
| **Azure ML** | Model hosting and training | Managed endpoints with auto-scaling. Model registry tracks versions for rollback. Built-in monitoring detects drift. |
| **Azure Cache for Redis** | Feature caching | Reduces database load during high-volume scoring. 5-minute TTL balances freshness with performance. |
| **Azure Static Web Apps** | Admin UI | Global CDN for operator access. Integrated authentication with Azure AD. |
| **Application Insights** | Observability | Distributed tracing correlates requests across services. Custom metrics track model performance and override rates. |

### AI Integration with Dispatch Workflow

The AI system integrates at the job creation point in the dispatch workflow:

**Event Flow:**
1. Job Portal publishes `JobCreated` event to Event Grid
2. Service Bus queues the event for reliable processing
3. Vendor Scoring Service consumes the event and:
   - Fetches eligible vendors from Cosmos DB
   - Applies rule-based filters (availability, geography, certifications, capacity)
   - Requests ML predictions from Azure ML endpoint
   - Combines scores using configurable weights
   - Generates human-readable explanations
4. `VendorRecommendationGenerated` event published with ranked vendors
5. Admin UI displays recommendations to operators

**Hybrid Scoring Approach:**

The scoring algorithm combines deterministic rules with ML predictions:

```
FinalScore = (0.4 × RuleScore) + (0.5 × MLScore) + (0.1 × ContextBonus)
```

- **Rule-based scoring** provides predictable baseline behavior for availability, proximity, certifications, and capacity
- **ML-based scoring** predicts completion probability, time-to-complete, and rework risk based on historical patterns
- **Weights are configurable** per job type, allowing business tuning

**Fallback Strategy:**

When ML is unavailable (timeout >5s or endpoint failure):
- Circuit breaker opens after 5 consecutive failures
- System falls back to rule-based scoring only
- Response includes `degradedMode: true` flag
- Confidence score reduced to trigger human review

### Automated vs Advisory Decisions

The system supports three automation levels, configurable per job type or customer tier:

| Level | Behavior | Use Case |
|-------|----------|----------|
| **Automated** | Top vendor dispatched without human intervention | Standard jobs with high-confidence recommendations (>85%) |
| **Advisory** | Recommendation displayed, operator confirms or overrides | Premium customers, complex jobs, or low-confidence scores |
| **Manual** | No AI recommendation, operator selects vendor | New job types with insufficient training data |

**Confidence-Based Routing:**

Recommendations below 70% confidence automatically route to advisory mode, regardless of configured automation level. This ensures human oversight for uncertain decisions.

**Decisions That Remain Human:**
- Final vendor selection for enterprise customers
- Override of AI recommendations (requires documented reason)
- Handling of edge cases (no eligible vendors, all vendors at capacity)
- Model deployment approval and rollback decisions

### Human-in-the-Loop Controls

The Admin UI provides operators with:
- Ranked vendor list with scores and explanations
- Risk factors highlighted for each vendor
- Confidence indicators for ML components
- One-click override with required reason capture
- Audit trail of all decisions and interventions

Override data feeds back into the ML training pipeline, enabling the model to learn from human expertise.

### Security and Compliance

- **Authentication**: Azure AD tokens required for all API access
- **Authorization**: RBAC with Operator, Admin, ML Engineer, and Auditor roles
- **Data Protection**: Encryption at rest (Cosmos DB, SQL) and in transit (TLS 1.2+)
- **PII Handling**: Customer data masked in logs, excluded from ML training
- **Audit Trail**: All AI decisions and human interventions logged to Azure SQL with 90-day retention

### Performance Targets

| Metric | Target | Implementation |
|--------|--------|----------------|
| Scoring latency | <2 seconds p99 | Redis caching, async ML calls |
| Throughput | 100 requests/second | Function auto-scaling, connection pooling |
| Availability | 99.9% | Multi-region Cosmos DB, circuit breakers |
| ML inference | <500ms | Azure ML managed endpoints with auto-scaling |

### Conclusion

This architecture balances automation efficiency with human oversight, using Azure's managed services to minimize operational burden while maintaining the flexibility to tune AI behavior as business needs evolve. The event-driven design enables loose coupling between components, supporting independent scaling and deployment of each service.
