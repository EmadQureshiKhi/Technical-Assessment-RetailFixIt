# Architecture Diagrams

This directory contains architecture diagrams for the RetailFixIt Vendor Dispatch System.

## High-Level Azure Architecture

![RetailFixIt Azure Architecture](retailfixit_azure_architecture.png)

### Architecture Overview

The diagram above shows the complete Azure architecture for the RetailFixIt AI-Orchestrated Vendor Dispatch System. The system is organized into logical layers that handle different responsibilities.

### Component Layers

**External**
- **Dispatch Operators**: Human users who review recommendations and can override AI decisions
- **Event Sources**: Upstream systems (Job Portal, Vendor Portal, Dispatch System) that publish events when jobs are created or updated

**Security & Identity**
- **Azure AD**: Handles authentication for all users accessing the Admin UI
- **Key Vault**: Securely stores connection strings, API keys, and other secrets

**Frontend**
- **Static Web App**: Hosts the Admin UI where operators view recommendations and perform overrides

**Event Ingestion**
- **Event Grid**: Receives events from all sources and routes them to appropriate handlers
- **Service Bus**: Provides reliable message queuing with guaranteed delivery
- **Dead Letter Queue**: Captures failed messages for investigation and replay

**AI Services (Azure Functions)**
- **Event Handler**: Processes incoming events from Service Bus
- **Vendor Scoring Service**: Core AI service that calculates hybrid scores combining rules and ML predictions
- **Explainability Service**: Generates human-readable explanations for each recommendation

**ML Platform**
- **Azure ML Workspace**: Manages model training, experiments, and versioning
- **ML Endpoint**: Serves real-time predictions for completion probability, time-to-complete, and rework risk
- **Model Artifacts**: Blob storage for trained model files and versions

**Data Layer**
- **Cosmos DB**: Low-latency storage for vendor profiles, jobs, and recommendations
- **Redis Cache**: Caches frequently accessed features to reduce database load
- **Azure SQL**: Relational storage for audit logs, historical metrics, and ML training data

**Observability**
- **Application Insights**: Collects telemetry, traces, and custom metrics from all services
- **Log Analytics**: Centralized log aggregation for querying and alerting

### Connection Legend

| Color | Flow Type | Description |
|-------|-----------|-------------|
| 🟢 Green | User/Auth | Operator authentication and UI interactions |
| 🔵 Blue | Events | Event publishing and processing flow |
| 🟣 Purple | AI/ML | Prediction requests and model deployment |
| 🟠 Orange | Data | Database read/write operations |
| ⚫ Gray (dotted) | Security | Secrets retrieval from Key Vault |
| 🔴 Red (dashed) | Monitoring | Telemetry and logging |

---

## System Overview (Mermaid)

```mermaid
flowchart TB
    subgraph "Event Sources"
        JobPortal[Job Portal]
        VendorPortal[Vendor Portal]
        DispatchSystem[Dispatch System]
    end

    subgraph "Event Ingestion"
        EventGrid[Azure Event Grid]
        ServiceBus[Azure Service Bus]
    end

    subgraph "AI Services"
        ScoringFunc[Vendor Scoring Service<br/>Azure Functions]
        MLEndpoint[ML Model Endpoint<br/>Azure ML]
        ExplainService[Explainability Service<br/>Azure Functions]
    end

    subgraph "Data Layer"
        CosmosDB[(Azure Cosmos DB<br/>Vendor Profiles, Jobs)]
        SQLServer[(Azure SQL<br/>Historical Metrics)]
        BlobStorage[Azure Blob Storage<br/>Model Artifacts]
        Redis[Azure Cache for Redis<br/>Feature Cache]
    end

    subgraph "Admin & Monitoring"
        AdminUI[Admin UI<br/>Azure Static Web Apps]
        AppInsights[Application Insights]
        LogAnalytics[Log Analytics]
    end

    subgraph "ML Pipeline"
        MLWorkspace[Azure ML Workspace]
        DataFactory[Azure Data Factory]
        MLRegistry[Model Registry]
    end

    JobPortal -->|JobCreated| EventGrid
    VendorPortal -->|VendorUpdated| EventGrid
    DispatchSystem -->|JobAssigned| EventGrid

    EventGrid --> ServiceBus
    ServiceBus --> ScoringFunc

    ScoringFunc --> MLEndpoint
    ScoringFunc --> ExplainService
    ScoringFunc --> CosmosDB
    ScoringFunc --> Redis
    ScoringFunc -->|VendorRecommendationGenerated| EventGrid

    MLEndpoint --> BlobStorage
    ExplainService --> CosmosDB

    AdminUI --> ScoringFunc
    AdminUI --> CosmosDB

    ScoringFunc --> AppInsights
    MLEndpoint --> AppInsights
    AppInsights --> LogAnalytics

    DataFactory --> SQLServer
    DataFactory --> MLWorkspace
    MLWorkspace --> MLRegistry
    MLRegistry --> MLEndpoint
```

