import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import PublicLayout from './layouts/PublicLayout';
import PortalLayout from './layouts/PortalLayout';
// Eager: critical paths users hit on first load. Auth + landing + the
// dashboards that PortalIndex routes into. Everything else is lazy so
// the initial JS bundle stays under the Vite 500 KB warning threshold.
import HomePage from './pages/public/HomePage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import CustomerDashboard from './pages/portal/CustomerDashboard';
import StaffDashboard from './pages/portal/StaffDashboard';
import AdminDashboard from './pages/portal/AdminDashboard';

// Lazy: every other page. Vite splits these into their own chunks. The
// Suspense boundary at the bottom catches them all with one shared
// loading fallback.
const ContactPage = lazy(() => import('./pages/public/ContactPage'));
const PublicGalleryPage = lazy(() => import('./pages/public/PublicGalleryPage'));
const SurveyPage = lazy(() => import('./pages/public/SurveyPage'));
const SignupPage = lazy(() => import('./pages/public/SignupPage'));
const PortfolioListPage = lazy(() => import('./pages/public/PortfolioListPage'));
const PortfolioDetailPage = lazy(() => import('./pages/public/PortfolioDetailPage'));
const ServiceDetailPage = lazy(() => import('./pages/public/ServiceDetailPage'));
const ProcessPage = lazy(() => import('./pages/public/ProcessPage'));
const AboutPage = lazy(() => import('./pages/public/AboutPage'));
const ProjectsListPage = lazy(() => import('./pages/portal/ProjectsListPage'));
const ProjectDetailPage = lazy(() => import('./pages/portal/ProjectDetailPage'));
const InvoicesPage = lazy(() => import('./pages/portal/InvoicesPage'));
const MessagesPage = lazy(() => import('./pages/portal/MessagesPage'));
const MessageBoardPage = lazy(() => import('./pages/portal/MessageBoardPage'));
const CalendarPage = lazy(() => import('./pages/portal/CalendarPage'));
const ContractTemplatesPage = lazy(() => import('./pages/portal/ContractTemplatesPage'));
const ContractsPage = lazy(() => import('./pages/portal/ContractsPage'));
const NewContractPage = lazy(() => import('./pages/portal/NewContractPage'));
const ContractDetailPage = lazy(() => import('./pages/portal/ContractDetailPage'));
const BulkImportPage = lazy(() => import('./pages/portal/BulkImportPage'));
const LeadsPage = lazy(() => import('./pages/portal/LeadsPage'));
const LeadDetailPage = lazy(() => import('./pages/portal/LeadDetailPage'));
const ProfilePage = lazy(() => import('./pages/portal/ProfilePage'));
const FinanceOverviewPage = lazy(() => import('./pages/portal/FinanceOverviewPage'));
const ExpensesPage = lazy(() => import('./pages/portal/ExpensesPage'));
const NewExpensePage = lazy(() => import('./pages/portal/NewExpensePage'));
const ExpenseDetailPage = lazy(() => import('./pages/portal/ExpenseDetailPage'));
const JobReceiptsPage = lazy(() => import('./pages/portal/JobReceiptsPage'));
const QuickBooksPage = lazy(() => import('./pages/portal/QuickBooksPage'));
const EstimatesPage = lazy(() => import('./pages/portal/EstimatesPage'));
const NewEstimatePage = lazy(() => import('./pages/portal/NewEstimatePage'));
const EstimateDetailPage = lazy(() => import('./pages/portal/EstimateDetailPage'));
const EstimatorVisualPage = lazy(() => import('./pages/portal/EstimatorVisualPage'));
const CompanySettingsPage = lazy(() => import('./pages/portal/CompanySettingsPage'));
const PortfolioAdminPage = lazy(() => import('./pages/portal/PortfolioAdminPage'));
const IntegrationsChecklistPage = lazy(() => import('./pages/portal/IntegrationsChecklistPage'));
const ProjectTimelinePage = lazy(() => import('./pages/portal/ProjectTimelinePage'));
const RecurringInvoicesPage = lazy(() => import('./pages/portal/RecurringInvoicesPage'));
const SubcontractorBillsPage = lazy(() => import('./pages/portal/SubcontractorBillsPage'));
const ProfitabilityPage = lazy(() => import('./pages/portal/ProfitabilityPage'));
const BankingPage = lazy(() => import('./pages/portal/BankingPage'));
const BankRulesPage = lazy(() => import('./pages/portal/BankRulesPage'));
const AssetsLiabilitiesPage = lazy(() => import('./pages/portal/AssetsLiabilitiesPage'));
const ReportsPage = lazy(() => import('./pages/portal/ReportsPage'));
const Form1099Page = lazy(() => import('./pages/portal/Form1099Page'));
const MileagePage = lazy(() => import('./pages/portal/MileagePage'));
const SatisfactionDashboardPage = lazy(() => import('./pages/portal/SatisfactionDashboardPage'));
const InventoryPage = lazy(() => import('./pages/portal/InventoryPage'));
const CalculatorsPage = lazy(() => import('./pages/portal/CalculatorsPage'));
const CatalogPage = lazy(() => import('./pages/portal/CatalogPage'));
const TimePage = lazy(() => import('./pages/portal/TimePage'));

