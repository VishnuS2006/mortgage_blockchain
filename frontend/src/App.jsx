import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import ConnectivityBanner from './components/ConnectivityBanner';
import ErrorBoundary from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import ProtectedRoute, { GuestRoute } from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WalletProvider } from './context/WalletRuntimeContext';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import ApplyLoan from './pages/borrower/ApplyLoan';
import Dashboard from './pages/borrower/Dashboard';
import Payment from './pages/borrower/Payment';
import UploadProperty from './pages/borrower/UploadProperty';
import LoadingSpinner from './components/LoadingSpinner';
import LenderDashboard from './pages/lender/Dashboard';
import Investments from './pages/lender/Investments';
import LoanBoard from './pages/lender/LoanBoard';
import LoanEmiDetails from './pages/lender/LoanEmiDetails';
import LenderWalletPage from './pages/lender/Wallet';
import PropertyView from './pages/shared/PropertyView';
import { getDefaultRouteForRole } from './utils/routing';
import './index.css';

function RoleHomeRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner text="Loading session..." />;
  }

  return <Navigate to={user ? getDefaultRouteForRole(user.role) : '/login'} replace />;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <>
      {user && <Navbar />}
      <ConnectivityBanner />
      <ErrorBoundary>
        <Routes>
          <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />

          <Route
            path="/borrower/dashboard"
            element={<ProtectedRoute allowedRoles={['borrower']}><Dashboard /></ProtectedRoute>}
          />
          <Route
            path="/borrower/upload-property"
            element={<ProtectedRoute allowedRoles={['borrower']}><UploadProperty /></ProtectedRoute>}
          />
          <Route
            path="/borrower/apply-loan"
            element={<ProtectedRoute allowedRoles={['borrower']}><ApplyLoan /></ProtectedRoute>}
          />
          <Route
            path="/borrower/payment"
            element={<ProtectedRoute allowedRoles={['borrower']}><Payment /></ProtectedRoute>}
          />

          <Route
            path="/lender/dashboard"
            element={<ProtectedRoute allowedRoles={['lender']}><LenderDashboard /></ProtectedRoute>}
          />
          <Route
            path="/lender/manage-loans"
            element={<ProtectedRoute allowedRoles={['lender']}><LoanBoard view="all" /></ProtectedRoute>}
          />
          <Route
            path="/lender/investments"
            element={<ProtectedRoute allowedRoles={['lender']}><Investments /></ProtectedRoute>}
          />
          <Route
            path="/lender/loan-emi/:loanId"
            element={<ProtectedRoute allowedRoles={['lender']}><LoanEmiDetails /></ProtectedRoute>}
          />
          <Route
            path="/lender/wallet"
            element={<ProtectedRoute allowedRoles={['lender']}><LenderWalletPage /></ProtectedRoute>}
          />

          <Route
            path="/dashboard"
            element={<ProtectedRoute allowedRoles={['borrower', 'lender']}><RoleHomeRedirect /></ProtectedRoute>}
          />
          <Route
            path="/upload-property"
            element={<ProtectedRoute allowedRoles={['borrower']}><Navigate to="/borrower/upload-property" replace /></ProtectedRoute>}
          />
          <Route
            path="/apply-loan"
            element={<ProtectedRoute allowedRoles={['borrower']}><Navigate to="/borrower/apply-loan" replace /></ProtectedRoute>}
          />
          <Route
            path="/payment"
            element={<ProtectedRoute allowedRoles={['borrower']}><Navigate to="/borrower/payment" replace /></ProtectedRoute>}
          />
          <Route
            path="/property/:loanId"
            element={<ProtectedRoute allowedRoles={['borrower', 'lender']}><PropertyView /></ProtectedRoute>}
          />

          <Route path="/" element={<RoleHomeRedirect />} />
          <Route path="*" element={<RoleHomeRedirect />} />
        </Routes>
      </ErrorBoundary>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <WalletProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: '12px',
              },
              success: { iconTheme: { primary: '#10b981', secondary: '#1e293b' } },
              error: { iconTheme: { primary: '#ef4444', secondary: '#1e293b' } },
            }}
          />
          <AppRoutes />
        </WalletProvider>
      </AuthProvider>
    </Router>
  );
}
