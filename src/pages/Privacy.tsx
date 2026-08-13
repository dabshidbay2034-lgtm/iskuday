import { Link } from "react-router-dom";
import { BarChart3, Eye, Lock, ShieldCheck } from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle } from "@/lib/seo";

/**
 * Plain-language description of what the app measures.
 *
 * Exists because the app records anonymised session replays through PostHog,
 * and recording someone's screen without telling them anywhere is not a
 * defensible default. Deliberately short and specific rather than a generic
 * boilerplate policy: it should be readable, and every claim on it should be
 * one the code actually honours (see src/lib/analytics.ts).
 *
 * This is a disclosure, not a consent gate, and not legal advice — if the
 * business needs GDPR-style opt-in, that is a separate piece of work.
 */
const Privacy = () => {
  return (
    // Clearance for the fixed z-50 BottomNav lives on the root and is gated to
    // mobile, the way every other page does it — otherwise the nav is free to
    // land on the contact paragraph that closes the page.
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* Indexable on purpose. A visible, crawlable privacy page is one of the
          trust signals Google looks for on a site that handles enquiries, and
          it is the page users search for by name ("mogadishurents privacy"). */}
      <Seo
        title={buildTitle("Privacy & Analytics")}
        description="What MogadishuRents measures when you use the site and what it deliberately does not: usage analytics, anonymised session replay, and the data we never collect."
        canonical={absoluteUrl("/privacy")}
      />
      <Header />

      <main className="pt-20">
        <section className="py-12 md:py-16 bg-gradient-to-br from-primary/5 via-background to-secondary/5">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">
                Privacy &amp; analytics
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                What MogadishuRents measures when you use the site, and what it
                deliberately does not.
              </p>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto space-y-6">
              <Card
                icon={<BarChart3 className="w-5 h-5 text-primary" />}
                tone="bg-primary/10"
                title="Usage analytics"
              >
                We record which pages are opened, which searches are run, and
                which listings get contacted — so we can tell which districts and
                price ranges people actually want, and fix the parts of the site
                that don't work. This is measured with PostHog, an analytics
                service.
              </Card>

              <Card
                icon={<Eye className="w-5 h-5 text-success" />}
                tone="bg-success/10"
                title="Session recordings"
              >
                Some visits are recorded as an anonymised replay of on-screen
                actions — pages, clicks and scrolling — so we can see where people
                get stuck. <strong className="text-foreground">Everything you
                type into a form is hidden from these recordings</strong>, including
                your name, phone number, email and password.
              </Card>

              <Card
                icon={<Lock className="w-5 h-5 text-warning" />}
                tone="bg-warning/10"
                title="What we never send to analytics"
              >
                Your phone number, email address and the contents of the messages
                you send are never included in analytics. Contact details are
                stored in the database, readable only by you and platform
                administrators, and are used solely to connect you with a
                landlord or service provider.
              </Card>

              <Card
                icon={<ShieldCheck className="w-5 h-5 text-info" />}
                tone="bg-info/10"
                title="When you're signed in"
              >
                If you have an account, analytics events are linked to your
                account id and your role on the platform (renter, owner, agent),
                so we can tell those groups apart. They are not linked to your
                name or contact details.
              </Card>

              <div className="p-6 rounded-2xl bg-card border border-border shadow-card">
                <h2 className="text-lg font-heading font-semibold text-foreground mb-2">
                  Questions
                </h2>
                <p className="text-muted-foreground">
                  Email{" "}
                  <a
                    href="mailto:info@mogadishurents.com"
                    className="text-primary font-medium hover:underline"
                  >
                    info@mogadishurents.com
                  </a>{" "}
                  and we'll answer. You can also reach us through the details on
                  our <Link to="/about" className="text-primary font-medium hover:underline">About page</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
};

function Card({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 rounded-2xl bg-card border border-border shadow-card">
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl ${tone} flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-heading font-semibold text-foreground mb-1.5">
            {title}
          </h2>
          <p className="text-muted-foreground leading-relaxed">{children}</p>
        </div>
      </div>
    </div>
  );
}

export default Privacy;
