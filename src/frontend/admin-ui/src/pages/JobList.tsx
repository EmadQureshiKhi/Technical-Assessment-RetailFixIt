/**
 * Job List Page
 *
 * Displays a list of pending jobs with their recommendation status.
 * Supports filtering and sorting capabilities.
 *
 * @requirement 5.1 - Display list of pending jobs with recommendation status
 * @requirement 5.6 - Filtering and sorting capabilities
 * @requirement 5.7 - Responsive and accessible (WCAG 2.1 AA)
 * @tested tests/e2e/admin-ui.spec.ts
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Job, JobFilters, JobSortOptions, UrgencyLevel, JobStatus, JobType } from '../types';
import { fetchJobs } from '../services/api';

/**
 * Formats a date string for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calculates time remaining until SLA deadline
 */
function getTimeRemaining(deadline: string): { text: string; urgent: boolean } {
  const now = new Date();
  const sla = new Date(deadline);
  const diffMs = sla.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffMs < 0) {
    return { text: 'Overdue', urgent: true };
  }
  if (diffHours < 2) {
    return { text: `${diffHours}h ${diffMins}m`, urgent: true };
  }
  if (diffHours < 24) {
    return { text: `${diffHours}h`, urgent: false };
  }
  const diffDays = Math.floor(diffHours / 24);
  return { text: `${diffDays}d`, urgent: false };
}

/**
 * Badge component for urgency level
 */
function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  return (
    <span className={`badge badge-${level}`} role="status" aria-label={`Urgency: ${level}`}>
      {level}
    </span>
  );
}

/**
 * Badge component for job status
 */
function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge badge-${status}`} role="status" aria-label={`Status: ${status}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

/**
 * Badge component for recommendation status
 */
