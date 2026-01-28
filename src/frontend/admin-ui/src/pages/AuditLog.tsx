/**
 * Audit Log Page
 *
 * Displays all accept and override actions with full audit trail.
 *
 * @requirement 6.4 - Audit trail for all AI decisions and human interventions
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: 'accept' | 'override';
  jobId: string;
  vendorId: string;
  vendorName?: string;
  originalVendorId?: string;
  originalVendorName?: string;
  reason?: string;
  category?: string;
  operatorId: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  retrievedAt: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AuditLog() {
  const [auditData, setAuditData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAuditLog = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/audit`);
      if (!response.ok) {
        throw new Error('Failed to fetch audit log');
      }
      const data = await response.json();
      setAuditData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuditLog();
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadAuditLog, 10000);
    return () => clearInterval(interval);
  }, [loadAuditLog]);

  return (
    <main id="main-content" role="main" aria-label="Audit Log">
      <div className="container" style={{ padding: 'var(--spacing-lg) var(--spacing-md)' }}>
        <div className="page-header">
          <div>
            <h1>Audit Log</h1>
            <p style={{ color: 'var(--color-gray-600)', margin: 'var(--spacing-xs) 0 0' }}>
              All vendor assignments and overrides with reasons
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <Link to="/" className="btn btn-secondary">
              ← Back to Jobs
            </Link>
            <button
              className="btn btn-primary"
              onClick={loadAuditLog}
              aria-label="Refresh audit log"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div
            role="alert"
            style={{
              padding: 'var(--spacing-md)',
              backgroundColor: 'var(--color-danger)',
              color: 'var(--color-white)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--spacing-lg)',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && !auditData && (
          <div
            role="status"
            aria-live="polite"
            style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}
          >
            Loading audit log...
          </div>
        )}

        {/* Audit entries */}
        {auditData && (
          <>
            <div
              style={{
                marginBottom: 'var(--spacing-md)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-gray-600)',
              }}
            >
              {auditData.total} entries • Last updated: {formatDate(auditData.retrievedAt)}
            </div>

            {auditData.entries.length === 0 ? (
              <div className="card" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
                <p style={{ color: 'var(--color-gray-600)' }}>
                  No audit entries yet. Accept or override a recommendation to see entries here.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                {auditData.entries.map((entry) => (
                  <article
                    key={entry.id}
                    className="card"
                    style={{
                      border: entry.action === 'override' 
                        ? '2px solid var(--color-warning)' 
                        : '2px solid var(--color-success)',
                    }}
                  >
                    <div className="card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            <span
                              className="badge"
                              style={{
                                backgroundColor: entry.action === 'override' 
                                  ? 'var(--color-warning)' 
                                  : 'var(--color-success)',
                                color: entry.action === 'override' ? '#000' : 'var(--color-white)',
                              }}
                            >
                              {entry.action === 'override' ? '⚠️ Override' : '✓ Accepted'}
                            </span>
                            <span style={{ fontWeight: 600 }}>
                              {entry.vendorName || entry.vendorId}
                            </span>
                          </div>
                          <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
                            Job: <code>{entry.jobId.slice(0, 8)}...</code> • 
                            Operator: {entry.operatorId} • 
                            {formatDate(entry.timestamp)}
                          </div>
                        </div>
                        <Link
                          to={`/jobs/${entry.jobId}`}
                          className="btn btn-secondary btn-sm"
                        >
                          View Job
                        </Link>
                      </div>

                      {/* Override details */}
                      {entry.action === 'override' && (
                        <div
                          style={{
                            marginTop: 'var(--spacing-md)',
                            padding: 'var(--spacing-md)',
                            backgroundColor: 'var(--color-warm-100)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
                            <strong>Original Recommendation:</strong> {entry.originalVendorName || entry.originalVendorId}
                          </div>
                          <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
                            <strong>Selected Instead:</strong> {entry.vendorName || entry.vendorId}
                          </div>
                          {entry.category && (
                            <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
                              <strong>Category:</strong> {entry.category}
                            </div>
                          )}
                          <div style={{ fontSize: 'var(--font-size-sm)' }}>
                            <strong>Reason:</strong> {entry.reason || 'No reason provided'}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
