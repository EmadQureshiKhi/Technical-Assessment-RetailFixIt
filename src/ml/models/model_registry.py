"""
Model Registry for Vendor Scoring Models

Manages model versioning, registration, and retrieval for the
RetailFixIt vendor scoring system.

@requirement 8.1 - Maintain version history for all deployed ML models
@requirement 8.3 - Log model version used for each recommendation
@property Property 15: Model Version Tracking
@tested tests/property/model-version-tracking.property.test.ts

Usage:
    registry = ModelRegistry('./models')
    registry.register_model('completion', model, metadata)
    model = registry.get_model('completion', version='latest')
"""

import os
import json
import logging
import hashlib
import pickle
from datetime import datetime
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)


class ModelStatus(Enum):
    """Model deployment status."""
    REGISTERED = 'registered'
    STAGING = 'staging'
    PRODUCTION = 'production'
    ARCHIVED = 'archived'
    DEPRECATED = 'deprecated'


class ModelType(Enum):
    """Types of models in the registry."""
    COMPLETION = 'completion'
    TIME_TO_COMPLETE = 'time_to_complete'
    REWORK_RISK = 'rework_risk'
    SATISFACTION = 'satisfaction'


@dataclass
class ModelVersion:
    """
    Model version metadata.
    
    @requirement 8.1 - Maintain version history for all deployed ML models
    @requirement 8.3 - Log model version used for each recommendation
    """
    version: str
    model_type: str
    status: str
    created_at: str
    updated_at: str
    
    # Training info
    training_data_hash: str
    training_samples: int
    training_duration_seconds: float
    
    # Performance metrics
    metrics: Dict[str, float]
    
    # Lineage
    parent_version: Optional[str] = None
    training_config: Dict[str, Any] = field(default_factory=dict)
    feature_names: List[str] = field(default_factory=list)
    
    # Deployment info
    deployed_at: Optional[str] = None
    deployment_environment: Optional[str] = None
    
    # File paths
    model_path: str = ''
    metadata_path: str = ''
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ModelVersion':
        return cls(**data)


@dataclass
class ModelLineage:
    """Track model lineage and training data."""
    version: str
    parent_version: Optional[str]
    training_data_sources: List[str]
    training_data_hash: str
    feature_engineering_version: str
    hyperparameters: Dict[str, Any]
    created_at: str


