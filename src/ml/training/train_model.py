"""
ML Training Pipeline for Vendor Scoring Model

Trains a gradient boosting model for predicting vendor job completion probability,
time-to-completion, and rework risk based on historical job outcomes.

@requirement 8.1 - Model versioning and lifecycle management
@requirement 9.6 - Scheduled and triggered model retraining
@property Property 16: Prediction Accuracy Monitoring
@tested tests/property/prediction-accuracy.property.test.ts

Usage:
    python train_model.py --config config.yaml
    python train_model.py --data-path ./data --output-path ./models
"""

import os
import json
import logging
import argparse
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import pickle

# ML Libraries
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    r2_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler, LabelEncoder

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class ModelMetrics:
    """Metrics for model evaluation."""
    # Classification metrics (for completion prediction)
    accuracy: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    roc_auc: float = 0.0
    
    # Regression metrics (for time prediction)
    mse: float = 0.0
    mae: float = 0.0
    r2: float = 0.0
    
    # Sample info
    train_samples: int = 0
    test_samples: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ModelArtifact:
    """Model artifact with metadata."""
    model_version: str
    model_type: str
    trained_at: str
    metrics: ModelMetrics
    feature_names: List[str]
    hyperparameters: Dict[str, Any]
    training_data_hash: str
    
    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result['metrics'] = self.metrics.to_dict()
        return result


