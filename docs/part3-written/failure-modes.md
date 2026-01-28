# Failure Modes: System Behavior Under Degraded Conditions

## When AI Is Unavailable

The ML endpoint can become unavailable due to infrastructure issues, deployment problems, or resource exhaustion. This system treats ML as an enhancement, not a dependency, ensuring dispatch operations continue even during complete ML outages.

**Immediate Fallback**: When the ML endpoint fails or the circuit breaker opens after consecutive failures, the scoring service automatically switches to rule-based scoring only. This fallback produces valid vendor recommendations using deterministic factors: availability, geographic proximity, certification match, capacity, and historical completion rates. The response includes a `degradedMode: true` flag so operators and downstream systems know ML predictions weren't available.

**Graceful Degradation Indicators**: The Admin UI displays a clear indicator when operating in fallback mode. Confidence scores are automatically reduced to reflect the absence of ML predictions, and the system may shift more recommendations to advisory mode (requiring human approval) during extended outages. This prevents fully autonomous dispatch based solely on rule-based scoring when the business has calibrated automation thresholds assuming hybrid scoring.

**Recovery Behavior**: The circuit breaker periodically allows test requests through (half-open state) to detect when the ML endpoint recovers. Once successful responses resume, the system gradually returns to normal operation. All fallback activations and recoveries are logged with timestamps for post-incident analysis.

## Handling Slow Responses

Latency spikes can be as disruptive as outages. A scoring request that takes 30 seconds blocks dispatch operations and frustrates operators.

**Timeout Enforcement**: ML inference has a strict 5-second timeout. If the endpoint doesn't respond within this window, the request is cancelled and rule-based fallback is used for that specific request. This ensures consistent response times regardless of ML endpoint performance. The timeout is configurable but defaults to a value that keeps overall scoring within the 2-second SLA for most requests.

**Cached Predictions**: For repeat scoring of the same job (e.g., operator refreshes the page), the system caches ML predictions briefly. This reduces load on the ML endpoint and provides instant responses for subsequent views of the same recommendation.

## Low-Confidence Results

Low confidence indicates the model is uncertain, perhaps due to sparse training data for this job type, unusual vendor combinations, or conflicting signals in the input data.

**Automatic Escalation**: When overall confidence falls below the configured threshold (default 70%), the system automatically sets the automation level to advisory, requiring human approval before dispatch. The recommendation is still generated and displayed, but it cannot proceed to automatic assignment.

**Transparency in Explanations**: The explainability layer specifically calls out factors contributing to low confidence. "Confidence is reduced because this vendor has only 3 completed jobs of this type" gives operators actionable context. They can proceed with the recommendation if they have additional information the model lacks, or select an alternative vendor.

**Abstention Option**: For extremely low confidence (below 40%), the system can be configured to abstain entirely, presenting the job for fully manual vendor selection rather than offering a potentially misleading recommendation. This prevents operators from anchoring on a recommendation the model has little basis for making.
