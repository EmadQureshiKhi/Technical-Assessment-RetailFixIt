# SLA Optimization Strategy

## Overview

Service Level Agreements define the time constraints within which jobs must be completed. The SLA optimization strategy dynamically adjusts vendor scoring to prioritize vendors most likely to meet these constraints, with the weight of SLA factors increasing as urgency rises.

## SLA Optimization Strategy

The system implements a multi-factor approach to SLA optimization that balances speed, reliability, and quality based on urgency level.

**Dynamic Weight Adjustment**: For critical jobs, response time factors receive up to 40% weight in the final score, while low-urgency jobs weight response time at only 15%. This ensures that when time is tight, the system aggressively prioritizes fast responders, but when there's flexibility, it can optimize for quality and cost.

**Urgency Escalation**: The system monitors time remaining until SLA deadline and automatically escalates urgency when deadlines approach. A job declared as "medium" urgency with only 3 hours remaining is treated as "high" urgency for scoring purposes. This prevents situations where a job sits in queue until it becomes an emergency.

**Response Time Scoring**: Vendors are scored based on their historical average response time relative to the SLA requirement. A vendor averaging 2-hour response times scores highly for a 4-hour SLA but poorly for a 1-hour SLA. Proximity bonuses further adjust this score—closer vendors can respond faster regardless of historical averages.

**Reliability Integration**: Fast response means nothing if the job isn't completed successfully. The system factors historical completion rates and rework rates into SLA compliance probability. A vendor who responds quickly but frequently requires follow-up visits may score lower than a slightly slower but more reliable alternative.

**Capacity Awareness**: Vendors near their capacity limit receive scoring penalties for urgent jobs. Even if a vendor has excellent historical response times, being at 90% capacity suggests they may not be able to respond as quickly to a new job.

## Tradeoffs

SLA optimization involves inherent tensions between competing objectives.

**Speed vs Quality**: Prioritizing fast responders may mean selecting vendors with lower quality scores. For critical SLAs, this tradeoff is acceptable, getting someone on-site quickly matters more than marginal quality differences. For low-urgency jobs, the system reverses this priority, favoring quality over speed.

**Cost Implications**: Vendors with faster response times often command premium pricing. The current system doesn't directly factor cost, meaning SLA optimization may systematically select more expensive vendors for urgent jobs. Future iterations could incorporate cost as a factor, accepting slightly longer response times when the cost differential is significant and the SLA allows it.

**Vendor Fairness**: Aggressive SLA optimization can create a "rich get richer" dynamic where fast-responding vendors receive more urgent (often higher-value) jobs, while slower vendors are relegated to low-urgency work. The fairness mechanisms described elsewhere help mitigate this, but tension remains between SLA optimization and equitable opportunity distribution.

**Prediction Uncertainty**: Estimated response times are based on historical averages, but actual response times vary. A vendor averaging 2 hours might take 4 hours on a particular day due to traffic, weather, or other factors. The system addresses this by requiring a margin of safety, vendors must have estimated times well under the SLA limit, not just barely meeting it.

**New Vendor Disadvantage**: Vendors without historical data receive neutral response time scores, which may disadvantage them for urgent jobs even if they could respond quickly. The onboarding period and exploration mechanisms help, but new vendors will generally not be selected for critical SLAs until they've built a track record.

**Escalation Cascades**: Automatic urgency escalation can create cascading effects where multiple jobs simultaneously become "critical," overwhelming the pool of fast-responding vendors. The system monitors for this pattern and may throttle escalation or alert operators when the critical job queue grows unexpectedly.

The SLA optimization strategy represents a pragmatic balance: aggressive prioritization of speed when SLAs demand it, graceful degradation to quality-focused selection when time permits, and continuous monitoring to detect when the strategy produces unintended consequences.
