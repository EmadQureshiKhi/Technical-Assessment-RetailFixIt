/**
 * Admin UI Application Root
 *
 * Main application component with routing and layout.
 *
 * @requirement 5.1 - Admin UI for operator interaction
 * @requirement 5.7 - Responsive and accessible (WCAG 2.1 AA)
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { JobList } from './pages/JobList';
import { JobDetail } from './pages/JobDetail';
import './styles/index.css';

function App() {
  return (
    <BrowserRouter>
      {/* Skip link for keyboard navigation - WCAG 2.1 AA */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Header />

      <Routes>
        <Route path="/" element={<JobList />} />
        <Route path="/jobs/:jobId" element={<JobDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
