import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Service {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  price_from: number | null;
  price_note: string | null;
  sort_order: number;
  is_published: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceInquiry {
  id: string;
  service_id: string | null;
  property_id: string | null;
  property_ref: string | null;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  message: string;
  status: "new" | "contacted" | "closed";
  created_at: string;
  service?: { title: string } | null;
  property?: { title: string } | null;
}

export interface CreateServiceInput {
  title: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  image_url?: string | null;
  price_from?: number | null;
  price_note?: string | null;
  sort_order?: number;
  is_published?: boolean;
  created_by?: string | null;
}

export interface CreateInquiryInput {
  service_id?: string | null;
  property_id?: string | null;
  property_ref?: string | null;
  sender_name: string;
  sender_email: string;
  sender_phone?: string | null;
  message: string;
}

export function usePublishedServices() {
  return useQuery({
    queryKey: ["published-services"],
    queryFn: async (): Promise<Service[]> => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .order("title", { ascending: true });

      if (error) throw error;
      return (data as Service[]) || [];
    },
  });
}

export function useAllServices() {
  return useQuery({
    queryKey: ["all-services"],
    queryFn: async (): Promise<Service[]> => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as Service[]) || [];
    },
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateServiceInput) => {
      const { data, error } = await supabase
        .from("services")
        .insert(input)
        .select("*")
        .single();
      if (error) throw error;
      return data as Service;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-services"] });
      queryClient.invalidateQueries({ queryKey: ["published-services"] });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...changes }: Partial<Service> & { id: string }) => {
      // updated_at is handled by the DB trigger (20260805000003) — no need to
      // set it manually here.
      const { data, error } = await supabase
        .from("services")
        .update(changes)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as Service;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-services"] });
      queryClient.invalidateQueries({ queryKey: ["published-services"] });
    },
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("services")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-services"] });
      queryClient.invalidateQueries({ queryKey: ["published-services"] });
    },
  });
}

export function useSubmitServiceInquiry() {
  return useMutation({
    mutationFn: async (input: CreateInquiryInput) => {
      const { data, error } = await supabase
        .from("service_inquiries")
        .insert({
          service_id: input.service_id || null,
          property_id: input.property_id || null,
          property_ref: input.property_ref?.trim() || null,
          sender_name: input.sender_name,
          sender_email: input.sender_email,
          sender_phone: input.sender_phone || null,
          message: input.message,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useServiceInquiries() {
  return useQuery({
    queryKey: ["service-inquiries"],
    queryFn: async (): Promise<ServiceInquiry[]> => {
      const { data, error } = await supabase
        .from("service_inquiries")
        .select(`
          *,
          service:services(title),
          property:properties(title)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as ServiceInquiry[]) || [];
    },
  });
}

export function useUpdateInquiryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "new" | "contacted" | "closed" }) => {
      const { data, error } = await supabase
        .from("service_inquiries")
        .update({ status })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-inquiries"] });
    },
  });
}
