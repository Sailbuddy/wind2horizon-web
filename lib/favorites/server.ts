"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AddLocationToCollectionInput,
  CollectionItemStatus,
  CreateCollectionInput,
  UpdateCollectionItemInput,
} from "@/lib/favorites/types";

function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

function assertValidTitle(title: string) {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    throw new Error("Listentitel fehlt.");
  }
  if (normalized.length > 120) {
    throw new Error("Listentitel ist zu lang.");
  }
  return normalized;
}

function assertValidRating(value: number | null | undefined) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("ratingPersonal muss zwischen 1 und 5 liegen.");
  }
}

async function getCurrentUserOrThrow() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) throw new Error(`Auth-Fehler: ${error.message}`);
  if (!data.user) throw new Error("Nicht eingeloggt.");

  return { supabase, user: data.user };
}

export async function getOrCreateDefaultCollection() {
  const { supabase, user } = await getCurrentUserOrThrow();

  const { data: existing, error: existingError } = await supabase
    .from("favorite_collections")
    .select("*")
    .eq("owner_user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Default-Liste konnte nicht geladen werden: ${existingError.message}`);
  }

  if (existing) return existing;

  const payload = {
    owner_user_id: user.id,
    title: "Meine Favoriten",
    description: null,
    visibility: "private",
    is_template: false,
    is_default: true,
    collection_type: "favorites",
    start_date: null,
    end_date: null,
    summary: null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("favorite_collections")
    .insert(payload)
    .select("*")
    .single();

  if (insertError) {
    // Falls paralleler Insert passiert ist, erneut lesen
    const { data: retry, error: retryError } = await supabase
      .from("favorite_collections")
      .select("*")
      .eq("owner_user_id", user.id)
      .eq("is_default", true)
      .maybeSingle();

    if (retryError || !retry) {
      throw new Error(
        `Default-Liste konnte nicht erstellt werden: ${insertError.message}`
      );
    }

    return retry;
  }

  return inserted;
}

export async function listUserCollections() {
  const { supabase, user } = await getCurrentUserOrThrow();

  const { data, error } = await supabase
    .from("favorite_collections")
    .select(`
      id,
      owner_user_id,
      title,
      description,
      visibility,
      is_template,
      is_default,
      collection_type,
      start_date,
      end_date,
      summary,
      created_at,
      updated_at
    `)
    .eq("owner_user_id", user.id)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Listen konnten nicht geladen werden: ${error.message}`);
  }

  return data ?? [];
}

export async function createCollection(input: CreateCollectionInput) {
  const { supabase, user } = await getCurrentUserOrThrow();

  const title = assertValidTitle(input.title);

  const payload = {
    owner_user_id: user.id,
    title,
    description: input.description ?? null,
    visibility: input.visibility ?? "private",
    is_template: false,
    is_default: input.isDefault ?? false,
    collection_type: input.collectionType ?? "favorites",
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    summary: input.summary ?? null,
  };

  const { data, error } = await supabase
    .from("favorite_collections")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Liste konnte nicht erstellt werden: ${error.message}`);
  }

  return data;
}

export async function addLocationToDefaultCollection(locationId: number) {
  const defaultCollection = await getOrCreateDefaultCollection();

  return addLocationToCollection({
    collectionId: defaultCollection.id,
    locationId,
    status: "saved",
  });
}