class ModelRegistry:
    """
    Model Registry for managing ML model versions.
    
    Provides functionality for:
    - Registering new model versions
    - Tracking model lineage
    - Managing model lifecycle (staging, production, archived)
    - Retrieving models by version or status
    
    @requirement 8.1 - Maintain version history for all deployed ML models
    @requirement 8.3 - Log model version used for each recommendation
    @requirement 8.5 - Maintain previous version for rollback
    """
    
    REGISTRY_FILE = 'registry.json'
    LINEAGE_FILE = 'lineage.json'
    
    def __init__(self, storage_path: str):
        """
        Initialize the model registry.
        
        Args:
            storage_path: Path to model storage directory
        """
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._registry: Dict[str, Dict[str, ModelVersion]] = {}
        self._lineage: Dict[str, ModelLineage] = {}
        self._production_versions: Dict[str, str] = {}
        self._staging_versions: Dict[str, str] = {}
        
        self._load_registry()
        logger.info(f"Initialized model registry at: {storage_path}")
    
    def _load_registry(self) -> None:
        """Load registry from disk."""
        registry_path = self.storage_path / self.REGISTRY_FILE
        if registry_path.exists():
            with open(registry_path, 'r') as f:
                data = json.load(f)
                
            # Load model versions
            for model_type, versions in data.get('models', {}).items():
                self._registry[model_type] = {}
                for version, version_data in versions.items():
                    self._registry[model_type][version] = ModelVersion.from_dict(version_data)
            
            # Load production/staging mappings
            self._production_versions = data.get('production', {})
            self._staging_versions = data.get('staging', {})
            
            logger.info(f"Loaded registry with {sum(len(v) for v in self._registry.values())} model versions")
        
        # Load lineage
        lineage_path = self.storage_path / self.LINEAGE_FILE
        if lineage_path.exists():
            with open(lineage_path, 'r') as f:
                lineage_data = json.load(f)
            for version, data in lineage_data.items():
                self._lineage[version] = ModelLineage(**data)
    
    def _save_registry(self) -> None:
        """Save registry to disk."""
        data = {
            'models': {
                model_type: {
                    version: mv.to_dict()
                    for version, mv in versions.items()
                }
                for model_type, versions in self._registry.items()
            },
            'production': self._production_versions,
            'staging': self._staging_versions,
            'updated_at': datetime.utcnow().isoformat(),
        }
        
        registry_path = self.storage_path / self.REGISTRY_FILE
        with open(registry_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        # Save lineage
        lineage_path = self.storage_path / self.LINEAGE_FILE
        with open(lineage_path, 'w') as f:
            json.dump({k: asdict(v) for k, v in self._lineage.items()}, f, indent=2)
    
    def register_model(
        self,
        model_type: str,
        model: Any,
        version: str,
        metrics: Dict[str, float],
        training_samples: int,
        training_duration_seconds: float,
        training_data_hash: str = '',
        feature_names: Optional[List[str]] = None,
        training_config: Optional[Dict[str, Any]] = None,
        parent_version: Optional[str] = None,
    ) -> ModelVersion:
        """
        Register a new model version.
        
        @requirement 8.1 - Register models with version tags
        @requirement 8.3 - Track model lineage and training data
        
        Args:
            model_type: Type of model (completion, time, rework)
            model: The trained model object
            version: Version string
            metrics: Performance metrics
            training_samples: Number of training samples
            training_duration_seconds: Training duration
            training_data_hash: Hash of training data
            feature_names: List of feature names
            training_config: Training configuration
            parent_version: Previous version this was derived from
            
        Returns:
            ModelVersion object
        """
        logger.info(f"Registering model: {model_type} version {version}")
        
        # Create model directory
        model_dir = self.storage_path / model_type / version
        model_dir.mkdir(parents=True, exist_ok=True)
        
        # Save model
        model_path = model_dir / 'model.pkl'
        with open(model_path, 'wb') as f:
            pickle.dump(model, f)
        
        # Create version metadata
        now = datetime.utcnow().isoformat()
        model_version = ModelVersion(
            version=version,
            model_type=model_type,
            status=ModelStatus.REGISTERED.value,
            created_at=now,
            updated_at=now,
            training_data_hash=training_data_hash or self._compute_hash(str(model)),
            training_samples=training_samples,
            training_duration_seconds=training_duration_seconds,
            metrics=metrics,
            parent_version=parent_version,
            training_config=training_config or {},
            feature_names=feature_names or [],
            model_path=str(model_path),
            metadata_path=str(model_dir / 'metadata.json'),
        )
        
        # Save metadata
        with open(model_version.metadata_path, 'w') as f:
            json.dump(model_version.to_dict(), f, indent=2)
        
        # Update registry
        if model_type not in self._registry:
            self._registry[model_type] = {}
        self._registry[model_type][version] = model_version
        
        # Track lineage
        self._lineage[f"{model_type}:{version}"] = ModelLineage(
            version=version,
            parent_version=parent_version,
            training_data_sources=[],
            training_data_hash=training_data_hash,
            feature_engineering_version='1.0.0',
            hyperparameters=training_config or {},
            created_at=now,
        )
        
        self._save_registry()
        logger.info(f"Registered model {model_type}:{version}")
        
        return model_version
    
    def get_model(
        self,
        model_type: str,
        version: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Optional[Any]:
        """
        Retrieve a model from the registry.
        
        Args:
            model_type: Type of model
            version: Specific version (or 'latest', 'production', 'staging')
            status: Filter by status
            
        Returns:
            The model object or None
        """
        model_version = self.get_model_version(model_type, version, status)
        if not model_version:
            return None
        
        # Load model
        if os.path.exists(model_version.model_path):
            with open(model_version.model_path, 'rb') as f:
                return pickle.load(f)
        
        return None
    
    def get_model_version(
        self,
        model_type: str,
        version: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Optional[ModelVersion]:
        """
        Get model version metadata.
        
        @requirement 8.3 - Log model version used for each recommendation
        
        Args:
            model_type: Type of model
            version: Specific version or 'latest', 'production', 'staging'
            status: Filter by status
            
        Returns:
            ModelVersion or None
        """
        if model_type not in self._registry:
            return None
        
        versions = self._registry[model_type]
        
        # Handle special version keywords
        if version == 'production':
            version = self._production_versions.get(model_type)
        elif version == 'staging':
            version = self._staging_versions.get(model_type)
        elif version == 'latest' or version is None:
            # Get most recent version
            if not versions:
                return None
            version = max(versions.keys(), key=lambda v: versions[v].created_at)
        
        if version and version in versions:
            mv = versions[version]
            if status is None or mv.status == status:
                return mv
        
        return None
    
    def list_versions(
        self,
        model_type: str,
        status: Optional[str] = None,
    ) -> List[ModelVersion]:
        """
        List all versions of a model type.
        
        @requirement 8.1 - Maintain version history for all deployed ML models
        
        Args:
            model_type: Type of model
            status: Filter by status
            
        Returns:
            List of ModelVersion objects
        """
        if model_type not in self._registry:
            return []
        
        versions = list(self._registry[model_type].values())
        
        if status:
            versions = [v for v in versions if v.status == status]
        
        # Sort by creation date (newest first)
        versions.sort(key=lambda v: v.created_at, reverse=True)
        
        return versions
    
    def promote_to_staging(self, model_type: str, version: str) -> bool:
        """
        Promote a model version to staging.
        
        @requirement 8.2 - Support blue-green deployment for model updates
        
        Args:
            model_type: Type of model
            version: Version to promote
            
        Returns:
            True if successful
        """
        if model_type not in self._registry or version not in self._registry[model_type]:
            logger.error(f"Model not found: {model_type}:{version}")
            return False
        
        # Update status
        model_version = self._registry[model_type][version]
        model_version.status = ModelStatus.STAGING.value
        model_version.updated_at = datetime.utcnow().isoformat()
        
        # Update staging mapping
        self._staging_versions[model_type] = version
        
        self._save_registry()
        logger.info(f"Promoted {model_type}:{version} to staging")
        
        return True
    
    def promote_to_production(self, model_type: str, version: str) -> bool:
        """
        Promote a model version to production.
        
        @requirement 8.2 - Support blue-green deployment for model updates
        @requirement 8.5 - Maintain previous version for rollback
        
        Args:
            model_type: Type of model
            version: Version to promote
            
        Returns:
            True if successful
        """
        if model_type not in self._registry or version not in self._registry[model_type]:
            logger.error(f"Model not found: {model_type}:{version}")
            return False
        
        # Archive current production version
        current_prod = self._production_versions.get(model_type)
        if current_prod and current_prod in self._registry[model_type]:
            self._registry[model_type][current_prod].status = ModelStatus.ARCHIVED.value
            self._registry[model_type][current_prod].updated_at = datetime.utcnow().isoformat()
        
        # Update status
        model_version = self._registry[model_type][version]
        model_version.status = ModelStatus.PRODUCTION.value
        model_version.deployed_at = datetime.utcnow().isoformat()
        model_version.deployment_environment = 'production'
        model_version.updated_at = datetime.utcnow().isoformat()
        
        # Update production mapping
        self._production_versions[model_type] = version
        
        self._save_registry()
        logger.info(f"Promoted {model_type}:{version} to production")
        
        return True
    
    def rollback(self, model_type: str) -> Optional[str]:
        """
        Rollback to the previous production version.
        
        @requirement 8.5 - Maintain previous version for rollback
        
        Args:
            model_type: Type of model
            
        Returns:
            The version rolled back to, or None
        """
        if model_type not in self._registry:
            return None
        
        # Find the most recent archived version
        archived = [
            v for v in self._registry[model_type].values()
            if v.status == ModelStatus.ARCHIVED.value
        ]
        
        if not archived:
            logger.warning(f"No archived versions available for rollback: {model_type}")
            return None
        
        # Get most recent archived
        archived.sort(key=lambda v: v.updated_at, reverse=True)
        rollback_version = archived[0]
        
        # Demote current production
        current_prod = self._production_versions.get(model_type)
        if current_prod and current_prod in self._registry[model_type]:
            self._registry[model_type][current_prod].status = ModelStatus.DEPRECATED.value
            self._registry[model_type][current_prod].updated_at = datetime.utcnow().isoformat()
        
        # Promote archived to production
        rollback_version.status = ModelStatus.PRODUCTION.value
        rollback_version.deployed_at = datetime.utcnow().isoformat()
        rollback_version.updated_at = datetime.utcnow().isoformat()
        
        self._production_versions[model_type] = rollback_version.version
        
        self._save_registry()
        logger.info(f"Rolled back {model_type} to version {rollback_version.version}")
        
        return rollback_version.version
    
    def get_lineage(self, model_type: str, version: str) -> Optional[ModelLineage]:
        """
        Get model lineage information.
        
        @requirement 8.3 - Track model lineage and training data
        
        Args:
            model_type: Type of model
            version: Model version
            
        Returns:
            ModelLineage or None
        """
        key = f"{model_type}:{version}"
        return self._lineage.get(key)
    
    def get_production_version(self, model_type: str) -> Optional[str]:
        """
        Get the current production version for a model type.
        
        @requirement 8.3 - Log model version used for each recommendation
        
        Args:
            model_type: Type of model
            
        Returns:
            Version string or None
        """
        return self._production_versions.get(model_type)
    
    def get_model_metrics(self, model_type: str, version: str) -> Optional[Dict[str, float]]:
        """
        Get performance metrics for a model version.
        
        @requirement 8.6 - Track model performance metrics per version
        
        Args:
            model_type: Type of model
            version: Model version
            
        Returns:
            Metrics dictionary or None
        """
        model_version = self.get_model_version(model_type, version)
        if model_version:
            return model_version.metrics
        return None
    
    def compare_versions(
        self,
        model_type: str,
        version_a: str,
        version_b: str,
    ) -> Dict[str, Any]:
        """
        Compare two model versions.
        
        Args:
            model_type: Type of model
            version_a: First version
            version_b: Second version
            
        Returns:
            Comparison dictionary
        """
        mv_a = self.get_model_version(model_type, version_a)
        mv_b = self.get_model_version(model_type, version_b)
        
        if not mv_a or not mv_b:
            return {'error': 'One or both versions not found'}
        
        comparison = {
            'version_a': version_a,
            'version_b': version_b,
            'metrics_comparison': {},
            'training_samples_diff': mv_b.training_samples - mv_a.training_samples,
            'created_at_diff_days': (
                datetime.fromisoformat(mv_b.created_at) -
                datetime.fromisoformat(mv_a.created_at)
            ).days,
        }
        
        # Compare metrics
        all_metrics = set(mv_a.metrics.keys()) | set(mv_b.metrics.keys())
        for metric in all_metrics:
            val_a = mv_a.metrics.get(metric, 0)
            val_b = mv_b.metrics.get(metric, 0)
            comparison['metrics_comparison'][metric] = {
                'version_a': val_a,
                'version_b': val_b,
                'diff': val_b - val_a,
                'pct_change': ((val_b - val_a) / val_a * 100) if val_a != 0 else 0,
            }
        
        return comparison
    
    def _compute_hash(self, data: str) -> str:
        """Compute SHA256 hash of data."""
        return hashlib.sha256(data.encode()).hexdigest()[:16]


# Singleton instance
_registry_instance: Optional[ModelRegistry] = None


def get_model_registry(storage_path: str = './models') -> ModelRegistry:
    """Get or create the model registry singleton."""
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = ModelRegistry(storage_path)
    return _registry_instance


def reset_model_registry() -> None:
    """Reset the model registry singleton (for testing)."""
    global _registry_instance
    _registry_instance = None
