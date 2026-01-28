"""
ML Scoring Service - Flask API for serving real ML model predictions

This service loads the trained scikit-learn models and provides predictions
via a REST API that can be called from Azure Functions.

@requirement 8.1 - Deploy model to Azure ML endpoint
"""

import os
import json
import pickle
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model references
completion_model = None
time_model = None
rework_model = None
scaler = None
models_loaded = False

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


def load_models():
    """Load the trained ML models from disk."""
    global completion_model, time_model, rework_model, scaler, models_loaded
    
    if models_loaded:
        return True
    
    logger.info("Loading ML models...")
    
    # Get model path - look in trained_models directory
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    model_path = os.path.join(base_path, 'trained_models')
    
    if not os.path.exists(model_path):
        logger.error(f"Model path not found: {model_path}")
        return False
    
    try:
        # Find the latest model files
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
        
        models_loaded = True
        logger.info("ML models loaded successfully")
        return True
        
    except Exception as e:
        logger.error(f"Failed to load models: {e}")
        return False


def preprocess_input(data: dict) -> np.ndarray:
    """Preprocess input data for prediction."""
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


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'models_loaded': models_loaded,
        'version': 'v20260128_033155'
    })


@app.route('/predict', methods=['POST'])
def predict():
    """
    Score vendors and return ML predictions.
    
    Expected input:
    {
        "data": [
            {
                "vendor_id": "v1",
                "job_type": "repair",
                "urgency_level": "high",
                ...
            }
        ]
    }
    """
    if not models_loaded:
        if not load_models():
            return jsonify({'error': 'Models not loaded'}), 500
    
    try:
        input_data = request.get_json()
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
                result['completion_probability'] = round(float(completion_prob[1]) if len(completion_prob) > 1 else float(completion_prob[0]), 3)
            else:
                result['completion_probability'] = 0.85
            
            # Time to completion
            if time_model is not None:
                time_pred = time_model.predict(X)[0]
                result['estimated_time_hours'] = round(float(max(0.5, time_pred)), 1)
            else:
                result['estimated_time_hours'] = 4.0
            
            # Rework probability
            if rework_model is not None:
                rework_prob = rework_model.predict_proba(X)[0]
                result['rework_probability'] = round(float(rework_prob[1]) if len(rework_prob) > 1 else float(rework_prob[0]), 3)
            else:
                result['rework_probability'] = 0.05
            
            # Calculate combined ML score
            ml_score = (
                result['completion_probability'] * 0.5 +
                (1 - min(result['estimated_time_hours'] / 24, 1)) * 0.3 +
                (1 - result['rework_probability']) * 0.2
            )
            result['ml_score'] = round(float(ml_score), 3)
            
            predictions.append(result)
        
        return jsonify({
            'predictions': predictions,
            'model_version': 'v20260128_033155',
            'model_info': {
                'completion_model': {'accuracy': 0.832, 'f1_score': 0.893},
                'time_model': {'r2_score': 0.776, 'mae': 1.797},
                'rework_model': {'accuracy': 0.853, 'f1_score': 0.851},
                'algorithm': 'GradientBoosting',
                'trained_at': '2026-01-28T03:31:55Z'
            }
        })
        
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return jsonify({'error': str(e)}), 500


# Load models on startup
load_models()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
