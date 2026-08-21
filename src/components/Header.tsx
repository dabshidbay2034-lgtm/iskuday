import { useState, useEffect } from "react";
import InstallPWAButton from "@/components/InstallPWAButton";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menu, X, User, LogIn, Plus, LayoutDashboard, Settings, LogOut, Heart,
  ChevronDown, Shield, Eye, Home, Building2, Hotel, BedDouble, Store, LayoutGrid,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppAuth } from "@/hooks/use-auth";
import { accountKind } from "@/lib/account-type";
import { isNavItemActive, visibleNavItems } from "@/lib/nav";
import { useClerk } from "@clerk/clerk-react";

/**
 * The property categories, defined once and rendered in both navs.
 *
 * They used to be two hand-maintained lists — the desktop dropdown and the
 * mobile sheet — which is how the two drifted: BnB shipped as a property type
 * and was added to neither. One array means a new type appears in both places
 * or in neither.
 */
const PROPERTY_CATEGORIES = [
  { type: "villa", label: "Villas", Icon: Home },
  { type: "apartment", label: "Apartments", Icon: Building2 },
  { type: "hotel", label: "Hotels", Icon: Hotel },
  { type: "bnb", label: "BnB", Icon: BedDouble },
  { type: "commercial", label: "Commercial", Icon: Store },
] as const;

/**
 * One definition of what a top-level nav link looks like.
 *
 * There were eight copies of this string inline. Eight copies is how a bar ends
 * up with one link a shade off the others — and it is why the active state was
 * previously faked by hard-coding "Home" to the lit colour.
 */
const navLinkClass = (active: boolean) =>
  `px-4 py-2 text-sm font-semibold rounded-full transition-colors ${
    active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
  }`;

