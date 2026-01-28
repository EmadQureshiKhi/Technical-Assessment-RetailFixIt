# Implementation Plan: RetailFixIt AI-Orchestrated Vendor Dispatch System

## Overview

This implementation plan breaks down the RetailFixIt Vendor Scorecard + Intelligent Dispatch System into discrete coding tasks. Tasks are organized to build incrementally, with property-based tests validating correctness at each stage.

**Technology Stack:**
- Backend: TypeScript/Node.js with Azure Functions
- Frontend: React with TypeScript (Azure Static Web Apps)
- ML: Python with Azure ML
- Infrastructure: Bicep (Azure IaC)
- Testing: Vitest, fast-check, Playwright

---

## Tasks

### 1. Project Setup and Core Infrastructure

- 1.1 Initialize project structure with monorepo layout
  - Create directory structure: `src/backend`, `src/frontend`, `src/ml`, `infrastructure`, `tests`, `docs`
  - Initialize npm workspaces for backend, frontend, and shared packages
  - Configure TypeScript with strict mode
  - Set up ESLint and Prettier
  - *Requirements: 12.1, 12.5*

- 1.2 Define core data models and schemas
  - Create `src/backend/shared/models/job.ts` with JobEvent interface
  - Create `src/backend/shared/models/vendor.ts` with VendorProfile interface
  - Create `src/backend/shared/models/scoring.ts` with ScoreFactors and ScoreBreakdown interfaces
  - Create `src/backend/shared/models/events.ts` with event schemas
  - Implement Zod schemas for runtime validation
  - *Requirements: 7.1, 7.2, 7.3*

- 1.3 Write property tests for schema validation
  - **Property 14: Schema Validation Enforcement**
  - Test that invalid inputs are rejected with field-level errors
  - *Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6*

- 1.4 Create Bicep infrastructure templates
  - Create `infrastructure/bicep/main.bicep` with resource group and parameters
  - Create modules for: Azure Functions, Cosmos DB, Azure SQL, Service Bus, Event Grid
  - Create modules for: Azure ML Workspace, Application Insights, Key Vault
  - Parameterize for dev/staging/production environments
  - *Requirements: 12.1, 12.2, 12.3, 12.4, 12.5*

- 1.5 Configure data encryption and security
  - Enable encryption at rest for Cosmos DB (customer-managed keys)
  - Enable encryption at rest for Azure SQL (TDE)
  - Configure Azure Key Vault for secrets management
  - Enable TLS 1.2+ for all data in transit
  - Configure network security groups and private endpoints
  - *Requirements: 11.3*

- 1.6 Implement caching layer
  - Create `src/backend/shared/cache/redis-client.ts`
  - Implement vendor profile caching (TTL: 5 minutes)
  - Implement feature cache for ML predictions
  - Add cache invalidation on vendor updates
  - *Requirements: Performance optimization*

### 2. Checkpoint - Verify project setup
- Ensure TypeScript compiles without errors
- Ensure Bicep templates validate successfully

---

### 3. Vendor Scoring Service - Rule Engine

- 3.1 Implement rule-based scoring filters
  - Create `src/backend/vendor-scoring-service/rules/availability-filter.ts`
  - Create `src/backend/vendor-scoring-service/rules/geographic-filter.ts`
  - Create `src/backend/vendor-scoring-service/rules/certification-filter.ts`
  - Create `src/backend/vendor-scoring-service/rules/capacity-filter.ts`
  - Each filter returns boolean (pass/fail) and score contribution
  - *Requirements: 2.1*

- 3.2 Implement rule-based score aggregator
  - Create `src/backend/vendor-scoring-service/rules/rule-engine.ts`
  - Combine filter results with configurable weights
  - Calculate rule-based score (0-1 range)
  - Return score breakdown with factor contributions
  - *Requirements: 1.3, 1.4, 2.1*

- 3.3 Write property tests for rule engine
  - **Property 2: Score Breakdown Completeness**
  - Test that all factors are present with valid values and weights sum to 1.0
  - *Validates: Requirements 1.4*

