import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import {
  resolveActiveCollectionId,
  createSupabaseAdminClient,
} from "@/lib/server/favorites/resolveActiveCollectionId";

function parseCollectionId(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const locationIdRaw = searchParams.get("locationId");
    const locationId = Number(locationIdRaw);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        {
          error: "locationId is required",
          isFavorite: false,
          authenticated: false,
          collectionId: null,
          resolvedVia: "none",
        },
        { status: 400 }
      );
    }

    const supabase = createSupabaseRouteClient(req);

    const { data: authData, error: authError } =
      await supabase.auth.getUser();

    if (authError || !authData?.user) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: false,
        collectionId: null,
        resolvedVia: "none",
      });
    }

    const userId = authData.user.id;

    // 🔧 NEU: optionale collectionId aus Query
    const requestedCollectionId = parseCollectionId(
      searchParams.get("collectionId")
    );

    const supabaseAdmin = createSupabaseAdminClient();

    let resolvedCollectionId = null;
    let resolvedVia = "none";

    // -----------------------------------------
    // Fall A: explizite collectionId
    // -----------------------------------------
    if (requestedCollectionId != null) {
      const { data: ownedCollection, error } = await supabaseAdmin
        .from("favorite_collections")
        .select("id")
        .eq("id", requestedCollectionId)
        .eq("owner_user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("[favorites/status] ownership error:", error);
        return NextResponse.json(
          {
            error: error.message,
            isFavorite: false,
            authenticated: true,
            collectionId: null,
            resolvedVia: "none",
          },
          { status: 500 }
        );
      }

      if (!ownedCollection?.id) {
        return NextResponse.json(
          {
            error: "Collection not owned by user",
            isFavorite: false,
            authenticated: true,
            collectionId: null,
            resolvedVia: "none",
          },
          { status: 403 }
        );
      }

      resolvedCollectionId = Number(ownedCollection.id);
      resolvedVia = "explicit";
    }

    // -----------------------------------------
    // Fall B: Resolver (activeCollectionId)
    // -----------------------------------------
    else {
      const resolved = await resolveActiveCollectionId(
        supabaseAdmin,
        userId
      );

      resolvedCollectionId = resolved.activeCollectionId;
      resolvedVia =
        resolved.activeCollectionId != null ? "active" : "none";
    }

    // -----------------------------------------
    // Kein Ergebnis → nicht Favorit
    // -----------------------------------------
    if (!resolvedCollectionId) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: true,
        collectionId: null,
        resolvedVia,
      });
    }

    // -----------------------------------------
    // Favoriten prüfen (wie bisher)
    // -----------------------------------------
    const { data: item, error: itemError } = await supabase
      .from("favorite_collection_items")
      .select("collection_id,location_id")
      .eq("collection_id", resolvedCollectionId)
      .eq("location_id", locationId)
      .eq("status", "saved")
      .maybeSingle();

    if (itemError) {
      console.error("[favorites/status] item error:", itemError);
      return NextResponse.json(
        {
          error: itemError.message,
          isFavorite: false,
          authenticated: true,
          collectionId: resolvedCollectionId,
          resolvedVia,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      isFavorite: !!item,
      authenticated: true,
      collectionId: resolvedCollectionId,
      resolvedVia,
    });
  } catch (err) {
    console.error("[favorites/status] unexpected error:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        isFavorite: false,
        authenticated: false,
        collectionId: null,
        resolvedVia: "none",
      },
      { status: 500 }
    );
  }
}