### Key Components

| Component | Azure Service | Purpose |
|-----------|--------------|---------|
| Event Ingestion | Event Grid + Service Bus | Reliable event routing with dead-letter support |
| Scoring Service | Azure Functions | Serverless vendor scoring with auto-scaling |
| ML Endpoint | Azure ML | Managed model hosting with versioning |
| Data Store | Cosmos DB | Low-latency vendor profile storage |
| Audit Store | Azure SQL | Relational storage for compliance |
| Cache | Redis | Feature caching for performance |
| Admin UI | Static Web Apps | Operator interface with Azure AD auth |

---

## Event Flow Diagram

This sequence diagram shows the complete flow from job creation to vendor assignment.

```mermaid
sequenceDiagram
    participant JP as Job Portal
    participant EG as Event Grid
    participant SB as Service Bus
    participant VS as Vendor Scoring Service
    participant ML as ML Endpoint
    participant ES as Explainability Service
    participant DB as Cosmos DB
    participant UI as Admin UI
    participant OP as Operator

    JP->>EG: JobCreated Event
    EG->>SB: Route to scoring queue
    SB->>VS: Dequeue job event
    
    VS->>DB: Fetch vendor profiles
    VS->>VS: Apply rule-based filters
    
    alt ML Available
        VS->>ML: Request ML predictions
        ML-->>VS: Prediction scores
        VS->>VS: Combine hybrid scores
    else ML Unavailable
        VS->>VS: Use rule-based fallback
        VS->>VS: Mark degraded mode
    end
    
    VS->>ES: Generate explanations
    ES-->>VS: Human-readable rationale
    
    VS->>DB: Store recommendation
    VS->>EG: VendorRecommendationGenerated
    
    UI->>DB: Poll for recommendations
    UI->>OP: Display recommendation
    
    alt Confidence >= 70% and Auto Mode
        OP->>UI: Auto-dispatch confirmed
        UI->>EG: VendorAssigned
    else Advisory Mode or Low Confidence
        alt Accept Recommendation
            OP->>UI: Confirm recommendation
            UI->>EG: VendorAssigned
        else Override
            OP->>UI: Select different vendor
            OP->>UI: Provide override reason
            UI->>DB: Store override with reason
            UI->>EG: VendorOverrideRecorded
            UI->>EG: VendorAssigned
        end
    end
```

### Event Types

| Event | Publisher | Subscriber | Purpose |
|-------|-----------|------------|---------|
| JobCreated | Job Portal | Scoring Service | Triggers vendor scoring |
| VendorRecommendationGenerated | Scoring Service | Admin UI | Delivers ranked vendors |
| VendorOverrideRecorded | Admin UI | ML Pipeline | Captures feedback for retraining |
| VendorAssigned | Admin UI | Dispatch System | Confirms final assignment |

---

## Data Model Diagram

This entity-relationship diagram shows the core data structures and their relationships.

```mermaid
erDiagram
    JOB ||--o{ RECOMMENDATION : generates
    JOB ||--o{ JOB_OUTCOME : has
    VENDOR ||--o{ RECOMMENDATION : receives
    VENDOR ||--|| VENDOR_PROFILE : has
    VENDOR ||--o{ VENDOR_METRICS : tracks
    RECOMMENDATION ||--o{ SCORE_FACTOR : contains
    RECOMMENDATION ||--o| OVERRIDE : may_have
    
    JOB {
        string jobId PK
        string jobType
        string location
        string urgencyLevel
        datetime slaDeadline
        string requiredCertifications
        string customerDetails
        datetime createdAt
        string status
    }
    
    VENDOR {
        string vendorId PK
        string name
        string status
        datetime createdAt
    }
    
    VENDOR_PROFILE {
        string vendorId PK
        string certifications
        string geographicCoverage
        int maxCapacity
        string availabilitySchedule
        string specializations
        datetime updatedAt
    }
    
    VENDOR_METRICS {
        string vendorId FK
        string metricType
        float value
        datetime periodStart
        datetime periodEnd
    }
    
    RECOMMENDATION {
        string recommendationId PK
        string jobId FK
        string vendorId FK
        int rank
        float overallScore
        float confidence
        string rationale
        string modelVersion
        datetime generatedAt
    }
    
    SCORE_FACTOR {
        string factorId PK
        string recommendationId FK
        string factorName
        float value
        float weight
        float contribution
    }
    
    OVERRIDE {
        string overrideId PK
        string recommendationId FK
        string originalVendorId
        string selectedVendorId
        string operatorId
        string reason
        datetime createdAt
    }
    
    JOB_OUTCOME {
        string outcomeId PK
        string jobId FK
        string vendorId
        string status
        datetime completedAt
        float customerSatisfaction
        bool requiredRework
    }
```

