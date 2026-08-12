import { Link } from "react-router-dom";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Building2, Users, Shield, Award, MapPin, Phone, Mail, Clock } from "lucide-react";

const About = () => {
  return (
    // Clearance for the fixed z-50 BottomNav lives on the root and is gated to
    // mobile, the way every other page does it. It was sitting on <main>
    // instead, unconditionally — spending the same 80px on desktop where the
    // nav is md:hidden, and leaving anything outside <main> uncovered.
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <main className="pt-20">
        {/* Hero Section */}
        <section className="py-16 bg-gradient-to-br from-primary/5 via-background to-secondary/5">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto text-center">
              <h1 className="text-4xl md:text-5xl font-heading font-bold text-foreground mb-6">
                About Mogadishu Rents
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Your trusted partner in finding the perfect home in Mogadishu. We connect property seekers
                with verified listings and reliable landlords across Somalia's capital.
              </p>
            </div>
          </div>
        </section>

        {/* Mission Section */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-heading font-bold text-foreground mb-4">Our Mission</h2>
                <p className="text-lg text-muted-foreground">
                  To revolutionize property rental in Somalia by providing a secure, transparent, and
                  user-friendly platform that benefits both tenants and property owners.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-heading font-semibold text-foreground mb-2">Security First</h3>
                  <p className="text-muted-foreground">
                    All properties are verified and landlords are background-checked to ensure your safety and peace of mind.
                  </p>
                </div>

                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="w-8 h-8 text-success" />
                  </div>
                  <h3 className="text-xl font-heading font-semibold text-foreground mb-2">Community Focused</h3>
                  <p className="text-muted-foreground">
                    Building a community of satisfied tenants and property owners through transparent communication and fair practices.
                  </p>
                </div>

                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Award className="w-8 h-8 text-warning" />
                  </div>
                  <h3 className="text-xl font-heading font-semibold text-foreground mb-2">Quality Assurance</h3>
                  <p className="text-muted-foreground">
                    We maintain high standards for all listings, ensuring you get the best value for your rental investment.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Why Choose Us Section */}
        <section className="py-16 bg-secondary/5">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-heading font-bold text-foreground mb-4">Why Choose Mogadishu Rents?</h2>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">Verified Properties</h3>
                      <p className="text-muted-foreground">Every listing is personally verified by our team to ensure accuracy and quality.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <Users className="w-4 h-4 text-success" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">Trusted Landlords</h3>
                      <p className="text-muted-foreground">Our landlords are vetted and committed to providing excellent service.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <Clock className="w-4 h-4 text-warning" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">24/7 Support</h3>
                      <p className="text-muted-foreground">Our customer service team is always ready to help with any questions or concerns.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-info/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <MapPin className="w-4 h-4 text-info" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">Prime Locations</h3>
                      <p className="text-muted-foreground">Access to properties in the best neighborhoods across Mogadishu.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-destructive/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <Shield className="w-4 h-4 text-destructive" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">Secure Transactions</h3>
                      <p className="text-muted-foreground">Safe and secure payment processing for all your rental transactions.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                      <Award className="w-4 h-4 text-accent-foreground" />
                    </div>
                    <div>
                      <h3 className="text-lg font-heading font-semibold text-foreground mb-1">Best Prices</h3>
                      <p className="text-muted-foreground">Competitive pricing with no hidden fees or commissions.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-heading font-bold text-foreground mb-4">Get In Touch</h2>
                <p className="text-lg text-muted-foreground">
                  Have questions? We're here to help you find your perfect home.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Phone className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground mb-2">Phone</h3>
                  <p className="text-muted-foreground">+252 612 679 357</p>
                </div>

                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mail className="w-6 h-6 text-success" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground mb-2">Email</h3>
                  <p className="text-muted-foreground">info@mogadishurents.com</p>
                </div>

                <div className="text-center p-6 rounded-2xl bg-card border border-border shadow-card">
                  <div className="w-12 h-12 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MapPin className="w-6 h-6 text-warning" />
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground mb-2">Location</h3>
                  <p className="text-muted-foreground">Mogadishu, Somalia</p>
                </div>
              </div>

              <p className="text-center text-muted-foreground mt-12">
                Read about{" "}
                <Link to="/privacy" className="text-primary font-medium hover:underline">
                  privacy and analytics
                </Link>{" "}
                — what we measure, and what we don't.
              </p>
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
};

export default About;