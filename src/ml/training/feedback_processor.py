"""
Feedback Processor for Model Retraining

Processes override data and job outcomes for incorporation into
model retraining pipelines.

@requirement 9.4 - Incorporate Human_Override data into model retraining pipelines
@requirement 9.5 - Maintain a feedback dataset of job outcomes for continuous learning
@property Property 18: Feedback Loop Incorporation
@tested tests/property/feedback-loop.property.test.ts

Usage:
    processor = FeedbackProcessor(storage_path='./feedback')
    processor.record_override(override_data)
    processor.record_outcome(outcome_data)
    training_data = processor.prepare_training_dataset()
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
import hashlib

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class FeedbackType(Enum):
    """Types of feedback data."""
    OVERRIDE = 'override'
    OUTCOME = 'outcome'
    RATING = 'rating'
    CORRECTION = 'correction'


class OverrideCategory(Enum):
    """Categories for override reasons."""
    PREFERENCE = 'preference'
    AVAILABILITY = 'availability'
    RELATIONSHIP = 'relationship'
    PERFORMANCE = 'performance'
    COST = 'cost'
    OTHER = 'other'


@dataclass
class OverrideRecord:
    """
    Record of a human override decision.
    
    @requirement 9.4 - Incorporate Human_Override data into model retraining
    """
    override_id: str
    job_id: str
    original_vendor_id: str
    selected_vendor_id: str
    operator_id: str
    override_reason: str
    override_category: str
    original_score: float
    selected_score: float
    confidence: float
    timestamp: str
    
    # Context at time of override
    job_type: Optional[str] = None
    urgency_level: Optional[str] = None
    customer_tier: Optional[str] = None
    
    # Metadata
    model_version: Optional[str] = None
    was_low_confidence: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'OverrideRecord':
        return cls(**data)


@dataclass
class OutcomeRecord:
    """
    Record of actual job outcome.
    
    @requirement 9.5 - Maintain feedback dataset of job outcomes
    """
    outcome_id: str
    job_id: str
    vendor_id: str
    
    # Outcome metrics
    completed_successfully: bool
    time_to_completion_hours: float
    required_rework: bool
    customer_satisfaction: Optional[float] = None
    
    # Prediction comparison
    predicted_completion_prob: Optional[float] = None
    predicted_time_to_complete: Optional[float] = None
    predicted_rework_risk: Optional[float] = None
    
    # Context
    was_ai_recommended: bool = True
    was_overridden: bool = False
    model_version: Optional[str] = None
    
    timestamp: str = ''
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'OutcomeRecord':
        return cls(**data)


@dataclass
class FeedbackDataset:
    """Dataset prepared for model retraining."""
    dataset_id: str
    created_at: str
    
    # Data counts
    total_samples: int
    override_samples: int
    outcome_samples: int
    
    # Data quality
    completeness_score: float
    recency_days: int
    
    # File paths
    features_path: str
    labels_path: str
    metadata_path: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FeedbackProcessor:
    """
    Processes feedback data for model retraining.
    
    Collects override decisions and job outcomes, then prepares
    them for incorporation into model training pipelines.
    
    @requirement 9.4 - Incorporate Human_Override data into model retraining pipelines
    @requirement 9.5 - Maintain a feedback dataset of job outcomes for continuous learning
    """
    
    OVERRIDES_FILE = 'overrides.json'
    OUTCOMES_FILE = 'outcomes.json'
    DATASETS_DIR = 'datasets'
    
    def __init__(self, storage_path: str):
        """
        Initialize the feedback processor.
        
        Args:
            storage_path: Path to store feedback data
        """
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._overrides: List[OverrideRecord] = []
        self._outcomes: List[OutcomeRecord] = []
        
        self._load_data()
        logger.info(f"Initialized feedback processor at: {storage_path}")
    
    def _load_data(self) -> None:
        """Load existing feedback data from disk."""
        # Load overrides
        overrides_path = self.storage_path / self.OVERRIDES_FILE
        if overrides_path.exists():
            with open(overrides_path, 'r') as f:
                data = json.load(f)
            self._overrides = [OverrideRecord.from_dict(o) for o in data]
            logger.info(f"Loaded {len(self._overrides)} override records")
        
        # Load outcomes
        outcomes_path = self.storage_path / self.OUTCOMES_FILE
        if outcomes_path.exists():
            with open(outcomes_path, 'r') as f:
                data = json.load(f)
            self._outcomes = [OutcomeRecord.from_dict(o) for o in data]
            logger.info(f"Loaded {len(self._outcomes)} outcome records")
    
    def _save_data(self) -> None:
        """Save feedback data to disk."""
        # Save overrides
        overrides_path = self.storage_path / self.OVERRIDES_FILE
        with open(overrides_path, 'w') as f:
            json.dump([o.to_dict() for o in self._overrides], f, indent=2)
        
        # Save outcomes
        outcomes_path = self.storage_path / self.OUTCOMES_FILE
        with open(outcomes_path, 'w') as f:
            json.dump([o.to_dict() for o in self._outcomes], f, indent=2)
    
    def record_override(
        self,
        job_id: str,
        original_vendor_id: str,
        selected_vendor_id: str,
        operator_id: str,
        override_reason: str,
        override_category: str,
        original_score: float,
        selected_score: float,
        confidence: float,
        job_type: Optional[str] = None,
        urgency_level: Optional[str] = None,
        customer_tier: Optional[str] = None,
        model_version: Optional[str] = None,
        was_low_confidence: bool = False,
    ) -> OverrideRecord:
        """
        Record a human override decision.
        
        @requirement 9.4 - Incorporate Human_Override data into model retraining
        
        Args:
            job_id: ID of the job
            original_vendor_id: AI-recommended vendor ID
            selected_vendor_id: Human-selected vendor ID
            operator_id: ID of the operator who made the override
            override_reason: Reason for the override
            override_category: Category of override
            original_score: Score of original recommendation
            selected_score: Score of selected vendor
            confidence: Confidence of original recommendation
            job_type: Type of job
            urgency_level: Urgency level
            customer_tier: Customer tier
            model_version: Model version used
            was_low_confidence: Whether recommendation was low confidence
            
        Returns:
            OverrideRecord
        """
        override = OverrideRecord(
            override_id=self._generate_id('override'),
            job_id=job_id,
            original_vendor_id=original_vendor_id,
            selected_vendor_id=selected_vendor_id,
            operator_id=operator_id,
            override_reason=override_reason,
            override_category=override_category,
            original_score=original_score,
            selected_score=selected_score,
            confidence=confidence,
            timestamp=datetime.utcnow().isoformat(),
            job_type=job_type,
            urgency_level=urgency_level,
            customer_tier=customer_tier,
            model_version=model_version,
            was_low_confidence=was_low_confidence,
        )
        
        self._overrides.append(override)
        self._save_data()
        
        logger.info(f"Recorded override: {override.override_id} for job {job_id}")
        return override
    
    def record_outcome(
        self,
        job_id: str,
        vendor_id: str,
        completed_successfully: bool,
        time_to_completion_hours: float,
        required_rework: bool,
        customer_satisfaction: Optional[float] = None,
        predicted_completion_prob: Optional[float] = None,
        predicted_time_to_complete: Optional[float] = None,
        predicted_rework_risk: Optional[float] = None,
        was_ai_recommended: bool = True,
        was_overridden: bool = False,
        model_version: Optional[str] = None,
    ) -> OutcomeRecord:
        """
        Record actual job outcome.
        
        @requirement 9.5 - Maintain feedback dataset of job outcomes
        
        Args:
            job_id: ID of the job
            vendor_id: ID of the vendor who completed the job
            completed_successfully: Whether job was completed successfully
            time_to_completion_hours: Actual time to complete
            required_rework: Whether rework was required
            customer_satisfaction: Customer satisfaction rating (0-5)
            predicted_completion_prob: Predicted completion probability
            predicted_time_to_complete: Predicted time to complete
            predicted_rework_risk: Predicted rework risk
            was_ai_recommended: Whether vendor was AI recommended
            was_overridden: Whether recommendation was overridden
            model_version: Model version used for prediction
            
        Returns:
            OutcomeRecord
        """
        outcome = OutcomeRecord(
            outcome_id=self._generate_id('outcome'),
            job_id=job_id,
            vendor_id=vendor_id,
            completed_successfully=completed_successfully,
            time_to_completion_hours=time_to_completion_hours,
            required_rework=required_rework,
            customer_satisfaction=customer_satisfaction,
            predicted_completion_prob=predicted_completion_prob,
            predicted_time_to_complete=predicted_time_to_complete,
            predicted_rework_risk=predicted_rework_risk,
            was_ai_recommended=was_ai_recommended,
            was_overridden=was_overridden,
            model_version=model_version,
            timestamp=datetime.utcnow().isoformat(),
        )
        
        self._outcomes.append(outcome)
        self._save_data()
        
        logger.info(f"Recorded outcome: {outcome.outcome_id} for job {job_id}")
        return outcome
    
    def prepare_training_dataset(
        self,
        include_overrides: bool = True,
        include_outcomes: bool = True,
        min_recency_days: int = 90,
        output_dir: Optional[str] = None,
    ) -> FeedbackDataset:
        """
        Prepare a training dataset from feedback data.
        
        @requirement 9.4 - Incorporate override data into retraining
        @requirement 9.5 - Maintain feedback dataset for continuous learning
        @property Property 18: Feedback Loop Incorporation
        
        Args:
            include_overrides: Whether to include override data
            include_outcomes: Whether to include outcome data
            min_recency_days: Only include data from last N days
            output_dir: Directory to save dataset files
            
        Returns:
            FeedbackDataset with paths to prepared data
        """
        logger.info("Preparing training dataset from feedback data")
        
        # Filter by recency
        cutoff_date = datetime.utcnow() - timedelta(days=min_recency_days)
        cutoff_str = cutoff_date.isoformat()
        
        # Prepare output directory
        if output_dir:
            dataset_dir = Path(output_dir)
        else:
            dataset_id = f"dataset_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
            dataset_dir = self.storage_path / self.DATASETS_DIR / dataset_id
        
        dataset_dir.mkdir(parents=True, exist_ok=True)
        
        # Collect training samples
        samples = []
        override_count = 0
        outcome_count = 0
        
        # Process overrides
        if include_overrides:
            for override in self._overrides:
                if override.timestamp >= cutoff_str:
                    sample = self._override_to_training_sample(override)
                    if sample:
                        samples.append(sample)
                        override_count += 1
        
        # Process outcomes
        if include_outcomes:
            for outcome in self._outcomes:
                if outcome.timestamp >= cutoff_str:
                    sample = self._outcome_to_training_sample(outcome)
                    if sample:
                        samples.append(sample)
                        outcome_count += 1
        
        if not samples:
            logger.warning("No samples found for training dataset")
            return FeedbackDataset(
                dataset_id=dataset_dir.name,
                created_at=datetime.utcnow().isoformat(),
                total_samples=0,
                override_samples=0,
                outcome_samples=0,
                completeness_score=0.0,
                recency_days=min_recency_days,
                features_path='',
                labels_path='',
                metadata_path='',
            )
        
        # Convert to DataFrame
        df = pd.DataFrame(samples)
        
        # Separate features and labels
        label_columns = ['target_completion', 'target_time', 'target_rework']
        feature_columns = [c for c in df.columns if c not in label_columns and c != 'job_id']
        
        features_df = df[feature_columns]
        labels_df = df[[c for c in label_columns if c in df.columns]]
        
        # Save to files
        features_path = dataset_dir / 'features.parquet'
        labels_path = dataset_dir / 'labels.parquet'
        metadata_path = dataset_dir / 'metadata.json'
        
        features_df.to_parquet(features_path, index=False)
        labels_df.to_parquet(labels_path, index=False)
        
        # Calculate completeness score
        completeness = 1.0 - (df.isna().sum().sum() / (len(df) * len(df.columns)))
        
        # Create dataset metadata
        dataset = FeedbackDataset(
            dataset_id=dataset_dir.name,
            created_at=datetime.utcnow().isoformat(),
            total_samples=len(samples),
            override_samples=override_count,
            outcome_samples=outcome_count,
            completeness_score=float(completeness),
            recency_days=min_recency_days,
            features_path=str(features_path),
            labels_path=str(labels_path),
            metadata_path=str(metadata_path),
        )
        
        # Save metadata
        with open(metadata_path, 'w') as f:
            json.dump(dataset.to_dict(), f, indent=2)
        
        logger.info(f"Prepared dataset with {len(samples)} samples ({override_count} overrides, {outcome_count} outcomes)")
        return dataset
    
    def _override_to_training_sample(self, override: OverrideRecord) -> Optional[Dict[str, Any]]:
        """
        Convert an override record to a training sample.
        
        Override data is valuable because it indicates where the model
        was wrong or where human judgment differed.
        """
        # The override indicates the selected vendor was preferred
        # This can be used to adjust model weights
        return {
            'job_id': override.job_id,
            'vendor_id': override.selected_vendor_id,
            'original_score': override.original_score,
            'selected_score': override.selected_score,
            'confidence': override.confidence,
            'override_category': override.override_category,
            'was_low_confidence': 1 if override.was_low_confidence else 0,
            # Target: the selected vendor should have scored higher
            'target_completion': 1.0,  # Assume override was correct
            'target_time': None,  # Unknown
            'target_rework': 0.0,  # Assume no rework expected
            'sample_weight': 2.0,  # Weight overrides higher
        }
    
    def _outcome_to_training_sample(self, outcome: OutcomeRecord) -> Optional[Dict[str, Any]]:
        """
        Convert an outcome record to a training sample.
        
        Outcome data provides ground truth for model predictions.
        """
        return {
            'job_id': outcome.job_id,
            'vendor_id': outcome.vendor_id,
            'predicted_completion_prob': outcome.predicted_completion_prob,
            'predicted_time_to_complete': outcome.predicted_time_to_complete,
            'predicted_rework_risk': outcome.predicted_rework_risk,
            'was_ai_recommended': 1 if outcome.was_ai_recommended else 0,
            'was_overridden': 1 if outcome.was_overridden else 0,
            # Targets: actual outcomes
            'target_completion': 1.0 if outcome.completed_successfully else 0.0,
            'target_time': outcome.time_to_completion_hours,
            'target_rework': 1.0 if outcome.required_rework else 0.0,
            'sample_weight': 1.0,
        }
    
    def get_override_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about override patterns.
        
        Useful for understanding where the model needs improvement.
        """
        if not self._overrides:
            return {'total_overrides': 0}
        
        df = pd.DataFrame([o.to_dict() for o in self._overrides])
        
        stats = {
            'total_overrides': len(df),
            'by_category': df['override_category'].value_counts().to_dict(),
            'avg_original_score': float(df['original_score'].mean()),
            'avg_selected_score': float(df['selected_score'].mean()),
            'avg_confidence': float(df['confidence'].mean()),
            'low_confidence_rate': float(df['was_low_confidence'].mean()),
        }
        
        if 'job_type' in df.columns:
            stats['by_job_type'] = df['job_type'].value_counts().to_dict()
        
        return stats
    
    def get_outcome_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about job outcomes.
        
        Useful for monitoring model accuracy.
        """
        if not self._outcomes:
            return {'total_outcomes': 0}
        
        df = pd.DataFrame([o.to_dict() for o in self._outcomes])
        
        stats = {
            'total_outcomes': len(df),
            'completion_rate': float(df['completed_successfully'].mean()),
            'rework_rate': float(df['required_rework'].mean()),
            'avg_time_to_completion': float(df['time_to_completion_hours'].mean()),
            'ai_recommended_rate': float(df['was_ai_recommended'].mean()),
            'override_rate': float(df['was_overridden'].mean()),
        }
        
        if df['customer_satisfaction'].notna().any():
            stats['avg_satisfaction'] = float(df['customer_satisfaction'].mean())
        
        return stats
    
    def get_prediction_accuracy(self) -> Dict[str, float]:
        """
        Calculate prediction accuracy by comparing predictions to outcomes.
        
        @requirement 9.1 - Monitor prediction accuracy against actual job outcomes
        """
        outcomes_with_predictions = [
            o for o in self._outcomes
            if o.predicted_completion_prob is not None
        ]
        
        if not outcomes_with_predictions:
            return {}
        
        df = pd.DataFrame([o.to_dict() for o in outcomes_with_predictions])
        
        accuracy = {}
        
        # Completion prediction accuracy
        if 'predicted_completion_prob' in df.columns:
            predicted = df['predicted_completion_prob'] > 0.5
            actual = df['completed_successfully']
            accuracy['completion_accuracy'] = float((predicted == actual).mean())
        
        # Time prediction MAE
        if 'predicted_time_to_complete' in df.columns:
            mask = df['predicted_time_to_complete'].notna()
            if mask.any():
                mae = abs(
                    df.loc[mask, 'predicted_time_to_complete'] -
                    df.loc[mask, 'time_to_completion_hours']
                ).mean()
                accuracy['time_mae_hours'] = float(mae)
        
        # Rework prediction accuracy
        if 'predicted_rework_risk' in df.columns:
            mask = df['predicted_rework_risk'].notna()
            if mask.any():
                predicted = df.loc[mask, 'predicted_rework_risk'] > 0.5
                actual = df.loc[mask, 'required_rework']
                accuracy['rework_accuracy'] = float((predicted == actual).mean())
        
        return accuracy
    
    def merge_with_training_data(
        self,
        existing_data_path: str,
        output_path: str,
        feedback_weight: float = 1.0,
    ) -> str:
        """
        Merge feedback data with existing training data.
        
        @requirement 9.4 - Merge feedback with outcome data
        
        Args:
            existing_data_path: Path to existing training data
            output_path: Path to save merged data
            feedback_weight: Weight multiplier for feedback samples
            
        Returns:
            Path to merged dataset
        """
        logger.info(f"Merging feedback with existing data: {existing_data_path}")
        
        # Load existing data
        if existing_data_path.endswith('.parquet'):
            existing_df = pd.read_parquet(existing_data_path)
        elif existing_data_path.endswith('.csv'):
            existing_df = pd.read_csv(existing_data_path)
        else:
            raise ValueError(f"Unsupported file format: {existing_data_path}")
        
        # Prepare feedback dataset
        feedback_dataset = self.prepare_training_dataset()
        
        if feedback_dataset.total_samples == 0:
            logger.warning("No feedback data to merge")
            return existing_data_path
        
        # Load feedback features
        feedback_df = pd.read_parquet(feedback_dataset.features_path)
        
        # Apply weight
        if 'sample_weight' in feedback_df.columns:
            feedback_df['sample_weight'] *= feedback_weight
        else:
            feedback_df['sample_weight'] = feedback_weight
        
        # Ensure existing data has sample_weight
        if 'sample_weight' not in existing_df.columns:
            existing_df['sample_weight'] = 1.0
        
        # Merge datasets
        merged_df = pd.concat([existing_df, feedback_df], ignore_index=True)
        
        # Save merged data
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        if str(output_path).endswith('.parquet'):
            merged_df.to_parquet(output_path, index=False)
        else:
            merged_df.to_csv(output_path, index=False)
        
        logger.info(f"Merged dataset saved to: {output_path} ({len(merged_df)} samples)")
        return str(output_path)
    
    def _generate_id(self, prefix: str) -> str:
        """Generate a unique ID."""
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S%f')
        hash_input = f"{prefix}_{timestamp}"
        return f"{prefix}_{hashlib.md5(hash_input.encode()).hexdigest()[:12]}"
    
    def get_overrides(
        self,
        job_id: Optional[str] = None,
        operator_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 100,
    ) -> List[OverrideRecord]:
        """Get override records with optional filtering."""
        overrides = self._overrides
        
        if job_id:
            overrides = [o for o in overrides if o.job_id == job_id]
        if operator_id:
            overrides = [o for o in overrides if o.operator_id == operator_id]
        if category:
            overrides = [o for o in overrides if o.override_category == category]
        
        return overrides[-limit:]
    
    def get_outcomes(
        self,
        job_id: Optional[str] = None,
        vendor_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[OutcomeRecord]:
        """Get outcome records with optional filtering."""
        outcomes = self._outcomes
        
        if job_id:
            outcomes = [o for o in outcomes if o.job_id == job_id]
        if vendor_id:
            outcomes = [o for o in outcomes if o.vendor_id == vendor_id]
        
        return outcomes[-limit:]


# Singleton instance
_processor_instance: Optional[FeedbackProcessor] = None


def get_feedback_processor(storage_path: str = './feedback') -> FeedbackProcessor:
    """Get or create the feedback processor singleton."""
    global _processor_instance
    if _processor_instance is None:
        _processor_instance = FeedbackProcessor(storage_path)
    return _processor_instance


def reset_feedback_processor() -> None:
    """Reset the feedback processor singleton (for testing)."""
    global _processor_instance
    _processor_instance = None