- 3.4 Write property tests for tie-breaking
  - **Property 4: Tie-Breaking Determinism**
  - Test that identical scores produce consistent ordering
  - *Validates: Requirements 1.7*

---

### 4. Vendor Scoring Service - ML Integration

- 4.1 Create ML client with fallback handling
  - Create `src/backend/vendor-scoring-service/ml/ml-client.ts`
  - Implement Azure ML endpoint invocation
  - Implement timeout handling (5 second limit)
  - Implement circuit breaker pattern
  - Return predictions: completion probability, time-to-complete, rework risk
  - *Requirements: 2.2, 13.1, 13.2, 13.4*

- 4.2 Implement feature extraction for ML
  - Create `src/backend/vendor-scoring-service/ml/feature-extractor.ts`
  - Extract features from job and vendor data
  - Normalize features for model input
  - Handle missing data with defaults
  - *Requirements: 2.2, 2.5*

- 4.3 Write property tests for ML fallback
  - **Property 6: Graceful ML Fallback**
  - Test that ML unavailability returns valid rule-based recommendations
  - *Validates: Requirements 2.3, 13.1*

- 4.4 Write property tests for circuit breaker
  - **Property 25: Circuit Breaker Activation**
  - Test that consecutive failures open the circuit
  - *Validates: Requirements 13.4*

- 4.5 Write property tests for timeout handling
  - **Property 24: Timeout Fallback Behavior**
  - Test that ML timeout (>5s) returns rule-based fallback
  - Test that response includes degraded mode flag
  - *Validates: Requirements 13.2*

---

### 5. Vendor Scoring Service - Hybrid Scoring

- 5.1 Implement hybrid score aggregator
  - Create `src/backend/vendor-scoring-service/scoring/hybrid-scorer.ts`
  - Combine rule-based and ML scores with configurable weights
  - Calculate overall confidence based on data quality and ML confidence
  - Implement tie-breaking logic
  - *Requirements: 1.3, 1.7, 2.4*

- 5.2 Implement vendor ranking and selection
  - Create `src/backend/vendor-scoring-service/scoring/vendor-ranker.ts`
  - Sort vendors by hybrid score
  - Select top 3-5 vendors
  - Handle edge cases (fewer than 3 eligible vendors)
  - *Requirements: 1.1, 1.2*

- 5.3 Write property tests for hybrid scoring
  - **Property 3: Hybrid Scoring Combines Rules and ML**
  - Test that both components contribute to final score
  - *Validates: Requirements 1.3, 2.1, 2.2*

- 5.4 Write property tests for configurable weights
  - **Property 5: Configurable Weights Affect Scores**
  - Test that different weights produce different scores
  - *Validates: Requirements 2.4*

- 5.5 Write property tests for ranking
  - **Property 1: Scoring Produces Valid Ranked Vendor List**
  - Test that 3-5 vendors are returned in descending score order
  - *Validates: Requirements 1.1, 1.2*

- 5.6 Write property tests for edge cases
  - **Property 27: Empty Vendor List Handling**
  - Test that empty vendor list returns appropriate error response
  - **Property 28: Insufficient Vendors Handling**
  - Test that fewer than 3 eligible vendors returns available vendors with warning
  - **Property 29: New Vendor Default Scoring**
  - Test that vendors with no history receive default scores with low confidence
  - *Validates: Requirements 1.5, 1.2*

### 6. Checkpoint - Verify scoring service
- Ensure all scoring tests pass
- Verify rule engine, ML client, and hybrid scorer work together

---

### 7. Explainability Layer

- 7.1 Implement factor analyzer
  - Create `src/backend/explainability-layer/factor-analyzer.ts`
  - Identify top contributing factors from score breakdown
  - Identify risk factors (low scores, missing data)
  - Calculate factor importance rankings
  - *Requirements: 3.2, 3.3*

- 7.2 Implement narrative generator
  - Create `src/backend/explainability-layer/narrative-generator.ts`
  - Generate human-readable explanations from factor analysis
  - Include confidence levels for ML components
  - Generate exclusion reasons for filtered vendors
  - *Requirements: 3.1, 3.5, 3.6*

