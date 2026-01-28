/**
 * Job Detail Page
 *
 * Displays job details, recommended vendors, scores, and rationale.
 * Allows operators to accept recommendations or override with a different vendor.
 *
 * @requirement 5.2 - Display job details, recommended vendors, scores, and rationale
 * @requirement 5.3 - Allow vendor override
 * @requirement 5.5 - Display confidence indicators
 * @requirement 5.7 - Responsive and accessible (WCAG 2.1 AA)
 * @tested tests/e2e/admin-ui.spec.ts
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Job, RecommendationResponse, VendorRecommendation } from '../types';
import { fetchJob, generateRecommendations, acceptRecommendation } from '../services/api';
import { OverrideModal } from '../components/OverrideModal';

/**
 * Formats a date string for display
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Confidence indicator component
 * @requirement 5.5 - Display confidence indicators
 */
function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  const level = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  const levelLabel = level === 'high' ? 'High confidence' : level === 'medium' ? 'Medium confidence' : 'Low confidence';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
      <div
        className="progress-bar"
        style={{ width: '100px' }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence: ${percentage}%`}
      >
        <div
          className={`progress-bar-fill ${level}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
        {percentage}%
        <span className="sr-only"> - {levelLabel}</span>
      </span>
    </div>
  );
}

/**
 * Score breakdown component
 */
