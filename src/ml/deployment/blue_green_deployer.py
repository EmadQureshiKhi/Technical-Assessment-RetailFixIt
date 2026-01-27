"""
Blue-Green Model Deployer

Implements blue-green deployment strategy for ML models with
traffic shifting and rollback capabilities.

@requirement 8.2 - Support blue-green deployment for model updates
@requirement 8.5 - Add rollback capability
@property Property 15: Model Version Tracking
@tested tests/property/model-version-tracking.property.test.ts

Usage:
    deployer = BlueGreenDeployer(registry)
    deployer.deploy_to_staging('completion', 'v1.0.0')
    deployer.shift_traffic('completion', blue_weight=0.9, green_weight=0.1)
    deployer.promote_to_production('completion')
"""

import os
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger(__name__)


class DeploymentSlot(Enum):
    """Deployment slot identifiers."""
    BLUE = 'blue'
    GREEN = 'green'


class DeploymentStatus(Enum):
    """Deployment status."""
    PENDING = 'pending'
    DEPLOYING = 'deploying'
    ACTIVE = 'active'
    DRAINING = 'draining'
    INACTIVE = 'inactive'
    FAILED = 'failed'
    ROLLED_BACK = 'rolled_back'


@dataclass
class DeploymentConfig:
    """Configuration for a deployment."""
    model_type: str
    version: str
    slot: str
    endpoint_url: str
    health_check_url: str
    traffic_weight: float = 0.0
    min_instances: int = 1
    max_instances: int = 10
    target_cpu_utilization: float = 0.7


@dataclass
class DeploymentState:
    """Current state of a deployment slot."""
    slot: str
    model_type: str
    version: Optional[str]
    status: str
    traffic_weight: float
    deployed_at: Optional[str]
    health_status: str = 'unknown'
    last_health_check: Optional[str] = None
    error_message: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DeploymentState':
        return cls(**data)


@dataclass
class TrafficConfig:
    """Traffic routing configuration."""
    blue_weight: float
    green_weight: float
    updated_at: str
    
    def validate(self) -> bool:
        """Validate that weights sum to 1.0."""
        return abs(self.blue_weight + self.green_weight - 1.0) < 0.001


@dataclass
class DeploymentHistory:
    """Record of a deployment action."""
    action: str
    model_type: str
    version: str
    slot: str
    timestamp: str
    status: str
    duration_seconds: float
    error: Optional[str] = None