- 7.3 Implement comparison engine
  - Create `src/backend/explainability-layer/comparison-engine.ts`
  - Generate comparative explanations between ranked vendors
  - Highlight differentiating factors
  - *Requirements: 3.4*

- 7.4 Write property tests for explainability
  - **Property 7: Explainability Completeness**
  - Test that explanations contain all required elements
  - *Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6*

---

### 8. Event Integration

- 8.1 Implement event handler for JobCreated
  - Create `src/backend/event-integration/handlers/job-created-handler.ts`
  - Parse and validate JobCreated events
  - Implement idempotency check using jobId
  - Trigger scoring workflow
  - *Requirements: 4.1, 4.5*

- 8.2 Implement event publisher for recommendations
  - Create `src/backend/event-integration/publishers/recommendation-publisher.ts`
  - Publish VendorRecommendationGenerated events
  - Include correlation ID propagation
  - *Requirements: 4.2, 4.6*

- 8.3 Implement dead-letter handling
  - Create `src/backend/event-integration/handlers/dead-letter-handler.ts`
  - Process failed events from dead-letter queue
  - Implement retry logic with exponential backoff
  - *Requirements: 4.3, 4.4, 13.5*

- 8.4 Write property tests for idempotency
  - **Property 8: Event Processing Idempotency**
  - Test that duplicate events produce single recommendation
  - *Validates: Requirements 4.5*

- 8.5 Write property tests for correlation ID
  - **Property 9: Correlation ID Propagation**
  - Test that correlation IDs appear in all related logs and events
  - *Validates: Requirements 4.6, 10.2*

- 8.6 Write property tests for retry logic
  - **Property 26: Retry with Exponential Backoff**
  - Test that retries use exponential delays
  - *Validates: Requirements 13.5*

### 9. Checkpoint - Verify event integration
- Ensure event handlers process events correctly
- Verify idempotency and correlation ID propagation

---

### 10. API Layer

- 10.1 Implement recommendation API endpoint
  - Create `src/backend/api/routes/recommendations.ts`
  - POST /api/v1/recommendations endpoint
  - Input validation with Zod
  - Return ranked vendors with explanations
  - *Requirements: 7.4, 7.5, 7.6*

- 10.1a Generate OpenAPI/Swagger documentation
  - Create `src/backend/api/openapi.yaml` specification
  - Configure swagger-ui-express for API documentation
  - Document all endpoints, request/response schemas
  - Include authentication requirements
  - *Requirements: 7.4*

- 10.2 Implement override API endpoint
  - Create `src/backend/api/routes/overrides.ts`
  - POST /api/v1/overrides endpoint
  - Validate override reason is provided
  - Log override to audit trail
  - *Requirements: 5.4, 6.4*

- 10.3 Implement authentication middleware
  - Create `src/backend/api/middleware/auth.ts`
  - Validate Azure AD tokens
  - Extract user roles from token claims
  - *Requirements: 11.1*

- 10.4 Implement authorization middleware
  - Create `src/backend/api/middleware/rbac.ts`
  - Define role permissions (Operator, Admin, ML Engineer, Auditor)
  - Enforce role-based access control
  - *Requirements: 11.2, 6.6*

- 10.5 Implement rate limiting middleware
  - Create `src/backend/api/middleware/rate-limiter.ts`
  - Implement sliding window rate limiting
  - Return 429 with retry-after header
  - *Requirements: 11.5*

- 10.6 Write property tests for override validation
  - **Property 10: Override Requires Reason**
  - Test that empty reasons are rejected
  - *Validates: Requirements 5.4*

- 10.7 Write property tests for authentication
  - **Property 20: Authentication Enforcement**
  - Test that invalid tokens are rejected with 401
  - *Validates: Requirements 11.1*

- 10.8 Write property tests for RBAC
  - **Property 21: RBAC Enforcement**
  - Test that unauthorized actions return 403
  - *Validates: Requirements 11.2, 6.6*

- 10.9 Write property tests for rate limiting
  - **Property 23: Rate Limiting Enforcement**
  - Test that exceeding limits returns 429
  - *Validates: Requirements 11.5*

