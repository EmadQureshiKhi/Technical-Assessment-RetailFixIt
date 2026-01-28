# Development Workflow Documentation

This folder contains the specification-driven development workflow used to build the RetailFixIt AI-Orchestrated Vendor Dispatch System.

## Documents

| Document | Description |
|----------|-------------|
| [requirements.md](./requirements.md) | 20 requirements with user stories and acceptance criteria |
| [design.md](./design.md) | Architecture, data models, 26 correctness properties |
| [tasks.md](./tasks.md) | 23 implementation phases with 100+ subtasks |

---

## What is Spec-Driven Development?

Spec-driven development is a methodology where you systematically refine a feature idea through three phases:

1. **Requirements** - Define what the system should do through user stories and acceptance criteria
2. **Design** - Architect how the system will work, including data models, APIs, and correctness properties
3. **Tasks** - Break down implementation into discrete, testable tasks

---

## Document Details

### [requirements.md](./requirements.md)

Defines 20 functional and non-functional requirements through:
- User stories describing who needs what and why
- Acceptance criteria specifying exact behaviors
- Glossary of domain terms
- Bonus feature requirements (A/B testing, fairness, SLA optimization)

### [design.md](./design.md)

Describes the technical architecture including:
- High-level Azure architecture diagram
- 12 Azure services with selection rationale
- Production vs Demo architecture comparison
- ML models (Completion, Time, Rework) with accuracy metrics
- Hybrid scoring algorithm design
- Data models (Job, Vendor, Score schemas)
- 26 formal correctness properties
- Error handling and fallback strategies
- Performance requirements
- Testing strategy (unit, property, integration, E2E, load, security)

### [tasks.md](./tasks.md)

Breaks down implementation into 23 phases with 100+ subtasks:
- Project setup and infrastructure (Phase 1-2)
- Vendor scoring service - rules, ML, hybrid (Phase 3-6)
- Explainability layer (Phase 7)
- Event integration (Phase 8-9)
- API layer with auth, RBAC, rate limiting (Phase 10)
- Logging and observability (Phase 11-12)
- Human-in-the-loop controls (Phase 13)
- Admin UI frontend (Phase 14-15)
- ML pipeline and model management (Phase 16-17)
- Documentation - Part 1 and Part 3 (Phase 18-19)
- Bonus features (Phase 20)
- Integration tests and edge cases (Phase 21)
- Final verification (Phase 22-23)

Each task includes:
- Specific file paths to create/modify
- Requirement references for traceability
- Property test mappings for validation

---

## Why This Approach?

1. **Traceability** - Every line of code traces back to a requirement
2. **Testability** - Correctness properties define what must always be true
3. **Incremental Validation** - Checkpoints ensure each phase works before moving on
4. **Documentation** - The spec serves as living documentation

---

## Correctness Properties

The design defines 26 formal correctness properties that the system must satisfy. These are tested using property-based testing (fast-check) which generates random inputs to verify properties hold universally, not just for specific examples.

| Property | Description |
|----------|-------------|
| Property 1 | Scoring produces valid ranked vendor list (3-5 vendors, descending order) |
| Property 2 | Score breakdown completeness (all factors, weights sum to 1.0) |
| Property 3 | Hybrid scoring combines rules and ML |
| Property 4 | Tie-breaking determinism |
| Property 5 | Configurable weights affect scores |
| Property 6 | Graceful ML fallback when endpoint unavailable |
| Property 7 | Explainability completeness |
| Property 8 | Event processing idempotency (no duplicate recommendations) |
| Property 9 | Correlation ID propagation |
| Property 10 | Override requires reason |
| Property 11 | Automation level behavior |
| Property 12 | Low confidence triggers human review |
| Property 13 | Override audit completeness |
| Property 14 | Schema validation enforcement |
| Property 15 | Model version tracking |
| Property 16 | Prediction accuracy monitoring |
| Property 17 | Drift detection alerting |
| Property 18 | Feedback loop incorporation |
| Property 19 | Comprehensive logging |
| Property 20 | Authentication enforcement |
| Property 21 | RBAC enforcement |
| Property 22 | PII masking in logs |
| Property 23 | Rate limiting enforcement |
| Property 24 | Timeout fallback behavior |
| Property 25 | Circuit breaker activation |
| Property 26 | Retry with exponential backoff |

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | TypeScript/Node.js with Azure Functions |
| Frontend | React with TypeScript (Azure Static Web Apps) |
| ML | Python with scikit-learn (Gradient Boosting) |
| Infrastructure | Bicep (Azure IaC) |
| Testing | Vitest, fast-check, Playwright |
| Database | Cosmos DB (documents), Azure SQL (audit) |
| Messaging | Event Grid, Service Bus |
| Monitoring | Application Insights, Log Analytics |

---

## Live Deployment

The system is deployed to Azure:
- **Frontend**: https://red-moss-08febb31e.6.azurestaticapps.net
- **Backend API**: https://retailfixit-dev-func.azurewebsites.net/api

