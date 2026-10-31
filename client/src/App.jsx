import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading, EmptyState, Icon } from './components/ui.jsx';

import { LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage } from './pages/auth.jsx';
import DashboardPage from './pages/dashboard.jsx';
import { SubscriptionsPage, SubscriptionDetailPage } from './pages/subscriptions.jsx';
import { InvoicesPage, InvoiceDetailPage } from './pages/invoices.jsx';
import PaymentsPage from './pages/payments.jsx';
import BillingPage from './pages/billing.jsx';
import ReportsPage from './pages/reports.jsx';
import { ProductsPage, PlansPage, TaxesPage, TemplatesPage } from './pages/catalogue.jsx';
import DiscountsPage from './pages/discounts.jsx';
import { CustomersPage, CustomerDetailPage } from './pages/customers.jsx';
import { TeamPage, SettingsPage, MailPage } from './pages/admin.jsx';
import {
  PortalHomePage, PortalCatalogPage, PortalSubscriptionsPage, PortalInvoicesPage,
  PortalInvoiceDetailPage, PortalPaymentsPage, PortalProfilePage,
} from './pages/portal.jsx';

/** Blocks a route until the session is known. */
function Protected({ children, allow }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to={user.role === 'customer' ? '/portal' : '/app'} replace />;
  return children;
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-600/25">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round">
            <path d="M6 18V6h6.5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>
        <Loading label="Loading your workspace…" />
      </div>
    </div>
  );
}

/** Sends a signed-in user to the right home page. */
function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'customer' ? '/portal' : '/app'} replace />;
}

/** Admin-only routes. */
const ADMIN = ['admin'];
const INTERNAL = ['admin', 'staff'];

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<Landing />} />

      {/* Team workspace */}
      <Route path="/app" element={<Protected allow={INTERNAL}><Layout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="taxes" element={<TaxesPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="catalogue" element={<Navigate to="/app/products" replace />} />
        <Route path="discounts" element={<DiscountsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="team" element={<Protected allow={ADMIN}><TeamPage /></Protected>} />
        <Route path="mail" element={<MailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* Customer portal */}
      <Route path="/portal" element={<Protected allow={['customer', 'admin']}><Layout /></Protected>}>
        <Route index element={<PortalHomePage />} />
        <Route path="plans" element={<PortalCatalogPage />} />
        <Route path="subscriptions" element={<PortalSubscriptionsPage />} />
        <Route path="invoices" element={<PortalInvoicesPage />} />
        <Route path="invoices/:id" element={<PortalInvoiceDetailPage />} />
        <Route path="payments" element={<PortalPaymentsPage />} />
        <Route path="profile" element={<PortalProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="py-20">
      <EmptyState
        icon="search"
        title="Page not found"
        description="That page doesn't exist, or you don't have access to it."
        action={<a href="/" className="btn-primary btn-sm">Go to my home page</a>}
      />
    </div>
  );
}
