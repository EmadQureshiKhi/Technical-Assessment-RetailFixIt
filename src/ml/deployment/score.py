"""
Scoring Script for Azure ML Online Endpoint

This script is used by Azure ML to serve predictions from the trained models.

@requirement 8.1 - Deploy model to Azure ML endpoint
"""

import os
import json
import pickle
import logging
import numpy as np
from typing import Dict, Any, List

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model references
completion_model = None
time_model = None
rework_model = None
scaler = None

# Feature columns (must match training)
FEATURE_COLUMNS = [
    'job_type_encoded',
    'urgency_level_encoded', 
    'customer_tier_encoded',
    'required_cert_count',
    'special_requirement_count',
    'hours_until_sla',
    'vendor_capacity_utilization',
    'vendor_cert_count',
    'vendor_specialization_count',
    'vendor_service_area_count',
    'historical_completion_rate',
    'historical_rework_rate',
    'historical_avg_response_time',
    'historical_avg_satisfaction',
    'certification_match_ratio',
    'is_in_service_area',
]

# Encoding mappings
JOB_TYPE_ENCODING = {'repair': 0, 'installation': 1, 'maintenance': 2, 'inspection': 3}
URGENCY_ENCODING = {'low': 0, 'medium': 1, 'high': 2, 'critical': 3}
TIER_ENCODING = {'standard': 0, 'premium': 1, 'enterprise': 2}


def init():
    """
    Initialize the model - called once when the endpoint starts.
    """
    global completion_model, time_model, rework_model, scaler
    
    logger.info("Initializing ML models...")
    
    # Get model path from environment
    model_path = os.environ.get('AZUREML_MODEL_DIR', './trained_models')
    
    # Load models
    try:
        # Find the latest model files (exclude metadata JSON files)
        model_files = os.listdir(model_path)
        
        completion_file = next((f for f in model_files if f.startswith('completion_model_') and f.endswith('.pkl')), None)
        time_file = next((f for f in model_files if f.startswith('time_model_') and f.endswith('.pkl')), None)
        rework_file = next((f for f in model_files if f.startswith('rework_model_') and f.endswith('.pkl')), None)
        scaler_file = next((f for f in model_files if f.startswith('scaler_') and f.endswith('.pkl')), None)
        
        if completion_file:
            with open(os.path.join(model_path, completion_file), 'rb') as f:
                completion_model = pickle.load(f)
            logger.info(f"Loaded completion model: {completion_file}")
        
        if time_file:
            with open(os.path.join(model_path, time_file), 'rb') as f:
                time_model = pickle.load(f)
            logger.info(f"Loaded time model: {time_file}")
        
        if rework_file:
            with open(os.path.join(model_path, rework_file), 'rb') as f:
                rework_model = pickle.load(f)
            logger.info(f"Loaded rework model: {rework_file}")
        
        if scaler_file:
            with open(os.path.join(model_path, scaler_file), 'rb') as f:
                scaler = pickle.load(f)
            logger.info(f"Loaded scaler: {scaler_file}")
        
        logger.info("ML models initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to load models: {e}")
        raise


def preprocess_input(data: Dict[str, Any]) -> np.ndarray:
    """
    Preprocess input data for prediction.
    """
    features = []
    
    # Job features
    features.append(JOB_TYPE_ENCODING.get(data.get('job_type', 'repair'), 0))
    features.append(URGENCY_ENCODING.get(data.get('urgency_level', 'medium'), 1))
    features.append(TIER_ENCODING.get(data.get('customer_tier', 'standard'), 0))
    features.append(data.get('required_cert_count', 0))
    features.append(data.get('special_requirement_count', 0))
    features.append(data.get('hours_until_sla', 24))
    
    # Vendor features
    features.append(data.get('vendor_capacity_utilization', 0.5))
    features.append(data.get('vendor_cert_count', 3))
    features.append(data.get('vendor_specialization_count', 2))
    features.append(data.get('vendor_service_area_count', 5))
    
    # Historical performance
    features.append(data.get('historical_completion_rate', 0.9))
    features.append(data.get('historical_rework_rate', 0.05))
    features.append(data.get('historical_avg_response_time', 2))
    features.append(data.get('historical_avg_satisfaction', 4.0))
    
    # Match features
    features.append(data.get('certification_match_ratio', 1.0))
    features.append(1 if data.get('is_in_service_area', True) else 0)
    
    X = np.array([features])
    
    # Scale if scaler is available
    if scaler is not None:
        X = scaler.transform(X)
    
    return X


def run(raw_data: str) -> str:
    """
    Score the input data and return predictions.
    
    Expected input format:
    {
        "data": [
            {
                "job_type": "repair",
                "urgency_level": "high",
                "customer_tier": "premium",
                "vendor_id": "v1",
                "historical_completion_rate": 0.95,
                ...
            }
        ]
    }
    
    Returns:
    {
        "predictions": [
            {
                "vendor_id": "v1",
                "completion_probability": 0.92,
                "estimated_time_hours": 3.5,
                "rework_probability": 0.05,
                "ml_score": 0.87
            }
        ],
        "model_version": "v20260128_033155"
    }
    """
    try:
        input_data = json.loads(raw_data)
        data_list = input_data.get('data', [])
        
        predictions = []
        
        for item in data_list:
            X = preprocess_input(item)
            
            result = {
                'vendor_id': item.get('vendor_id', 'unknown'),
            }
            
            # Completion probability
            if completion_model is not None:
                completion_prob = completion_model.predict_proba(X)[0]
                result['completion_probability'] = float(completion_prob[1]) if len(completion_prob) > 1 else float(completion_prob[0])
            else:
                result['completion_probability'] = 0.85  # Default
            
            # Time to completion
            if time_model is not None:
                time_pred = time_model.predict(X)[0]
                result['estimated_time_hours'] = float(max(0.5, time_pred))
            else:
                result['estimated_time_hours'] = 4.0  # Default
            
            # Rework probability
            if rework_model is not None:
                rework_prob = rework_model.predict_proba(X)[0]
                result['rework_probability'] = float(rework_prob[1]) if len(rework_prob) > 1 else float(rework_prob[0])
            else:
                result['rework_probability'] = 0.05  # Default
            
            # Calculate combined ML score
            # Higher completion prob, lower time, lower rework = better score
            ml_score = (
                result['completion_probability'] * 0.5 +
                (1 - min(result['estimated_time_hours'] / 24, 1)) * 0.3 +
                (1 - result['rework_probability']) * 0.2
            )
            result['ml_score'] = float(ml_score)
            
            predictions.append(result)
        
        response = {
            'predictions': predictions,
            'model_version': 'v20260128_033155',
        }
        
        return json.dumps(response)
        
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return json.dumps({
            'error': str(e),
            'predictions': [],
        })


# For local testing
if __name__ == '__main__':
    init()
    
    test_input = json.dumps({
        'data': [
            {
                'vendor_id': 'v1',
                'job_type': 'repair',
                'urgency_level': 'high',
                'customer_tier': 'premium',
                'historical_completion_rate': 0.95,
                'historical_rework_rate': 0.02,
                'certification_match_ratio': 1.0,
                'is_in_service_area': True,
            },
            {
                'vendor_id': 'v2',
                'job_type': 'repair',
                'urgency_level': 'high',
                'customer_tier': 'premium',
                'historical_completion_rate': 0.85,
                'historical_rework_rate': 0.08,
                'certification_match_ratio': 0.8,
                'is_in_service_area': True,
            }
        ]
    })
    
    result = run(test_input)
    print(json.dumps(json.loads(result), indent=2))
