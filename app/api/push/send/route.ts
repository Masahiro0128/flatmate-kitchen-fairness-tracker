import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

webpush.setVapidDetails(
  "mailto:masahirotakeba@gmail.com",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("subscription");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payload = JSON.stringify({
    title: "Kitchen reminder",
    body: "Don't forget to log your tasks today!",
  });

  await Promise.allSettled(
    (subscriptions ?? []).map((row) =>
      webpush.sendNotification(row.subscription, payload)
    )
  );

  return NextResponse.json({ ok: true, sent: subscriptions?.length ?? 0 });
}