function PortalIndex() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'CUSTOMER') return <Navigate to="/portal/customer" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/portal/admin" replace />;
  return <Navigate to="/portal/staff" replace />;
}

export default function App() {
  return (
    <Suspense fallback={
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    }>
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/portfolio" element={<PortfolioListPage />} />
        <Route path="/portfolio/:slug" element={<PortfolioDetailPage />} />
        <Route path="/services/:slug" element={<ServiceDetailPage />} />
        <Route path="/process" element={<ProcessPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/g/:token" element={<PublicGalleryPage />} />
        <Route path="/survey/:token" element={<SurveyPage />} />
        <Route path="/start" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
        <Route
          path="admin/settings"
          element={
            <RequireAuth roles={['ADMIN']}>
              <CompanySettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/portfolio"
          element={
            <RequireAuth roles={['ADMIN']}>
              <PortfolioAdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/integrations"
          element={
            <RequireAuth roles={['ADMIN']}>
              <IntegrationsChecklistPage />
            </RequireAuth>
          }
        />
        <Route path="projects" element={<ProjectsListPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/timeline" element={<ProjectTimelinePage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route
          path="invoices/recurring"
          element={
            <RequireAuth accountingAccess>
              <RecurringInvoicesPage />
            </RequireAuth>
          }
        />
        <Route
          path="subcontractor-bills"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR']}>
              <SubcontractorBillsPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/profitability"
          element={
            <RequireAuth accountingAccess>
              <ProfitabilityPage />
            </RequireAuth>
          }
        />
        <Route
          path="banking"
          element={
            <RequireAuth accountingAccess>
              <BankingPage />
            </RequireAuth>
          }
        />
        <Route
          path="banking/rules"
          element={
            <RequireAuth accountingAccess>
              <BankRulesPage />
            </RequireAuth>
          }
        />
        <Route
          path="banking/assets"
          element={
            <RequireAuth accountingAccess>
              <AssetsLiabilitiesPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/reports"
          element={
            <RequireAuth accountingAccess>
              <ReportsPage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/1099"
          element={
            <RequireAuth accountingAccess>
              <Form1099Page />
            </RequireAuth>
          }
        />
        <Route
          path="finance/mileage"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE']}>
              <MileagePage />
            </RequireAuth>
          }
        />
        <Route
          path="finance/satisfaction"
          element={
            <RequireAuth accountingAccess>
              <SatisfactionDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="catalog/inventory"
          element={
            <RequireAuth salesAccess>
              <InventoryPage />
            </RequireAuth>
          }
        />
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
          path="job-receipts"
          element={
            <RequireAuth submitExpense>
              <JobReceiptsPage />
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
        <Route path="estimates" element={<EstimatesPage />} />
        <Route
          path="estimates/new"
          element={
            <RequireAuth salesAccess>
              <NewEstimatePage />
            </RequireAuth>
          }
        />
        <Route path="estimates/:id" element={<EstimateDetailPage />} />
        <Route
          path="estimator/visual"
          element={
            <RequireAuth salesAccess>
              <EstimatorVisualPage />
            </RequireAuth>
          }
        />
        <Route
          path="calculators"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR']}>
              <CalculatorsPage />
            </RequireAuth>
          }
        />
        <Route
          path="catalog"
          element={
            <RequireAuth salesAccess>
              <CatalogPage />
            </RequireAuth>
          }
        />
        <Route
          path="time"
          element={
            <RequireAuth roles={['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR']}>
              <TimePage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
