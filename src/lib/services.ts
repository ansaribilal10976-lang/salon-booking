import type { Service } from "@/types/database";

export type ServiceCatalog = {
  source: "preview" | "supabase" | "unavailable";
  services: Service[];
};

type SupabaseConfig = { url?: string; key?: string };
type QueryServices = () => Promise<{
  data: Service[] | null;
  error: unknown;
}>;

// Display-only examples. These IDs must never be submitted as real bookings.
const previewServices: Service[] = [
  { id: "preview-cut", name: "Haircut & blow-dry", duration: 60, price: 65 },
  { id: "preview-blowout", name: "Signature blowout", duration: 45, price: 45 },
  { id: "preview-color", name: "Root color touch-up", duration: 90, price: 95 },
  { id: "preview-highlights", name: "Partial highlights", duration: 150, price: 165 },
  { id: "preview-treatment", name: "Deep conditioning treatment", duration: 45, price: 55 },
  { id: "preview-styling", name: "Event styling & updo", duration: 60, price: 85 },
];

export async function loadServiceCatalog(
  config: SupabaseConfig,
  queryServices: QueryServices,
): Promise<ServiceCatalog> {
  // Demo data is only used when no Supabase configuration exists. An empty
  // database or a failed query must never silently display invented services.
  if (!config.url && !config.key) {
    return { source: "preview", services: previewServices };
  }

  if (!config.url || !config.key) {
    return { source: "unavailable", services: [] };
  }

  try {
    const { data, error } = await queryServices();
    if (error || data === null) {
      console.error("services:query_failed");
      return { source: "unavailable", services: [] };
    }
    return { source: "supabase", services: data };
  } catch {
    console.error("services:query_failed");
    return { source: "unavailable", services: [] };
  }
}
