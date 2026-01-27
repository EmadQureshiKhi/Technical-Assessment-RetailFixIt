# Data Quality & Events: Critical Instrumentation for Reliable AI

## Critical Event Instrumentation

The vendor dispatch AI is only as reliable as the data flowing through it. I've identified several event categories that are essential for both real-time scoring and continuous model improvement.

**Job Lifecycle Events**: `JobCreated`, `JobAssigned`, `JobStarted`, `JobCompleted`, `JobCancelled`. Each event must include timestamps, correlation IDs, and relevant context. The `JobCompleted` event is particularly critical—it must capture actual completion time, customer satisfaction rating, and whether rework was required. Without accurate outcome data, prediction accuracy cannot be measured and improved models cannot be trained.

**Vendor State Events**: `VendorAvailabilityUpdated`, `VendorCapacityChanged`, `VendorCertificationExpired`. Real-time vendor state directly impacts scoring accuracy. Stale availability data leads to recommendations for vendors who can't actually take the job, eroding operator trust. The system implements aggressive cache invalidation and requires vendors to confirm availability for high-priority jobs.

**AI Decision Events**: `RecommendationGenerated`, `RecommendationAccepted`, `RecommendationOverridden`. These events form the audit trail and feedback loop. Each recommendation event includes the full score breakdown, model version, confidence level, and processing time. Override events capture the operator's reasoning, enabling analysis of why the AI's recommendation was rejected.

**System Health Events**: `MLEndpointLatency`, `FallbackActivated`, `CircuitBreakerStateChange`. Operational events help distinguish between AI quality issues and infrastructure issues. If recommendations are being overridden frequently during periods of ML fallback, that's a different problem than overrides during normal operation.

## Data Quality Requirements

**Completeness**: Missing fields degrade model performance. The system enforces schema validation at ingestion, rejecting events with missing required fields rather than allowing partial data to pollute the training pipeline. For optional fields, I track missingness rates and alert when they exceed thresholds that could impact model accuracy.

**Timeliness**: Stale data is often worse than missing data because it appears valid. Vendor availability that's 30 minutes old might recommend a vendor who's already been assigned elsewhere. The system implements TTLs on cached data and timestamps all events, allowing the scoring service to weight recent data more heavily or flag recommendations based on potentially stale inputs.

**Accuracy**: Garbage in, garbage out. Customer satisfaction ratings must come from actual customer feedback, not operator estimates. Completion times must reflect actual work duration, not administrative timestamps. The system validates data against business rules (a job can't complete before it starts) and flags anomalies for review rather than silently accepting them.

**Consistency**: The same vendor should have the same ID across all systems. Geographic coordinates should use the same precision and reference system. I maintain canonical schemas and transformation pipelines that normalize data from various source systems before it enters the AI pipeline, preventing subtle inconsistencies from creating model confusion.