class VendorScoringTrainer:
    """
    Trainer for vendor scoring ML models.
    
    Trains three models:
    1. Completion probability classifier
    2. Time-to-completion regressor
    3. Rework risk classifier
    
    @requirement 8.1 - Model versioning and lifecycle management
    @requirement 9.6 - Scheduled and triggered model retraining
    """
    
    # Feature columns used for training
    FEATURE_COLUMNS = [
        # Job features
        'job_type_encoded',
        'urgency_level_encoded',
        'customer_tier_encoded',
        'required_cert_count',
        'special_requirement_count',
        'hours_until_sla',
        
        # Vendor features
        'vendor_capacity_utilization',
        'vendor_cert_count',
        'vendor_specialization_count',
        'vendor_service_area_count',
        
        # Historical performance features
        'historical_completion_rate',
        'historical_rework_rate',
        'historical_avg_response_time',
        'historical_avg_satisfaction',
        
        # Match features
        'certification_match_ratio',
        'is_in_service_area',
    ]
    
    # Target columns
    TARGET_COMPLETION = 'job_completed_successfully'
    TARGET_TIME = 'time_to_completion_hours'
    TARGET_REWORK = 'required_rework'
    
    def __init__(
        self,
        model_version: Optional[str] = None,
        random_state: int = 42,
        test_size: float = 0.2,
    ):
        """
        Initialize the trainer.
        
        Args:
            model_version: Version string for the model (auto-generated if None)
            random_state: Random seed for reproducibility
            test_size: Fraction of data to use for testing
        """
        self.model_version = model_version or self._generate_version()
        self.random_state = random_state
        self.test_size = test_size
        
        # Models
        self.completion_model: Optional[GradientBoostingClassifier] = None
        self.time_model: Optional[GradientBoostingRegressor] = None
        self.rework_model: Optional[GradientBoostingClassifier] = None
        
        # Preprocessing
        self.scaler = StandardScaler()
        self.label_encoders: Dict[str, LabelEncoder] = {}
        
        # Metrics
        self.completion_metrics: Optional[ModelMetrics] = None
        self.time_metrics: Optional[ModelMetrics] = None
        self.rework_metrics: Optional[ModelMetrics] = None
        
        logger.info(f"Initialized trainer with version: {self.model_version}")
    
    def _generate_version(self) -> str:
        """Generate a version string based on timestamp."""
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        return f"v{timestamp}"
    
    def load_training_data(self, data_path: str) -> pd.DataFrame:
        """
        Load training data from Azure SQL (job outcomes).
        
        In production, this would connect to Azure SQL.
        For local development, loads from CSV/JSON files.
        
        @requirement 8.1 - Load training data from Azure SQL (job outcomes)
        
        Args:
            data_path: Path to training data file or connection string
            
        Returns:
            DataFrame with training data
        """
        logger.info(f"Loading training data from: {data_path}")
        
        if data_path.startswith('mssql://') or data_path.startswith('Server='):
            # Azure SQL connection
            return self._load_from_azure_sql(data_path)
        elif data_path.endswith('.csv'):
            return pd.read_csv(data_path)
        elif data_path.endswith('.json'):
            return pd.read_json(data_path)
        elif data_path.endswith('.parquet'):
            return pd.read_parquet(data_path)
        else:
            # Try to load as CSV by default
            return pd.read_csv(data_path)
    
    def _load_from_azure_sql(self, connection_string: str) -> pd.DataFrame:
        """
        Load data from Azure SQL database.
        
        @requirement 8.1 - Load training data from Azure SQL
        """
        try:
            import pyodbc
            
            query = """
            SELECT 
                jo.JobId,
                jo.VendorId,
                jo.CompletionStatus,
                jo.TimeToCompletionHours,
                jo.RequiredRework,
                jo.CustomerSatisfaction,
                jo.WasAIRecommended,
                jo.WasOverridden,
                -- Join with job details
                j.JobType,
                j.UrgencyLevel,
                j.CustomerTier,
                j.RequiredCertCount,
                j.SpecialRequirementCount,
                j.HoursUntilSla,
                -- Join with vendor metrics
                vm.CompletionRate as HistoricalCompletionRate,
                vm.ReworkRate as HistoricalReworkRate,
                vm.AvgResponseTimeHours as HistoricalAvgResponseTime,
                vm.AvgCustomerSatisfaction as HistoricalAvgSatisfaction,
                -- Vendor features
                v.CapacityUtilization as VendorCapacityUtilization,
                v.CertCount as VendorCertCount,
                v.SpecializationCount as VendorSpecializationCount,
                v.ServiceAreaCount as VendorServiceAreaCount,
                -- Match features
                m.CertificationMatchRatio,
                m.IsInServiceArea
            FROM JobOutcome jo
            JOIN Jobs j ON jo.JobId = j.JobId
            JOIN VendorMetrics vm ON jo.VendorId = vm.VendorId
            JOIN Vendors v ON jo.VendorId = v.VendorId
            JOIN JobVendorMatch m ON jo.JobId = m.JobId AND jo.VendorId = m.VendorId
            WHERE jo.CompletedAt IS NOT NULL
            ORDER BY jo.CompletedAt DESC
            """
            
            conn = pyodbc.connect(connection_string)
            df = pd.read_sql(query, conn)
            conn.close()
            
            logger.info(f"Loaded {len(df)} records from Azure SQL")
            return df
            
        except ImportError:
            logger.warning("pyodbc not installed, using mock data")
            return self._generate_mock_data()
        except Exception as e:
            logger.error(f"Failed to load from Azure SQL: {e}")
            raise
    
    def _generate_mock_data(self, n_samples: int = 1000) -> pd.DataFrame:
        """Generate mock training data for development/testing."""
        np.random.seed(self.random_state)
        
        data = {
            'job_type_encoded': np.random.randint(0, 4, n_samples),
            'urgency_level_encoded': np.random.randint(0, 4, n_samples),
            'customer_tier_encoded': np.random.randint(0, 3, n_samples),
            'required_cert_count': np.random.randint(0, 5, n_samples),
            'special_requirement_count': np.random.randint(0, 3, n_samples),
            'hours_until_sla': np.random.uniform(1, 72, n_samples),
            'vendor_capacity_utilization': np.random.uniform(0, 1, n_samples),
            'vendor_cert_count': np.random.randint(0, 10, n_samples),
            'vendor_specialization_count': np.random.randint(0, 5, n_samples),
            'vendor_service_area_count': np.random.randint(1, 10, n_samples),
            'historical_completion_rate': np.random.uniform(0.5, 1.0, n_samples),
            'historical_rework_rate': np.random.uniform(0, 0.3, n_samples),
            'historical_avg_response_time': np.random.uniform(1, 24, n_samples),
            'historical_avg_satisfaction': np.random.uniform(2.5, 5.0, n_samples),
            'certification_match_ratio': np.random.uniform(0, 1, n_samples),
            'is_in_service_area': np.random.randint(0, 2, n_samples),
        }
        
        df = pd.DataFrame(data)
        
        # Generate targets based on features (with some noise)
        completion_prob = (
            0.3 * df['historical_completion_rate'] +
            0.2 * df['certification_match_ratio'] +
            0.2 * df['is_in_service_area'] +
            0.15 * (1 - df['vendor_capacity_utilization']) +
            0.15 * (df['historical_avg_satisfaction'] / 5)
        )
        df['job_completed_successfully'] = (completion_prob + np.random.normal(0, 0.1, n_samples) > 0.5).astype(int)
        
        # Time to completion
        df['time_to_completion_hours'] = (
            df['historical_avg_response_time'] * 0.5 +
            df['hours_until_sla'] * 0.1 +
            np.random.uniform(1, 8, n_samples)
        )
        
        # Rework probability
        rework_prob = df['historical_rework_rate'] + np.random.normal(0, 0.05, n_samples)
        df['required_rework'] = (rework_prob > 0.15).astype(int)
        
        return df
    
    def preprocess_data(self, df: pd.DataFrame) -> Tuple[np.ndarray, Dict[str, np.ndarray]]:
        """
        Preprocess training data.
        
        Args:
            df: Raw training DataFrame
            
        Returns:
            Tuple of (features, targets_dict)
        """
        logger.info("Preprocessing training data...")
        
        # Ensure all feature columns exist
        missing_cols = set(self.FEATURE_COLUMNS) - set(df.columns)
        if missing_cols:
            logger.warning(f"Missing columns, filling with defaults: {missing_cols}")
            for col in missing_cols:
                df[col] = 0
        
        # Extract features
        X = df[self.FEATURE_COLUMNS].values
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Extract targets
        targets = {}
        if self.TARGET_COMPLETION in df.columns:
            targets['completion'] = df[self.TARGET_COMPLETION].values
        if self.TARGET_TIME in df.columns:
            targets['time'] = df[self.TARGET_TIME].values
        if self.TARGET_REWORK in df.columns:
            targets['rework'] = df[self.TARGET_REWORK].values
        
        logger.info(f"Preprocessed {len(X)} samples with {len(self.FEATURE_COLUMNS)} features")
        return X_scaled, targets
    
    def train(
        self,
        X: np.ndarray,
        targets: Dict[str, np.ndarray],
        hyperparameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, ModelMetrics]:
        """
        Train all models.
        
        @requirement 8.1 - Train gradient boosting model for completion prediction
        
        Args:
            X: Feature matrix
            targets: Dictionary of target arrays
            hyperparameters: Optional hyperparameters for models
            
        Returns:
            Dictionary of metrics for each model
        """
        logger.info("Starting model training...")
        
        # Default hyperparameters
        default_params = {
            'n_estimators': 100,
            'max_depth': 5,
            'learning_rate': 0.1,
            'min_samples_split': 10,
            'min_samples_leaf': 5,
            'random_state': self.random_state,
        }
        params = {**default_params, **(hyperparameters or {})}
        
        metrics = {}
        
        # Train completion model
        if 'completion' in targets:
            logger.info("Training completion probability model...")
            self.completion_model, self.completion_metrics = self._train_classifier(
                X, targets['completion'], params, 'completion'
            )
            metrics['completion'] = self.completion_metrics
        
        # Train time model
        if 'time' in targets:
            logger.info("Training time-to-completion model...")
            self.time_model, self.time_metrics = self._train_regressor(
                X, targets['time'], params, 'time'
            )
            metrics['time'] = self.time_metrics
        
        # Train rework model
        if 'rework' in targets:
            logger.info("Training rework risk model...")
            self.rework_model, self.rework_metrics = self._train_classifier(
                X, targets['rework'], params, 'rework'
            )
            metrics['rework'] = self.rework_metrics
        
        logger.info("Model training complete")
        return metrics
    
    def _train_classifier(
        self,
        X: np.ndarray,
        y: np.ndarray,
        params: Dict[str, Any],
        model_name: str,
    ) -> Tuple[GradientBoostingClassifier, ModelMetrics]:
        """Train a classification model."""
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=self.test_size, random_state=self.random_state
        )
        
        # Train model
        model = GradientBoostingClassifier(**params)
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1] if len(model.classes_) == 2 else None
        
        metrics = ModelMetrics(
            accuracy=accuracy_score(y_test, y_pred),
            precision=precision_score(y_test, y_pred, zero_division=0),
            recall=recall_score(y_test, y_pred, zero_division=0),
            f1=f1_score(y_test, y_pred, zero_division=0),
            roc_auc=roc_auc_score(y_test, y_prob) if y_prob is not None else 0.0,
            train_samples=len(X_train),
            test_samples=len(X_test),
        )
        
        logger.info(f"{model_name} model - Accuracy: {metrics.accuracy:.4f}, F1: {metrics.f1:.4f}")
        return model, metrics
    
    def _train_regressor(
        self,
        X: np.ndarray,
        y: np.ndarray,
        params: Dict[str, Any],
        model_name: str,
    ) -> Tuple[GradientBoostingRegressor, ModelMetrics]:
        """Train a regression model."""
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=self.test_size, random_state=self.random_state
        )
        
        # Train model
        model = GradientBoostingRegressor(**params)
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        
        metrics = ModelMetrics(
            mse=mean_squared_error(y_test, y_pred),
            mae=mean_absolute_error(y_test, y_pred),
            r2=r2_score(y_test, y_pred),
            train_samples=len(X_train),
            test_samples=len(X_test),
        )
        
        logger.info(f"{model_name} model - MSE: {metrics.mse:.4f}, R2: {metrics.r2:.4f}")
        return model, metrics
    
    def save_models(self, output_path: str) -> Dict[str, str]:
        """
        Save model artifacts to Azure ML registry.
        
        In production, this would register models with Azure ML.
        For local development, saves to filesystem.
        
        @requirement 8.1 - Save model artifacts to Azure ML registry
        
        Args:
            output_path: Path to save models (or Azure ML workspace connection)
            
        Returns:
            Dictionary of saved model paths
        """
        logger.info(f"Saving models to: {output_path}")
        
        os.makedirs(output_path, exist_ok=True)
        saved_paths = {}
        
        # Save completion model
        if self.completion_model:
            path = os.path.join(output_path, f'completion_model_{self.model_version}.pkl')
            with open(path, 'wb') as f:
                pickle.dump(self.completion_model, f)
            saved_paths['completion'] = path
            
            # Save metadata
            artifact = ModelArtifact(
                model_version=self.model_version,
                model_type='GradientBoostingClassifier',
                trained_at=datetime.utcnow().isoformat(),
                metrics=self.completion_metrics or ModelMetrics(),
                feature_names=self.FEATURE_COLUMNS,
                hyperparameters=self.completion_model.get_params(),
                training_data_hash='',  # Would be computed from actual data
            )
            meta_path = os.path.join(output_path, f'completion_model_{self.model_version}_meta.json')
            with open(meta_path, 'w') as f:
                json.dump(artifact.to_dict(), f, indent=2)
        
        # Save time model
        if self.time_model:
            path = os.path.join(output_path, f'time_model_{self.model_version}.pkl')
            with open(path, 'wb') as f:
                pickle.dump(self.time_model, f)
            saved_paths['time'] = path
            
            artifact = ModelArtifact(
                model_version=self.model_version,
                model_type='GradientBoostingRegressor',
                trained_at=datetime.utcnow().isoformat(),
                metrics=self.time_metrics or ModelMetrics(),
                feature_names=self.FEATURE_COLUMNS,
                hyperparameters=self.time_model.get_params(),
                training_data_hash='',
            )
            meta_path = os.path.join(output_path, f'time_model_{self.model_version}_meta.json')
            with open(meta_path, 'w') as f:
                json.dump(artifact.to_dict(), f, indent=2)
        
        # Save rework model
        if self.rework_model:
            path = os.path.join(output_path, f'rework_model_{self.model_version}.pkl')
            with open(path, 'wb') as f:
                pickle.dump(self.rework_model, f)
            saved_paths['rework'] = path
            
            artifact = ModelArtifact(
                model_version=self.model_version,
                model_type='GradientBoostingClassifier',
                trained_at=datetime.utcnow().isoformat(),
                metrics=self.rework_metrics or ModelMetrics(),
                feature_names=self.FEATURE_COLUMNS,
                hyperparameters=self.rework_model.get_params(),
                training_data_hash='',
            )
            meta_path = os.path.join(output_path, f'rework_model_{self.model_version}_meta.json')
            with open(meta_path, 'w') as f:
                json.dump(artifact.to_dict(), f, indent=2)
        
        # Save scaler
        scaler_path = os.path.join(output_path, f'scaler_{self.model_version}.pkl')
        with open(scaler_path, 'wb') as f:
            pickle.dump(self.scaler, f)
        saved_paths['scaler'] = scaler_path
        
        logger.info(f"Saved {len(saved_paths)} model artifacts")
        return saved_paths