class BlueGreenDeployer:
    """
    Blue-Green Deployment Manager for ML Models.
    
    Manages two deployment slots (blue and green) for each model type,
    enabling zero-downtime deployments with traffic shifting and rollback.
    
    @requirement 8.2 - Support blue-green deployment for model updates
    @requirement 8.5 - Add rollback capability
    """
    
    STATE_FILE = 'deployment_state.json'
    HISTORY_FILE = 'deployment_history.json'
    
    def __init__(
        self,
        storage_path: str,
        azure_ml_workspace: Optional[str] = None,
        azure_ml_subscription: Optional[str] = None,
        azure_ml_resource_group: Optional[str] = None,
    ):
        """
        Initialize the deployer.
        
        Args:
            storage_path: Path to store deployment state
            azure_ml_workspace: Azure ML workspace name
            azure_ml_subscription: Azure subscription ID
            azure_ml_resource_group: Azure resource group
        """
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self.azure_ml_workspace = azure_ml_workspace
        self.azure_ml_subscription = azure_ml_subscription
        self.azure_ml_resource_group = azure_ml_resource_group
        
        # State tracking
        self._deployments: Dict[str, Dict[str, DeploymentState]] = {}
        self._traffic_configs: Dict[str, TrafficConfig] = {}
        self._history: List[DeploymentHistory] = []
        
        self._load_state()
        logger.info(f"Initialized blue-green deployer at: {storage_path}")
    
    def _load_state(self) -> None:
        """Load deployment state from disk."""
        state_path = self.storage_path / self.STATE_FILE
        if state_path.exists():
            with open(state_path, 'r') as f:
                data = json.load(f)
            
            # Load deployments
            for model_type, slots in data.get('deployments', {}).items():
                self._deployments[model_type] = {}
                for slot, state_data in slots.items():
                    self._deployments[model_type][slot] = DeploymentState.from_dict(state_data)
            
            # Load traffic configs
            for model_type, config_data in data.get('traffic', {}).items():
                self._traffic_configs[model_type] = TrafficConfig(**config_data)
        
        # Load history
        history_path = self.storage_path / self.HISTORY_FILE
        if history_path.exists():
            with open(history_path, 'r') as f:
                history_data = json.load(f)
            self._history = [DeploymentHistory(**h) for h in history_data]
    
    def _save_state(self) -> None:
        """Save deployment state to disk."""
        data = {
            'deployments': {
                model_type: {
                    slot: state.to_dict()
                    for slot, state in slots.items()
                }
                for model_type, slots in self._deployments.items()
            },
            'traffic': {
                model_type: asdict(config)
                for model_type, config in self._traffic_configs.items()
            },
            'updated_at': datetime.utcnow().isoformat(),
        }
        
        state_path = self.storage_path / self.STATE_FILE
        with open(state_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        # Save history (keep last 1000 entries)
        history_path = self.storage_path / self.HISTORY_FILE
        with open(history_path, 'w') as f:
            json.dump([asdict(h) for h in self._history[-1000:]], f, indent=2)
    
    def _record_history(
        self,
        action: str,
        model_type: str,
        version: str,
        slot: str,
        status: str,
        duration_seconds: float,
        error: Optional[str] = None,
    ) -> None:
        """Record a deployment action in history."""
        self._history.append(DeploymentHistory(
            action=action,
            model_type=model_type,
            version=version,
            slot=slot,
            timestamp=datetime.utcnow().isoformat(),
            status=status,
            duration_seconds=duration_seconds,
            error=error,
        ))
    
    def _get_inactive_slot(self, model_type: str) -> DeploymentSlot:
        """Get the currently inactive slot for a model type."""
        if model_type not in self._deployments:
            return DeploymentSlot.BLUE
        
        slots = self._deployments[model_type]
        
        # If blue is active/has traffic, use green
        blue_state = slots.get(DeploymentSlot.BLUE.value)
        if blue_state and blue_state.traffic_weight > 0:
            return DeploymentSlot.GREEN
        
        return DeploymentSlot.BLUE
    
    def _get_active_slot(self, model_type: str) -> Optional[DeploymentSlot]:
        """Get the currently active slot for a model type."""
        if model_type not in self._deployments:
            return None
        
        slots = self._deployments[model_type]
        
        for slot_name, state in slots.items():
            if state.traffic_weight > 0.5:
                return DeploymentSlot(slot_name)
        
        return None
    
    def deploy_to_staging(
        self,
        model_type: str,
        version: str,
        config: Optional[DeploymentConfig] = None,
    ) -> DeploymentState:
        """
        Deploy a model version to the staging (inactive) slot.
        
        @requirement 8.2 - Support staging and production endpoints
        
        Args:
            model_type: Type of model
            version: Model version to deploy
            config: Optional deployment configuration
            
        Returns:
            DeploymentState for the staging slot
        """
        start_time = time.time()
        logger.info(f"Deploying {model_type}:{version} to staging")
        
        # Determine which slot to use
        staging_slot = self._get_inactive_slot(model_type)
        
        # Initialize model type if needed
        if model_type not in self._deployments:
            self._deployments[model_type] = {}
            self._traffic_configs[model_type] = TrafficConfig(
                blue_weight=1.0,
                green_weight=0.0,
                updated_at=datetime.utcnow().isoformat(),
            )
        
        # Create deployment state
        now = datetime.utcnow().isoformat()
        state = DeploymentState(
            slot=staging_slot.value,
            model_type=model_type,
            version=version,
            status=DeploymentStatus.DEPLOYING.value,
            traffic_weight=0.0,
            deployed_at=now,
            health_status='pending',
        )
        
        try:
            # In production, this would deploy to Azure ML endpoint
            # For now, simulate deployment
            self._simulate_deployment(model_type, version, staging_slot)
            
            state.status = DeploymentStatus.ACTIVE.value
            state.health_status = 'healthy'
            state.last_health_check = now
            
            self._deployments[model_type][staging_slot.value] = state
            self._save_state()
            
            duration = time.time() - start_time
            self._record_history('deploy_staging', model_type, version, staging_slot.value, 'success', duration)
            
            logger.info(f"Successfully deployed {model_type}:{version} to {staging_slot.value}")
            return state
            
        except Exception as e:
            state.status = DeploymentStatus.FAILED.value
            state.health_status = 'unhealthy'
            state.error_message = str(e)
            
            self._deployments[model_type][staging_slot.value] = state
            self._save_state()
            
            duration = time.time() - start_time
            self._record_history('deploy_staging', model_type, version, staging_slot.value, 'failed', duration, str(e))
            
            logger.error(f"Failed to deploy {model_type}:{version}: {e}")
            raise
    
    def _simulate_deployment(
        self,
        model_type: str,
        version: str,
        slot: DeploymentSlot,
    ) -> None:
        """
        Simulate deployment to Azure ML endpoint.
        
        In production, this would:
        1. Create/update Azure ML online endpoint
        2. Deploy model to the endpoint
        3. Wait for deployment to be ready
        4. Run health checks
        """
        # Simulate deployment time
        time.sleep(0.1)
        
        # In production:
        # from azure.ai.ml import MLClient
        # from azure.ai.ml.entities import ManagedOnlineEndpoint, ManagedOnlineDeployment
        # 
        # ml_client = MLClient(...)
        # endpoint = ManagedOnlineEndpoint(name=f"{model_type}-{slot.value}")
        # ml_client.online_endpoints.begin_create_or_update(endpoint).result()
        # 
        # deployment = ManagedOnlineDeployment(
        #     name=version,
        #     endpoint_name=endpoint.name,
        #     model=f"azureml:{model_type}:{version}",
        #     instance_type="Standard_DS3_v2",
        #     instance_count=1,
        # )
        # ml_client.online_deployments.begin_create_or_update(deployment).result()
    
    def shift_traffic(
        self,
        model_type: str,
        blue_weight: float,
        green_weight: float,
        validate: bool = True,
    ) -> TrafficConfig:
        """
        Shift traffic between blue and green slots.
        
        @requirement 8.2 - Implement traffic shifting between versions
        
        Args:
            model_type: Type of model
            blue_weight: Traffic weight for blue slot (0-1)
            green_weight: Traffic weight for green slot (0-1)
            validate: Whether to validate weights sum to 1.0
            
        Returns:
            Updated TrafficConfig
        """
        logger.info(f"Shifting traffic for {model_type}: blue={blue_weight}, green={green_weight}")
        
        if validate and abs(blue_weight + green_weight - 1.0) > 0.001:
            raise ValueError("Traffic weights must sum to 1.0")
        
        if model_type not in self._deployments:
            raise ValueError(f"No deployments found for model type: {model_type}")
        
        # Update traffic config
        config = TrafficConfig(
            blue_weight=blue_weight,
            green_weight=green_weight,
            updated_at=datetime.utcnow().isoformat(),
        )
        self._traffic_configs[model_type] = config
        
        # Update deployment states
        if DeploymentSlot.BLUE.value in self._deployments[model_type]:
            self._deployments[model_type][DeploymentSlot.BLUE.value].traffic_weight = blue_weight
        if DeploymentSlot.GREEN.value in self._deployments[model_type]:
            self._deployments[model_type][DeploymentSlot.GREEN.value].traffic_weight = green_weight
        
        self._save_state()
        
        # In production, update Azure ML endpoint traffic
        # ml_client.online_endpoints.begin_create_or_update(
        #     ManagedOnlineEndpoint(
        #         name=f"{model_type}-endpoint",
        #         traffic={
        #             "blue": int(blue_weight * 100),
        #             "green": int(green_weight * 100),
        #         }
        #     )
        # ).result()
        
        return config
    
    def promote_to_production(
        self,
        model_type: str,
        gradual: bool = True,
        steps: int = 5,
        step_duration_seconds: float = 60,
    ) -> bool:
        """
        Promote staging slot to production with gradual traffic shift.
        
        @requirement 8.2 - Support blue-green deployment for model updates
        
        Args:
            model_type: Type of model
            gradual: Whether to shift traffic gradually
            steps: Number of steps for gradual shift
            step_duration_seconds: Duration between steps
            
        Returns:
            True if successful
        """
        start_time = time.time()
        logger.info(f"Promoting {model_type} staging to production")
        
        staging_slot = self._get_inactive_slot(model_type)
        production_slot = self._get_active_slot(model_type)
        
        if model_type not in self._deployments:
            raise ValueError(f"No deployments found for model type: {model_type}")
        
        staging_state = self._deployments[model_type].get(staging_slot.value)
        if not staging_state or staging_state.status != DeploymentStatus.ACTIVE.value:
            raise ValueError(f"No active staging deployment for {model_type}")
        
        try:
            if gradual:
                # Gradual traffic shift
                for i in range(1, steps + 1):
                    staging_weight = i / steps
                    production_weight = 1 - staging_weight
                    
                    if staging_slot == DeploymentSlot.BLUE:
                        self.shift_traffic(model_type, staging_weight, production_weight)
                    else:
                        self.shift_traffic(model_type, production_weight, staging_weight)
                    
                    logger.info(f"Traffic shift step {i}/{steps}: staging={staging_weight:.0%}")
                    
                    # In production, wait between steps
                    # time.sleep(step_duration_seconds)
            else:
                # Immediate switch
                if staging_slot == DeploymentSlot.BLUE:
                    self.shift_traffic(model_type, 1.0, 0.0)
                else:
                    self.shift_traffic(model_type, 0.0, 1.0)
            
            # Update deployment statuses
            staging_state.status = DeploymentStatus.ACTIVE.value
            if production_slot and production_slot.value in self._deployments[model_type]:
                self._deployments[model_type][production_slot.value].status = DeploymentStatus.DRAINING.value
            
            self._save_state()
            
            duration = time.time() - start_time
            self._record_history(
                'promote_production',
                model_type,
                staging_state.version or '',
                staging_slot.value,
                'success',
                duration,
            )
            
            logger.info(f"Successfully promoted {model_type} to production")
            return True
            
        except Exception as e:
            duration = time.time() - start_time
            self._record_history(
                'promote_production',
                model_type,
                staging_state.version or '',
                staging_slot.value,
                'failed',
                duration,
                str(e),
            )
            logger.error(f"Failed to promote {model_type}: {e}")
            raise
    
    def rollback(self, model_type: str) -> bool:
        """
        Rollback to the previous production deployment.
        
        @requirement 8.5 - Add rollback capability
        
        Args:
            model_type: Type of model
            
        Returns:
            True if successful
        """
        start_time = time.time()
        logger.info(f"Rolling back {model_type}")
        
        if model_type not in self._deployments:
            raise ValueError(f"No deployments found for model type: {model_type}")
        
        current_slot = self._get_active_slot(model_type)
        if not current_slot:
            raise ValueError(f"No active deployment to rollback from: {model_type}")
        
        # Determine rollback slot
        rollback_slot = (
            DeploymentSlot.GREEN if current_slot == DeploymentSlot.BLUE
            else DeploymentSlot.BLUE
        )
        
        rollback_state = self._deployments[model_type].get(rollback_slot.value)
        if not rollback_state or rollback_state.status not in [
            DeploymentStatus.ACTIVE.value,
            DeploymentStatus.DRAINING.value,
        ]:
            raise ValueError(f"No valid rollback target for {model_type}")
        
        try:
            # Immediate traffic switch for rollback
            if rollback_slot == DeploymentSlot.BLUE:
                self.shift_traffic(model_type, 1.0, 0.0)
            else:
                self.shift_traffic(model_type, 0.0, 1.0)
            
            # Update statuses
            rollback_state.status = DeploymentStatus.ACTIVE.value
            self._deployments[model_type][current_slot.value].status = DeploymentStatus.ROLLED_BACK.value
            
            self._save_state()
            
            duration = time.time() - start_time
            self._record_history(
                'rollback',
                model_type,
                rollback_state.version or '',
                rollback_slot.value,
                'success',
                duration,
            )
            
            logger.info(f"Successfully rolled back {model_type} to {rollback_slot.value}")
            return True
            
        except Exception as e:
            duration = time.time() - start_time
            self._record_history(
                'rollback',
                model_type,
                rollback_state.version or '',
                rollback_slot.value,
                'failed',
                duration,
                str(e),
            )
            logger.error(f"Failed to rollback {model_type}: {e}")
            raise
    
    def get_deployment_state(self, model_type: str) -> Dict[str, DeploymentState]:
        """
        Get current deployment state for a model type.
        
        Args:
            model_type: Type of model
            
        Returns:
            Dictionary of slot -> DeploymentState
        """
        return self._deployments.get(model_type, {})
    
    def get_traffic_config(self, model_type: str) -> Optional[TrafficConfig]:
        """
        Get current traffic configuration for a model type.
        
        Args:
            model_type: Type of model
            
        Returns:
            TrafficConfig or None
        """
        return self._traffic_configs.get(model_type)
    
    def get_active_version(self, model_type: str) -> Optional[str]:
        """
        Get the currently active (production) version for a model type.
        
        @requirement 8.3 - Log model version used for each recommendation
        
        Args:
            model_type: Type of model
            
        Returns:
            Version string or None
        """
        active_slot = self._get_active_slot(model_type)
        if active_slot and model_type in self._deployments:
            state = self._deployments[model_type].get(active_slot.value)
            if state:
                return state.version
        return None
    
    def health_check(self, model_type: str) -> Dict[str, str]:
        """
        Run health checks on all deployment slots.
        
        Args:
            model_type: Type of model
            
        Returns:
            Dictionary of slot -> health status
        """
        results = {}
        
        if model_type not in self._deployments:
            return results
        
        for slot, state in self._deployments[model_type].items():
            if state.status == DeploymentStatus.ACTIVE.value:
                # In production, would call health endpoint
                # response = requests.get(f"{state.endpoint_url}/health")
                # health = 'healthy' if response.status_code == 200 else 'unhealthy'
                health = 'healthy'  # Simulated
                
                state.health_status = health
                state.last_health_check = datetime.utcnow().isoformat()
                results[slot] = health
        
        self._save_state()
        return results
    
    def get_deployment_history(
        self,
        model_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[DeploymentHistory]:
        """
        Get deployment history.
        
        Args:
            model_type: Filter by model type
            limit: Maximum number of entries
            
        Returns:
            List of DeploymentHistory entries
        """
        history = self._history
        
        if model_type:
            history = [h for h in history if h.model_type == model_type]
        
        return history[-limit:]


# Singleton instance
_deployer_instance: Optional[BlueGreenDeployer] = None


def get_deployer(storage_path: str = './deployments') -> BlueGreenDeployer:
    """Get or create the deployer singleton."""
    global _deployer_instance
    if _deployer_instance is None:
        _deployer_instance = BlueGreenDeployer(storage_path)
    return _deployer_instance


def reset_deployer() -> None:
    """Reset the deployer singleton (for testing)."""
    global _deployer_instance
    _deployer_instance = None