const Header = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isSignedIn, user, orgId, platformRole } = useAppAuth();
  // A hotel account adds rooms to its building, not properties to a portfolio.
  const isHotelAccount = accountKind(platformRole) === "hotel";

  // Who sees the "Manage" entry: agency staff (they have an active org) and
  // solo landlords (no org, but a listing-capable platform role). Renters see
  // nothing. This mirrors who actually has rows behind /manage — the route
  // itself is only signed-in-gated, since RLS does the real scoping.
  const canManageProperties =
    isSignedIn &&
    (Boolean(orgId) ||
      ['owner', 'agent', 'hotel_manager', 'admin'].includes(platformRole ?? ''));
  const navItems = visibleNavItems({
    canManageProperties: Boolean(canManageProperties),
    hasOrg: Boolean(orgId),
  });

  const { signOut } = useClerk();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const fullName = user?.fullName || user?.firstName || "User";
  const avatarUrl = user?.imageUrl;
  const email = user?.primaryEmailAddress?.emailAddress;

  const initials = fullName
    .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "U";

  return (
    <header className="sticky top-0 z-50 bg-background/85 backdrop-blur-xl border-b border-border/70">
      <div className="container flex items-center justify-between h-16 md:h-20">
        <Link to="/" className="flex items-center shrink-0">
          <img
            src="/logo-icon.svg"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icon-192.png"; }}
            alt="Mogadishu Rents"
            className="h-10 md:h-12 w-auto"
          />
        </Link>

        {/* Desktop nav — rendered from NAV_ITEMS so it cannot drift from the
            mobile sheet below. See src/lib/nav.ts for why there is a list. */}
        <nav className="hidden lg:flex items-center gap-1 p-1 rounded-full border border-border/70 bg-card/60">
          {navItems.map((item) =>
            item.id === "explore" ? (
              // The one entry with a menu. The category links used to be a
              // sibling called "Categories" pointing at the same route with a
              // filter — folding them in means Explore is one idea with five
              // shortcuts rather than two nav entries competing for it.
              <DropdownMenu key={item.id}>
                <DropdownMenuTrigger
                  // aria-current belongs here too, not only on the plain links.
                  // Explore is the entry a visitor is most often standing on,
                  // and rendering it as a menu button is a layout decision that
                  // must not cost a screen-reader user the "you are here".
                  aria-current={isNavItemActive(pathname, item.to) ? "page" : undefined}
                  className={`flex items-center gap-1 ${navLinkClass(isNavItemActive(pathname, item.to))} outline-none`}
                >
                  {item.label} <ChevronDown className="w-3.5 h-3.5" />
                </DropdownMenuTrigger>
                {/* Icons, not emoji.
                    Emoji render in each platform's own house style — Apple's 🏠
                    and Google's are different drawings in different palettes —
                    so a nav built from them looks like three different design
                    languages depending on the visitor's phone. The lucide set is
                    already the app's icon language; using it here means the menu
                    inherits the brand colour and stays consistent everywhere. */}
                <DropdownMenuContent align="start" className="w-52 rounded-2xl">
                  <DropdownMenuItem asChild>
                    <Link to="/properties" className="w-full rounded-lg gap-2 font-semibold">
                      <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                      All properties
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {PROPERTY_CATEGORIES.map(({ type, label, Icon }) => (
                    <DropdownMenuItem key={type} asChild>
                      <Link to={`/properties?type=${type}`} className="w-full rounded-lg gap-2">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                key={item.id}
                to={item.to}
                aria-current={isNavItemActive(pathname, item.to) ? "page" : undefined}
                className={navLinkClass(isNavItemActive(pathname, item.to))}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="hidden lg:flex items-center gap-2">
          <InstallPWAButton />
          {isSignedIn ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full font-semibold hover:bg-muted"
                onClick={() => navigate("/add-property")}
              >
                <Plus className="w-4 h-4" /> {isHotelAccount ? "Add a room" : "List your property"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-full border border-border bg-card pl-3 pr-1 py-1 shadow-card hover:shadow-elevated transition-shadow">
                    <Menu className="w-4 h-4 text-foreground" />
                    <Avatar className="w-7 h-7">
                      {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">{initials}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 rounded-2xl">
                  <div className="px-3 py-2.5">
                    <p className="text-sm font-semibold text-foreground truncate">{fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/dashboard")} className="rounded-lg">
                    <LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/saved")} className="rounded-lg">
                    <Heart className="w-4 h-4 mr-2" /> Saved
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/profile")} className="rounded-lg">
                    <Settings className="w-4 h-4 mr-2" /> Settings
                  </DropdownMenuItem>
                  {platformRole === "admin" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate("/admin-panel")} className="rounded-lg">
                        <Shield className="w-4 h-4 mr-2" /> Admin Panel
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/admin/services")} className="rounded-lg">
                        <Settings className="w-4 h-4 mr-2" /> Manage Services
                      </DropdownMenuItem>
                    </>
                  )}
                  {platformRole === "semi_admin" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate("/semiadmin")} className="rounded-lg">
                        <Eye className="w-4 h-4 mr-2" /> Overview Panel
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive rounded-lg">
                    <LogOut className="w-4 h-4 mr-2" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="rounded-full font-semibold" onClick={() => navigate("/signin")}>
                <LogIn className="w-4 h-4" /> Sign In
              </Button>
              <Button size="sm" className="rounded-full font-semibold px-5 shadow-card" onClick={() => navigate("/signup")}>Get Started</Button>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="lg:hidden flex items-center gap-2 rounded-full border border-border bg-card pl-3 pr-1 py-1 shadow-card"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X className="w-4 h-4 text-foreground" /> : <Menu className="w-4 h-4 text-foreground" />}
          <Avatar className="w-7 h-7">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="lg:hidden border-t border-border/70 bg-background overflow-hidden"
          >
            <div className="container py-4 flex flex-col gap-1">
              {/* Same list, same order, same words as the desktop bar. */}
              {navItems.map((item) => {
                const active = isNavItemActive(pathname, item.to);
                return (
                  <Link
                    key={item.id}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-colors ${
                      active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}

              {/* The category shortcuts sit directly under Explore, mirroring
                  the desktop dropdown rather than being a separate section with
                  its own heading further down the sheet. */}
              <div className="py-2 px-3">
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_CATEGORIES.map(({ type, label, Icon }) => (
                    <Link
                      key={type}
                      to={`/properties?type=${type}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border border-border hover:border-primary hover:text-primary transition-colors"
                      onClick={() => setIsOpen(false)}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="px-3"><InstallPWAButton /></div>

              <div className="mt-2 pt-3 border-t border-border/70 px-3">
                {isSignedIn ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 py-1">
                      <Avatar className="w-10 h-10">
                        {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm font-bold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{fullName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{email}</p>
                      </div>
                    </div>
                    <Button size="sm" className="rounded-full font-semibold w-full shadow-card" onClick={() => { navigate("/add-property"); setIsOpen(false); }}>
                      <Plus className="w-4 h-4" /> {isHotelAccount ? "Add a room" : "List your property"}
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => { navigate("/dashboard"); setIsOpen(false); }}>
                        <LayoutDashboard className="w-4 h-4" /> Dashboard
                      </Button>
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => { navigate("/profile"); setIsOpen(false); }}>
                        <Settings className="w-4 h-4" /> Settings
                      </Button>
                    </div>
                    {platformRole === "admin" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => { navigate("/admin-panel"); setIsOpen(false); }}>
                          <Shield className="w-4 h-4" /> Admin
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-full" onClick={() => { navigate("/admin/services"); setIsOpen(false); }}>
                          <Settings className="w-4 h-4" /> Services
                        </Button>
                      </div>
                    )}
                    {platformRole === "semi_admin" && (
                      <Button variant="outline" size="sm" className="rounded-full w-full" onClick={() => { navigate("/semiadmin"); setIsOpen(false); }}>
                        <Eye className="w-4 h-4" /> Overview Panel
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive justify-start rounded-full" onClick={() => { handleSignOut(); setIsOpen(false); }}>
                      <LogOut className="w-4 h-4" /> Sign Out
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button variant="outline" size="sm" className="flex-1 rounded-full font-semibold" onClick={() => { navigate("/signin"); setIsOpen(false); }}>
                      <LogIn className="w-4 h-4" /> Sign In
                    </Button>
                    <Button size="sm" className="flex-1 rounded-full font-semibold shadow-card" onClick={() => { navigate("/signup"); setIsOpen(false); }}>
                      Sign Up
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Header;
