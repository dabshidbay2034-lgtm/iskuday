import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitServiceInquiry, type Service } from "@/hooks/use-services";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { Send, CheckCircle2, User, Mail, Phone, FileText } from "lucide-react";

const inquirySchema = z.object({
  sender_name: z.string().min(2, "Name must be at least 2 characters"),
  sender_email: z.string().email("Please enter a valid email address"),
  sender_phone: z.string().optional(),
  message: z.string().min(5, "Message must be at least 5 characters"),
  // Free text — a property address or internal reference, NOT a property id.
  // property_id is a UUID FK; sending arbitrary text there used to fail the FK
  // and kill the whole insert. See migration 20260805000003.
  property_ref: z.string().optional(),
});

type InquiryFormData = z.infer<typeof inquirySchema>;

interface ServiceInquiryDialogProps {
  service: Service | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServiceInquiryDialog({ service, open, onOpenChange }: ServiceInquiryDialogProps) {
  const submitInquiry = useSubmitServiceInquiry();
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InquiryFormData>({
    resolver: zodResolver(inquirySchema),
    defaultValues: {
      sender_name: "",
      sender_email: "",
      sender_phone: "",
      message: "",
      property_ref: "",
    },
  });

  const onSubmit = async (data: InquiryFormData) => {
    try {
      await submitInquiry.mutateAsync({
        service_id: service?.id || null,
        sender_name: data.sender_name,
        sender_email: data.sender_email,
        sender_phone: data.sender_phone || null,
        message: data.message,
        property_ref: data.property_ref || null,
      });

      setSubmitted(true);
      // Service and id only — the name, email, phone and message the visitor
      // just typed are contact details and stay out of analytics.
      track(ANALYTICS_EVENTS.SERVICE_INQUIRY_SUBMITTED, {
        service_id: service?.id,
        service_title: service?.title,
      });
      toast.success("Inquiry sent successfully! Our team will contact you soon.");
    } catch (err: unknown) {
      toast.error((err as Error)?.message || "Failed to send inquiry. Please try again.");
    }
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      setTimeout(() => {
        setSubmitted(false);
        reset();
      }, 300);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px] rounded-3xl p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-xl font-heading font-extrabold text-foreground">
            {submitted ? "Inquiry Received" : `Enquire about ${service?.title || "Service"}`}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            {submitted
              ? "Thank you for reaching out. We will get back to you shortly."
              : "Fill in your details below and our service team will connect with you."}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/15 text-success flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <p className="text-foreground font-semibold">Your request has been submitted</p>
            <Button
              className="rounded-full w-full max-w-xs mx-auto"
              onClick={() => handleClose(false)}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Full Name *
              </Label>
              <Input
                placeholder="Your full name"
                {...register("sender_name")}
                className="h-11 rounded-xl"
              />
              {errors.sender_name && (
                <p className="text-xs text-destructive">{errors.sender_name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email Address *
              </Label>
              <Input
                type="email"
                placeholder="name@example.com"
                {...register("sender_email")}
                className="h-11 rounded-xl"
              />
              {errors.sender_email && (
                <p className="text-xs text-destructive">{errors.sender_email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Phone Number (Optional)
              </Label>
              <Input
                type="tel"
                placeholder="e.g. +252..."
                {...register("sender_phone")}
                className="h-11 rounded-xl"
              />
              {errors.sender_phone && (
                <p className="text-xs text-destructive">{errors.sender_phone.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Property Reference (Optional)
              </Label>
              <Input
                placeholder="Property address or reference if applicable"
                {...register("property_ref")}
                className="h-11 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                Message *
              </Label>
              <Textarea
                placeholder="Tell us about what you need..."
                rows={3}
                {...register("message")}
                className="rounded-xl resize-none"
              />
              {errors.message && (
                <p className="text-xs text-destructive">{errors.message.message}</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || submitInquiry.isPending}
              className="w-full h-12 rounded-full font-bold shadow-card gap-2 mt-2"
            >
              <Send className="w-4 h-4" />
              {isSubmitting || submitInquiry.isPending ? "Submitting..." : "Send Inquiry"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
