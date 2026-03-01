"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ContactRecord {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  relationshipType: string;
  importance: number;
  notes: string | null;
  bio: string | null;
  decayRateOverride: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateContactInput {
  name: string;
  email?: string;
  relationshipType?: string;
  importance?: number;
  notes?: string;
  groupIds?: string[];
}

interface UpdateContactInput extends Partial<CreateContactInput> {
  email?: string;
  bio?: string | null;
  groupIds?: string[];
  decayRateOverride?: number | null;
}

export function useCreateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create contact");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useContacts() {
  return useQuery<ContactRecord[]>({
    queryKey: ["contacts"],
    queryFn: async () => {
      const res = await fetch("/api/contacts");
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateContactInput & { id: string }) => {
      const res = await fetch(`/api/contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to update contact");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useGenerateBio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/contacts/${id}/bio`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to generate bio");
      return res.json() as Promise<{ bio: string | null; message?: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graph"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
