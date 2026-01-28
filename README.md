# RetailFixIt AI-Orchestrated Vendor Dispatch System

An intelligent vendor dispatch system that combines deterministic business rules with machine learning predictions to recommend optimal vendors for retail service jobs. Built on Azure with a focus on explainability, human oversight, and continuous improvement.

## System Overview

The RetailFixIt Vendor Dispatch System automates vendor selection for service jobs using a hybrid scoring approach:

- **Rule-Based Scoring (40%)**: Deterministic filters for availability, geographic proximity, certifications, and capacity
- **ML-Based Scoring (50%)**: Gradient boosting models predict completion probability, time-to-complete, and rework risk
- **Context Bonus (10%)**: Job-specific factors like SLA urgency and customer tier

The system operates in three automation modes:
- **Automated**: High-confidence recommendations dispatch without human intervention
- **Advisory**: Recommendations require operator approval before dispatch
- **Manual**: Operators select vendors without AI recommendations

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Job Portal    │────▶│  Event Grid     │────▶│  Service Bus    │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Admin UI     │◀────│  Scoring Svc    │────▶│   Azure ML      │
│ (Static Web App)│     │ (Azure Func)    │     │   Endpoint      │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
            ┌───────────┐ ┌───────────┐ ┌───────────┐
            │ Cosmos DB │ │ Azure SQL │ │   Redis   │
            │ (Profiles)│ │  (Audit)  │ │  (Cache)  │
            └───────────┘ └───────────┘ └───────────┘
```

## AI Approach and Assumptions

### Hybrid Scoring Philosophy

The system combines rules and ML because:
- **Rules provide predictability**: Operators understand why a vendor was filtered out
- **ML captures patterns**: Historical data reveals vendor-job type affinities humans might miss
- **Graceful degradation**: When ML is unavailable, rule-based scoring continues

### Key Assumptions

1. **Vendor pool**: 100-1000 active vendors per service region
2. **Job volume**: Designed for 100 req/s peak, 20 req/s average
3. **Override rate**: Expected 10-20% of recommendations overridden
4. **SLA distribution**: Most jobs have 24-48 hour SLAs

### ML Model Details

- **Algorithm**: Gradient boosting (XGBoost/LightGBM) for interpretability
- **Predictions**: Completion probability, time-to-complete, rework risk
- **Training data**: Job outcomes, vendor metrics, override feedback
- **Retraining**: Weekly scheduled, with drift-triggered ad-hoc retraining

## Explainability Generation

Every recommendation includes human-readable explanations:

1. **Factor Analysis**: Identifies top contributing factors and risk indicators
2. **Narrative Generation**: Converts scores into plain language ("Vendor A ranked highest due to 95% completion rate and proximity")
3. **Comparison Engine**: Explains why higher-ranked vendors scored better
4. **Confidence Indicators**: ML components show prediction confidence levels

Example explanation:
> "TechPro Services is recommended with 87% confidence. Top factors: excellent completion rate (96%), available immediately, 12 miles from job site. Risk: slightly above average rework rate (8%) for this job type."

## Feedback and Retraining

### Override Incorporation

Human overrides feed back into model training with safeguards:

1. **Outcome-weighted**: Overrides only incorporated after job completion
2. **Categorized**: Operators classify override reasons (availability, relationship, preference)
3. **Validated**: Override where AI was actually better carries neutral/negative weight

### Drift Detection

The system monitors for model degradation:

- **Feature drift**: KL divergence tracks input distribution changes
- **Prediction accuracy**: Rolling comparison of predictions vs outcomes
- **Override rate**: Elevated overrides signal potential model issues

### Retraining Pipeline

1. Weekly scheduled retraining with latest outcome data
2. Drift alerts can trigger ad-hoc retraining
3. Blue-green deployment with shadow scoring validation
4. Automatic rollback if accuracy degrades

## Project Structure

```
├── src/
│   ├── backend/
│   │   ├── api/              # REST API endpoints
│   │   ├── event-integration/ # Event handlers and publishers
│   │   ├── explainability-layer/ # Explanation generation
│   │   ├── shared/           # Common models, logging, caching
│   │   └── vendor-scoring-service/ # Core scoring logic
│   ├── frontend/
│   │   └── admin-ui/         # React operator interface
│   └── ml/
│       ├── training/         # Model training scripts
│       ├── models/           # Model registry
│       ├── monitoring/       # Drift detection
│       └── deployment/       # Blue-green deployment
├── infrastructure/
│   └── bicep/               # Azure IaC templates
├── tests/
│   ├── property/            # Property-based tests (26 properties)
│   ├── integration/         # Integration tests
│   ├── e2e/                 # End-to-end tests
│   └── load/                # Performance tests
└── docs/
    ├── part1-design/        # Architecture documentation
    └── part3-written/       # Governance responses
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.9+ (for ML components)
- Azure CLI (for deployment)

### Installation

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run linting
npm run lint
```

### Running Locally

```bash
# Start the API (development mode)
cd src/backend/api && npm run dev

# Start the Admin UI
cd src/frontend/admin-ui && npm run dev
```

### Deployment

See [docs/AZURE_DEPLOYMENT_GUIDE.md](docs/AZURE_DEPLOYMENT_GUIDE.md) for Azure deployment instructions.

## Testing

The system uses property-based testing to validate correctness properties:

```bash
# Run all tests
npm test

# Run property tests only
npm test -- --grep "property"

# Run with coverage
npm test -- --coverage
```

Key property tests include:
- Scoring produces valid ranked vendor lists
- Hybrid scoring combines rules and ML appropriately
- ML fallback works when endpoint unavailable
- Override requires documented reason
- PII is masked in all logs

## Limitations and Next Steps

### Current Limitations

1. **Single region**: Designed for US deployment; multi-region requires Cosmos DB global distribution
2. **Batch scoring**: Real-time (<1 hour SLA) jobs may need architecture changes
3. **Vendor self-service**: Vendors cannot update their own profiles
4. **A/B testing**: Infrastructure exists but full experimentation platform not built

### Planned Enhancements

1. **Multi-region deployment**: Enable Cosmos DB global distribution
2. **Real-time streaming**: Event Hubs for sub-second event processing
3. **Advanced ML**: Evaluate deep learning if gradient boosting accuracy plateaus
4. **Vendor portal**: Self-service profile updates to reduce data staleness
5. **Full A/B testing**: Dedicated experimentation platform for model comparison

## Documentation

- [Architecture Design](docs/part1-design/architecture-design.md)
- [Tradeoffs and Assumptions](docs/part1-design/tradeoffs-assumptions.md)
- [AI Authority & Risk](docs/part3-written/ai-authority-risk.md)
- [Model Drift & Feedback](docs/part3-written/model-drift-feedback.md)
- [Data Quality & Events](docs/part3-written/data-quality-events.md)
- [Failure Modes](docs/part3-written/failure-modes.md)

## License

Proprietary - RetailFixIt Internal Use Only