---

### 11. Logging and Observability

- 11.1 Implement structured logging
  - Create `src/backend/shared/logging/logger.ts`
  - Configure Application Insights integration
  - Implement PII masking for customer data
  - Include correlation IDs in all log entries
  - *Requirements: 10.1, 10.2, 11.4*

- 11.2 Implement metrics collection
  - Create `src/backend/shared/metrics/metrics-collector.ts`
  - Track request latency, error rates, model inference time
  - Track override rates and confidence distributions
  - *Requirements: 10.4*

- 11.3 Implement health check endpoints
  - Create `src/backend/api/routes/health.ts`
  - Liveness and readiness probes
  - Dependency health checks (DB, ML endpoint)
  - *Requirements: 10.3*

- 11.4 Write property tests for PII masking
  - **Property 22: PII Masking in Logs**
  - Test that PII fields are masked in log output
  - *Validates: Requirements 11.4*

- 11.5 Write property tests for comprehensive logging
  - **Property 19: Comprehensive Logging**
  - Test that all required fields are logged for each request
  - *Validates: Requirements 10.1, 10.4*

### 12. Checkpoint - Verify API and observability
- Ensure all API endpoints work correctly
- Verify authentication, authorization, and rate limiting
- Verify logging and metrics collection

---

### 13. Human-in-the-Loop Controls

- 13.1 Implement automation level configuration
  - Create `src/backend/vendor-scoring-service/controls/automation-config.ts`
  - Support levels: auto, advisory, manual
  - Configure per job type or customer tier
  - *Requirements: 6.1*

- 13.2 Implement confidence-based routing
  - Create `src/backend/vendor-scoring-service/controls/confidence-router.ts`
  - Route low-confidence recommendations to human review
  - Configurable confidence threshold (default 70%)
  - *Requirements: 6.2, 13.3*

- 13.3 Implement audit trail
  - Create `src/backend/shared/audit/audit-logger.ts`
  - Log all AI decisions with full context
  - Log all human interventions with reasons
  - Store in Azure SQL for compliance
  - *Requirements: 6.4, 6.5*

- 13.4 Write property tests for automation levels
  - **Property 11: Automation Level Behavior**
  - Test that advisory level requires human approval
  - *Validates: Requirements 6.1*

- 13.5 Write property tests for confidence routing
  - **Property 12: Low Confidence Triggers Review**
  - Test that low confidence flags for human review
  - *Validates: Requirements 6.2, 13.3*

- 13.6 Write property tests for audit completeness
  - **Property 13: Override Audit Completeness**
  - Test that all required fields are in audit log
  - *Validates: Requirements 6.4*

---

### 14. Admin UI Frontend

- 14.1 Set up React project with TypeScript
  - Create `src/frontend/admin-ui` with Vite
  - Configure TypeScript, ESLint, Prettier
  - Set up Azure Static Web Apps configuration
  - *Requirements: 5.1*

- 14.2 Implement job list view
  - Create `src/frontend/admin-ui/src/pages/JobList.tsx`
  - Display pending jobs with recommendation status
  - Implement filtering and sorting
  - *Requirements: 5.1, 5.6*

- 14.3 Implement job detail view
  - Create `src/frontend/admin-ui/src/pages/JobDetail.tsx`
  - Display job details, recommended vendors, scores
  - Display rationale and confidence indicators
  - *Requirements: 5.2, 5.5*

- 14.4 Implement override functionality
  - Create `src/frontend/admin-ui/src/components/OverrideModal.tsx`
  - Allow vendor selection with required reason
  - Submit override to API
  - *Requirements: 5.3, 5.4*

- 14.4a Implement accessibility compliance
  - Add ARIA labels to all interactive elements
  - Ensure keyboard navigation works throughout
  - Test with screen reader (VoiceOver/NVDA)
  - Verify color contrast meets WCAG 2.1 AA
  - Add skip navigation links
  - *Requirements: 5.7*

- 14.5 Write E2E tests for Admin UI
  - Test job list display and filtering
  - Test job detail view with recommendations
  - Test override workflow
  - *Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6*

