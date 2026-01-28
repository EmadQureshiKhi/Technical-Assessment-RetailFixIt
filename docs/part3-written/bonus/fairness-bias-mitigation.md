# Fairness and Bias Mitigation in Vendor Dispatch

## Potential Bias Sources

AI-driven vendor dispatch systems can inadvertently perpetuate or amplify biases present in historical data, leading to unfair treatment of certain vendors. Understanding these bias sources is the first step toward mitigation.

**Historical Performance Bias**: If certain vendors historically received fewer job opportunities (perhaps due to manual dispatcher preferences), they have less data to demonstrate competence. The model may then score them lower due to "insufficient data," creating a self-reinforcing cycle where underrepresented vendors never get the chance to build a track record.

**Geographic Bias**: Vendors in certain regions may appear to have lower completion rates not because of capability, but because those regions have more complex jobs, longer travel times, or different customer demographics. Without controlling for these confounders, the model penalizes vendors for factors outside their control.

**Temporal Bias**: Vendors who joined the platform recently lack historical data, putting them at a systematic disadvantage against established vendors. Similarly, vendors who had a rough patch (perhaps due to temporary staffing issues) may be penalized long after they've resolved those issues.

**Feedback Loop Amplification**: When the model recommends the same high-scoring vendors repeatedly, those vendors accumulate more positive outcomes (simply by volume), further increasing their scores. Meanwhile, lower-ranked vendors receive fewer opportunities to demonstrate improvement, cementing their lower rankings.

**Proxy Discrimination**: Even without explicit demographic features, the model may learn proxies. For example, if vendor company size correlates with certain demographics, and larger companies historically received preferential treatment, the model may perpetuate this pattern through features like "years in business" or "fleet size."

## Monitoring for Disparate Impact

Detecting bias requires ongoing monitoring across multiple dimensions, not just aggregate performance metrics.

**Opportunity Distribution Analysis**: Track job assignment rates across vendor segments, by company size, geographic region, time on platform, and any available demographic dimensions. Statistical tests (chi-square, proportion tests) identify whether certain groups receive significantly fewer opportunities than expected given their availability and qualifications.

**Outcome Parity Monitoring**: Compare completion rates, customer satisfaction, and rework rates across vendor segments. If the model is fair, vendors with similar qualifications should achieve similar outcomes regardless of segment membership. Significant disparities warrant investigation, they may indicate the model is routing easier jobs to favored vendors.

**Score Distribution Analysis**: Examine the distribution of AI scores across vendor segments. A fair model should produce similar score distributions for similarly qualified vendors. Bimodal distributions or systematic score gaps between segments suggest the model has learned biased patterns.

**Override Pattern Analysis**: Track whether human operators override AI recommendations more frequently for certain vendor segments. Consistent overrides in favor of a particular segment may indicate the model undervalues those vendors, while overrides against a segment may reveal operator bias that the model should not learn from.

**Temporal Trend Monitoring**: Monitor how vendor scores and opportunity rates change over time. New vendors should see improving scores as they build track records. If certain segments show persistently flat or declining trajectories, the system may be trapping them in low-opportunity cycles.

## Vendor Starvation Prevention

Ensuring all qualified vendors receive fair opportunity requires active intervention beyond passive monitoring.

**Minimum Opportunity Guarantees**: Implement a floor on job assignments for qualified vendors. Even if a vendor's score is lower than competitors, they receive a minimum percentage of jobs in their service area. This ensures data collection for accurate scoring and prevents complete exclusion of capable vendors.

**Exploration-Exploitation Balance**: Borrow from multi-armed bandit algorithms to balance exploiting known high-performers with exploring potentially underrated vendors. A small percentage of jobs (5-10%) are assigned with exploration weighting, giving lower-ranked vendors opportunities to demonstrate capability.

**Score Decay for Inactivity**: If a vendor hasn't received jobs recently, their historical performance data becomes stale. Rather than penalizing them for lack of recent data, implement score decay that gradually moves inactive vendors toward a neutral baseline, giving them fresh opportunities when they become available again.

**New Vendor Onboarding Period**: New vendors enter a protected onboarding period where they receive guaranteed job opportunities regardless of (necessarily limited) historical scores. During this period, the system collects baseline performance data before the vendor enters normal competitive scoring.

**Segment-Aware Ranking**: When generating recommendations, ensure the top candidates include representation from different vendor segments when qualified candidates exist. This prevents homogeneous recommendations that systematically exclude certain groups.

**Feedback-Weighted Retraining**: When incorporating override data into model retraining, weight feedback to prevent amplification of existing biases. Overrides that increase diversity (selecting a vendor from an underrepresented segment) receive higher weight than overrides that reinforce existing patterns.

**Regular Fairness Audits**: Conduct quarterly fairness audits examining all metrics above. Audits should involve stakeholders beyond the ML team—operations, vendor relations, and potentially external reviewers. to ensure diverse perspectives on what constitutes fair treatment.
