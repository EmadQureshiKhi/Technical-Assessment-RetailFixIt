"""
Drift Detection for ML Models

Monitors feature distributions and model performance to detect
data drift and model degradation.

@requirement 9.1 - Monitor prediction accuracy against actual job outcomes
@requirement 9.2 - Detect statistical drift in input feature distributions
@property Property 17: Drift Detection Alerting
@tested tests/property/drift-detection.property.test.ts

Usage:
    detector = DriftDetector(baseline_stats)
    drift_result = detector.detect_drift(current_data)
    if drift_result.has_drift:
        alert_ml_engineers(drift_result)
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
import math

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class DriftSeverity(Enum):
    """Severity levels for drift detection."""
    NONE = 'none'
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


class DriftType(Enum):
    """Types of drift detected."""
    FEATURE_DRIFT = 'feature_drift'
    CONCEPT_DRIFT = 'concept_drift'
    PREDICTION_DRIFT = 'prediction_drift'
    LABEL_DRIFT = 'label_drift'


@dataclass
class FeatureStatistics:
    """Statistics for a single feature."""
    name: str
    mean: float
    std: float
    min_val: float
    max_val: float
    median: float
    q1: float
    q3: float
    missing_rate: float
    unique_count: int
    histogram_bins: List[float] = field(default_factory=list)
    histogram_counts: List[int] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'FeatureStatistics':
        return cls(**data)
    
    @classmethod
    def from_series(cls, name: str, series: pd.Series, n_bins: int = 20) -> 'FeatureStatistics':
        """Compute statistics from a pandas Series."""
        clean_series = series.dropna()
        
        if len(clean_series) == 0:
            return cls(
                name=name,
                mean=0.0,
                std=0.0,
                min_val=0.0,
                max_val=0.0,
                median=0.0,
                q1=0.0,
                q3=0.0,
                missing_rate=1.0,
                unique_count=0,
            )
        
        # Compute histogram
        hist_counts, hist_bins = np.histogram(clean_series, bins=n_bins)
        
        return cls(
            name=name,
            mean=float(clean_series.mean()),
            std=float(clean_series.std()),
            min_val=float(clean_series.min()),
            max_val=float(clean_series.max()),
            median=float(clean_series.median()),
            q1=float(clean_series.quantile(0.25)),
            q3=float(clean_series.quantile(0.75)),
            missing_rate=float(series.isna().mean()),
            unique_count=int(clean_series.nunique()),
            histogram_bins=hist_bins.tolist(),
            histogram_counts=hist_counts.tolist(),
        )


@dataclass
class DriftResult:
    """Result of drift detection for a single feature."""
    feature_name: str
    drift_type: str
    drift_score: float
    threshold: float
    has_drift: bool
    severity: str
    baseline_stats: Dict[str, float]
    current_stats: Dict[str, float]
    details: str = ''
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DriftReport:
    """Complete drift detection report."""
    report_id: str
    generated_at: str
    model_type: str
    model_version: str
    
    # Overall drift status
    has_drift: bool
    overall_severity: str
    drift_score: float
    
    # Feature-level results
    feature_results: List[DriftResult]
    drifted_features: List[str]
    
    # Recommendations
    recommendations: List[str]
    
    # Metadata
    baseline_sample_size: int
    current_sample_size: int
    monitoring_window_hours: int
    
    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result['feature_results'] = [r.to_dict() if hasattr(r, 'to_dict') else r for r in self.feature_results]
        return result


@dataclass
class Alert:
    """Drift alert for notification."""
    alert_id: str
    timestamp: str
    model_type: str
    model_version: str
    severity: str
    drift_type: str
    message: str
    affected_features: List[str]
    recommended_action: str
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[str] = None


class DriftDetector:
    """
    Drift Detection for ML Models.
    
    Monitors feature distributions using KL divergence and other
    statistical tests to detect data drift.
    
    @requirement 9.1 - Monitor prediction accuracy against actual job outcomes
    @requirement 9.2 - Detect statistical drift in input feature distributions
    """
    
    # Default thresholds for drift detection
    DEFAULT_KL_THRESHOLD = 0.1  # KL divergence threshold
    DEFAULT_PSI_THRESHOLD = 0.2  # Population Stability Index threshold
    DEFAULT_MEAN_SHIFT_THRESHOLD = 2.0  # Standard deviations
    
    # Severity thresholds
    SEVERITY_THRESHOLDS = {
        DriftSeverity.LOW: 0.05,
        DriftSeverity.MEDIUM: 0.1,
        DriftSeverity.HIGH: 0.2,
        DriftSeverity.CRITICAL: 0.3,
    }
    
    def __init__(
        self,
        baseline_stats: Optional[Dict[str, FeatureStatistics]] = None,
        kl_threshold: float = DEFAULT_KL_THRESHOLD,
        psi_threshold: float = DEFAULT_PSI_THRESHOLD,
        mean_shift_threshold: float = DEFAULT_MEAN_SHIFT_THRESHOLD,
        storage_path: Optional[str] = None,
    ):
        """
        Initialize the drift detector.
        
        Args:
            baseline_stats: Baseline feature statistics
            kl_threshold: KL divergence threshold for drift
            psi_threshold: PSI threshold for drift
            mean_shift_threshold: Mean shift threshold (in std devs)
            storage_path: Path to store drift reports
        """
        self.baseline_stats = baseline_stats or {}
        self.kl_threshold = kl_threshold
        self.psi_threshold = psi_threshold
        self.mean_shift_threshold = mean_shift_threshold
        
        self.storage_path = Path(storage_path) if storage_path else None
        if self.storage_path:
            self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._alerts: List[Alert] = []
        self._reports: List[DriftReport] = []
        
        logger.info(f"Initialized drift detector with {len(self.baseline_stats)} baseline features")
    
    def set_baseline(self, data: pd.DataFrame) -> Dict[str, FeatureStatistics]:
        """
        Set baseline statistics from training data.
        
        Args:
            data: Training data DataFrame
            
        Returns:
            Dictionary of feature statistics
        """
        logger.info(f"Computing baseline statistics from {len(data)} samples")
        
        self.baseline_stats = {}
        for column in data.columns:
            if data[column].dtype in [np.float64, np.int64, np.float32, np.int32]:
                self.baseline_stats[column] = FeatureStatistics.from_series(column, data[column])
        
        # Save baseline
        if self.storage_path:
            baseline_path = self.storage_path / 'baseline_stats.json'
            with open(baseline_path, 'w') as f:
                json.dump({k: v.to_dict() for k, v in self.baseline_stats.items()}, f, indent=2)
        
        logger.info(f"Computed baseline for {len(self.baseline_stats)} features")
        return self.baseline_stats
    
    def load_baseline(self, path: str) -> Dict[str, FeatureStatistics]:
        """Load baseline statistics from file."""
        with open(path, 'r') as f:
            data = json.load(f)
        
        self.baseline_stats = {
            k: FeatureStatistics.from_dict(v)
            for k, v in data.items()
        }
        
        return self.baseline_stats
    
    def detect_drift(
        self,
        current_data: pd.DataFrame,
        model_type: str = 'unknown',
        model_version: str = 'unknown',
    ) -> DriftReport:
        """
        Detect drift in current data compared to baseline.
        
        @requirement 9.2 - Detect statistical drift in input feature distributions
        
        Args:
            current_data: Current data to check for drift
            model_type: Type of model being monitored
            model_version: Version of model being monitored
            
        Returns:
            DriftReport with detailed results
        """
        logger.info(f"Detecting drift for {model_type}:{model_version}")
        
        if not self.baseline_stats:
            raise ValueError("Baseline statistics not set. Call set_baseline() first.")
        
        feature_results: List[DriftResult] = []
        drifted_features: List[str] = []
        
        # Check each feature
        for feature_name, baseline in self.baseline_stats.items():
            if feature_name not in current_data.columns:
                logger.warning(f"Feature {feature_name} not found in current data")
                continue
            
            current_stats = FeatureStatistics.from_series(feature_name, current_data[feature_name])
            
            # Calculate drift metrics
            kl_divergence = self._calculate_kl_divergence(baseline, current_stats)
            psi = self._calculate_psi(baseline, current_stats)
            mean_shift = self._calculate_mean_shift(baseline, current_stats)
            
            # Determine if drift occurred
            has_drift = (
                kl_divergence > self.kl_threshold or
                psi > self.psi_threshold or
                abs(mean_shift) > self.mean_shift_threshold
            )
            
            # Calculate overall drift score
            drift_score = max(
                kl_divergence / self.kl_threshold,
                psi / self.psi_threshold,
                abs(mean_shift) / self.mean_shift_threshold,
            )
            
            # Determine severity
            severity = self._get_severity(drift_score)
            
            result = DriftResult(
                feature_name=feature_name,
                drift_type=DriftType.FEATURE_DRIFT.value,
                drift_score=drift_score,
                threshold=1.0,  # Normalized threshold
                has_drift=has_drift,
                severity=severity.value,
                baseline_stats={
                    'mean': baseline.mean,
                    'std': baseline.std,
                    'median': baseline.median,
                },
                current_stats={
                    'mean': current_stats.mean,
                    'std': current_stats.std,
                    'median': current_stats.median,
                },
                details=f"KL={kl_divergence:.4f}, PSI={psi:.4f}, MeanShift={mean_shift:.2f}σ",
            )
            
            feature_results.append(result)
            
            if has_drift:
                drifted_features.append(feature_name)
        
        # Calculate overall drift
        overall_drift_score = max([r.drift_score for r in feature_results]) if feature_results else 0.0
        overall_severity = self._get_severity(overall_drift_score)
        has_overall_drift = len(drifted_features) > 0
        
        # Generate recommendations
        recommendations = self._generate_recommendations(feature_results, drifted_features)
        
        # Create report
        report = DriftReport(
            report_id=f"drift_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            generated_at=datetime.utcnow().isoformat(),
            model_type=model_type,
            model_version=model_version,
            has_drift=has_overall_drift,
            overall_severity=overall_severity.value,
            drift_score=overall_drift_score,
            feature_results=feature_results,
            drifted_features=drifted_features,
            recommendations=recommendations,
            baseline_sample_size=0,  # Would be tracked
            current_sample_size=len(current_data),
            monitoring_window_hours=24,
        )
        
        self._reports.append(report)
        
        # Generate alerts if needed
        if has_overall_drift:
            self._generate_alert(report)
        
        # Save report
        if self.storage_path:
            report_path = self.storage_path / f"{report.report_id}.json"
            with open(report_path, 'w') as f:
                json.dump(report.to_dict(), f, indent=2)
        
        logger.info(f"Drift detection complete: has_drift={has_overall_drift}, severity={overall_severity.value}")
        return report
    
    def _calculate_kl_divergence(
        self,
        baseline: FeatureStatistics,
        current: FeatureStatistics,
    ) -> float:
        """
        Calculate KL divergence between baseline and current distributions.
        
        @requirement 9.2 - Monitor feature distributions using KL divergence
        """
        if not baseline.histogram_counts or not current.histogram_counts:
            return 0.0
        
        # Normalize histograms to probability distributions
        p = np.array(baseline.histogram_counts, dtype=float)
        q = np.array(current.histogram_counts, dtype=float)
        
        # Handle different bin sizes
        if len(p) != len(q):
            # Resample to same size
            min_len = min(len(p), len(q))
            p = np.interp(np.linspace(0, 1, min_len), np.linspace(0, 1, len(p)), p)
            q = np.interp(np.linspace(0, 1, min_len), np.linspace(0, 1, len(q)), q)
        
        # Add small epsilon to avoid division by zero
        epsilon = 1e-10
        p = p + epsilon
        q = q + epsilon
        
        # Normalize
        p = p / p.sum()
        q = q / q.sum()
        
        # Calculate KL divergence
        kl_div = np.sum(p * np.log(p / q))
        
        return float(kl_div)
    
    def _calculate_psi(
        self,
        baseline: FeatureStatistics,
        current: FeatureStatistics,
    ) -> float:
        """
        Calculate Population Stability Index (PSI).
        
        PSI is commonly used in credit scoring to detect distribution shifts.
        """
        if not baseline.histogram_counts or not current.histogram_counts:
            return 0.0
        
        # Normalize histograms
        p = np.array(baseline.histogram_counts, dtype=float)
        q = np.array(current.histogram_counts, dtype=float)
        
        # Handle different bin sizes
        if len(p) != len(q):
            min_len = min(len(p), len(q))
            p = np.interp(np.linspace(0, 1, min_len), np.linspace(0, 1, len(p)), p)
            q = np.interp(np.linspace(0, 1, min_len), np.linspace(0, 1, len(q)), q)
        
        # Add epsilon and normalize
        epsilon = 1e-10
        p = (p + epsilon) / (p.sum() + epsilon * len(p))
        q = (q + epsilon) / (q.sum() + epsilon * len(q))
        
        # Calculate PSI
        psi = np.sum((q - p) * np.log(q / p))
        
        return float(psi)
    
    def _calculate_mean_shift(
        self,
        baseline: FeatureStatistics,
        current: FeatureStatistics,
    ) -> float:
        """Calculate mean shift in standard deviations."""
        if baseline.std == 0:
            return 0.0
        
        return (current.mean - baseline.mean) / baseline.std
    
    def _get_severity(self, drift_score: float) -> DriftSeverity:
        """Determine severity level from drift score."""
        if drift_score >= self.SEVERITY_THRESHOLDS[DriftSeverity.CRITICAL]:
            return DriftSeverity.CRITICAL
        elif drift_score >= self.SEVERITY_THRESHOLDS[DriftSeverity.HIGH]:
            return DriftSeverity.HIGH
        elif drift_score >= self.SEVERITY_THRESHOLDS[DriftSeverity.MEDIUM]:
            return DriftSeverity.MEDIUM
        elif drift_score >= self.SEVERITY_THRESHOLDS[DriftSeverity.LOW]:
            return DriftSeverity.LOW
        else:
            return DriftSeverity.NONE
    
    def _generate_recommendations(
        self,
        results: List[DriftResult],
        drifted_features: List[str],
    ) -> List[str]:
        """Generate recommendations based on drift results."""
        recommendations = []
        
        if not drifted_features:
            recommendations.append("No significant drift detected. Continue monitoring.")
            return recommendations
        
        # Count severity levels
        high_severity = sum(1 for r in results if r.severity in ['high', 'critical'])
        
        if high_severity > 0:
            recommendations.append(
                f"URGENT: {high_severity} features show high/critical drift. "
                "Consider increasing human oversight and investigating data quality."
            )
        
        if len(drifted_features) > len(results) * 0.3:
            recommendations.append(
                "Multiple features drifting suggests systematic data change. "
                "Investigate upstream data sources."
            )
        
        if len(drifted_features) <= 3:
            recommendations.append(
                f"Investigate specific features: {', '.join(drifted_features)}"
            )
        
        recommendations.append(
            "Consider retraining the model with recent data if drift persists."
        )
        
        return recommendations
    
    def _generate_alert(self, report: DriftReport) -> Alert:
        """
        Generate an alert for detected drift.
        
        @requirement 9.2 - Generate alerts when drift exceeds threshold
        """
        alert = Alert(
            alert_id=f"alert_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            timestamp=datetime.utcnow().isoformat(),
            model_type=report.model_type,
            model_version=report.model_version,
            severity=report.overall_severity,
            drift_type=DriftType.FEATURE_DRIFT.value,
            message=f"Drift detected in {len(report.drifted_features)} features",
            affected_features=report.drifted_features,
            recommended_action=report.recommendations[0] if report.recommendations else "Investigate drift",
        )
        
        self._alerts.append(alert)
        
        # In production, would send to alerting system
        logger.warning(f"DRIFT ALERT: {alert.message} (severity: {alert.severity})")
        
        return alert
    
    def get_alerts(
        self,
        acknowledged: Optional[bool] = None,
        severity: Optional[str] = None,
    ) -> List[Alert]:
        """Get drift alerts."""
        alerts = self._alerts
        
        if acknowledged is not None:
            alerts = [a for a in alerts if a.acknowledged == acknowledged]
        
        if severity:
            alerts = [a for a in alerts if a.severity == severity]
        
        return alerts
    
    def acknowledge_alert(self, alert_id: str, user_id: str) -> bool:
        """Acknowledge a drift alert."""
        for alert in self._alerts:
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                alert.acknowledged_by = user_id
                alert.acknowledged_at = datetime.utcnow().isoformat()
                return True
        return False
    
    def get_reports(self, limit: int = 100) -> List[DriftReport]:
        """Get recent drift reports."""
        return self._reports[-limit:]


class PerformanceMonitor:
    """
    Monitor model prediction accuracy against actual outcomes.
    
    @requirement 9.1 - Monitor prediction accuracy against actual job outcomes
    """
    
    def __init__(self, storage_path: Optional[str] = None):
        """Initialize the performance monitor."""
        self.storage_path = Path(storage_path) if storage_path else None
        if self.storage_path:
            self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self._predictions: List[Dict[str, Any]] = []
        self._outcomes: List[Dict[str, Any]] = []
        self._metrics_history: List[Dict[str, Any]] = []
    
    def record_prediction(
        self,
        job_id: str,
        vendor_id: str,
        model_version: str,
        predicted_completion_prob: float,
        predicted_time_to_complete: float,
        predicted_rework_risk: float,
    ) -> None:
        """Record a model prediction for later comparison."""
        self._predictions.append({
            'job_id': job_id,
            'vendor_id': vendor_id,
            'model_version': model_version,
            'predicted_completion_prob': predicted_completion_prob,
            'predicted_time_to_complete': predicted_time_to_complete,
            'predicted_rework_risk': predicted_rework_risk,
            'timestamp': datetime.utcnow().isoformat(),
        })
    
    def record_outcome(
        self,
        job_id: str,
        vendor_id: str,
        completed_successfully: bool,
        actual_time_to_complete: float,
        required_rework: bool,
    ) -> None:
        """
        Record actual job outcome for accuracy comparison.
        
        @requirement 9.1 - Compare predictions to actual outcomes
        """
        self._outcomes.append({
            'job_id': job_id,
            'vendor_id': vendor_id,
            'completed_successfully': completed_successfully,
            'actual_time_to_complete': actual_time_to_complete,
            'required_rework': required_rework,
            'timestamp': datetime.utcnow().isoformat(),
        })
    
    def calculate_accuracy_metrics(self) -> Dict[str, float]:
        """
        Calculate accuracy metrics by comparing predictions to outcomes.
        
        @requirement 9.1 - Monitor prediction accuracy against actual job outcomes
        @property Property 16: Prediction Accuracy Monitoring
        """
        # Match predictions with outcomes
        predictions_df = pd.DataFrame(self._predictions)
        outcomes_df = pd.DataFrame(self._outcomes)
        
        if predictions_df.empty or outcomes_df.empty:
            return {}
        
        # Merge on job_id and vendor_id
        merged = predictions_df.merge(
            outcomes_df,
            on=['job_id', 'vendor_id'],
            suffixes=('_pred', '_actual'),
        )
        
        if merged.empty:
            return {}
        
        metrics = {}
        
        # Completion prediction accuracy
        completion_correct = (
            (merged['predicted_completion_prob'] > 0.5) ==
            merged['completed_successfully']
        ).mean()
        metrics['completion_accuracy'] = float(completion_correct)
        
        # Time prediction MAE
        time_mae = abs(
            merged['predicted_time_to_complete'] -
            merged['actual_time_to_complete']
        ).mean()
        metrics['time_mae_hours'] = float(time_mae)
        
        # Rework prediction accuracy
        rework_correct = (
            (merged['predicted_rework_risk'] > 0.5) ==
            merged['required_rework']
        ).mean()
        metrics['rework_accuracy'] = float(rework_correct)
        
        # Store metrics
        self._metrics_history.append({
            'timestamp': datetime.utcnow().isoformat(),
            'sample_size': len(merged),
            **metrics,
        })
        
        return metrics
    
    def get_metrics_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get historical accuracy metrics."""
        return self._metrics_history[-limit:]


# Singleton instances
_drift_detector_instance: Optional[DriftDetector] = None
_performance_monitor_instance: Optional[PerformanceMonitor] = None


def get_drift_detector(storage_path: str = './monitoring') -> DriftDetector:
    """Get or create the drift detector singleton."""
    global _drift_detector_instance
    if _drift_detector_instance is None:
        _drift_detector_instance = DriftDetector(storage_path=storage_path)
    return _drift_detector_instance


def get_performance_monitor(storage_path: str = './monitoring') -> PerformanceMonitor:
    """Get or create the performance monitor singleton."""
    global _performance_monitor_instance
    if _performance_monitor_instance is None:
        _performance_monitor_instance = PerformanceMonitor(storage_path=storage_path)
    return _performance_monitor_instance


def reset_monitoring() -> None:
    """Reset monitoring singletons (for testing)."""
    global _drift_detector_instance, _performance_monitor_instance
    _drift_detector_instance = None
    _performance_monitor_instance = None
