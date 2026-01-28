# RetailFixIt Documentation Index

This directory contains comprehensive documentation for the RetailFixIt AI-Orchestrated Vendor Dispatch System, organized by assessment part.

---

## Quick Navigation

### Part 1: Design Documentation
| Document | Description |
|----------|-------------|
| [Architecture Design](part1-design/architecture-design.md) | High-level system architecture and Azure services |
| [Tradeoffs & Assumptions](part1-design/tradeoffs-assumptions.md) | Design decisions and alternatives considered |
| [Diagrams](part1-design/diagrams/README.md) | Architecture diagrams |

### Part 2: Implementation
| Component | Location | Description |
|-----------|----------|-------------|
| Backend API | [`src/backend/`](../src/backend/) | Express.js API, event handlers, scoring service |
| Frontend UI | [`src/frontend/admin-ui/`](../src/frontend/admin-ui/) | React Admin UI for operators |
| ML Pipeline | [`src/ml/`](../src/ml/) | Python ML training, models, monitoring |
| Azure Functions | [`azure-functions/`](../azure-functions/) | Deployed serverless API endpoints |
| Infrastructure | [`infrastructure/bicep/`](../infrastructure/bicep/) | Bicep IaC templates for Azure |

### Part 3: Written Governance Responses
| Document | Description |
|----------|-------------|
| [AI Authority & Risk](part3-written/ai-authority-risk.md) | Decisions requiring human oversight |
| [Model Drift & Feedback](part3-written/model-drift-feedback.md) | Drift detection and retraining approach |
| [Data Quality & Events](part3-written/data-quality-events.md) | Critical event instrumentation |
| [Failure Modes](part3-written/failure-modes.md) | System behavior under degraded conditions |

### Bonus Features (All 5 Implemented)
| Document | Description |
|----------|-------------|
| [Offline Training Notebook](../src/ml/notebooks/vendor_scoring_training_executed.ipynb) | ML training with data exploration and evaluation |
| [A/B Testing Plan](part3-written/bonus/ab-testing-plan.md) | AI vs manual dispatch comparison methodology |
| [Confidence Scoring](../src/backend/vendor-scoring-service/scoring/confidence-scorer.ts) | Abstention logic for low-confidence predictions |
| [Fairness & Bias Mitigation](part3-written/bonus/fairness-bias-mitigation.md) | Equitable vendor treatment |
| [SLA Optimization](part3-written/bonus/sla-optimization.md) | SLA-aware vendor scoring strategy |

---

## Part 1: Design Documentation

System architecture and design decisions for the AI-orchestrated vendor dispatch system.

### [Architecture Design](part1-design/architecture-design.md)

Comprehensive architecture documentation including:
- High-level Azure architecture diagram
- Azure services selection and rationale
- AI integration with dispatch workflow
- Automated vs advisory decision boundaries
- Human-in-the-loop controls
- Security and compliance considerations
- Performance targets

### [Tradeoffs and Assumptions](part1-design/tradeoffs-assumptions.md)

Design decision analysis covering:
- Hybrid scoring vs pure ML tradeoffs
- Event-driven vs request-response architecture
- Database selection (Cosmos DB + Azure SQL)
- Serverless vs container-based compute
- Confidence threshold calibration
- Model complexity vs interpretability

### [Architecture Diagrams](part1-design/diagrams/README.md)

Visual representations of the system:
- Azure architecture diagram (current state)
- Azure architecture diagram (production-ready)
- Diagram generation instructions

---

## Part 2: Implementation

### Project Structure

```
├── src/
│   ├── backend/
│   │   ├── api/                    # REST API endpoints
│   │   ├── event-integration/      # Event handlers and publishers
│   │   ├── explainability-layer/   # Explanation generation
│   │   ├── shared/                 # Common models, logging, caching
│   │   └── vendor-scoring-service/ # Core scoring logic
│   ├── frontend/
│   │   └── admin-ui/               # React operator interface
│   └── ml/
│       ├── training/               # Model training scripts
│       ├── models/                 # Model registry
│       ├── monitoring/             # Drift detection
│       └── deployment/             # Blue-green deployment
├── azure-functions/                # Deployed serverless API
├── infrastructure/
│   └── bicep/                      # Azure IaC templates
├── tests/
│   ├── property/                   # Property-based tests (26 properties)
│   ├── integration/                # Integration tests
│   ├── e2e/                        # End-to-end tests
│   └── load/                       # Performance tests
├── workflow/                       # Spec-driven development docs
└── docs/
    ├── part1-design/               # Architecture documentation
    └── part3-written/              # Governance responses
```

### Backend API
Location: [`src/backend/`](../src/backend/)

| Component | Path | Purpose |
|-----------|------|---------|
| API Routes | `src/backend/api/` | REST endpoints for recommendations, overrides |
| Event Integration | `src/backend/event-integration/` | Event handlers, publishers, dead-letter handling |
| Explainability Layer | `src/backend/explainability-layer/` | Factor analysis, narrative generation |
| Vendor Scoring | `src/backend/vendor-scoring-service/` | Rule engine, ML client, hybrid scoring |
| Shared Utilities | `src/backend/shared/` | Models, logging, caching, audit |

### Frontend Admin UI
Location: [`src/frontend/admin-ui/`](../src/frontend/admin-ui/)

React application for dispatch operators:
- Job list with filtering and sorting
- Job detail view with vendor recommendations
- Override modal with reason capture
- Toast notifications for actions
- Responsive design (WCAG 2.1 AA compliant)

