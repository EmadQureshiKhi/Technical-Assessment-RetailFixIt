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
        borderBottom: '1px solid var(--color-gray-200)',
        padding: 'var(--spacing-md) 0',
      }}
    >
      <div className="container">
        <nav
          role="navigation"
          aria-label="Main navigation"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            to="/"
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: 700,
              color: 'var(--color-primary)',
              textDecoration: 'none',
            }}
            aria-label="RetailFixIt Admin - Home"
          >
            RetailFixIt Admin
          </Link>

          <ul
            style={{
              display: 'flex',
              gap: 'var(--spacing-lg)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              <Link
                to="/"
                style={{
                  color: isActive('/') ? 'var(--color-primary)' : 'var(--color-gray-700)',
                  textDecoration: 'none',
                  fontWeight: isActive('/') ? 600 : 400,
                  padding: 'var(--spacing-sm)',
                  borderBottom: isActive('/') ? '2px solid var(--color-primary)' : 'none',
                }}
                aria-current={isActive('/') ? 'page' : undefined}
              >
                Jobs
              </Link>
            </li>
            <li>
              <Link
                to="/audit"
                style={{
                  color: isActive('/audit') ? 'var(--color-primary)' : 'var(--color-gray-700)',
                  textDecoration: 'none',
                  fontWeight: isActive('/audit') ? 600 : 400,
                  padding: 'var(--spacing-sm)',
                  borderBottom: isActive('/audit') ? '2px solid var(--color-primary)' : 'none',
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
