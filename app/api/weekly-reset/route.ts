import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

const WEEKLY_POINTS = 21;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: roommates, error: fetchError } = await supabase
    .from("roommates")
    .select("id, points");

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  for (const roommate of roommates ?? []) {
    const { error } = await supabase
      .from("roommates")
      .update({ points: roommate.points + WEEKLY_POINTS })
      .eq("id", roommate.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { error: logError } = await supabase
    .from("weekly_resets")
    .insert({ added: WEEKLY_POINTS });

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, added: WEEKLY_POINTS });
}