### 15. Checkpoint - Verify Admin UI
- Ensure Admin UI displays jobs and recommendations
- Verify override functionality works end-to-end

---

### 16. ML Pipeline and Model Management

- 16.1 Create ML training pipeline
  - Create `src/ml/training/train_model.py`
  - Load training data from Azure SQL (job outcomes)
  - Train gradient boosting model for completion prediction
  - Save model artifacts to Azure ML registry
  - *Requirements: 8.1, 9.6*

- 16.2 Implement model versioning
  - Create `src/ml/models/model_registry.py`
  - Register models with version tags
  - Track model lineage and training data
  - *Requirements: 8.1, 8.3*

- 16.2a Implement blue-green model deployment
  - Create `src/ml/deployment/blue_green_deployer.py`
  - Support staging and production endpoints
  - Implement traffic shifting between versions
  - Add rollback capability
  - *Requirements: 8.2, 8.5*

- 16.3 Implement drift detection
  - Create `src/ml/monitoring/drift_detector.py`
  - Monitor feature distributions using KL divergence
  - Generate alerts when drift exceeds threshold
  - *Requirements: 9.1, 9.2*

- 16.4 Implement feedback incorporation
  - Create `src/ml/training/feedback_processor.py`
  - Process override data for retraining
  - Merge feedback with outcome data
  - *Requirements: 9.4, 9.5*

- 16.5 Write property tests for model versioning
  - **Property 15: Model Version Tracking**
  - Test that recommendations include model version
  - *Validates: Requirements 8.3, 8.6*

- 16.6 Write property tests for drift detection
  - **Property 17: Drift Detection Alerting**
  - Test that distribution changes trigger alerts
  - *Validates: Requirements 9.2*

- 16.7 Write property tests for feedback loop
  - **Property 18: Feedback Loop Incorporation**
  - Test that overrides are included in training data
  - *Validates: Requirements 9.4, 9.5*

- 16.8 Write property tests for accuracy monitoring
  - **Property 16: Prediction Accuracy Monitoring**
  - Test that predictions are compared to outcomes
  - *Validates: Requirements 9.1*

### 17. Checkpoint - Verify ML pipeline
- Ensure training pipeline runs successfully
- Verify model versioning and drift detection

---

### 18. Part 1 - Design Documentation

- 18.1 Create architecture design document
  - Create `docs/part1-design/architecture-design.md`
  - Include 1-2 page design write-up
  - Document Azure services and rationale
  - Explain AI integration with dispatch workflow
  - Document automated vs advisory decisions
  - *Requirements: 15.1, 15.2, 15.3, 15.4, 15.5*

- 18.2 Create architecture diagrams
  - Create `docs/part1-design/diagrams/` directory
  - High-level Azure architecture diagram
  - Event flow diagram
  - Data model diagram
  - ML pipeline diagram
  - *Requirements: 15.2*

- 18.3 Create tradeoffs and assumptions document
  - Create `docs/part1-design/tradeoffs-assumptions.md`
  - Document key design tradeoffs
  - List assumptions made
  - Discuss alternatives considered
  - *Requirements: 15.6*

---

### 19. Part 3 - Written Governance Responses

- 19.1 Write AI Authority & Risk response
  - Create `docs/part3-written/ai-authority-risk.md`
  - Discuss decisions that should never be fully autonomous
  - Explain risk considerations
  - *Requirements: 16.1*

- 19.2 Write Model Drift & Feedback response
  - Create `docs/part3-written/model-drift-feedback.md`
  - Explain drift detection approach
  - Describe safe override incorporation into retraining
  - *Requirements: 16.2*

- 19.3 Write Data Quality & Events response
  - Create `docs/part3-written/data-quality-events.md`
  - Identify critical event instrumentation
  - Explain data quality requirements for reliable AI
  - *Requirements: 16.3*

- 19.4 Write Failure Modes response
  - Create `docs/part3-written/failure-modes.md`
  - Describe behavior when AI is unavailable
  - Explain handling of slow or low-confidence results
  - *Requirements: 16.4*

---

### 20. Bonus Features

