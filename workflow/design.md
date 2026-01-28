# Design Document: RetailFixIt AI-Orchestrated Vendor Dispatch System

## Overview

This design document describes the architecture for an AI-Orchestrated Retail Operations system on Azure. The system implements a Vendor Scorecard + Intelligent Dispatch System using a hybrid approach combining deterministic rules with ML-based predictions.

### Core Design Principles

1. **Event-Driven Architecture**: Components communicate through Azure Event Grid and Service Bus for loose coupling and scalability
2. **Hybrid Intelligence**: Combining predictable rule-based scoring with adaptive ML predictions, with graceful fallback
3. **Human-in-the-Loop**: Explainable recommendations with configurable automation levels and audit trails

---

### Event Flow

```
1. Job Portal publishes JobCreated event
2. Event Grid routes to Service Bus queue
3. Vendor Scoring Service dequeues and processes:
   a. Fetch vendor profiles from Cosmos DB
   b. Apply rule-based filters
   c. Request ML predictions (with timeout/fallback)
   d. Combine scores (hybrid approach)
   e. Generate explanations
4. Publish VendorRecommendationGenerated event
5. Admin UI displays recommendations to operator
6. Operator accepts or overrides recommendation
```

### Azure Services Selection

| Service | Resource Name | SKU | Purpose | Why |
|---------|---------------|-----|---------|-----|
| **Azure Functions** | retailfixit-dev-func | Y1 (Consumption) | Hosts all API endpoints (scoring, recommendations, overrides) | Serverless, event-driven, auto-scaling, cost-effective |
| **Static Web Apps** | retailfixit-admin-ui | Free | Hosts React Admin UI frontend | Integrated CI/CD, global CDN, serverless API integration |
| **Cosmos DB** | retailfixit-dev-cosmos | Serverless | Document database for jobs, vendors, recommendations | Low latency, flexible schema, global distribution |
| **Azure SQL** | retailfixit-dev-db | Basic | Relational database for audit logs, historical metrics | Strong consistency, relational queries for analytics |
| **Service Bus** | retailfixit-dev-sb | Standard | Message queuing for job events | Reliable delivery, dead-letter support, session handling |
| **Event Grid** | retailfixit-dev-eg | Basic | Event routing between services | Native Azure integration, push-based delivery, filtering |
| **Azure ML Workspace** | retailfixit-dev-ml | Basic | ML model training, versioning, registry | Managed ML infrastructure, model registry, endpoint management |
| **Key Vault** | rfixitdevkv | Standard | Secrets management (connection strings, API keys) | Secure secret storage, access policies, audit logging |
| **Application Insights** | retailfixit-dev-ai | Pay-as-you-go | Monitoring, logging, distributed tracing | End-to-end tracing, metrics, alerting, log analytics |
| **Storage Accounts** | retailfixitdev | Standard_LRS | Blob storage for function runtime, ML artifacts | Cost-effective storage, lifecycle management |
| **Container Registry** | retailfixitdevmlacr | Basic | Docker images for ML model deployment | Private registry for ML containers |
| **Redis Cache** | (planned) | Basic | Feature caching for ML predictions | Low-latency feature retrieval, reduce database load |

### Production vs Demo Architecture

For the assessment demo, the architecture is simplified:

| Component | Production Design | Demo Implementation |
|-----------|-------------------|---------------------|
| **Data Storage** | Cosmos DB + Azure SQL | In-memory sample data |
| **Event Processing** | Event Grid → Service Bus → Functions | Direct function calls |
| **ML Inference** | Azure ML Managed Endpoints | Pre-computed predictions embedded in code |
| **Audit Logging** | Azure SQL with retention policies | In-memory array |

The Bicep templates deploy the full production architecture, demonstrating what a real system would look like. The demo uses simplified in-memory implementations for faster development and easier demonstration.

---

---

## ML Models

### Trained Models