### Storage Distribution

| Entity | Storage | Partition Key | Rationale |
|--------|---------|---------------|-----------|
| Job | Cosmos DB | serviceRegion | Query by region for scoring |
| Vendor Profile | Cosmos DB | serviceRegion | Co-locate with jobs |
| Recommendation | Cosmos DB | jobId | Query by job |
| Override | Azure SQL | - | Relational queries for audit |
| Job Outcome | Azure SQL | - | ML training joins |
| Vendor Metrics | Azure SQL | - | Aggregation queries |

---

## ML Pipeline Diagram

This diagram shows the machine learning lifecycle from data collection to model deployment.

```mermaid
flowchart TB
    subgraph "Data Sources"
        JobOutcomes[Job Outcomes<br/>Azure SQL]
        VendorMetrics[Vendor Metrics<br/>Cosmos DB]
        OverrideLogs[Override Logs<br/>Azure SQL]
    end

    subgraph "Feature Engineering"
        DataFactory[Azure Data Factory]
        FeatureStore[Feature Store<br/>Azure ML]
    end

    subgraph "Training Pipeline"
        MLWorkspace[Azure ML Workspace]
        TrainingCluster[Training Compute]
        Experiments[ML Experiments]
    end

    subgraph "Model Registry"
        Registry[Model Registry]
        Validation[Model Validation]
        Approval[Approval Gate]
    end

    subgraph "Deployment"
        Staging[Staging Endpoint]
        Production[Production Endpoint]
        ABTest[A/B Test Router]
    end

    subgraph "Monitoring"
        DriftDetector[Drift Detection]
        PerformanceMonitor[Performance Monitor]
        Alerts[Alert System]
    end

    JobOutcomes --> DataFactory
    VendorMetrics --> DataFactory
    OverrideLogs --> DataFactory
    
    DataFactory --> FeatureStore
    FeatureStore --> MLWorkspace
    
    MLWorkspace --> TrainingCluster
    TrainingCluster --> Experiments
    Experiments --> Registry
    
    Registry --> Validation
    Validation --> Approval
    Approval --> Staging
    Staging --> Production
    
    Production --> ABTest
    ABTest --> DriftDetector
    ABTest --> PerformanceMonitor
    
    DriftDetector --> Alerts
    PerformanceMonitor --> Alerts
    Alerts -->|Trigger Retrain| MLWorkspace
```

### ML Pipeline Stages

| Stage | Component | Trigger | Output |
|-------|-----------|---------|--------|
| Data Collection | Data Factory | Daily schedule | Feature dataset |
| Training | ML Workspace | Weekly or drift alert | Model candidate |
| Validation | Model Registry | New model registered | Validation metrics |
| Deployment | Blue-Green | Manual approval | Production endpoint |
| Monitoring | Drift Detector | Continuous | Alerts if drift >threshold |

### Model Predictions

The ML model produces three predictions for each vendor-job pair:

1. **Completion Probability** (0-1): Likelihood vendor completes job successfully
2. **Time-to-Completion** (hours): Predicted duration to complete job
3. **Rework Risk** (0-1): Probability of requiring rework

### Feedback Loop

Override data flows back into training:
1. Operator overrides AI recommendation
2. Override logged with reason to Azure SQL
3. Data Factory includes overrides in next training batch
4. Model learns from human expertise


---

## Future Architecture (Production-Ready)

The diagram below shows the enhanced architecture with additional Azure services for a production-grade deployment.

![RetailFixIt Future Architecture](retailfixit_azure_architecturenew.png)

### Additional Components

| Service | Purpose |
|---------|---------|
| **Azure CDN** | Global edge caching for Admin UI |
| **Application Gateway (WAF)** | Web application firewall, SSL termination, DDoS protection |
| **API Management** | Rate limiting, API versioning, developer portal |
| **Event Hubs** | High-volume event streaming for ML pipelines |
| **Managed Identities** | Zero-secret authentication between services |
| **Defender for Cloud** | Security monitoring and compliance |
| **Cognitive Services** | Text analytics, anomaly detection |
| **Data Factory** | ETL pipelines for ML training data |

See [tradeoffs-assumptions.md](../tradeoffs-assumptions.md#production-ready-enhancements) for rationale.