def main():
    """Main entry point for training pipeline."""
    parser = argparse.ArgumentParser(description='Train vendor scoring ML models')
    parser.add_argument('--data-path', type=str, default='./data/training_data.csv',
                        help='Path to training data')
    parser.add_argument('--output-path', type=str, default='./models',
                        help='Path to save trained models')
    parser.add_argument('--model-version', type=str, default=None,
                        help='Model version string')
    parser.add_argument('--use-mock-data', action='store_true',
                        help='Use mock data for training')
    
    args = parser.parse_args()
    
    # Initialize trainer
    trainer = VendorScoringTrainer(model_version=args.model_version)
    
    # Load data
    if args.use_mock_data:
        logger.info("Using mock training data")
        df = trainer._generate_mock_data(n_samples=5000)
    else:
        df = trainer.load_training_data(args.data_path)
    
    # Preprocess
    X, targets = trainer.preprocess_data(df)
    
    # Train
    metrics = trainer.train(X, targets)
    
    # Save
    saved_paths = trainer.save_models(args.output_path)
    
    # Print summary
    print("\n" + "="*50)
    print("Training Complete")
    print("="*50)
    print(f"Model Version: {trainer.model_version}")
    print(f"Training Samples: {len(df)}")
    print("\nMetrics:")
    for name, m in metrics.items():
        print(f"  {name}:")
        if m.accuracy > 0:
            print(f"    Accuracy: {m.accuracy:.4f}")
            print(f"    F1 Score: {m.f1:.4f}")
        if m.r2 != 0:
            print(f"    R2 Score: {m.r2:.4f}")
            print(f"    MAE: {m.mae:.4f}")
    print("\nSaved Models:")
    for name, path in saved_paths.items():
        print(f"  {name}: {path}")


if __name__ == '__main__':
    main()
