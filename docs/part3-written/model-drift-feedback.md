# Model Drift & Feedback: Detection and Safe Retraining

## Drift Detection Approach

Model drift occurs when the statistical properties of input data or the relationship between inputs and outcomes changes over time. In the vendor dispatch context, drift can manifest as seasonal demand shifts, vendor workforce changes, new service regions, or evolving customer expectations. The detection strategy operates on multiple fronts.

**Feature Distribution Monitoring**: The system continuously tracks the distribution of key input features (job types, geographic spread, urgency levels, vendor capacity utilization) using KL divergence against baseline distributions established during model training. When divergence exceeds configured thresholds, the system generates alerts and can automatically increase human oversight until the drift is investigated.

**Prediction Accuracy Tracking**: Every job outcome is compared against the model's predictions—completion probability vs. actual completion, predicted time vs. actual time, rework risk vs. actual rework occurrence. I maintain rolling accuracy metrics per model version, and significant degradation triggers retraining evaluation. This outcome-based monitoring catches concept drift that feature monitoring might miss.

**Override Rate Analysis**: A sudden increase in human overrides signals that operators are losing trust in recommendations. The system tracks override rates by job type, customer tier, and time period. Elevated override rates, even without explicit accuracy degradation, indicate the model may be missing factors that human operators recognize.

## Safe Override Incorporation into Retraining

Human overrides represent valuable signal about model limitations, but incorporating them naively can introduce bias or amplify operator preferences that don't correlate with better outcomes. This approach treats overrides as a distinct feedback channel with appropriate safeguards.

**Outcome-Weighted Feedback**: Overrides are only incorporated into training data after the job completes and outcomes are recorded. An override where the operator-selected vendor performed better than the AI recommendation carries positive weight; an override where the original recommendation would have been better carries negative or neutral weight. This prevents the model from simply learning to mimic operator preferences regardless of actual performance.

**Override Categorization**: Operators must categorize overrides (availability, relationship, preference, other). Category-specific analysis helps distinguish between model gaps (the AI missed that the vendor was unavailable) and subjective preferences (the operator has a personal relationship with a vendor). Model gaps inform feature engineering; subjective preferences are tracked but weighted carefully.

**Staged Rollout**: Retrained models deploy first to a shadow environment where they score jobs in parallel with production but don't affect dispatch. Only after validation against held-out data and shadow performance review does a new model version proceed to staged production rollout via blue-green deployment, with automatic rollback triggers if accuracy degrades.