### ML Pipeline
Location: [`src/ml/`](../src/ml/)

| Component | Path | Purpose |
|-----------|------|---------|
| Training | `src/ml/training/` | Model training, feedback processing |
| Models | `src/ml/models/` | Model registry, versioning |
| Monitoring | `src/ml/monitoring/` | Drift detection |
| Deployment | `src/ml/deployment/` | Blue-green deployment, scoring scripts |
| Notebooks | `src/ml/notebooks/` | Training notebook with evaluation |
| Trained Models | `src/ml/trained_models/` | Serialized .pkl model files |

### Azure Functions (Deployed)
Location: [`azure-functions/`](../azure-functions/)

Consolidated serverless API deployed to Azure:
- All endpoints in single function app
- Pre-computed ML predictions for demo
- In-memory data for simplified deployment

### Infrastructure as Code
Location: [`infrastructure/bicep/`](../infrastructure/bicep/)

Bicep templates for Azure resources:
- `main.bicep` - Main deployment template
- `modules/` - Individual resource modules
- `parameters/` - Environment-specific parameters (dev, staging, production)

---

## Part 3: Written Governance Responses

Engineering reasoning about production AI systems and governance considerations.

### [AI Authority & Risk](part3-written/ai-authority-risk.md)

Discussion of decisions that should never be fully autonomous:
- High-value customer assignments
- Safety-critical jobs
- New vendor onboarding period
- Risk framework balancing customer impact, vendor fairness, and efficiency

### [Model Drift & Feedback](part3-written/model-drift-feedback.md)

Approach to detecting drift and incorporating feedback:
- Feature distribution monitoring (KL divergence)
- Prediction accuracy tracking
- Override rate analysis
- Outcome-weighted feedback incorporation
- Staged model rollout with validation

### [Data Quality & Events](part3-written/data-quality-events.md)

Critical event instrumentation for reliable AI:
- Job lifecycle events
- Vendor state events
- AI decision events
- System health events
- Data quality requirements (completeness, timeliness, accuracy, consistency)

### [Failure Modes](part3-written/failure-modes.md)

System behavior under degraded conditions:
- ML unavailability and fallback behavior
- Slow response handling with timeouts
- Low-confidence result escalation
- Abstention for extremely uncertain predictions

---

## Bonus Features Documentation

All 5 optional bonus items have been implemented:

### 1. [Offline Training Notebook](../src/ml/notebooks/vendor_scoring_training_executed.ipynb)

Jupyter notebook demonstrating the ML training process:
- Data exploration and feature engineering
- Model training (Gradient Boosting)
- Evaluation metrics and validation
- Model serialization to `.pkl` files

### 2. [A/B Testing Plan](part3-written/bonus/ab-testing-plan.md)

Methodology for comparing AI dispatch vs manual dispatch:
- Traffic splitting approach (50/50 randomized)
- Success metrics definition (completion rate, time, satisfaction)
- Statistical analysis methodology (t-tests, confidence intervals)

### 3. [Confidence Scoring & Abstention](../src/backend/vendor-scoring-service/scoring/confidence-scorer.ts)

Logic for calculating recommendation confidence:
- Data quality assessment
- ML model certainty evaluation
- Abstention when confidence < 70% threshold
- Automatic escalation to human review

### 4. [Fairness and Bias Mitigation](part3-written/bonus/fairness-bias-mitigation.md)

Ensuring equitable vendor treatment:
- Potential bias sources identification
- Disparate impact monitoring
- Vendor starvation prevention mechanisms

### 5. [SLA Optimization](part3-written/bonus/sla-optimization.md)

SLA-aware vendor scoring strategy:
- Urgency factoring in scores
- Fast-response vendor prioritization
- Tradeoffs between speed and quality

---

## API Documentation

The REST API is documented using OpenAPI/Swagger:
- **Specification**: [`src/backend/api/src/openapi.yaml`](../src/backend/api/src/openapi.yaml)
- Interactive docs available at `/api-docs` when running the API server

### Live Deployment
- **Frontend**: https://red-moss-08febb31e.6.azurestaticapps.net
- **Backend API**: https://retailfixit-dev-func.azurewebsites.net/api

---

## Spec-Driven Development Workflow

This project was built using spec-driven development methodology. The workflow documentation shows how the system was designed step-by-step:

| Document | Description |
|----------|-------------|
| [Requirements](../workflow/requirements.md) | User stories and acceptance criteria |
| [Design](../workflow/design.md) | Architecture, data models, correctness properties |
| [Tasks](../workflow/tasks.md) | Implementation plan with 23 phases |
| [Workflow README](../workflow/README.md) | Overview of the spec-driven approach |

### What is Spec-Driven Development?

1. **Requirements** - Define what the system should do through user stories and acceptance criteria
2. **Design** - Architect how the system will work, including data models, APIs, and 26 correctness properties
3. **Tasks** - Break down implementation into discrete, testable tasks with requirement traceability

---

## Document Conventions

- **Requirements references**: Documents reference specific requirements from the spec (e.g., "Requirements 1.1, 1.2")
- **Property references**: Testing properties are numbered (e.g., "Property 7: Explainability Completeness")
- **Code examples**: TypeScript for backend, Python for ML components
- **Diagrams**: Mermaid syntax for inline diagrams, PNG exports in `diagrams/` folder
