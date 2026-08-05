import { useState } from "react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { usePublishedServices, type Service } from "@/hooks/use-services";
import { ServiceCard } from "@/components/services/ServiceCard";
import { ServiceInquiryDialog } from "@/components/services/ServiceInquiryDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Wrench, ShieldCheck, HeadphonesIcon } from "lucide-react";
import { motion } from "framer-motion";

const Services = () => {
  const { data: services, isLoading, error } = usePublishedServices();
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleEnquire = (service: Service) => {
    setSelectedService(service);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header />

      {/* Hero Section */}
      <section className="relative py-12 md:py-20 bg-gradient-to-b from-primary/5 via-background to-background border-b border-border/40">
        <div className="container max-w-4xl text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-extrabold uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" /> Professional Property Services
          </div>

          <h1 className="text-3xl md:text-5xl font-heading font-extrabold text-foreground tracking-tight">
            Comprehensive Services for Your Mogadishu Property
          </h1>

          <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            From property maintenance and cleaning to security management and legal consulting, request high-quality services directly from our vetted specialists.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-6">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border/60 shadow-sm text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Vetted Experts</p>
                <p className="text-[11px] text-muted-foreground">Certified technicians</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border/60 shadow-sm text-left">
              <div className="w-9 h-9 rounded-xl bg-success/10 text-success flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Guaranteed Work</p>
                <p className="text-[11px] text-muted-foreground">Quality & safety assured</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border/60 shadow-sm text-left">
              <div className="w-9 h-9 rounded-xl bg-info/10 text-info flex items-center justify-center shrink-0">
                <HeadphonesIcon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Fast Response</p>
                <p className="text-[11px] text-muted-foreground">Prompt service delivery</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Grid Catalog */}
      <main className="container py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-heading font-extrabold text-foreground tracking-tight">
              Service Catalog
            </h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              Browse available solutions and submit an inquiry instantly
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-3xl border border-border/60 p-6 space-y-4">
                <Skeleton className="h-40 w-full rounded-2xl" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full rounded-full" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-8 text-center bg-destructive/10 text-destructive rounded-3xl border border-destructive/20">
            <p className="font-semibold">Failed to load services</p>
            <p className="text-xs mt-1">Please try refreshing the page.</p>
          </div>
        )}

        {!isLoading && !error && (services || []).length === 0 && (
          <div className="text-center py-20 bg-card rounded-3xl border border-border shadow-card">
            <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Wrench className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="font-heading font-bold text-lg mb-2">No services published yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              Please check back soon for our updated service catalog.
            </p>
          </div>
        )}

        {!isLoading && !error && (services || []).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {services!.map((service, i) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4) }}
              >
                <ServiceCard service={service} onEnquire={handleEnquire} />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Inquiry Dialog */}
      <ServiceInquiryDialog
        service={selectedService}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <BottomNav />
    </div>
  );
};

export default Services;
