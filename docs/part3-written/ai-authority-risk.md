# AI Authority & Risk: Decisions That Should Never Be Fully Autonomous

## Overview

In the RetailFixIt vendor dispatch system, AI serves as a powerful decision-support tool, but certain decisions must always retain human oversight. The principle guiding this approach is that AI should augment human judgment, not replace it entirely, especially when decisions carry significant business, safety, or customer relationship implications.

## Decisions Requiring Human Oversight

**High-Value Customer Assignments**: When dispatching vendors to enterprise-tier customers or jobs with SLA penalties exceeding defined thresholds, the system operates in advisory mode. These relationships represent significant revenue and reputational value; a poor vendor match could damage long-term partnerships. The AI provides recommendations with full rationale, but a human operator makes the final call.

**Safety-Critical Jobs**: Any job involving potential safety hazards like electrical work, gas line repairs, or structural modifications, requires human approval regardless of AI confidence scores. The consequences of a mismatched vendor in these scenarios extend beyond customer dissatisfaction to potential injury or property damage. The system flags these job types automatically and routes them to qualified supervisors.

**New Vendor Onboarding Period**: Vendors with fewer than 10 completed jobs lack sufficient historical data for reliable ML predictions. During this onboarding period, the system applies conservative rule-based scoring with explicit low-confidence indicators, and all assignments require human review. This protects both customers from unproven vendors and new vendors from being set up for failure on mismatched jobs.

## Risk Considerations

The risk framework balances three factors: customer impact, vendor fairness, and operational efficiency. Fully autonomous dispatch optimizes for efficiency but can amplify biases in training data, create vendor starvation (where some vendors never receive jobs), or miss contextual factors the model hasn't learned. By maintaining human checkpoints at high-risk decision points, I've created a feedback mechanism that catches model blind spots before they cause harm.

Additionally, regulatory and liability considerations require demonstrable human oversight for certain decision categories. The audit trail captures not just what the AI recommended, but who approved it and why, providing the accountability chain necessary for compliance and dispute resolution.

The system's configurable automation levels (auto, advisory, manual) allow operations teams to adjust the human-AI balance based on evolving business needs, seasonal patterns, or emerging risk factors without requiring code changes.
