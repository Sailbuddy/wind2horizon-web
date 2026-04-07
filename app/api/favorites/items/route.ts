import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import {
  resolveActiveCollectionId,
  createSupabaseAdminClient,
} from "@/lib/server/favorites/resolveActiveCollectionId";

function parseOptionalNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function checkCollectionOwnership(
  supabase: any,
  collectionId: number,
  userId: string
) {
  const { data: collection, error } = await supabase
    .from("favorite_collections")
    .select("id")
    .eq("id", collectionId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return collection;
}

async function resolveCollectionIdOrThrow({
  supabaseAdmin,
  userId,
  requestedCollectionId,
}: {
  supabaseAdmin: any;
  userId: string;
  requestedCollectionId: number | null;
}) {
  if (requestedCollectionId != null) {
    const { data, error } = await supabaseAdmin
      .from("favorite_collections")
      .select("id")
      .eq("id", requestedCollectionId)
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.id) {
      throw new Error("No access to collection");
    }

    return Number(data.id);
  }

  const resolved = await resolveActiveCollectionId(supabaseAdmin, userId);

  if (!resolved.activeCollectionId) {
    throw new Error("No active collection available");
  }

  return Number(resolved.activeCollectionId);
}

function mapResolverErrorToStatus(message: string) {
  if (message === "No access to collection") return 403;
  if (message === "No active collection available") return 409;
  return 500;
}

// --------------------------------------------------
// GET → Alle Items einer Collection laden
// --------------------------------------------------
export async function GET(req: Request) {
  try {
    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;
    const url = new URL(req.url);
    const requestedCollectionId = parseOptionalNumber(
      url.searchParams.get("collectionId")
    );

    const supabaseAdmin = createSupabaseAdminClient();

    let collectionId: number;
    try {
      collectionId = await resolveCollectionIdOrThrow({
        supabaseAdmin,
        userId,
        requestedCollectionId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: err.message || "Collection resolve failed" },
        { status: mapResolverErrorToStatus(err.message || "") }
      );
    }

    const { data, error } = await supabase
      .from("favorite_collection_items")
      .select(`
        id,
        collection_id,
        location_id,
        note,
        sort_order,
        status,
        planned_date,
        planned_time,
        visited_at,
        purpose,
        stay_type,
        priority,
        highlight,
        caution_note,
        rating_personal,
        would_return,
        report_note,
        created_at,
        updated_at,
        locations:location_id (
          id,
          display_name,
          name_de,
          name_en,
          name_it,
          name_fr,
          name_hr,
          category_id,
          categories:category_id (
            id,
            name_de,
            name_en,
            name_it,
            name_fr,
            name_hr
          )
        )
      `)
      .eq("collection_id", collectionId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[favorites items GET error]", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      collectionId,
      items: data ?? [],
    });
  } catch (err) {
    console.error("[favorites items GET]", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

// --------------------------------------------------
// POST → Marker zu Collection hinzufügen
// --------------------------------------------------
export async function POST(req: Request) {
  try {
    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;
    const body = await req.json();

    const requestedCollectionId = parseOptionalNumber(body.collectionId);
    const locationId = parseOptionalNumber(body.locationId);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid locationId" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();

    let collectionId: number;
    try {
      collectionId = await resolveCollectionIdOrThrow({
        supabaseAdmin,
        userId,
        requestedCollectionId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: err.message || "Collection resolve failed" },
        { status: mapResolverErrorToStatus(err.message || "") }
      );
    }

    const payload = {
      collection_id: collectionId,
      location_id: locationId,
      note: body.note ?? null,
      sort_order: body.sortOrder ?? null,
      status: body.status ?? "saved",
      planned_date: body.plannedDate ?? null,
      planned_time: body.plannedTime ?? null,
      purpose: body.purpose ?? null,
      stay_type: body.stayType ?? null,
      priority: body.priority ?? null,
    };

    const { data, error } = await supabase
      .from("favorite_collection_items")
      .upsert(payload, {
        onConflict: "collection_id,location_id",
      })
      .select("*")
      .single();

    if (error) {
      console.error("[favorites items UPSERT error]", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      collectionId,
      item: data,
    });
  } catch (err) {
    console.error("[favorites items POST]", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

// --------------------------------------------------
// PATCH → Eintrag aktualisieren
// --------------------------------------------------
export async function PATCH(req: Request) {
  try {
    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;
    const body = await req.json();

    const requestedCollectionId = parseOptionalNumber(body.collectionId);
    const locationId = parseOptionalNumber(body.locationId);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid locationId" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();

    let collectionId: number;
    try {
      collectionId = await resolveCollectionIdOrThrow({
        supabaseAdmin,
        userId,
        requestedCollectionId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: err.message || "Collection resolve failed" },
        { status: mapResolverErrorToStatus(err.message || "") }
      );
    }

    const { data, error } = await supabase
      .from("favorite_collection_items")
      .update({
        note: body.note ?? null,
        status: body.status ?? null,
        planned_date: body.plannedDate ?? null,
        planned_time: body.plannedTime ?? null,
        visited_at: body.visitedAt ?? null,
        purpose: body.purpose ?? null,
        stay_type: body.stayType ?? null,
        priority: body.priority ?? null,
        highlight: body.highlight ?? null,
        caution_note: body.cautionNote ?? null,
        rating_personal: body.ratingPersonal ?? null,
        would_return: body.wouldReturn ?? null,
        report_note: body.reportNote ?? null,
      })
      .eq("collection_id", collectionId)
      .eq("location_id", locationId)
      .select("*")
      .single();

    if (error) {
      console.error("[favorites items UPDATE error]", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      collectionId,
      item: data,
    });
  } catch (err) {
    console.error("[favorites items PATCH]", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

// --------------------------------------------------
// DELETE → Marker entfernen
// --------------------------------------------------
export async function DELETE(req: Request) {
  try {
    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const userId = authData.user.id;
    const body = await req.json();

    const requestedCollectionId = parseOptionalNumber(body.collectionId);
    const locationId = parseOptionalNumber(body.locationId);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid locationId" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();

    let collectionId: number;
    try {
      collectionId = await resolveCollectionIdOrThrow({
        supabaseAdmin,
        userId,
        requestedCollectionId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: err.message || "Collection resolve failed" },
        { status: mapResolverErrorToStatus(err.message || "") }
      );
    }

    const { error } = await supabase
      .from("favorite_collection_items")
      .delete()
      .eq("collection_id", collectionId)
      .eq("location_id", locationId);

    if (error) {
      console.error("[favorites items DELETE error]", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      collectionId,
    });
  } catch (err) {
    console.error("[favorites items DELETE]", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}