# Tradeoffs and Assumptions

This document captures the key design decisions, tradeoffs considered, and assumptions made in the RetailFixIt Vendor Dispatch System architecture.

## Key Design Tradeoffs

### 1. Hybrid Scoring vs Pure ML

**Decision:** Combine rule-based scoring (40%) with ML predictions (50%) plus context bonus (10%).

**Tradeoff:**
- **Pure ML** would maximize predictive accuracy but creates a "black box" that's hard to debug and explain
- **Pure Rules** are transparent but can't capture complex patterns in historical data
- **Hybrid** balances explainability with adaptive intelligence

**Why Hybrid:**
- Business rules provide predictable baseline behavior operators can understand
- ML captures patterns humans might miss (e.g., vendor performance varies by job type)
- Graceful degradation when ML is unavailable
- Easier to tune: adjust weights without retraining models

### 2. Event-Driven vs Request-Response

**Decision:** Use Event Grid + Service Bus for job processing rather than synchronous API calls.

**Tradeoff:**
- **Synchronous** is simpler to implement and debug, provides immediate feedback
- **Event-driven** adds complexity but enables loose coupling and better resilience

**Why Event-Driven:**
- Decouples job creation from scoring—upstream systems don't wait for AI
- Dead-letter queues capture failures for investigation and replay
- Natural fit for async ML inference which can take 500ms+
- Scales independently: scoring service auto-scales without affecting job portal

**Mitigation:** Admin UI polls for recommendations, providing near-real-time experience for operators.

### 3. Cosmos DB vs Azure SQL for Primary Storage

**Decision:** Use Cosmos DB for vendor profiles and recommendations, Azure SQL for audit logs and ML training data.

**Tradeoff:**
- **Cosmos DB only** simplifies architecture but lacks relational query support for analytics
- **SQL only** provides rich queries but higher latency for real-time lookups
- **Polyglot** adds operational complexity but optimizes for each use case

**Why Polyglot:**
- Cosmos DB delivers <10ms reads for vendor lookups during scoring
- Azure SQL supports complex joins for ML training data preparation
- Audit queries need relational capabilities (e.g., "all overrides by operator X in date range")
- Cosmos DB partition key (serviceRegion) aligns with scoring query patterns

### 4. Serverless vs Container-Based Compute

**Decision:** Use Azure Functions for scoring and explainability services.

**Tradeoff:**
- **Containers (AKS)** provide more control, consistent performance, no cold starts
- **Serverless** reduces operational overhead, auto-scales to zero, pay-per-execution

**Why Serverless:**
- Variable workload: job volume fluctuates by time of day and season
- Cost efficiency: don't pay for idle compute during low-traffic periods
- Faster time-to-market: no cluster management overhead

**Mitigation:** Use Premium plan for production to minimize cold starts. Pre-warm functions during expected peak hours.

### 5. Confidence Threshold for Human Review

**Decision:** Route recommendations below 70% confidence to human review.

**Tradeoff:**
- **Lower threshold (50%)** reduces operator workload but risks poor recommendations
- **Higher threshold (90%)** increases safety but creates bottleneck for operators
- **70%** balances automation efficiency with appropriate human oversight

**Why 70%:**
- Based on industry benchmarks for advisory AI systems
- Configurable per job type—can increase for high-value customers
- Operators can still override high-confidence recommendations if needed

### 6. ML Model Complexity vs Interpretability

**Decision:** Use gradient boosting (XGBoost/LightGBM) rather than deep learning.

**Tradeoff:**
- **Deep learning** might achieve higher accuracy but is harder to explain
- **Linear models** are fully interpretable but can't capture non-linear patterns
- **Gradient boosting** balances accuracy with feature importance explanations

**Why Gradient Boosting:**
- Feature importance scores enable explainability layer
- Proven performance on tabular data (vendor metrics, job attributes)
- Faster inference than deep learning (important for <2s SLA)
- Easier to debug when predictions seem wrong

---

## Assumptions

### Business Assumptions

1. **Job volume:** System designed for 100 requests/second peak, with average of 20 req/s. If volume exceeds 10x, architecture review needed.

2. **Vendor pool size:** Assumes 100-1000 active vendors per service region. Scoring algorithm complexity is O(n) where n = eligible vendors.

3. **Override rate:** Assumes 10-20% of recommendations will be overridden. Higher rates may indicate model issues or need for retraining.

