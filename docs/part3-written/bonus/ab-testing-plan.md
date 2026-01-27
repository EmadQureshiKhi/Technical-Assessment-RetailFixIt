# A/B Testing Plan: AI Dispatch vs Manual Dispatch

## Traffic Splitting Methodology

Comparing AI-recommended dispatch against manual dispatch requires careful experimental design to isolate the effect of AI recommendations while maintaining operational fairness and statistical validity.

**Randomization Strategy**: Jobs are randomly assigned to treatment groups at creation time using a deterministic hash of the jobId. This ensures consistent group assignment if a job is reprocessed and prevents selection bias. The hash-based approach also enables reproducible experiments—given the same jobId, the same group assignment results. Traffic split defaults to 80/20 (AI/manual) during initial rollout, shifting toward 90/10 as confidence in AI performance grows.

**Stratified Sampling**: Pure random assignment can create imbalanced groups for rare job types or customer tiers. The system implements stratified randomization, ensuring each stratum (job type × urgency level × customer tier) maintains the target split ratio. This prevents scenarios where all critical enterprise jobs happen to land in one group, skewing results.

**Holdout Groups**: Beyond the primary A/B split, a small holdout group (5%) receives no AI involvement—vendors are selected purely by operator judgment without seeing AI recommendations. This establishes a true baseline and detects whether simply showing recommendations (even if overridden) influences operator behavior.

## Success Metrics

Measuring AI dispatch effectiveness requires metrics that capture both operational efficiency and business outcomes.

**Primary Metrics**:
- **Job Completion Rate**: Percentage of jobs completed successfully without cancellation or reassignment. Higher completion rates indicate better vendor-job matching.
- **Time to Completion**: Hours from job assignment to completion. AI should reduce this by selecting vendors with appropriate capacity and proximity.
- **Customer Satisfaction**: Post-job satisfaction scores (1-5 scale). The ultimate measure of whether the right vendor was selected.
- **Rework Rate**: Percentage of jobs requiring follow-up visits. Lower rework indicates better initial vendor selection.

**Secondary Metrics**:
- **Time to Assignment**: How quickly jobs move from created to assigned. AI recommendations should accelerate this.
- **Override Rate**: In the AI group, how often operators select a different vendor. High override rates may indicate model issues or operator distrust.
- **Vendor Utilization Balance**: Standard deviation of job counts across vendors. AI should distribute work more evenly than manual selection.
- **SLA Compliance**: Percentage of jobs completed within SLA deadlines. Critical for enterprise customers.

**Guardrail Metrics**: Metrics that must not degrade significantly, even if primary metrics improve:
- Customer complaint rate
- Vendor churn rate
- Cost per job (if AI systematically selects more expensive vendors)

## Statistical Approach

Rigorous statistical analysis ensures conclusions are valid and actionable.

**Sample Size Calculation**: Before launching, calculate required sample size based on minimum detectable effect (MDE), baseline metric values, and desired statistical power (typically 80%). For a 5% improvement in completion rate from a 92% baseline with 80% power and 5% significance, approximately 2,500 jobs per group are needed. The experiment runs until this threshold is reached.

**Sequential Testing**: Rather than waiting for full sample collection, implement sequential testing with spending functions (O'Brien-Fleming boundaries). This allows early stopping if AI clearly outperforms or underperforms, while controlling false positive rates. Early stopping saves time and reduces exposure if AI performs poorly.

**Heterogeneous Treatment Effects**: Aggregate results can mask important variation. Analyze treatment effects across segments: job types, customer tiers, geographic regions, time of day. AI might excel for routine repairs but underperform for complex installations. Segment analysis informs where to deploy AI and where to maintain manual processes.

**Causal Inference Considerations**: Even with randomization, confounders can emerge. Monitor for differential attrition (jobs dropping out of one group more than another) and spillover effects (operators in the manual group learning from AI recommendations they see elsewhere). Use intention-to-treat analysis as the primary approach, with per-protocol analysis as sensitivity check.

**Reporting and Decision Framework**: Results are reported with confidence intervals, not just point estimates. A decision framework specifies thresholds: "Deploy AI broadly if completion rate improves by >2% with 95% CI excluding zero, and no guardrail metric degrades by >1%." This prevents post-hoc rationalization and ensures decisions are made on pre-specified criteria.
