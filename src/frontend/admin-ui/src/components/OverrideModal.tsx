/**
 * Override Modal Component
 *
 * Modal dialog for submitting vendor overrides with required reason.
 *
 * @requirement 5.3 - Allow vendor selection with required reason
 * @requirement 5.4 - Require override reason
 * @requirement 5.7 - Accessible modal (WCAG 2.1 AA)
 * @tested tests/e2e/admin-ui.spec.ts
 */

import { useState, useEffect, useRef } from 'react';
import type { VendorRecommendation, OverrideCategory } from '../types';
import { submitOverride, ApiServiceError } from '../services/api';

interface OverrideModalProps {
  jobId: string;
  originalVendor: VendorRecommendation;
  selectedVendor: VendorRecommendation;
  onClose: () => void;
  onComplete: () => void;
}

const OVERRIDE_CATEGORIES: { value: OverrideCategory; label: string; description: string }[] = [
  { value: 'preference', label: 'Customer Preference', description: 'Customer requested a specific vendor' },
  { value: 'availability', label: 'Availability Issue', description: 'Recommended vendor is not actually available' },
  { value: 'relationship', label: 'Vendor Relationship', description: 'Existing relationship or contract requirements' },
  { value: 'other', label: 'Other', description: 'Other reason not listed above' },
];

export function OverrideModal({
  jobId,
  originalVendor,
  selectedVendor,
  onClose,
  onComplete,
}: OverrideModalProps) {
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<OverrideCategory>('preference');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);

  // Focus management for accessibility
  useEffect(() => {
    // Focus the close button when modal opens
    closeButtonRef.current?.focus();

    // Trap focus within modal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }

      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!reason.trim()) {
      errors.reason = 'Override reason is required';
    } else if (reason.trim().length < 10) {
      errors.reason = 'Please provide a more detailed reason (at least 10 characters)';
    } else if (reason.length > 1000) {
      errors.reason = 'Reason must be 1000 characters or less';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      reasonInputRef.current?.focus();
      return;
    }

    try {
      setSubmitting(true);
      await submitOverride({
        jobId,
        originalVendorId: originalVendor.vendorId,
        selectedVendorId: selectedVendor.vendorId,
        overrideReason: reason.trim(),
        overrideCategory: category,
      });
      onComplete();
    } catch (err) {
      if (err instanceof ApiServiceError) {
        if (err.details?.details) {
          const newFieldErrors: Record<string, string> = {};
          err.details.details.forEach(detail => {
            if (detail.field === 'overrideReason') {
              newFieldErrors.reason = detail.message;
            }
          });
          setFieldErrors(newFieldErrors);
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit override');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isSelectingDifferentVendor = originalVendor.vendorId !== selectedVendor.vendorId;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="override-modal-title"
      aria-describedby="override-modal-description"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" ref={modalRef}>
        <div className="modal-header">
          <h2 id="override-modal-title" className="modal-title">
            {isSelectingDifferentVendor ? 'Override Recommendation' : 'Confirm Selection'}
          </h2>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
            type="button"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p id="override-modal-description" style={{ marginTop: 0 }}>
              {isSelectingDifferentVendor ? (
                <>
                  You are overriding the AI recommendation of{' '}
                  <strong>{originalVendor.vendorName}</strong> (Score: {Math.round(originalVendor.overallScore * 100)})
                  {' '}with <strong>{selectedVendor.vendorName}</strong> (Score: {Math.round(selectedVendor.overallScore * 100)}).
                </>
              ) : (
                <>
                  You are selecting <strong>{selectedVendor.vendorName}</strong> for this job.
                </>
              )}
            </p>

            {/* Category selection */}
            <div className="form-group">
              <label htmlFor="override-category" className="form-label">
                Override Category <span aria-hidden="true">*</span>
                <span className="sr-only">(required)</span>
              </label>
              <select
                id="override-category"
                className="form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as OverrideCategory)}
                required
                aria-describedby="category-description"
              >
                {OVERRIDE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <p
                id="category-description"
                style={{
                  marginTop: 'var(--spacing-xs)',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-gray-600)',
                }}
              >
                {OVERRIDE_CATEGORIES.find((c) => c.value === category)?.description}
              </p>
            </div>

            {/* Reason input */}
            <div className="form-group">
              <label htmlFor="override-reason" className="form-label">
                Override Reason <span aria-hidden="true">*</span>
                <span className="sr-only">(required)</span>
              </label>
              <textarea
                ref={reasonInputRef}
                id="override-reason"
                className={`form-textarea ${fieldErrors.reason ? 'error' : ''}`}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (fieldErrors.reason) {
                    setFieldErrors((prev) => ({ ...prev, reason: '' }));
                  }
                }}
                placeholder="Please explain why you are overriding the AI recommendation..."
                rows={4}
                required
                aria-required="true"
                aria-invalid={!!fieldErrors.reason}
                aria-describedby={fieldErrors.reason ? 'reason-error' : 'reason-hint'}
                maxLength={1000}
              />
              {fieldErrors.reason ? (
                <p id="reason-error" className="form-error" role="alert">
                  {fieldErrors.reason}
                </p>
              ) : (
                <p
                  id="reason-hint"
                  style={{
                    marginTop: 'var(--spacing-xs)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-gray-600)',
                  }}
                >
                  {reason.length}/1000 characters
                </p>
              )}
            </div>

            {/* General error */}
            {error && (
              <div
                role="alert"
                style={{
                  padding: 'var(--spacing-md)',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--spacing-md)',
                }}
              >
                {error}
              </div>
            )}

            {/* Warning about audit trail */}
            <div
              style={{
                marginTop: 'var(--spacing-md)',
                padding: 'var(--spacing-md)',
                backgroundColor: 'var(--color-gray-100)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              <strong>Note:</strong> This override will be logged to the audit trail with your operator ID,
              timestamp, and the reason provided.
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !reason.trim()}
              aria-busy={submitting}
            >
              {submitting ? 'Submitting...' : 'Confirm Override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
