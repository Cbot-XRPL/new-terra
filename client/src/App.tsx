import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import PublicLayout from './layouts/PublicLayout';
import PortalLayout from './layouts/PortalLayout';
import HomePage from './pages/public/HomePage';
import ContactPage from './pages/public/ContactPage';
import LoginPage from './pages/auth/LoginPage';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';
import CustomerDashboard from './pages/portal/CustomerDashboard';
import StaffDashboard from './pages/portal/StaffDashboard';
import AdminDashboard from './pages/portal/AdminDashboard';
import ProjectsListPage from './pages/portal/ProjectsListPage';
import ProjectDetailPage from './pages/portal/ProjectDetailPage';
import InvoicesPage from './pages/portal/InvoicesPage';

function PortalIndex() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'CUSTOMER') return <Navigate to="/portal/customer" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/portal/admin" replace />;
  return <Navigate to="/portal/staff" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Route>

      <Route
        path="/portal"
        element={
          <RequireAuth>
            <PortalLayout />
          </RequireAuth>
        }
      >
        <Route index element={<PortalIndex />} />
        <Route
          path="customer"
          element={
            <RequireAuth roles={['CUSTOMER']}>
              <CustomerDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="staff"
          element={
            <RequireAuth roles={['EMPLOYEE', 'SUBCONTRACTOR', 'ADMIN']}>
              <StaffDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireAuth roles={['ADMIN']}>
              <AdminDashboard />
            </RequireAuth>
          }
        />
        <Route path="projects" element={<ProjectsListPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