| Model | Version | Accuracy | Purpose |
|-------|---------|----------|---------|
| **Completion Model** | v20260128_033155 | 83.2% | Predicts job completion probability |
| **Time Model** | v20260128_033155 | R²=0.776 | Predicts estimated job duration (hours) |
| **Rework Model** | v20260128_033155 | 85.3% | Predicts rework probability |
| **Feature Scaler** | v20260128_033155 | N/A | Normalizes input features |

### Model Training
- **Algorithm**: Gradient Boosting (scikit-learn)
- **Training Data**: Historical job outcomes with vendor performance
- **Features**: Completion rate, certification match, service area, capacity, satisfaction, response time, rework rate

### Model Deployment Options

| Option | Description | Use Case |
|--------|-------------|----------|
| **Pre-computed** | Predictions embedded in code | Demo, low-latency |
| **Azure ML Endpoint** | Real-time inference via REST API | Production, dynamic |
| **Batch Scoring** | Scheduled prediction updates | High-volume, cost-effective |

---

## Scoring Algorithm Design

### Hybrid Scoring Formula

```
FinalScore = (α × RuleScore) + (β × MLScore) + (γ × ContextBonus)

Where:
- α = Rule weight (default 0.4)
- β = ML weight (default 0.5)  
- γ = Context weight (default 0.1)
```

### Rule-Based Scoring Components

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Availability | 0.25 | Binary (1.0 if available, 0.0 if not) |
| Geographic Proximity | 0.20 | 1.0 - (distance / maxDistance) |
| Certification Match | 0.20 | matchedCerts / requiredCerts |
| Capacity | 0.15 | 1.0 - (currentJobs / maxCapacity) |
| Historical Completion Rate | 0.20 | completedJobs / totalJobs |

### ML-Based Predictions

| Prediction | Description |
|------------|-------------|
| Completion Probability | Likelihood vendor completes job successfully |
| Time-to-Completion | Predicted hours to complete job |
| Rework Risk | Probability of requiring rework |

---

## Data Models

### Job Event Schema

```
JobEvent:
  - jobId: string (UUID)
  - jobType: enum (repair, installation, maintenance, inspection)
  - location: GeoLocation
  - urgencyLevel: enum (low, medium, high, critical)
  - slaDeadline: datetime
  - requiredCertifications: string[]
  - customerDetails: CustomerDetails
```

### Vendor Profile Schema

```
VendorProfile:
  - vendorId: string (UUID)
  - name: string
  - status: enum (active, inactive, suspended)
  - certifications: Certification[]
  - geographicCoverage: ServiceArea[]
  - maxCapacity: number
  - currentCapacity: number
  - availabilitySchedule: AvailabilityWindow[]
```

### Score Factors Schema

```
ScoreFactors:
  - availabilityScore: number (0-1)
  - proximityScore: number (0-1)
  - certificationScore: number (0-1)
  - capacityScore: number (0-1)
  - completionRate: number (0-1)
  - reworkRate: number (0-1)
  - predictedCompletionProb: number (0-1)
  - predictionConfidence: number (0-1)
```

---

## Correctness Properties

These properties define what the system must guarantee across all valid inputs. They serve as the bridge between requirements and testable guarantees.

### Property 1: Valid Ranked Vendor List
For any valid job and available vendors, the system SHALL produce a ranked list of 3-5 vendors where each vendor's rank corresponds to their descending overall score.

### Property 2: Score Breakdown Completeness
For any recommendation, the score breakdown SHALL contain all defined factors with values between 0-1, weights that sum to 1.0, and contributions that equal (value × weight).

### Property 3: Hybrid Scoring Combines Rules and ML
For any request where ML is available, the final score SHALL be a weighted combination of rule-based and ML-based scores, where both contribute non-zero values.

### Property 4: Tie-Breaking Determinism
For any two vendors with identical scores, the tie-breaking algorithm SHALL produce consistent ordering based on availability (primary) and proximity (secondary).

### Property 5: Configurable Weights Affect Scores
For any two different weight configurations applied to the same data, the resulting scores SHALL differ when rule-based and ML-based components differ.