- 20.1 Create A/B testing plan document
  - Create `docs/part3-written/bonus/ab-testing-plan.md`
  - Describe traffic splitting methodology
  - Define success metrics
  - Explain statistical approach
  - *Requirements: 17.1, 17.2, 17.3*

- 20.2 Implement confidence scoring and abstention
  - Create `src/backend/vendor-scoring-service/scoring/confidence-scorer.ts`
  - Calculate confidence based on data quality and model certainty
  - Implement abstention logic for low confidence
  - *Requirements: 18.1, 18.2, 18.3*

- 20.3 Create fairness and bias mitigation document
  - Create `docs/part3-written/bonus/fairness-bias-mitigation.md`
  - Discuss potential bias sources
  - Describe monitoring for disparate impact
  - Explain vendor starvation prevention
  - *Requirements: 19.1, 19.2, 19.3*

- 20.4 Implement SLA-aware optimization
  - Create `src/backend/vendor-scoring-service/scoring/sla-optimizer.ts`
  - Factor SLA urgency into scoring
  - Prioritize fast-response vendors for tight SLAs
  - *Requirements: 20.1, 20.2*

- 20.5 Create SLA optimization document
  - Create `docs/part3-written/bonus/sla-optimization.md`
  - Explain SLA optimization strategy
  - Discuss tradeoffs
  - *Requirements: 20.3*

- 20.6 Create ML training notebook
  - Create `src/ml/notebooks/vendor_scoring_training.ipynb`
  - Document data exploration
  - Show model training process
  - Include evaluation metrics
  - *Requirements: Bonus - offline training*

---

### 21. Integration Tests and Edge Cases

- 21.1 Write integration tests for event flow
  - Test JobCreated → Scoring → VendorRecommendationGenerated flow
  - Test dead-letter handling and retry
  - Use TestContainers for Azure emulators
  - *Requirements: 14.2*

- 21.2 Write integration tests for API endpoints
  - Test recommendation API with database
  - Test override API with audit logging
  - Test authentication and authorization
  - *Requirements: 14.2*

- 21.3 Write E2E tests for complete workflow
  - Test full flow from job creation to vendor assignment
  - Test override workflow through Admin UI
  - Use Playwright for UI testing
  - *Requirements: 14.3*

- 21.4 Write edge case tests
  - Test empty vendor list (no vendors available)
  - Test all vendors filtered out (none meet criteria)
  - Test fewer than 3 eligible vendors
  - Test concurrent scoring requests for same job
  - Test malformed event payloads
  - Test partial ML response (some predictions missing)
  - Test database connection timeout
  - Test Cosmos DB throttling (429 responses)
  - Test Event Grid delivery failures
  - *Requirements: 14.6*

- 21.5 Write load and performance tests
  - Create `tests/load/scoring-load-test.js` using k6
  - Test 100 requests/second sustained load
  - Verify p99 latency < 2 seconds
  - Test ML endpoint under load
  - Test database connection pool exhaustion
  - *Requirements: 14.5*

- 21.6 Write security tests
  - Run OWASP ZAP scan on API endpoints
  - Run Snyk vulnerability scan on dependencies
  - Test SQL injection prevention
  - Test XSS prevention in Admin UI
  - Verify no PII in logs under load
  - *Requirements: 11.6*

---

### 22. Final Checkpoint - Complete System Verification
- Run all unit tests and verify 80%+ coverage
- Run all property-based tests (26 properties)
- Run integration tests
- Run E2E tests
- Run load tests and verify performance SLAs
- Run security scans (OWASP ZAP, Snyk)
- Run accessibility audit (axe-core, Lighthouse)
- Verify all documentation is complete

---

### 23. Project README and Final Documentation

- 23.1 Create main project README
  - Create `README.md` with system overview
  - Document AI approach and assumptions
  - Explain explainability generation
  - Describe feedback and retraining approach
  - List limitations and next steps
  - *Requirements: Part 2 deliverables*

- 23.2 Create docs README
  - Create `docs/README.md` with documentation index
  - Link to all Part 1 and Part 3 documents
  - Provide navigation guide
  - *Requirements: 15.1*

---