function RecommendationBadge({ status }: { status?: string }) {
  if (!status) return null;
  
  const colors: Record<string, string> = {
    pending: 'var(--color-gray-500)',
    generated: '#44403c',
    accepted: '#15803d',
    overridden: '#a16207',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs)',
        fontSize: 'var(--font-size-sm)',
        color: colors[status] || 'var(--color-gray-600)',
      }}
      role="status"
      aria-label={`Recommendation: ${status}`}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: colors[status] || 'var(--color-gray-400)',
        }}
        aria-hidden="true"
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<JobFilters>({});
  const [sort, setSort] = useState<JobSortOptions>({ field: 'slaDeadline', direction: 'asc' });

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJobs(filters, sort);
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [filters, sort]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleFilterChange = (key: keyof JobFilters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  const handleSortChange = (field: JobSortOptions['field']) => {
    setSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIndicator = (field: JobSortOptions['field']) => {
    if (sort.field !== field) return null;
    return sort.direction === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <main id="main-content" role="main" aria-label="Job List">
      <div className="container" style={{ padding: 'var(--spacing-lg) var(--spacing-md)' }}>
        <div className="page-header">
          <h1>Jobs Dashboard</h1>
          <button
            className="btn btn-secondary"
            onClick={loadJobs}
            aria-label="Refresh job list"
          >
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div
          className="card"
          style={{ marginBottom: 'var(--spacing-lg)' }}
          role="search"
          aria-label="Filter jobs"
        >
          <div className="card-body">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--spacing-md)',
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="filter-search" className="form-label">
                  Search
                </label>
                <input
                  id="filter-search"
                  type="search"
                  className="form-input"
                  placeholder="Job ID, city, address..."
                  value={filters.searchQuery || ''}
                  onChange={e => handleFilterChange('searchQuery', e.target.value)}
                  aria-describedby="search-hint"
                />
                <span id="search-hint" className="sr-only">
                  Search by job ID, city, or address
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="filter-status" className="form-label">
                  Status
                </label>
                <select
                  id="filter-status"
                  className="form-select"
                  value={filters.status || ''}
                  onChange={e => handleFilterChange('status', e.target.value)}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="filter-urgency" className="form-label">
                  Urgency
                </label>
                <select
                  id="filter-urgency"
                  className="form-select"
                  value={filters.urgencyLevel || ''}
                  onChange={e => handleFilterChange('urgencyLevel', e.target.value)}
                >
                  <option value="">All urgencies</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="filter-type" className="form-label">
                  Job Type
                </label>
                <select
                  id="filter-type"
                  className="form-select"
                  value={filters.jobType || ''}
                  onChange={e => handleFilterChange('jobType', e.target.value as JobType)}
                >
                  <option value="">All types</option>
                  <option value="repair">Repair</option>
                  <option value="installation">Installation</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
            </div>
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
        {loading && (
          <div
            role="status"
            aria-live="polite"
            style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}
          >
            <span aria-hidden="true">Loading...</span>
            <span className="sr-only">Loading jobs, please wait</span>
          </div>
        )}

        {/* Job table */}
        {!loading && !error && (
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" aria-label="Jobs table">
                <thead>
                  <tr>
                    <th scope="col">
                      <button
                        onClick={() => handleSortChange('slaDeadline')}
                        style={{
                          background: 'none',
                          border: 'none',
                          font: 'inherit',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        aria-label={`Sort by SLA deadline ${sort.field === 'slaDeadline' ? (sort.direction === 'asc' ? 'descending' : 'ascending') : ''}`}
                      >
                        SLA Deadline{getSortIndicator('slaDeadline')}
                      </button>
                    </th>
                    <th scope="col">Job ID</th>
                    <th scope="col">Type</th>
                    <th scope="col">Location</th>
                    <th scope="col">
                      <button
                        onClick={() => handleSortChange('urgencyLevel')}
                        style={{
                          background: 'none',
                          border: 'none',
                          font: 'inherit',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        aria-label={`Sort by urgency ${sort.field === 'urgencyLevel' ? (sort.direction === 'asc' ? 'descending' : 'ascending') : ''}`}
                      >
                        Urgency{getSortIndicator('urgencyLevel')}
                      </button>
                    </th>
                    <th scope="col">
                      <button
                        onClick={() => handleSortChange('status')}
                        style={{
                          background: 'none',
                          border: 'none',
                          font: 'inherit',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        aria-label={`Sort by status ${sort.field === 'status' ? (sort.direction === 'asc' ? 'descending' : 'ascending') : ''}`}
                      >
                        Status{getSortIndicator('status')}
                      </button>
                    </th>
                    <th scope="col">Recommendation</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
                        No jobs found matching your criteria
                      </td>
                    </tr>
                  ) : (
                    jobs.map(job => {
                      const timeRemaining = getTimeRemaining(job.slaDeadline);
                      return (
                        <tr key={job.jobId}>
                          <td>
                            <div>
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: timeRemaining.urgent ? 'var(--color-danger)' : 'inherit',
                                }}
                              >
                                {timeRemaining.text}
                              </span>
                              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
                                {formatDate(job.slaDeadline)}
                              </div>
                            </div>
                          </td>
                          <td>
                            <code style={{ fontSize: 'var(--font-size-sm)' }}>
                              {job.jobId.slice(0, 8)}...
                            </code>
                          </td>
                          <td style={{ textTransform: 'capitalize' }}>{job.jobType}</td>
                          <td>
                            <div>
                              {job.location.city}, {job.location.state}
                              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
                                {job.location.address}
                              </div>
                            </div>
                          </td>
                          <td>
                            <UrgencyBadge level={job.urgencyLevel} />
                          </td>
                          <td>
                            <StatusBadge status={job.status} />
                          </td>
                          <td>
                            <RecommendationBadge status={job.recommendationStatus} />
                          </td>
                          <td>
                            <Link
                              to={`/jobs/${job.jobId}`}
                              className="btn btn-primary btn-sm"
                              aria-label={`View details for job ${job.jobId.slice(0, 8)}`}
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Results summary */}
        {!loading && !error && (
          <div
            style={{
              marginTop: 'var(--spacing-md)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-gray-600)',
            }}
            aria-live="polite"
          >
            Showing {jobs.length} job{jobs.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </main>
  );
}
