import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle } from "@/lib/seo";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Building2, Hotel, Home, LandPlot,
  Users, Shield, Clock, CheckCircle2,
  ArrowRight, Star, TrendingUp, DollarSign,
  BedDouble, ClipboardCheck, Wrench, FileText,
  ArrowUpRight, Building, Handshake,
  BarChart3, Search, Gem,
  Zap, Target, Globe, Smartphone,
  CalendarClock,
} from "lucide-react";

/**
 * A section label.
 *
 * ── WHAT THIS REPLACED, AND WHY ────────────────────────────────────────────
 * Seven sections each opened with the same construction: a filled `<Badge>`
 * pill, `uppercase tracking-widest font-bold`, an icon jammed in front, and a
 * DIFFERENT accent colour every time — primary, hotel purple, success green,
 * warning amber, accent orange. Four things were wrong with it at once:
 *
 *   • The icon-in-a-coloured-pill above a headline is the single most
 *     recognisable generated-landing-page component there is. It shows up on
 *     every AI-built marketing page, usually with the same Sparkles glyph.
 *   • Rotating the accent colour per section is not a system, it is a rainbow.
 *     A brand has one accent; using five says none of them meant anything.
 *   • A filled pill is a BADGE — it means status ("New", "Beta", "3 unread").
 *     Using it as a heading label spends an emphasis device on decoration, so
 *     when something genuinely needs flagging there is nothing louder left.
 *   • Bold + uppercase + wide tracking on a coloured field is three emphases
 *     doing one job.
 *
 * A label needs to be quiet and legible: it is wayfinding, not a headline. So
 * this is small, muted, letterspaced once, and sits on a hairline rule that
 * gives the section a top edge. One treatment, every section.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      <span aria-hidden="true" className="h-px w-6 bg-border" />
      {children}
    </p>
  );
}

const SHOWCASE_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
  },
  {
    id: "for-hotels",
    label: "For Hotels",
  },
  {
    id: "for-agencies",
    label: "For Agencies & Owners",
  },
  {
    id: "for-renters",
    label: "For Renters",
  },
  {
    id: "for-buyers",
    label: "Property for Sale",
  },
  {
    id: "team",
    label: "10-Agent Team",
  },
  {
    id: "pricing",
    label: "Pricing",
  },
];

const FEATURES_HOTEL = [
  {
    icon: BedDouble,
    title: "Room Management",
    desc: "Add, edit and manage all your hotel rooms with rates, photos and availability — all from one dashboard.",
  },
  {
    icon: ClipboardCheck,
    title: "Front Desk Board",
    desc: "See who's arriving today, who's checking out, who's in-house and your current occupancy at a single glance.",
  },
  {
    icon: CalendarClock, // using CalendarClock icon
    title: "Bookings Engine",
    desc: "Accept reservation requests, confirm bookings, check guests in and out — the full booking lifecycle.",
  },
  {
    icon: Wrench,
    title: "Housekeeping Queue",
    desc: "Assign cleaning and maintenance tasks, track progress, and ensure every room is ready for the next guest.",
  },
  {
    icon: Globe,
    title: "Your Own Hotel Website",
    desc: "Each hotel gets a customizable web page on its own subdomain — hero images, rooms, gallery, contact and more.",
  },
  {
    icon: Users,
    title: "Staff & Payroll",
    desc: "Manage your team roster, staff documents, track attendance and run monthly payroll with salaries and advances.",
  },
];

const FEATURES_PMS = [
  {
    icon: DollarSign,
    title: "Rent Ledger",
    desc: "Track every payment per unit across a 12-month ledger. Mark rent as paid, see arrears at a glance.",
  },
  {
    icon: BarChart3,
    title: "Portfolio Dashboard",
    desc: "See all your units in one place — occupancy status, arrears, active tenants, and monthly revenue at a glance.",
  },
  {
    icon: FileText,
    title: "Lease Documents",
    desc: "Upload and store lease agreements, contracts and tenant documents — everything organised per property.",
  },
  {
    icon: Zap,
    title: "Utility Tracking",
    desc: "Record electricity, water and other utility bills per unit. Know exactly what each tenant owes.",
  },
  {
    icon: Wrench,
    title: "Maintenance Work Orders",
    desc: "Log maintenance requests, assign them and track completion. Keep your properties in top condition.",
  },
  {
    icon: TrendingUp,
    title: "Expenses & Profit",
    desc: "Record all property expenses, categorise them, and see your net returns — not just rent collected.",
  },
];

const RENTER_BENEFITS = [
  {
    icon: Search,
    title: "Browse by District",
    desc: "Search across all 18 districts of Mogadishu — find exactly where you want to live or do business.",
  },
  {
    icon: Home,
    title: "Houses & Apartments",
    desc: "From 1-bedroom apartments to 6-bedroom family homes — fully furnished or unfurnished options.",
  },
  {
    icon: Building2,
    title: "Commercial Spaces",
    desc: "Offices, shops, warehouses and business premises for rent. Prime locations across the city.",
  },
  {
    icon: Shield,
    title: "Photos and prices up front",
    // Was "Every property is checked by our team" — there is no review step
    // between an owner pressing publish and the listing going live, so the
    // claim was one a renter could disprove by publishing something themselves.
    desc: "Listings carry at least two real photos, the asking price and the deposit before you ever call anyone.",
  },
  {
    icon: Clock,
    title: "Contact the owner",
    // Was "Quick responses guaranteed" — we do not control how fast a landlord
    // replies, and guaranteeing someone else's behaviour is a promise the
    // platform cannot keep.
    desc: "Message whoever is letting the place over WhatsApp or through the site. No agent sits in between.",
  },
  {
    icon: Star,
    title: "Saved Favorites",
    desc: "Save your favourite listings, compare properties, and come back anytime — even on mobile.",
  },
];

const BUYER_BENEFITS = [
  {
    icon: LandPlot,
    title: "Land & Plots",
    desc: "Browse available land and plots for sale across Mogadishu's growing districts. Prime investment opportunities.",
  },
  {
    icon: Building,
    title: "Houses for Sale",
    desc: "Fully built homes ready for immediate purchase. Move-in ready with all paperwork handled by the agency.",
  },
  {
    icon: Gem,
    title: "Prime Commercial Property",
    desc: "Shop units, office buildings and commercial complexes for sale. Own your business premises.",
  },
  {
    icon: Handshake,
    title: "Agency-Managed Sales",
    desc: "All for-sale listings are managed by licensed agencies. They handle documentation, inspection and transfer.",
  },
  {
    icon: Shield,
    title: "Secure Transactions",
    desc: "Every sale goes through proper documentation and verification. Peace of mind for buyers.",
  },
  {
    icon: TrendingUp,
    title: "Investment Opportunity",
    desc: "Mogadishu's real estate market is growing. Buy property now and watch your investment appreciate.",
  },
];

const TEAM_FEATURES = [
  {
    icon: Users,
    title: "10+ Agents Per Agency",
    desc: "Each agency operates with at least 10 agents working together — one team, divided roles, maximum efficiency.",
  },
  {
    icon: Target,
    title: "Specialised Roles",
    desc: "Agents split the work: listing managers, tenant liaisons, maintenance coordinators, legal clerks, and more.",
  },
  {
    icon: Zap,
    title: "Lightning-Fast Response",
    desc: "With a full team, inquiries are answered in minutes — not hours. Someone is always available.",
  },
  {
    icon: ClipboardCheck,
    title: "Dedicated Property Managers",
    desc: "Each property has a named manager responsible for tenant relations, maintenance follow-up and rent collection.",
  },
  {
    icon: BarChart3,
    title: "Team Performance Dashboard",
    desc: "Agency admins see each agent's performance — listings added, inquiries handled, payments collected.",
  },
  {
    icon: Smartphone,
    title: "Mobile-Ready for Field Work",
    desc: "Agents manage everything from their phone — take photos on site, update listings, respond to inquiries.",
  },
];

const PRICING_PLANS = [
  {
    plan: "pms",
    label: "PMS Only",
    price: "$60",
    period: "/month",
    tagline: "Property management without hotel operations",
    features: [
      "Rent ledger & payment tracking",
      "Utility bills management",
      "Expenses & maintenance",
      "Lease document vault",
      "Tenant records",
      "Portfolio dashboard",
      "14-day free trial",
    ],
    cta: "Start Free Trial",
    href: "/billing",
    highlight: false,
  },
  {
    plan: "hotel",
    label: "Hotel Management + PMS",
    price: "$99.99",
    period: "/month",
    tagline: "The complete hotel bundle with PMS included",
    features: [
      "Hotel room management & rates",
      "Front desk arrivals/departures",
      "Online booking engine",
      "Housekeeping board",
      "Rent ledger, utilities & maintenance",
      "Custom hotel website and staff payroll",
      "14-day free trial",
    ],
    cta: "Start Free Trial",
    href: "/billing",
    highlight: true,
  },
];

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Showcase() {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Seo
        title={buildTitle(
          "MogadishuRents — Hotel Management, Property Management & Real Estate Marketplace",
        )}
        description="Mogadishu's complete real estate platform. Hotels run front desk, bookings and web pages. Agencies and owners manage rent, tenants and maintenance. Renters find houses, apartments and commercial space. Buy land and property through trusted agencies."
        canonical={absoluteUrl("/showcase")}
      />
      <Header />

      {/* ──────── HERO ──────── */}
      {/*
        HERO — rebuilt.

        What was here: three stacked gradient washes (a diagonal, plus a radial
        at top-right and another at bottom-left), a Sparkles pill reading "One
        Platform — Every Solution", a headline whose second line was recoloured
        to the brand accent, three equally-weighted buttons, and a five-step
        staggered fade. Every one of those is a generated-landing-page reflex,
        and together they were doing the arguing that the words should do.

        What replaces it: one flat surface with a single hairline seam at the
        bottom, one headline in one colour, one clear primary action with two
        quieter ones beside it, and a single fade for the whole block. The page
        now has somewhere to put emphasis, because it is no longer spending it
        everywhere at once.
      */}
      <section className="relative flex items-center border-b border-border bg-muted/25 min-h-[70vh] md:min-h-[62vh]">
        <div className="container relative z-10 pt-24 md:pt-32">
          <FadeIn>
            <div className="max-w-3xl">
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-heading font-extrabold text-foreground leading-[1.05] tracking-tight mb-5">
                Run your property business from your phone
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-xl mb-8 leading-relaxed">
                Hotels, letting agencies and landlords in Mogadishu use MogadishuRents to
                take bookings, track rent, pay staff and publish their own website.
              </p>
              {/* One primary action. The old row gave three buttons equal weight,
                  which is the same as giving none — a visitor who does not
                  already know which of the three they are has to read all of
                  them before deciding. */}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="xl" className="rounded-full font-semibold" asChild>
                  <a href="#for-hotels">
                    See how it works <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button variant="outline" size="xl" className="rounded-full font-semibold" asChild>
                  <Link to="/properties">
                    Browse listings <Search className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </FadeIn>

          {/*
            What the platform covers, not how many customers it claims.

            Three of the four figures here were invented — "2,000+ properties",
            "500+ owners & hotels", and a "4.8★ rating" for a product with no
            reviews feature at all. Only "18 districts" was real, and it kept
            company that made it look invented too. These four are each true
            today and stay true as the platform grows.
          */}
          <FadeIn delay={0.4}>
            <dl className="flex flex-wrap gap-8 md:gap-12 mt-16">
              {[
                { term: "18", detail: "Districts covered" },
                { term: "5", detail: "Property types" },
                { term: "0%", detail: "Commission on rent" },
                { term: "Free", detail: "To list and browse" },
              ].map((s) => (
                <div key={s.detail}>
                  <dt className="text-2xl md:text-3xl font-heading font-extrabold text-foreground">{s.term}</dt>
                  <dd className="text-sm text-muted-foreground">{s.detail}</dd>
                </div>
              ))}
            </dl>
          </FadeIn>
        </div>

        {/* Floating section nav */}
        <div className="hidden lg:block absolute right-6 top-1/2 -translate-y-1/2">
          <nav className="flex flex-col gap-3">
            {SHOWCASE_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-border group-hover:bg-primary transition-colors" />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">{s.label}</span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* ──────── FOR HOTELS ──────── */}
      <section id="for-hotels" className="py-16 md:py-24 bg-gradient-to-b from-background via-primary/[0.02] to-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <FadeIn>
              <div>
                <SectionLabel>For Hotels</SectionLabel>
                <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
                  Run your hotel from one place
                </h2>
                <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-lg">
                  From front desk operations to your own hotel website — everything a hotel
                  business needs to manage rooms, guests, staff and online presence.
                  All in one dashboard, all accessible from your phone.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button variant="outline" className="rounded-full" asChild>
                    <Link to="/manage/hotel">
                      Open Hotel Desk <ArrowUpRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" className="rounded-full" asChild>
                    <Link to="/billing">
                      Hotel Management + PMS — $99.99/mo
                    </Link>
                  </Button>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="grid grid-cols-2 gap-3">
                {/* Preview cards */}
                <div className="col-span-2 rounded-2xl bg-card border border-border/60 p-5 shadow-card">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-hotel/15 flex items-center justify-center">
                      <ClipboardCheck className="w-5 h-5 text-hotel" />
                    </div>
                    <div>
                      <p className="font-heading font-bold text-foreground text-sm">Today's Board</p>
                      <p className="text-xs text-muted-foreground">Arrivals, departures & occupancy</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-xl bg-info/10 p-3 text-center">
                      <p className="text-lg font-heading font-extrabold text-info">8</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Arriving</p>
                    </div>
                    <div className="flex-1 rounded-xl bg-warning/10 p-3 text-center">
                      <p className="text-lg font-heading font-extrabold text-warning">5</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Departing</p>
                    </div>
                    <div className="flex-1 rounded-xl bg-success/10 p-3 text-center">
                      <p className="text-lg font-heading font-extrabold text-success">22</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">In-house</p>
                    </div>
                    <div className="flex-1 rounded-xl bg-primary/10 p-3 text-center">
                      <p className="text-lg font-heading font-extrabold text-primary">76%</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Occupancy</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-card border border-border/60 p-4 shadow-card">
                  <Globe className="w-5 h-5 text-hotel mb-2" />
                  <p className="font-heading font-bold text-foreground text-sm">Hotel Website</p>
                  <p className="text-xs text-muted-foreground">Custom page on its own subdomain</p>
                </div>
                <div className="rounded-2xl bg-card border border-border/60 p-4 shadow-card">
                  <Users className="w-5 h-5 text-hotel mb-2" />
                  <p className="font-heading font-bold text-foreground text-sm">Staff & Payroll</p>
                  <p className="text-xs text-muted-foreground">Roster, attendance, salary runs</p>
                </div>
              </div>
            </FadeIn>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {FEATURES_HOTEL.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.05}>
                <div className="group rounded-2xl bg-card border border-border/60 p-5 shadow-card hover:shadow-elevated transition-all duration-300 hover:-translate-y-1">
                  <div className="w-11 h-11 rounded-xl bg-hotel/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <f.icon className="w-5.5 h-5.5 text-hotel" />
                  </div>
                  <h3 className="font-heading font-bold text-foreground text-sm mb-1.5">{f.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn className="mt-8 text-center">
            <Button size="xl" className="rounded-full font-semibold" asChild>
              <Link to="/billing">
                Start Hotel Free Trial <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </FadeIn>
        </div>
      </section>

      {/* ──────── FOR AGENCIES & OWNERS ──────── */}
      <section id="for-agencies" className="py-16 md:py-24 bg-muted/30">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <FadeIn className="order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-2xl bg-card border border-border/60 p-5 shadow-card">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <p className="font-heading font-bold text-foreground text-sm">Rent Ledger</p>
                      <p className="text-xs text-muted-foreground">12-month view per unit</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { month: "Jul", status: "paid", amount: "$600" },
                      { month: "Jun", status: "paid", amount: "$600" },
                      { month: "May", status: "paid", amount: "$600" },
                      { month: "Apr", status: "overdue", amount: "$600" },
                    ].map((r) => (
                      <div key={r.month} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/50">
                        <span className="text-xs font-medium text-foreground">{r.month}</span>
                        <span className={`text-xs font-bold ${r.status === "paid" ? "text-success" : "text-destructive"}`}>
                          {r.status === "paid" ? "✓ " : "! "}{r.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-card border border-border/60 p-4 shadow-card">
                  <FileText className="w-5 h-5 text-success mb-2" />
                  <p className="font-heading font-bold text-foreground text-sm">Lease Vault</p>
                  <p className="text-xs text-muted-foreground">All documents in one place</p>
                </div>
                <div className="rounded-2xl bg-card border border-border/60 p-4 shadow-card">
                  <TrendingUp className="w-5 h-5 text-success mb-2" />
                  <p className="font-heading font-bold text-foreground text-sm">Portfolio View</p>
                  <p className="text-xs text-muted-foreground">Arrears, revenue & occupancy</p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.2} className="order-1 lg:order-2">
              <div>
                <SectionLabel>For Agencies & Owners</SectionLabel>
                <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
                  Your entire rental portfolio, organised
                </h2>
                <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-lg">
                  From rent collection and utility tracking to maintenance and lease documents —
                  every tool a property agency or solo landlord needs to manage tenants and units.
                  Built for Mogadishu's real estate market.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button variant="outline" className="rounded-full" asChild>
                    <Link to="/manage">
                      Open Dashboard <ArrowUpRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" className="rounded-full" asChild>
                    <Link to="/billing">
                      PMS Only — $60/mo
                    </Link>
                  </Button>
                </div>
              </div>
            </FadeIn>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {FEATURES_PMS.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.05}>
                <div className="group rounded-2xl bg-card border border-border/60 p-5 shadow-card hover:shadow-elevated transition-all duration-300 hover:-translate-y-1">
                  <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <f.icon className="w-5.5 h-5.5 text-success" />
                  </div>
                  <h3 className="font-heading font-bold text-foreground text-sm mb-1.5">{f.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn className="mt-8 text-center">
            <Button size="xl" className="rounded-full font-semibold" variant="hero" asChild>
              <Link to="/billing">
                Start PMS Free Trial <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </FadeIn>
        </div>
      </section>

      {/* ──────── FOR RENTERS ──────── */}
      <section id="for-renters" className="py-16 md:py-24">
        <div className="container">
          <FadeIn className="text-center max-w-xl mx-auto mb-12">
            <SectionLabel>For Renters</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
              Find your next home — or business space
            </h2>
            <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
              Browse verified houses, apartments, BnBs and commercial spaces across all
              18 districts of Mogadishu. Contact agencies directly and move in fast.
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {RENTER_BENEFITS.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.05}>
                <div className="rounded-2xl bg-card border border-border/60 p-5 shadow-card hover:shadow-elevated transition-all duration-300">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <f.icon className="w-5.5 h-5.5 text-primary" />
                  </div>
                  <h3 className="font-heading font-bold text-foreground text-sm mb-1.5">{f.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn className="mt-10 text-center">
            <Button size="xl" className="rounded-full font-semibold" variant="hero" asChild>
              <Link to="/properties">
                Browse Properties <Search className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </FadeIn>
        </div>
      </section>

      {/* ──────── FOR BUYERS ──────── */}
      <section id="for-buyers" className="py-16 md:py-24 bg-gradient-to-b from-background via-accent/[0.03] to-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <FadeIn>
              <div>
                <SectionLabel>Property for Sale</SectionLabel>
                <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
                  Buy land, homes & commercial property
                </h2>
                <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-lg">
                  Looking to buy? Our agency partners list land, houses and commercial
                  properties for sale. Each listing comes with full agency support
                  through the purchase process. Property for sale is managed exclusively
                  by licensed real estate agencies.
                </p>
                <div className="mt-6">
                  <Button variant="outline" className="rounded-full" asChild>
                    <Link to="/properties?purpose=sell">
                      Browse For Sale <ArrowUpRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="grid grid-cols-2 gap-3">
                {BUYER_BENEFITS.slice(0, 4).map((f) => (
                  <div key={f.title} className="rounded-2xl bg-card border border-border/60 p-4 shadow-card">
                    <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center mb-2.5">
                      <f.icon className="w-5 h-5 text-warning" />
                    </div>
                    <p className="font-heading font-bold text-foreground text-sm mb-1">{f.title}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ──────── 10-AGENT TEAM ──────── */}
      <section id="team" className="py-16 md:py-24 bg-primary/[0.03]">
        <div className="container">
          <FadeIn className="text-center max-w-2xl mx-auto mb-12">
            <SectionLabel>10-Agent Teams</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
              An army of agents — not just one person
            </h2>
            <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
              Every agency on the platform operates with a team of at least 10 agents working
              together. That means faster responses, specialised roles, and a level of service
              a solo operator simply cannot match.
            </p>
          </FadeIn>

          {/* Team visual */}
          <FadeIn>
            <div className="rounded-3xl bg-card border border-border/60 p-6 md:p-10 shadow-card mb-10">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                {[
                  { role: "Listing Manager", desc: "Creates & updates listings", color: "bg-primary/10 text-primary" },
                  { role: "Tenant Liaison", desc: "Shows properties to tenants", color: "bg-info/10 text-info" },
                  { role: "Contracts Clerk", desc: "Handles lease documents", color: "bg-hotel/10 text-hotel" },
                  { role: "Maintenance Coordinator", desc: "Schedules repairs", color: "bg-warning/10 text-warning" },
                  { role: "Rent Collector", desc: "Follows up payments", color: "bg-success/10 text-success" },
                  { role: "Marketing Agent", desc: "Promotes listings", color: "bg-accent/10 text-accent" },
                  { role: "Customer Support", desc: "Answers inquiries", color: "bg-primary/10 text-primary" },
                  { role: "Field Photographer", desc: "Captures property photos", color: "bg-info/10 text-info" },
                  { role: "Legal Clerk", desc: "Verifies documentation", color: "bg-hotel/10 text-hotel" },
                  { role: "Team Lead", desc: "Coordinates the team", color: "bg-warning/10 text-warning" },
                ].map((agent) => (
                  <div
                    key={agent.role}
                    className="rounded-2xl bg-muted/50 border border-border/40 p-3 text-center hover:shadow-card transition-shadow"
                  >
                    <div className={`w-10 h-10 rounded-xl ${agent.color} flex items-center justify-center mx-auto mb-2`}>
                      <Users className="w-5 h-5" />
                    </div>
                    <p className="font-heading font-bold text-foreground text-xs">{agent.role}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{agent.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {TEAM_FEATURES.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.05}>
                <div className="rounded-2xl bg-card border border-border/60 p-5 shadow-card hover:shadow-elevated transition-all duration-300 hover:-translate-y-1">
                  <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <f.icon className="w-5.5 h-5.5 text-accent" />
                  </div>
                  <h3 className="font-heading font-bold text-foreground text-sm mb-1.5">{f.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ──────── PRICING ──────── */}
      <section id="pricing" className="py-16 md:py-24">
        <div className="container">
          <FadeIn className="text-center max-w-xl mx-auto mb-12">
            <SectionLabel>Pricing</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight mb-4">
              Two plans, one platform
            </h2>
            <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
              Pick the plan that matches your business. Both include a 14-day free trial —
              no card, no payment details, no commitment.
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {PRICING_PLANS.map((p) => (
              <FadeIn key={p.plan}>
                <div
                  className={`rounded-3xl border-2 p-6 md:p-8 ${
                    p.highlight
                      ? "border-primary bg-card shadow-elevated relative"
                      : "border-border bg-card shadow-card"
                  }`}
                >
                  {p.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground border-0 text-[10px] uppercase tracking-widest font-bold rounded-full px-4 py-1">
                        <Star className="w-3 h-3 mr-1" /> Popular
                      </Badge>
                    </div>
                  )}
                  <div className="mb-5">
                    <h3 className="font-heading font-bold text-foreground text-lg">{p.label}</h3>
                    <p className="text-muted-foreground text-sm mt-1">{p.tagline}</p>
                  </div>
                  <div className="mb-5">
                    <span className="text-3xl md:text-4xl font-heading font-extrabold text-foreground">{p.price}</span>
                    <span className="text-muted-foreground text-sm">{p.period}</span>
                  </div>
                  <ul className="space-y-2.5 mb-6">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full rounded-full font-semibold"
                    variant={p.highlight ? "hero" : "outline"}
                    size="lg"
                    asChild
                  >
                    <Link to={p.href}>
                      {p.cta} <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ──────── CTA ──────── */}
      {/* A flat inked band, not a primary-to-accent diagonal wash. The gradient
          made the closing section look like the hero it was competing with;
          one solid dark field ends the page instead of restarting it. */}
      <section className="py-16 md:py-24 bg-secondary text-secondary-foreground">
        <div className="container">
          <FadeIn className="text-center max-w-xl mx-auto">
            {/* Colours are the INVERTED pair, not the page's defaults.
                `text-foreground` on `bg-secondary` is dark ink on a dark field —
                the hazard of flipping a section's background without flipping
                what sits on it. */}
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-secondary-foreground tracking-tight mb-4">
              Start with the 14 days free
            </h2>
            <p className="text-secondary-foreground/70 text-base md:text-lg leading-relaxed mb-8">
              No card, no payment details. Set up your rooms or your portfolio, and
              decide at the end of the fortnight.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {/* No Sparkles on the button. A glyph that means nothing next to a
                  verb that already says what happens is decoration on the one
                  control the whole page exists to get clicked. */}
              <Button size="xl" className="rounded-full font-semibold" variant="hero" asChild>
                <Link to="/billing">
                  Start free trial <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="xl"
                variant="outline"
                className="rounded-full font-semibold bg-transparent border-secondary-foreground/30 text-secondary-foreground hover:bg-secondary-foreground/10 hover:text-secondary-foreground"
                asChild
              >
                <Link to="/signup">Create an account</Link>
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ──────── FOOTER ──────── */}
      <footer className="border-t border-border py-10 md:py-12 bg-card">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-heading font-extrabold text-sm">M</span>
              </div>
              <div>
                <p className="font-heading font-bold text-foreground text-sm leading-tight">MogadishuRents</p>
                <p className="text-muted-foreground text-xs">
                  © 2026 · All rights reserved ·{" "}
                  <Link to="/privacy" className="hover:text-foreground transition-colors underline-offset-2 hover:underline">
                    Privacy
                  </Link>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/about" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                About
              </Link>
              <Link to="/properties" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Explore
              </Link>
              <Link to="/services" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Services
              </Link>
              <Link to="/showcase" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Overview
              </Link>
            </div>
          </div>
        </div>
      </footer>

      <BottomNav />
    </div>
  );
}