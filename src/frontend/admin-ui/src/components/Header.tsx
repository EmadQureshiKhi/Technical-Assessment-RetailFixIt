/**
 * Header Component
 *
 * Main navigation header for the Admin UI.
 *
 * @requirement 5.1 - Admin UI navigation
 * @requirement 5.7 - Accessible navigation (WCAG 2.1 AA)
 */

import { Link, useLocation } from 'react-router-dom';

export function Header() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      role="banner"
      style={{
        backgroundColor: 'var(--color-white)',
        borderBottom: '1px solid var(--border-color)',
        padding: '0',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px' }}>
        <nav
          role="navigation"
          aria-label="Main navigation"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '64px',
          }}
        >
          <Link
            to="/"
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 700,
              color: 'var(--color-gray-900)',
              textDecoration: 'none',
              letterSpacing: '-0.025em',
              marginLeft: '-8px',
              padding: '8px',
            }}
            aria-label="RetailFixIt Admin - Home"
          >
            RetailFixIt
          </Link>

          <ul
            style={{
              display: 'flex',
              gap: 'var(--spacing-xs)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              <Link
                to="/"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  color: isActive('/') ? 'var(--color-gray-900)' : 'var(--color-gray-600)',
                  textDecoration: 'none',
                  fontWeight: 500,
                  fontSize: 'var(--font-size-sm)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isActive('/') ? 'var(--color-warm-200)' : 'transparent',
                  transition: 'all var(--transition-fast)',
                }}
                aria-current={isActive('/') ? 'page' : undefined}
              >
                Jobs
              </Link>
            </li>
            <li
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 4px',
              }}
            >
              <span
                style={{
                  width: '1px',
                  height: '20px',
                  backgroundColor: 'var(--color-gray-300)',
                }}
              />
            </li>
            <li>
              <Link
                to="/audit"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  color: isActive('/audit') ? 'var(--color-gray-900)' : 'var(--color-gray-600)',
                  textDecoration: 'none',
                  fontWeight: 500,
                  fontSize: 'var(--font-size-sm)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isActive('/audit') ? 'var(--color-warm-200)' : 'transparent',
                  transition: 'all var(--transition-fast)',
                }}
                aria-current={isActive('/audit') ? 'page' : undefined}
              >
                Audit Log
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
