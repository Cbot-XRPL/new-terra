import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import PublicLayout from './layouts/PublicLayout';
import PortalLayout from './layouts/PortalLayout';
import HomePage from './pages/public/HomePage';
import ContactPage from './pages/public/ContactPage';
import LoginPage from './pages/auth/LoginPage';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import CustomerDashboard from './pages/portal/CustomerDashboard';
import StaffDashboard from './pages/portal/StaffDashboard';
import AdminDashboard from './pages/portal/AdminDashboard';
import ProjectsListPage from './pages/portal/ProjectsListPage';
import ProjectDetailPage from './pages/portal/ProjectDetailPage';
import InvoicesPage from './pages/portal/InvoicesPage';
import MessagesPage from './pages/portal/MessagesPage';
import MessageBoardPage from './pages/portal/MessageBoardPage';
import CalendarPage from './pages/portal/CalendarPage';
import ContractTemplatesPage from './pages/portal/ContractTemplatesPage';
import ContractsPage from './pages/portal/ContractsPage';
import NewContractPage from './pages/portal/NewContractPage';
import ContractDetailPage from './pages/portal/ContractDetailPage';
import BulkImportPage from './pages/portal/BulkImportPage';
import LeadsPage from './pages/portal/LeadsPage';
import LeadDetailPage from './pages/portal/LeadDetailPage';
import ProfilePage from './pages/portal/ProfilePage';
import FinanceOverviewPage from './pages/portal/FinanceOverviewPage';
import ExpensesPage from './pages/portal/ExpensesPage';
import NewExpensePage from './pages/portal/NewExpensePage';
import ExpenseDetailPage from './pages/portal/ExpenseDetailPage';
import QuickBooksPage from './pages/portal/QuickBooksPage';

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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        <Route path="messages" element={<MessagesPage />} />
        <Route
          path="board"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR']}>
              <MessageBoardPage />
            </RequireAuth>
          }
        />
        <Route
          path="calendar"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR']}>
              <CalendarPage />
            </RequireAuth>
          }
        />
        <Route
          path="contract-templates"
          element={
            <RequireAuth roles={['ADMIN']}>
              <ContractTemplatesPage />
            </RequireAuth>
          }
        />
        <Route path="contracts" element={<ContractsPage />} />
        <Route
          path="contracts/new"
          element={
            <RequireAuth salesAccess>
              <NewContractPage />
            </RequireAuth>
          }
        />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route
          path="bulk-import"
          element={
            <RequireAuth roles={['ADMIN']}>
              <BulkImportPage />
            </RequireAuth>
          }
        />
        <Route
          path="leads"
          element={
            <RequireAuth salesAccess>
              <LeadsPage />
            </RequireAuth>
          }
        />
        <Route
          path="leads/:id"
          element={
            <RequireAuth salesAccess>
              <LeadDetailPage />
            </RequireAuth>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="finance"
          element={
            <RequireAuth submitExpense>
              <FinanceOverviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/expenses"
          element={
            <RequireAuth submitExpense>
              <ExpensesPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/expenses/new"
          element={
            <RequireAuth submitExpense>
              <NewExpensePage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/expenses/:id"
          element={
            <RequireAuth submitExpense>
              <ExpenseDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/qb"
          element={
            <RequireAuth accountingAccess>
              <QuickBooksPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
