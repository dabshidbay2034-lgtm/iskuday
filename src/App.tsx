import type { UserRole } from "@/lib/types";
import { PERMISSIONS } from "@/lib/permissions";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
const About = lazy(() => import("./pages/About"));
const Properties = lazy(() => import("./pages/Properties"));
const SignIn = lazy(() => import("./pages/SignIn"));
const SignUp = lazy(() => import("./pages/SignUp"));
const AddProperty = lazy(() => import("./pages/AddProperty"));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const Saved = lazy(() => import("./pages/Saved"));
const Admin = lazy(() => import("./pages/Admin"));
const SemiAdmin = lazy(() => import("./pages/SemiAdmin"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Team = lazy(() => import("./pages/Team"));
// Property-management + services surfaces (docs/PLAN_PMS_SERVICES.md).
const Manage = lazy(() => import("./pages/Manage"));
const ManageProperty = lazy(() => import("./pages/ManageProperty"));
const Services = lazy(() => import("./pages/Services"));
const AdminServices = lazy(() => import("./pages/AdminServices"));
const AgencyProfile = lazy(() => import("./pages/AgencyProfile"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry auth/permission failures. A 401 means the JWT was rejected
      // and a 403 means RLS said no — neither changes by asking again, and
      // retrying turns one rejected request into four identical ones.
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/about" element={<About />} />
            <Route path="/properties" element={<Properties />} />
            {/* Splat routes are required: Clerk's path-based routing renders its
                own sub-paths (/signin/factor-one, /signup/sso-callback,
                /signup/verify-email-address, ...). An exact path match sends the
                OAuth callback to NotFound and the sign-in flow dead-ends. */}
            <Route path="/signin/*" element={<SignIn />} />
            <Route path="/signup/*" element={<SignUp />} />
            <Route path="/complete-profile" element={<ProtectedRoute><CompleteProfile /></ProtectedRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/add-property" element={<ProtectedRoute allowedRoles={['owner', 'agent']}><AddProperty /></ProtectedRoute>} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['owner', 'agent', 'hotel_manager']}><Dashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
            <Route path="/saved" element={<ProtectedRoute><Saved /></ProtectedRoute>} />
            <Route path="/admin-panel" element={<ProtectedRoute allowedRoles={['admin' as UserRole]}><Admin /></ProtectedRoute>} />
            <Route path="/semiadmin" element={<ProtectedRoute allowedRoles={['semi_admin' as UserRole, 'admin' as UserRole]}><SemiAdmin /></ProtectedRoute>} />
            <Route path="/team" element={<ProtectedRoute requireOrg={true} requirePermission={PERMISSIONS.STAFF_MANAGE}><Team /></ProtectedRoute>} />

            {/* Property management — signed-in only, deliberately NOT gated on
                requireOrg or an org permission.

                A solo landlord has no Clerk organization, so requireOrg would
                lock them out, and can(RENT_VIEW) resolves false for them since
                it derives from the org role. Gating here would have re-broken
                the exact users the nullable-org_id work exists to serve.

                It is safe to be permissive: every PMS table's RLS scopes rows to
                `org matches` OR `owns_property(...)`, so a signed-in user with
                neither sees an empty dashboard and nothing else. Mutating
                actions stay gated inside the pages. */}
            <Route path="/manage" element={<ProtectedRoute><Manage /></ProtectedRoute>} />
            <Route path="/manage/property/:id" element={<ProtectedRoute><ManageProperty /></ProtectedRoute>} />

            {/* Public services catalog + agency/hotel profiles. */}
            <Route path="/services" element={<Services />} />
            <Route path="/agency/:orgId" element={<AgencyProfile />} />
            <Route path="/admin/services" element={<ProtectedRoute allowedRoles={['admin' as UserRole]}><AdminServices /></ProtectedRoute>} />
            {/* HotelProfile routes removed */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
