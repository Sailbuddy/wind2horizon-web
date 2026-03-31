import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const locationIdRaw = searchParams.get("locationId");
    const locationId = Number(locationIdRaw);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: false,
      });
    }

    const userId = authData.user.id;

    const { data: collections, error: collectionsError } = await supabase
      .from("favorite_collections")
      .select("id,is_default,collection_type")
      .eq("owner_user_id", userId);

    if (collectionsError) {
      console.error("[favorites/status] collections error:", collectionsError);
      return NextResponse.json(
        { error: collectionsError.message },
        { status: 500 }
      );
    }

    const targetCollection =
      collections?.find((c) => c?.is_default) ||
      collections?.find((c) => c?.collection_type === "favorites") ||
      collections?.[0] ||
      null;

    if (!targetCollection?.id) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: true,
      });
    }

    const { data: item, error: itemError } = await supabase
      .from("favorite_collection_items")
      .select("collection_id,location_id")
      .eq("collection_id", Number(targetCollection.id))
      .eq("location_id", locationId)
      .maybeSingle();

    if (itemError) {
      console.error("[favorites/status] item error:", itemError);
      return NextResponse.json(
        { error: itemError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      isFavorite: !!item,
      authenticated: true,
    });
  } catch (err) {
    console.error("[favorites/status] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}