import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

export async function POST(request: Request) {
  const { roommateId, subscription } = await request.json();

  if (!roommateId || !subscription) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("roommate_id", roommateId);

  const { error } = await supabase.from("push_subscriptions").insert({
    roommate_id: roommateId,
    subscription,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