function ScoreBreakdown({ vendor }: { vendor: VendorRecommendation }) {
  return (
    <div style={{ marginTop: 'var(--spacing-md)' }}>
      <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-sm)' }}>
        Score Breakdown
      </h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--spacing-sm)',
        }}
      >
        {vendor.scoreBreakdown.factors.map(factor => (
          <div
            key={factor.name}
            style={{
              padding: 'var(--spacing-sm)',
              backgroundColor: 'var(--color-gray-100)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-600)', textTransform: 'capitalize' }}>
              {factor.name.replace(/([A-Z])/g, ' $1').trim()}
            </div>
            <div style={{ fontWeight: 600 }}>
              {Math.round(factor.value * 100)}%
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)' }}>
              Weight: {Math.round(factor.weight * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ML Predictions component - displays predictions from trained models
 */
function MLPredictions({ vendor }: { vendor: VendorRecommendation }) {
  const predictions = vendor.mlPredictions;
  if (!predictions) return null;

  return (
    <div
      style={{
        marginTop: 'var(--spacing-md)',
        padding: 'var(--spacing-md)',
        backgroundColor: '#e8f4fd',
        borderRadius: 'var(--radius-md)',
        border: '1px solid #b8daff',
      }}
    >
      <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-sm)', color: '#004085' }}>
        🤖 ML Model Predictions
      </h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--spacing-md)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: '#004085', marginBottom: '4px' }}>
            Completion Probability
          </div>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: predictions.completionProbability >= 0.95 ? '#28a745' : predictions.completionProbability >= 0.85 ? '#ffc107' : '#dc3545' }}>
            {(predictions.completionProbability * 100).toFixed(1)}%
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: '#004085', marginBottom: '4px' }}>
            Estimated Time
          </div>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: '#17a2b8' }}>
            {predictions.estimatedTimeHours.toFixed(1)} hrs
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: '#004085', marginBottom: '4px' }}>
            Rework Risk
          </div>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: predictions.reworkProbability <= 0.05 ? '#28a745' : predictions.reworkProbability <= 0.10 ? '#ffc107' : '#dc3545' }}>
            {(predictions.reworkProbability * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ML Model Info Panel - displays model version and accuracy metrics
 */
function MLModelInfoPanel({ modelInfo, modelVersion, automationLevel }: { 
  modelInfo?: { 
    version: string; 
    completionModel: { accuracy: number; f1Score: number };
    timeModel: { r2Score: number; mae: number };
    reworkModel: { accuracy: number; f1Score: number };
    trainedAt: string;
    algorithm: string;
  };
  modelVersion: string;
  automationLevel: string;
}) {
  if (!modelInfo) return null;

  return (
    <div
      style={{
        marginBottom: 'var(--spacing-lg)',
        padding: 'var(--spacing-md)',
        backgroundColor: '#f0f7ff',
        borderRadius: 'var(--radius-md)',
        border: '1px solid #b8daff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', color: '#004085' }}>
          🤖 ML Model Info
        </h3>
        <span
          style={{
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 600,
            backgroundColor: automationLevel === 'auto' ? '#28a745' : '#ffc107',
            color: automationLevel === 'auto' ? 'white' : '#212529',
          }}
        >
          {automationLevel === 'auto' ? '✓ AUTO MODE' : '⚠ ADVISORY MODE'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--spacing-md)',
          fontSize: 'var(--font-size-sm)',
        }}
      >
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Version</div>
          <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{modelVersion}</div>
        </div>
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Algorithm</div>
          <div style={{ fontWeight: 600 }}>{modelInfo.algorithm}</div>
        </div>
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Completion Model</div>
          <div style={{ fontWeight: 600 }}>
            {(modelInfo.completionModel.accuracy * 100).toFixed(1)}% accuracy
          </div>
        </div>
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Time Model</div>
          <div style={{ fontWeight: 600 }}>
            R² = {modelInfo.timeModel.r2Score.toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Rework Model</div>
          <div style={{ fontWeight: 600 }}>
            {(modelInfo.reworkModel.accuracy * 100).toFixed(1)}% accuracy
          </div>
        </div>
        <div>
          <div style={{ color: '#6c757d', marginBottom: '2px' }}>Trained</div>
          <div style={{ fontWeight: 600 }}>
            {new Date(modelInfo.trainedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Vendor card component
 */
function VendorCard({
  vendor,
  isTopRecommendation,
  onAccept,
  onOverride,
  isAssigned,
  isJobAssigned,
  isSelectingOverride,
}: {
  vendor: VendorRecommendation;
  isTopRecommendation: boolean;
  onAccept: () => void;
  onOverride: () => void;
  isAssigned?: boolean;
  isJobAssigned?: boolean;
  isSelectingOverride?: boolean;
}) {
  const [expanded, setExpanded] = useState(isTopRecommendation);

  // In override selection mode, dim the top recommendation
  const isDimmed = isSelectingOverride && isTopRecommendation;
  // Highlight alternative vendors in override selection mode
  const isHighlighted = isSelectingOverride && !isTopRecommendation;

  return (
    <article
      className="card"
      style={{
        marginBottom: 'var(--spacing-md)',
        border: isAssigned 
          ? '2px solid var(--color-success)' 
          : isHighlighted
            ? '2px solid var(--color-warning)'
            : isTopRecommendation 
              ? '2px solid var(--color-primary)' 
              : undefined,
        opacity: (isJobAssigned && !isAssigned) || isDimmed ? 0.5 : 1,
      }}
      aria-label={`Vendor recommendation: ${vendor.vendorName}, rank ${vendor.rank}${isAssigned ? ' - Assigned' : ''}`}
    >
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: isAssigned 
                    ? 'var(--color-success)' 
                    : isTopRecommendation 
                      ? 'var(--color-primary)' 
                      : 'var(--color-gray-300)',
                  color: isAssigned || isTopRecommendation ? 'var(--color-white)' : 'var(--color-gray-700)',
                  fontWeight: 600,
                  fontSize: 'var(--font-size-sm)',
                }}
                aria-hidden="true"
              >
                {isAssigned ? '✓' : vendor.rank}
              </span>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
                {vendor.vendorName}
              </h3>
              {isAssigned && (
                <span
                  className="badge"
                  style={{ backgroundColor: 'var(--color-success)', color: 'var(--color-white)' }}
                >
                  Assigned
                </span>
              )}
              {!isAssigned && isTopRecommendation && !isJobAssigned && (
                <span
                  className="badge"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-white)' }}
                >
                  Recommended
                </span>
              )}
            </div>
            <p style={{ margin: 'var(--spacing-sm) 0 0', color: 'var(--color-gray-600)', fontSize: 'var(--font-size-sm)' }}>
              Est. response: {vendor.estimatedResponseTime}
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div className="score-display">
              <span className="score-value">{Math.round(vendor.overallScore * 100)}</span>
              <span className="score-label">/ 100</span>
            </div>
            <div style={{ marginTop: 'var(--spacing-xs)' }}>
              <ConfidenceIndicator confidence={vendor.confidence} />
            </div>
          </div>
        </div>

        {/* Rationale */}
        <div
          style={{
            marginTop: 'var(--spacing-md)',
            padding: 'var(--spacing-md)',
            backgroundColor: 'var(--color-gray-100)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
            Rationale
          </h4>
          <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
            {vendor.rationale}
          </p>
        </div>

        {/* ML Predictions */}
        <MLPredictions vendor={vendor} />

        {/* Risk factors */}
        {vendor.riskFactors.length > 0 && (
          <div
            style={{
              marginTop: 'var(--spacing-md)',
              padding: 'var(--spacing-md)',
              backgroundColor: '#fff3cd',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-warning)',
            }}
            role="alert"
          >
            <h4 style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)', color: '#856404' }}>
              Risk Factors
            </h4>
            <ul style={{ margin: 0, paddingLeft: 'var(--spacing-lg)', fontSize: 'var(--font-size-sm)' }}>
              {vendor.riskFactors.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Expandable score breakdown */}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 'var(--spacing-md)',
            background: 'none',
            border: 'none',
            color: 'var(--color-primary)',
            cursor: 'pointer',
            fontSize: 'var(--font-size-sm)',
            padding: 0,
          }}
          aria-expanded={expanded}
          aria-controls={`score-breakdown-${vendor.vendorId}`}
        >
          {expanded ? '▼ Hide score details' : '▶ Show score details'}
        </button>

        {expanded && (
          <div id={`score-breakdown-${vendor.vendorId}`}>
            <ScoreBreakdown vendor={vendor} />
          </div>
        )}

        {/* Actions */}
        {!isJobAssigned && (
          <div
            style={{
              marginTop: 'var(--spacing-lg)',
              display: 'flex',
              gap: 'var(--spacing-sm)',
              justifyContent: 'flex-end',
            }}
          >
            {isSelectingOverride ? (
              // In override selection mode
              isTopRecommendation ? (
                // Hide buttons for top recommendation (it's being overridden)
                <span style={{ color: 'var(--color-gray-500)', fontSize: 'var(--font-size-sm)' }}>
                  Being overridden...
                </span>
              ) : (
                // Show "Select This Vendor" for alternatives
                <button
                  className="btn btn-warning"
                  onClick={onOverride}
                  aria-label={`Select ${vendor.vendorName} to override the recommendation`}
                >
                  Select This Vendor
                </button>
              )
            ) : (
              // Normal mode
              isTopRecommendation ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={onOverride}
                    aria-label={`Override recommendation and select a different vendor`}
                  >
                    Override
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={onAccept}
                    aria-label={`Accept ${vendor.vendorName} as the assigned vendor`}
                  >
                    Accept Recommendation
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={onOverride}
                  aria-label={`Select ${vendor.vendorName} instead of the recommended vendor`}
                >
                  Select This Vendor
                </button>
              )
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedVendorForOverride, setSelectedVendorForOverride] = useState<VendorRecommendation | null>(null);
  const [acceptedVendorId, setAcceptedVendorId] = useState<string | null>(null);
  const [overriddenVendorId, setOverriddenVendorId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSelectingOverride, setIsSelectingOverride] = useState(false); // New state for override selection mode

  const loadData = useCallback(async () => {
    if (!jobId) return;

    try {
      setLoading(true);
      setError(null);

      const jobData = await fetchJob(jobId);
      if (!jobData) {
        setError('Job not found');
        return;
      }
      setJob(jobData);

      // Check if job is already accepted/assigned - set initial state
      if (jobData.recommendationStatus === 'accepted' || jobData.status === 'assigned') {
        // Job was already accepted - mark as assigned (use first vendor as placeholder)
        setAcceptedVendorId('previously-assigned');
        setSuccessMessage('✓ This job has already been assigned to a vendor');
      } else if (jobData.recommendationStatus === 'overridden') {
        setOverriddenVendorId('previously-overridden');
        setSuccessMessage('✓ This job was assigned via override');
      }

      // Try to generate recommendations
      try {
        const recs = await generateRecommendations(jobData);
        setRecommendations(recs);
      } catch {
        // Recommendations may not be available yet
        console.log('Recommendations not yet available');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job details');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAccept = async (vendorId: string) => {
    if (!jobId) return;
    try {
      const vendorName = recommendations?.recommendations.find(v => v.vendorId === vendorId)?.vendorName || 'Vendor';
      await acceptRecommendation(jobId, vendorId, vendorName);
      // Update local state to reflect acceptance
      setAcceptedVendorId(vendorId);
      setOverriddenVendorId(null);
      setSuccessMessage(`✓ ${vendorName} has been assigned to this job`);
      // Update job status locally
      if (job) {
        setJob({ ...job, status: 'assigned', recommendationStatus: 'accepted' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept recommendation');
    }
  };

  const handleOverrideClick = (vendor: VendorRecommendation) => {
    // If clicking override on the top recommendation, enter selection mode
    // If clicking on another vendor, open the override modal directly
    const topVendor = recommendations?.recommendations[0];
    if (topVendor && vendor.vendorId === topVendor.vendorId) {
      // User wants to override the recommendation - show selection mode
      setIsSelectingOverride(true);
    } else {
      // User selected a different vendor - open override modal
      setSelectedVendorForOverride(vendor);
      setShowOverrideModal(true);
    }
  };

  const handleCancelOverrideSelection = () => {
    setIsSelectingOverride(false);
  };

  const handleOverrideComplete = () => {
    setShowOverrideModal(false);
    setIsSelectingOverride(false);
    if (selectedVendorForOverride) {
      // Update local state to reflect override
      setOverriddenVendorId(selectedVendorForOverride.vendorId);
      setAcceptedVendorId(null);
      setSuccessMessage(`✓ Override recorded: ${selectedVendorForOverride.vendorName} has been assigned instead`);
      // Update job status locally
      if (job) {
        setJob({ ...job, status: 'assigned', recommendationStatus: 'overridden' });
      }
    }
    setSelectedVendorForOverride(null);
  };

  if (loading) {
    return (
      <main id="main-content" role="main">
        <div className="container" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
          <div role="status" aria-live="polite">
            Loading job details...
          </div>
        </div>
      </main>
    );
  }

  if (error || !job) {
    return (
      <main id="main-content" role="main">
        <div className="container" style={{ padding: 'var(--spacing-xl)' }}>
          <div role="alert" className="card" style={{ padding: 'var(--spacing-lg)', textAlign: 'center' }}>
            <h2 style={{ color: 'var(--color-danger)' }}>Error</h2>
            <p>{error || 'Job not found'}</p>
            <Link to="/" className="btn btn-primary">
              Back to Jobs
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const topVendor = recommendations?.recommendations[0];
  const assignedVendorId = acceptedVendorId || overriddenVendorId;
  const isJobAssigned = assignedVendorId !== null;

  return (
    <main id="main-content" role="main" aria-label="Job Details">
      <div className="container" style={{ padding: 'var(--spacing-lg) var(--spacing-md)' }}>
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <Link to="/" style={{ color: 'var(--color-gray-600)', textDecoration: 'none' }}>
            ← Back to Jobs
          </Link>
        </nav>

        {/* Success Message */}
        {successMessage && (
          <div
            role="alert"
            style={{
              marginBottom: 'var(--spacing-lg)',
              padding: 'var(--spacing-md)',
              backgroundColor: '#d4edda',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-success)',
              color: '#155724',
            }}
          >
            {successMessage}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-lg)' }}>
          {/* Job Details Panel */}
          <aside>
            <div className="card">
              <div className="card-header">
                <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Job Details</h2>
              </div>
              <div className="card-body">
                <dl style={{ margin: 0 }}>
                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Job ID</dt>
                    <dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}>
                      {job.jobId}
                    </dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Type</dt>
                    <dd style={{ margin: 0, textTransform: 'capitalize' }}>{job.jobType}</dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Urgency</dt>
                    <dd style={{ margin: 0 }}>
                      <span className={`badge badge-${job.urgencyLevel}`}>{job.urgencyLevel}</span>
                    </dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Status</dt>
                    <dd style={{ margin: 0 }}>
                      <span className={`badge badge-${job.status}`}>{job.status.replace('_', ' ')}</span>
                    </dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>SLA Deadline</dt>
                    <dd style={{ margin: 0 }}>{formatDate(job.slaDeadline)}</dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Location</dt>
                    <dd style={{ margin: 0 }}>
                      {job.location.address}<br />
                      {job.location.city}, {job.location.state} {job.location.zipCode}
                    </dd>
                  </div>

                  <div style={{ marginBottom: 'var(--spacing-md)' }}>
                    <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>Customer Tier</dt>
                    <dd style={{ margin: 0, textTransform: 'capitalize' }}>{job.customerDetails.tier}</dd>
                  </div>

                  {job.requiredCertifications.length > 0 && (
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                      <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
                        Required Certifications
                      </dt>
                      <dd style={{ margin: 0 }}>
                        <ul style={{ margin: 0, paddingLeft: 'var(--spacing-lg)' }}>
                          {job.requiredCertifications.map((cert, i) => (
                            <li key={i}>{cert}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}

                  {job.specialRequirements.length > 0 && (
                    <div>
                      <dt style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
                        Special Requirements
                      </dt>
                      <dd style={{ margin: 0 }}>
                        <ul style={{ margin: 0, paddingLeft: 'var(--spacing-lg)' }}>
                          {job.specialRequirements.map((req, i) => (
                            <li key={i}>{req}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </aside>

          {/* Recommendations Panel */}
          <section aria-labelledby="recommendations-heading">
            <h2 id="recommendations-heading" style={{ marginBottom: 'var(--spacing-lg)' }}>
              Vendor Recommendations
            </h2>

            {recommendations ? (
              <>
                {/* ML Model Info Panel */}
                <MLModelInfoPanel 
                  modelInfo={recommendations.mlModelInfo}
                  modelVersion={recommendations.modelVersion}
                  automationLevel={recommendations.automationLevel}
                />

                {/* Recommendation metadata */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--spacing-md)',
                    padding: 'var(--spacing-sm) var(--spacing-md)',
                    backgroundColor: 'var(--color-gray-100)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--color-gray-600)' }}>Model: </span>
                    <span>{recommendations.modelVersion}</span>
                    {recommendations.degradedMode && (
                      <span
                        style={{
                          marginLeft: 'var(--spacing-sm)',
                          color: 'var(--color-warning)',
                        }}
                        role="status"
                      >
                        (Degraded Mode)
                      </span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-gray-600)' }}>Overall Confidence: </span>
                    <ConfidenceIndicator confidence={recommendations.overallConfidence} />
                  </div>
                </div>

                {/* Automation level indicator */}
                {recommendations.automationLevel === 'advisory' && (
                  <div
                    role="alert"
                    style={{
                      marginBottom: 'var(--spacing-md)',
                      padding: 'var(--spacing-md)',
                      backgroundColor: 'var(--color-primary-light)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-primary)',
                    }}
                  >
                    <strong>Human Review Required:</strong> This recommendation requires operator approval before dispatch.
                  </div>
                )}

                {/* Override selection mode banner */}
                {isSelectingOverride && (
                  <div
                    role="alert"
                    style={{
                      marginBottom: 'var(--spacing-md)',
                      padding: 'var(--spacing-md)',
                      backgroundColor: '#fff3cd',
                      borderRadius: 'var(--radius-md)',
                      border: '2px solid var(--color-warning)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>⚠️ Override Mode:</strong> Select a different vendor below to override the AI recommendation.
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleCancelOverrideSelection}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Vendor cards */}
                {recommendations.recommendations.map((vendor, index) => (
                  <VendorCard
                    key={vendor.vendorId}
                    vendor={vendor}
                    isTopRecommendation={index === 0}
                    onAccept={() => handleAccept(vendor.vendorId)}
                    onOverride={() => handleOverrideClick(vendor)}
                    isAssigned={assignedVendorId === vendor.vendorId}
                    isJobAssigned={isJobAssigned}
                    isSelectingOverride={isSelectingOverride}
                  />
                ))}
              </>
            ) : (
              <div className="card" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
                <p style={{ color: 'var(--color-gray-600)' }}>
                  No recommendations available yet.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={loadData}
                >
                  Generate Recommendations
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Override Modal */}
        {showOverrideModal && topVendor && selectedVendorForOverride && (
          <OverrideModal
            jobId={job.jobId}
            originalVendor={topVendor}
            selectedVendor={selectedVendorForOverride}
            onClose={() => setShowOverrideModal(false)}
            onComplete={handleOverrideComplete}
          />
        )}
      </div>
    </main>
  );
}
