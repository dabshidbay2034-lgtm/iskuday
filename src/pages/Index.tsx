import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { absoluteUrl } from "@/lib/seo";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import CategorySection from "@/components/CategorySection";
import DistrictSection from "@/components/DistrictSection";
import FeaturedProperties from "@/components/FeaturedProperties";
import BottomNav from "@/components/BottomNav";
import InstallBanner from "@/components/InstallBanner";
import { Shield, Clock, HeadphonesIcon, MessageCircle } from "lucide-react";

const features = [
  { icon: Shield, title: "Verified Listings", desc: "Every property is checked by our team" },
  { icon: Clock, title: "Instant Booking", desc: "Book your next home in minutes" },
  { icon: HeadphonesIcon, title: "24/7 Support", desc: "We're always here to help" },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* The homepage is the ONE page whose canonical is legitimately the site
          root. Every other route must declare its own — see src/lib/seo.ts. */}
      <Seo
        title="MogadishuRents — Rent Houses, Apartments & Hotels in Mogadishu"
        description="Mogadishu's rental marketplace. Browse verified houses, apartments, hotels and commercial spaces for rent across all 18 districts. Guri kiro ah oo Muqdisho ah."
        canonical={absoluteUrl("/")}
      />
      <InstallBanner />
      <Header />
      <HeroSection />
      <CategorySection />
      <FeaturedProperties />
      <DistrictSection />

      {/* Why MogadishuRents */}
      <section className="py-12 md:py-20 bg-muted/40">
        <div className="container">
          <div className="text-center max-w-xl mx-auto mb-10 md:mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">Why us</span>
            <h2 className="text-2xl md:text-3xl font-heading font-extrabold text-foreground tracking-tight">
              Renting made simple in Mogadishu
            </h2>
            <p className="text-muted-foreground text-sm md:text-base mt-2">
              From search to move-in, we make finding your next home effortless
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="text-center p-6 md:p-8 rounded-3xl bg-card border border-border/60 shadow-card hover:shadow-elevated transition-shadow duration-300"
              >
                <div
                  className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                    i === 0 ? "bg-primary/10" : i === 1 ? "bg-accent/15" : "bg-info/10"
                  }`}
                >
                  <f.icon className={`w-6 h-6 md:w-7 md:h-7 ${i === 0 ? "text-primary" : i === 1 ? "text-accent" : "text-info"}`} />
                </div>
                <h3 className="font-heading font-bold text-foreground mb-1.5">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10 md:py-12 bg-card">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-glow">
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
            <div className="flex items-center gap-3">
              <a
                href="/services"
                className="flex items-center gap-2 text-sm font-semibold text-primary-foreground bg-primary rounded-full px-5 py-2.5 shadow-card hover:bg-primary/90 transition-colors"
              >
                <MessageCircle className="w-4 h-4" /> Request Services & Inquiries
              </a>
            </div>
          </div>
        </div>
      </footer>

      <BottomNav />
    </div>
  );
};

export default Index;
