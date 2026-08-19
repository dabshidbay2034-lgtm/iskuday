import type { UserRole } from "@/lib/types";
import { PERMISSIONS } from "@/lib/permissions";
import { lazy, Suspense, useMemo } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import BillingGate from "@/components/BillingGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import AnalyticsBridge from "@/components/AnalyticsBridge";
import AcceptInvitesOnSignIn from "@/components/hotel/AcceptInvitesOnSignIn";
import TenantRoutes from "@/components/hotel/TenantRoutes";
import { resolveTenant } from "@/lib/tenant";

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
const About = lazy(() => import("./pages/About"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Properties = lazy(() => import("./pages/Properties"));
const SignIn = lazy(() => import("./pages/SignIn"));
const SignUp = lazy(() => import("./pages/SignUp"));
const AddProperty = lazy(() => import("./pages/AddProperty"));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const Saved = lazy(() => import("./pages/Saved"));
const Admin = lazy(() => import("./pages/Admin"));
const Showcase = lazy(() => import("./pages/Showcase"));
const SemiAdmin = lazy(() => import("./pages/SemiAdmin"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Team = lazy(() => import("./pages/Team"));
// Property-management + services surfaces (docs/PLAN_PMS_SERVICES.md).
const Manage = lazy(() => import("./pages/Manage"));
const ManageProperty = lazy(() => import("./pages/ManageProperty"));
const HotelManager = lazy(() => import("./pages/HotelManager"));
const HotelPage = lazy(() => import("./pages/HotelPage"));
const ManageHotels = lazy(() => import("./pages/ManageHotels"));
const EditHotel = lazy(() => import("./pages/EditHotel"));
const StaffManager = lazy(() => import("./pages/StaffManager"));
const PayrollPage = lazy(() => import("./pages/PayrollPage"));
const StaffAttendance = lazy(() => import("./pages/StaffAttendance"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const Services = lazy(() => import("./pages/Services"));
const AdminServices = lazy(() => import("./pages/AdminServices"));
const AgencyProfile = lazy(() => import("./pages/AgencyProfile"));
const JoinHotel = lazy(() => import("./pages/JoinHotel"));
const Billing = lazy(() => import("./pages/Billing"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The default staleTime of 0 refetches on every mount AND every window
      // focus, so each navigation re-pulled the whole property list with its
      // joined property_images, and every return to the PWA did it again. On
      // the connections our renters actually have, that is the single most
      // expensive thing the app does. Listings do not change minute to minute.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      // Never retry auth/permission failures. A 401 means the JWT was rejected
      // and a 403 means RLS said no â€” neither changes by asking again, and
      // retrying turns one rejected request into four identical ones.
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

/**
 * Which site are we? Resolved from the hostname ONCE, at module scope.
 *
 * `jazeera.mogadishurents.com` must serve that hotel's own website, not the
 * marketplace with a hotel page inside it. The host cannot change without a
 * full page load, so this never needs to be reactive â€” and resolving it here
 * means the platform's routes are never even mounted on a tenant host.
 *
 * Locally there is no wildcard cert, so `resolveTenant` also honours
 * `<sub>.localhost:8080` and `?__tenant=<sub>` â€” see docs/SUBDOMAINS.md.
 */
/*
 * WHY resolveTenant() IS NOT AT MODULE SCOPE
 *
 * It used to be `const tenant = resolveTenant()` right here, which read fine
 * and quietly made the whole app impossible to render outside a browser:
 * resolveTenant() reads window.location, so merely IMPORTING App.tsx in Node
 * threw before a single component ran. That was the one thing standing between
 * this project and build-time prerendering, which is what puts real HTML in
 * front of a crawler instead of an empty shell.
 *
 * useMemo with an empty dependency list keeps the property that mattered --
 * resolved once, never re-run on a re-render -- while deferring the window
 * read to render time, where a browser exists.
 */
const App = () => {
  const tenant = useMemo(() => resolveTenant(), []);

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/*
        Opted into both React Router v7 behaviours early.

        These were emitting a deprecation warning per page load. Turning them on
        now means the eventual v7 upgrade is a version bump rather than a
        behaviour change discovered in production:

          v7_startTransition   — route state updates are wrapped in
            React.startTransition, so a slow lazy route no longer blocks the
            current screen from responding while it loads. Every page here is
            already lazy + Suspense, so this is the behaviour the app was
            written for.

          v7_relativeSplatPath — fixes how relative paths resolve INSIDE splat
            routes. This app has two (`/signin/*`, `/signup/*`) and both render
            a Clerk component configured with an ABSOLUTE `path="/signin"`,
            with no relative `to=`/`navigate()` beneath them — so there is
            nothing whose resolution can change.
      */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* Inside the router (needs useLocation) and outside the boundary, so a
            crashed page still reports the route it happened on. */}
        <AnalyticsBridge />
        {/* Claims any hotel-team invitations addressed to this user's email,
            once per session. Renders nothing; lives here rather than on a page
            so an invitee lands on their hotel wherever they happen to sign in. */}
        <AcceptInvitesOnSignIn />
        {/* Inside the router so the fallback's "Go home" and any future
            navigation have a router context to work with. */}
        <ErrorBoundary>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>}>
          {tenant.kind === "hotel" ? (
            <TenantRoutes subdomain={tenant.subdomain} />
          ) : (
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/about" element={<About />} />
            <Route path="/showcase" element={<Showcase />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/properties" element={<Properties />} />
            {/* Path-based category pages — /properties/3-bedroom-apartments-in-mogadishu.
                Same component, filters forced from the slug. The catalogue of valid
                slugs and the reasoning live in src/lib/facets.ts; an unrecognised one
                renders the 404 rather than an empty category page. */}
            <Route path="/properties/:facetSlug" element={<Properties />} />
            {/* Splat routes are required: Clerk's path-based routing renders its
                own sub-paths (/signin/factor-one, /signup/sso-callback,
                /signup/verify-email-address, ...). An exact path match sends the
                OAuth callback to NotFound and the sign-in flow dead-ends. */}
            <Route path="/signin/*" element={<SignIn />} />
            <Route path="/signup/*" element={<SignUp />} />
            <Route path="/complete-profile" element={<ProtectedRoute><CompleteProfile /></ProtectedRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/add-property" element={<ProtectedRoute allowedRoles={['owner', 'agent', 'hotel_manager']}><AddProperty /></ProtectedRoute>} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            {/* Hotel team invite. Deliberately public: the token in the URL is
                the credential, and the page itself routes a signed-out visitor
                through sign-in and back rather than burning the invite. */}
            <Route path="/join/:token" element={<JoinHotel />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['owner', 'agent', 'hotel_manager']}><Dashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
            <Route path="/saved" element={<ProtectedRoute><Saved /></ProtectedRoute>} />
            {/* Plans, trial status and payment history (20260816000001).

                Signed-in only, and deliberately NOT gated on allowedRoles or an
                org permission. Everyone who can reach a paid surface has to be
                able to reach the page explaining what it costs â€” including an
                agency's staff, who are often the ones who actually make the
                EVC/Zaad transfer. A role gate here would hide the price list
                from the person paying it, and every paywall in the app points
                at this route. */}
            <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
            <Route path="/admin-panel" element={<ProtectedRoute allowedRoles={['admin' as UserRole]}><Admin /></ProtectedRoute>} />
            <Route path="/semiadmin" element={<ProtectedRoute allowedRoles={['semi_admin' as UserRole, 'admin' as UserRole]}><SemiAdmin /></ProtectedRoute>} />
            {/* The hotel's own team, not a Clerk organization. Guarded on nothing but
                sign-in: `my_hotel_ids()` decides what the visitor can reach, and an
                INVITED member has no agency role and no org — gating on either would
                lock out exactly the people this page exists for. */}
            <Route path="/team" element={<ProtectedRoute><Team /></ProtectedRoute>} />

            {/* Property management â€” signed-in only, deliberately NOT gated on
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
            <Route path="/manage/property/:id" element={<ProtectedRoute><BillingGate plan="pms"><ManageProperty /></BillingGate></ProtectedRoute>} />
            {/* Front-desk hotel board (20260807000001) â€” bookings, housekeeping,
                            today's arrivals/departures across the managed hotel rooms.

                Hotel web pages (20260808000001) â€” the hotelier's page builder.

                NOT gated on allowedRoles, on purpose, same reasoning as the block
                above: hotel_managed() in the DB grants access to more than
                platform-role hotel_manager â€” org:admin/manager/agent staff, and
                per-hotel `hotel_members` (hotel_admin/hotel_editor, 20260810000002)
                invited onto a single hotel without ever holding the platform role
                themselves. An allowedRoles router gate is stricter than that and
                silently locks out every one of them before they ever reach the
                page. The "agency can't create a hotel" rule lives where it
                belongs â€” at CREATION time, in AddProperty's account-type filter
                and the properties/hotels INSERT triggers in
                20260812000002_account_type_separation.sql â€” not here. Someone
                with no route into a hotel simply finds an empty portfolio, same
                as every other /manage/* page. */}
                        <Route path="/manage/hotel" element={<ProtectedRoute><BillingGate plan="hotel"><HotelManager /></BillingGate></ProtectedRoute>} />
                                                <Route path="/manage/hotels" element={<ProtectedRoute><BillingGate plan="hotel"><ManageHotels /></BillingGate></ProtectedRoute>} />
                                                <Route path="/manage/hotels/:id" element={<ProtectedRoute><BillingGate plan="hotel"><EditHotel /></BillingGate></ProtectedRoute>} />
                                                {/* Team + payroll (20260810000001) â€” the operator's staff and pay runs. */}
                                                <Route path="/manage/staff" element={<ProtectedRoute><BillingGate plan="hotel"><StaffManager /></BillingGate></ProtectedRoute>} />
                                                <Route path="/manage/payroll" element={<ProtectedRoute><BillingGate plan="hotel"><PayrollPage /></BillingGate></ProtectedRoute>} />
                                                <Route path="/manage/attendance" element={<ProtectedRoute><BillingGate plan="hotel"><StaffAttendance /></BillingGate></ProtectedRoute>} />
                                                <Route path="/manage/analytics" element={<ProtectedRoute><BillingGate plan="hotel"><AnalyticsDashboard /></BillingGate></ProtectedRoute>} />

            {/* Public services catalog + agency/hotel profiles. */}
              <Route path="/services" element={<Services />} />
              <Route path="/agency/:orgId" element={<AgencyProfile />} />
              {/* Each hotel's public, customizable web page (20260808000001). */}
              <Route path="/hotels/:slug" element={<HotelPage />} />
              {/* A hotel's other published pages. /hotels/:slug stays the MAIN page
                  whichever one the hotel designates, so promoting a different page
                  never changes the URL the listings and the sitemap point at. */}
              <Route path="/hotels/:slug/:pageSlug" element={<HotelPage />} />
              <Route path="/admin/services" element={<ProtectedRoute allowedRoles={['admin' as UserRole]}><AdminServices /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          )}
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;

