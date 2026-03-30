import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// --------------------------------------------------
// POST → Marker zu Collection hinzufügen
// --------------------------------------------------
export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = authData.user.id;
    const body = await req.json();

    const collectionId = Number(body.collectionId);
    const locationId = Number(body.locationId);

    // Sicherheitscheck: gehört Collection dem User?
    const { data: collection } = await supabase
      .from("favorite_collections")
      .select("id")
      .eq("id", collectionId)
      .eq("owner_user_id", userId)
      .maybeSingle();

    if (!collection) {
      return NextResponse.json({ ok: false, error: "No access to collection" }, { status: 403 });
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
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// --------------------------------------------------
// PATCH → Eintrag aktualisieren
// --------------------------------------------------
export async function PATCH(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();

    const { data, error } = await supabase
      .from("favorite_collection_items")
      .update({
        note: body.note ?? null,
        status: body.status ?? null,
        planned_date: body.plannedDate ?? null,
        planned_time: body.plannedTime ?? null,
        visited_at: body.visitedAt ?? null,
        highlight: body.highlight ?? null,
        caution_note: body.cautionNote ?? null,
        rating_personal: body.ratingPersonal ?? null,
        would_return: body.wouldReturn ?? null,
      })
      .eq("collection_id", body.collectionId)
      .eq("location_id", body.locationId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// --------------------------------------------------
// DELETE → Marker entfernen
// --------------------------------------------------
export async function DELETE(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();

    const { error } = await supabase
      .from("favorite_collection_items")
      .delete()
      .eq("collection_id", body.collectionId)
      .eq("location_id", body.locationId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}