### Property 6: Graceful ML Fallback
When the ML endpoint is unavailable or times out, the system SHALL return valid recommendations using rule-based scoring only, with a confidence indicator reflecting degraded mode.

### Property 7: Explainability Completeness
For any recommendation, the explanation SHALL contain: top 3 contributing factors, risk factors with severity, confidence levels for ML components, and comparison rationale.

### Property 8: Event Processing Idempotency
For any event processed multiple times, the system SHALL produce exactly one recommendation, identified by the same recommendationId derived from jobId.

### Property 9: Correlation ID Propagation
For any request, the correlationId SHALL appear in all log entries, downstream events, and API responses.

### Property 10: Override Requires Reason
For any override attempt, the system SHALL reject if the reason field is empty or whitespace only.

### Property 11: Automation Level Behavior
For any recommendation with automation level 'advisory', the system SHALL NOT automatically dispatch and SHALL require explicit human approval.

### Property 12: Low Confidence Triggers Review
For any recommendation with confidence below threshold (default 70%), the system SHALL flag for human review and set automation level to 'advisory'.

### Property 13: Override Audit Completeness
For any override, the audit log SHALL contain: timestamp, operatorId, jobId, originalVendorId, selectedVendorId, overrideReason, overrideCategory.

### Property 14: Schema Validation Enforcement
For any request with invalid input data, the system SHALL reject with 400 status and field-level validation details.

### Property 15: Model Version Tracking
For any recommendation, the response and audit log SHALL include the exact modelVersion string used.

### Property 16: Prediction Accuracy Monitoring
For any completed job, the system SHALL compare predicted values against actual outcomes and store for accuracy tracking.

### Property 17: Drift Detection Alerting
For any feature distribution deviating from baseline beyond threshold, the system SHALL generate a drift alert.

### Property 18: Feedback Loop Incorporation
For any override recorded, the override data SHALL be included in the next model retraining dataset.

### Property 19: Comprehensive Logging
For any request, the system SHALL log: input payload (PII masked), intermediate scores, final recommendation, processing time, model version.

### Property 20: Authentication Enforcement
For any request without valid Azure AD token, the system SHALL return 401 without processing.

### Property 21: RBAC Enforcement
For any unauthorized action attempt, the system SHALL return 403 Forbidden.

### Property 22: PII Masking in Logs
For any log entry with customer data, PII fields SHALL be masked or excluded.

### Property 23: Rate Limiting Enforcement
For any client exceeding rate limit, subsequent requests SHALL receive 429 until window resets.

### Property 24: Timeout Fallback Behavior
For any request where ML inference exceeds 5 seconds, the system SHALL return rule-based recommendation with degraded mode flag.

### Property 25: Circuit Breaker Activation
For any service experiencing consecutive failures beyond threshold, the circuit breaker SHALL open and use fallback behavior.

### Property 26: Retry with Exponential Backoff
For any transient failure, the system SHALL retry with exponentially increasing delays (1s, 2s, 4s) up to maximum retries.

---


## Testing Strategy

### Testing Pyramid

```
         ┌─────────────┐
         │   E2E (5%)  │  Playwright
         ├─────────────┤
         │Integration  │  TestContainers
         │   (20%)     │
         ├─────────────┤
         │   Unit      │  Vitest
         │   (50%)     │
         ├─────────────┤
         │  Property   │  fast-check
         │   (25%)     │
         └─────────────┘
```

### Test Categories

| Category | Purpose | Coverage Target |
|----------|---------|-----------------|
| Unit Tests | Individual function correctness | 80% line coverage |
| Property Tests | Universal properties across inputs | All 26 properties |
| Integration Tests | Service interactions | Event flows, DB operations |
| E2E Tests | Full user workflows | Critical paths |
| Load Tests | Performance validation | 100 req/s, <2s p99 |
| Security Tests | Vulnerability scanning | No critical/high |
