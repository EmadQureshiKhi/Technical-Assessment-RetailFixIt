# ML Components

This directory contains Python-based ML components for the RetailFixIt Vendor Dispatch System.

## Structure

- `training/` - Model training scripts
  - `train_model.py` - Gradient boosting model training pipeline
  - `feedback_processor.py` - Override and outcome data processing for retraining
- `models/` - Model registry and versioning
  - `model_registry.py` - Model version management and lifecycle
- `monitoring/` - Drift detection and performance monitoring
  - `drift_detector.py` - Feature drift detection using KL divergence
- `deployment/` - Blue-green deployment scripts
  - `blue_green_deployer.py` - Traffic shifting and rollback capabilities
- `notebooks/` - Jupyter notebooks for exploration and documentation

## Requirements

The ML components require the following Python packages:
- numpy
- pandas
- scikit-learn
- pyodbc (for Azure SQL connection)

## Usage

### Training a Model

```bash
# Using mock data for development
python src/ml/training/train_model.py --use-mock-data --output-path ./models

# Using real data from Azure SQL
python src/ml/training/train_model.py --data-path "Server=..." --output-path ./models
```

### Model Registry

```python
from src.ml.models.model_registry import ModelRegistry

registry = ModelRegistry('./models')
registry.register_model('completion', model, 'v1.0.0', metrics, ...)
model = registry.get_model('completion', version='production')
```

### Drift Detection

```python
from src.ml.monitoring.drift_detector import DriftDetector

detector = DriftDetector(storage_path='./monitoring')
detector.set_baseline(training_data)
report = detector.detect_drift(current_data, 'completion', 'v1.0.0')
```

### Blue-Green Deployment

```python
from src.ml.deployment.blue_green_deployer import BlueGreenDeployer

deployer = BlueGreenDeployer('./deployments')
deployer.deploy_to_staging('completion', 'v2.0.0')
deployer.shift_traffic('completion', blue_weight=0.9, green_weight=0.1)
deployer.promote_to_production('completion')
```

## Property Tests

The ML components are validated by the following property tests:
- Property 15: Model Version Tracking (`tests/property/model-version-tracking.property.test.ts`)
- Property 16: Prediction Accuracy Monitoring (`tests/property/prediction-accuracy.property.test.ts`)
- Property 17: Drift Detection Alerting (`tests/property/drift-detection.property.test.ts`)
- Property 18: Feedback Loop Incorporation (`tests/property/feedback-loop.property.test.ts`)