export async function addLocationToCollection(input: AddLocationToCollectionInput) {
  const { supabase, user } = await getCurrentUserOrThrow();

  // Sicherheitscheck: gehört die Collection dem User?
  const { data: collection, error: collectionError } = await supabase
    .from("favorite_collections")
    .select("id, owner_user_id, title")
    .eq("id", input.collectionId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (collectionError) {
    throw new Error(`Liste konnte nicht geprüft werden: ${collectionError.message}`);
  }
  if (!collection) {
    throw new Error("Liste nicht gefunden oder kein Zugriff.");
  }

  const payload = {
    collection_id: input.collectionId,
    location_id: input.locationId,
    note: input.note ?? null,
    sort_order: input.sortOrder ?? null,
    status: (input.status ?? "saved") as CollectionItemStatus,
    planned_date: input.plannedDate ?? null,
    planned_time: input.plannedTime ?? null,
    purpose: input.purpose ?? null,
    stay_type: input.stayType ?? null,
    priority: input.priority ?? null,
  };

  // Upsert ist hier praktisch, weil PK = (collection_id, location_id)
  const { data, error } = await supabase
    .from("favorite_collection_items")
    .upsert(payload, {
      onConflict: "collection_id,location_id",
      ignoreDuplicates: false,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Marker konnte nicht gespeichert werden: ${error.message}`);
  }

  return {
    collection,
    item: data,
    wasCreatedOrUpdated: true,
  };
}

export async function updateCollectionItem(input: UpdateCollectionItemInput) {
  const { supabase, user } = await getCurrentUserOrThrow();

  assertValidRating(input.ratingPersonal);

  // Besitzprüfung über Join-Logik
  const { data: ownedCollection, error: ownedCollectionError } = await supabase
    .from("favorite_collections")
    .select("id")
    .eq("id", input.collectionId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (ownedCollectionError) {
    throw new Error(`Liste konnte nicht geprüft werden: ${ownedCollectionError.message}`);
  }
  if (!ownedCollection) {
    throw new Error("Liste nicht gefunden oder kein Zugriff.");
  }

  const patch = {
    note: input.note ?? null,
    sort_order: input.sortOrder ?? null,
    status: input.status ?? null,
    planned_date: input.plannedDate ?? null,
    planned_time: input.plannedTime ?? null,
    visited_at: input.visitedAt ?? null,
    purpose: input.purpose ?? null,
    stay_type: input.stayType ?? null,
    priority: input.priority ?? null,
    rating_personal: input.ratingPersonal ?? null,
    would_return: input.wouldReturn ?? null,
    report_note: input.reportNote ?? null,
    highlight: input.highlight ?? null,
    caution_note: input.cautionNote ?? null,
  };

  const { data, error } = await supabase
    .from("favorite_collection_items")
    .update(patch)
    .eq("collection_id", input.collectionId)
    .eq("location_id", input.locationId)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Eintrag konnte nicht aktualisiert werden: ${error.message}`);
  }

  return data;
}

export async function removeLocationFromCollection(collectionId: number, locationId: number) {
  const { supabase, user } = await getCurrentUserOrThrow();

  const { data: collection, error: collectionError } = await supabase
    .from("favorite_collections")
    .select("id")
    .eq("id", collectionId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (collectionError) {
    throw new Error(`Liste konnte nicht geprüft werden: ${collectionError.message}`);
  }
  if (!collection) {
    throw new Error("Liste nicht gefunden oder kein Zugriff.");
  }

  const { error } = await supabase
    .from("favorite_collection_items")
    .delete()
    .eq("collection_id", collectionId)
    .eq("location_id", locationId);

  if (error) {
    throw new Error(`Eintrag konnte nicht entfernt werden: ${error.message}`);
  }

  return { success: true };
}

export async function getCollectionWithItems(collectionId: number) {
  const { supabase, user } = await getCurrentUserOrThrow();

  const { data: collection, error: collectionError } = await supabase
    .from("favorite_collections")
    .select(`
      id,
      owner_user_id,
      title,
      description,
      visibility,
      is_template,
      is_default,
      collection_type,
      start_date,
      end_date,
      summary,
      created_at,
      updated_at
    `)
    .eq("id", collectionId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (collectionError) {
    throw new Error(`Liste konnte nicht geladen werden: ${collectionError.message}`);
  }
  if (!collection) {
    throw new Error("Liste nicht gefunden oder kein Zugriff.");
  }

  const { data: items, error: itemsError } = await supabase
    .from("favorite_collection_items")
    .select(`
      collection_id,
      location_id,
      note,
      sort_order,
      created_at,
      status,
      planned_date,
      planned_time,
      visited_at,
      purpose,
      stay_type,
      priority,
      rating_personal,
      would_return,
      report_note,
      highlight,
      caution_note,
      locations (
        id,
        category_id,
        display_name,
        name_de,
        name_en,
        name_it,
        name_hr,
        name_fr,
        lat,
        lng,
        address,
        maps_url,
        google_place_id,
        active
      )
    `)
    .eq("collection_id", collectionId)
    .order("planned_date", { ascending: true, nullsFirst: false })
    .order("planned_time", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (itemsError) {
    throw new Error(`Listeneinträge konnten nicht geladen werden: ${itemsError.message}`);
  }

  return {
    collection,
    items: items ?? [],
  };
}

export async function markCollectionItemVisited(
  collectionId: number,
  locationId: number,
  visitedAt?: string
) {
  return updateCollectionItem({
    collectionId,
    locationId,
    status: "visited",
    visitedAt: visitedAt ?? new Date().toISOString(),
  });
}

export async function saveAndRefreshPath(
  action: () => Promise<unknown>,
  path: string
) {
  const result = await action();
  revalidatePath(path);
  return result;
}