import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
 
// --------------------------------------------------
// GET → Alle Collections des Users laden
// --------------------------------------------------
export async function GET() {
try {
    const supabase = await createSupabaseServerClient();
 
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const userId = authData.user.id;

    const { data, error } = await supabase
      .from("favorite_collections")
      .select("*")
      .eq("owner_user_id", userId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, collections: data ?? [] });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

// --------------------------------------------------
// POST → Neue Collection erstellen
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

    const payload = {
      owner_user_id: userId,
      title: body.title,
      description: body.description ?? null,
      visibility: body.visibility ?? "private",
      is_template: false,
      is_default: body.isDefault ?? false,
      collection_type: body.collectionType ?? "favorites",
      start_date: body.startDate ?? null,
      end_date: body.endDate ?? null,
      summary: body.summary ?? null,
    };

    const { data, error } = await supabase
     .from("favorite_collections")
      .insert(payload)
      .select("*")
      .single();
 
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
 
    return NextResponse.json({ ok: true, collection: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}