4. **SLA distribution:** Assumes most jobs have 24-48 hour SLAs. Real-time dispatch (<1 hour) would require architecture changes.

5. **Geographic scope:** Initial deployment assumes single-region (US). Multi-region expansion would require Cosmos DB global distribution configuration.

### Technical Assumptions

1. **Azure AD integration:** Assumes organization uses Azure AD for identity. Alternative IdPs would require auth middleware changes.

2. **Network connectivity:** Assumes reliable network between Azure services. Private endpoints configured but public fallback available.

3. **Data quality:** Assumes vendor profiles are reasonably complete. Missing data handled with defaults but may reduce confidence scores.

4. **ML endpoint availability:** Assumes 99.9% availability from Azure ML. Circuit breaker handles outages with rule-based fallback.

5. **Event ordering:** Assumes events for the same job arrive in order. Service Bus sessions enforce ordering within a job.

### Operational Assumptions

1. **Monitoring coverage:** Assumes operations team monitors Application Insights dashboards. Alerts configured for critical failures.

2. **Model retraining cadence:** Assumes weekly retraining is sufficient. Drift detection triggers ad-hoc retraining if needed.

3. **Audit retention:** Assumes 90-day retention meets compliance requirements. Longer retention requires storage tier changes.

4. **Operator availability:** Assumes operators available during business hours for advisory mode. After-hours jobs may need higher automation threshold.

---

## Alternatives Considered

### Alternative 1: Apache Kafka Instead of Service Bus

**Considered:** Kafka for event streaming with higher throughput and replay capabilities.

**Rejected Because:**
- Service Bus is fully managed, reducing operational overhead
- Native Azure integration simplifies authentication and monitoring
- Current volume (100 req/s) doesn't require Kafka's scale
- Service Bus dead-letter and sessions meet reliability requirements

**Revisit If:** Volume exceeds 10,000 req/s or need cross-cloud event streaming.

### Alternative 2: Real-Time Feature Store (Feast/Tecton)

**Considered:** Dedicated feature store for ML feature management.

**Rejected Because:**
- Redis caching meets current latency requirements
- Feature set is relatively simple (vendor metrics, job attributes)
- Adds operational complexity for limited benefit at current scale

**Revisit If:** Feature engineering becomes complex or need feature versioning.

### Alternative 3: GraphQL API Instead of REST

**Considered:** GraphQL for flexible querying from Admin UI.

**Rejected Because:**
- REST is simpler and well-understood by team
- Query patterns are predictable (get recommendations, submit override)
- OpenAPI tooling more mature for documentation and code generation

**Revisit If:** Admin UI needs complex nested queries or multiple clients with different data needs.

### Alternative 4: Kubernetes (AKS) for All Services

**Considered:** Container orchestration for consistent deployment model.

**Rejected Because:**
- Serverless reduces operational overhead significantly
- Variable workload benefits from scale-to-zero
- Team has more experience with Functions than Kubernetes

**Revisit If:** Need long-running processes, GPU compute, or consistent sub-100ms latency.

### Alternative 5: Single Database (Cosmos DB Only)

**Considered:** Simplify by using Cosmos DB for all storage including audit logs.

**Rejected Because:**
- Audit queries need relational joins (e.g., override trends by operator)
- ML training data preparation benefits from SQL transformations
- Cosmos DB change feed could sync to SQL, but adds complexity

**Revisit If:** Audit query patterns become simpler or Cosmos DB adds better analytics support.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| ML model degrades over time | Drift detection with automatic alerts, weekly retraining |
| Cold start latency | Premium Functions plan, pre-warming during peak hours |
| Vendor data staleness | 5-minute cache TTL, cache invalidation on vendor updates |
| Operator override fatigue | Tune confidence threshold, improve model with feedback |
| Single region failure | Cosmos DB multi-region ready, can enable if needed |
| Cost overrun | Budget alerts, auto-scaling limits, reserved capacity for predictable workloads |

---

## Future Considerations

1. **Multi-region deployment:** Enable Cosmos DB global distribution when expanding beyond US.

2. **Real-time streaming:** Consider Event Hubs if need sub-second event processing.

3. **Advanced ML:** Evaluate deep learning if gradient boosting accuracy plateaus.

4. **A/B testing infrastructure:** Build dedicated experimentation platform for model comparison.

5. **Vendor self-service:** Portal for vendors to update profiles, reducing data staleness.
