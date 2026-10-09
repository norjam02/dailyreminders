// The organizer's check-in settings: how, when, how firmly, and what the
// parent can reply.

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { Button, Chip, Chips, Choice, ErrorText, Field, Screen, Section, T } from "@/components/ui";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { deviceTimeZone, HOUR_CHOICES, hourLabel, US_TIME_ZONES } from "@/lib/time";
import { STARTER_REPLIES, type CheckinMode, type CheckinPlan, type ReminderFirmness } from "@/lib/types";

// "a selfie" opens the front camera on the check-in screen.
const PHOTO_PROMPTS = ["breakfast", "a selfie", "the view from your window", "your coffee cup", "anything you like"];

const MODES: { mode: CheckinMode; label: string; description: string }[] = [
  { mode: "button", label: "Tap a button", description: "Simplest. Good for anyone who dislikes cameras." },
  { mode: "photo", label: "Send a photo", description: "Of something you pick, like breakfast or a selfie." },
];

const FIRMNESS: { value: ReminderFirmness; label: string; description: string }[] = [
  { value: "gentle", label: "Gentle", description: "Just the one notification." },
  { value: "normal", label: "Normal", description: "Two more reminders, 20 minutes apart." },
  { value: "persistent", label: "Persistent", description: "A reminder every 10 minutes until the wait runs out." },
];

const WAITS: { value: 30 | 60 | 120; label: string }[] = [
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
];

function defaults(circleId: string): CheckinPlan {
  const zone = deviceTimeZone();
  return {
    circle_id: circleId,
    mode: "button",
    photo_prompt: null,
    times: ["10:00"],
    timezone: US_TIME_ZONES.some((z) => z.zone === zone) ? zone : "America/Chicago",
    firmness: "normal",
    wait_minutes: 60,
    quick_replies: [],
    personal_note: null,
  };
}

export default function Plan() {
  const { current, isOrganizer } = useSession();
  const circleId = current?.circle.id;
  const parentName = current?.circle.name ?? "your parent";
  const isParent = current?.role === "parent";

  const [plan, setPlan] = useState<CheckinPlan | null>(null);
  const [exists, setExists] = useState(false);
  // Each check-in can carry quick replies or a note from the organizer, not both.
  const [extra, setExtra] = useState<"none" | "replies" | "note">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!circleId) return;
      supabase
        .from("checkin_plans")
        .select("circle_id, mode, photo_prompt, times, timezone, firmness, wait_minutes, quick_replies, personal_note")
        .eq("circle_id", circleId)
        .maybeSingle()
        .then(({ data, error: loadError }) => {
          if (loadError) return setError(errorMessage(loadError));
          if (data) {
            const loaded = data as CheckinPlan;
            // Selfie used to be its own mode; it's now a photo of "a selfie".
            const asPhoto = loaded.mode === "selfie" ? { mode: "photo" as const, photo_prompt: "a selfie" } : {};
            setPlan({ ...loaded, ...asPhoto, times: loaded.times.map((t) => t.slice(0, 5)) });
            setExtra(loaded.personal_note?.trim() ? "note" : loaded.quick_replies.length > 0 ? "replies" : "none");
            setExists(true);
          } else {
            setPlan(defaults(circleId));
            setExtra("none");
            setExists(false);
          }
        });
    }, [circleId]),
  );

  if (!isOrganizer) {
    return (
      <Screen>
        <T>Only the person who set up this circle can change its check-ins.</T>
      </Screen>
    );
  }
  if (!plan || !circleId) return <Screen>{null}</Screen>;

  const update = (patch: Partial<CheckinPlan>) => setPlan({ ...plan, ...patch });

  function toggleTime(time: string) {
    if (!plan) return;
    const has = plan.times.includes(time);
    const times = has ? plan.times.filter((t) => t !== time) : [...plan.times, time].sort();
    update({ times });
  }

  function toggleReply(reply: string) {
    if (!plan) return;
    const has = plan.quick_replies.includes(reply);
    update({
      quick_replies: has ? plan.quick_replies.filter((r) => r !== reply) : [...plan.quick_replies, reply],
    });
  }

  async function save() {
    if (!plan || !circleId) return;
    if (plan.times.length === 0) {
      setError("Pick at least one check-in time.");
      return;
    }
    if (extra === "replies" && plan.quick_replies.length === 0) {
      setError("Pick at least one quick reply, or choose Nothing extra.");
      return;
    }
    if (extra === "note" && !plan.personal_note?.trim()) {
      setError("Write your note, or choose Nothing extra.");
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      mode: plan.mode,
      photo_prompt: plan.mode === "photo" ? plan.photo_prompt ?? PHOTO_PROMPTS[0] : null,
      times: plan.times,
      timezone: plan.timezone,
      firmness: plan.firmness,
      wait_minutes: plan.wait_minutes,
      quick_replies: extra === "replies" ? plan.quick_replies : [],
      personal_note: extra === "note" ? plan.personal_note?.trim() || null : null,
    };
    const { error: saveError } = exists
      ? await supabase.from("checkin_plans").update(fields).eq("circle_id", circleId)
      : await supabase.from("checkin_plans").insert({ circle_id: circleId, ...fields });
    setBusy(false);
    if (saveError) return setError(errorMessage(saveError));
    router.replace("/");
  }

  return (
    <Screen>
      <Section title={isParent ? "How you check in" : `How ${parentName} checks in`}>
        {MODES.map((m) => (
          <Choice
            key={m.mode}
            label={m.label}
            description={m.description}
            selected={plan.mode === m.mode}
            onPress={() => update({ mode: m.mode })}
          />
        ))}
      </Section>

      {plan.mode === "photo" ? (
        <Section title="A photo of">
          <Chips>
            {PHOTO_PROMPTS.map((p) => (
              <Chip
                key={p}
                label={p}
                selected={(plan.photo_prompt ?? PHOTO_PROMPTS[0]) === p}
                onPress={() => update({ photo_prompt: p })}
              />
            ))}
          </Chips>
        </Section>
      ) : null}

      <Section title="When" hint="Pick up to three times a day.">
        <Chips>
          {HOUR_CHOICES.map((time) => (
            <Chip
              key={time}
              label={hourLabel(time)}
              selected={plan.times.includes(time)}
              disabled={!plan.times.includes(time) && plan.times.length >= 3}
              onPress={() => toggleTime(time)}
            />
          ))}
        </Chips>
      </Section>

      <Section title={isParent ? "Your time zone" : `${parentName}'s time zone`}>
        <Chips>
          {US_TIME_ZONES.map((z) => (
            <Chip
              key={z.zone}
              label={z.label}
              selected={plan.timezone === z.zone}
              onPress={() => update({ timezone: z.zone })}
            />
          ))}
        </Chips>
      </Section>

      <Section title="Reminders">
        {FIRMNESS.map((f) => (
          <Choice
            key={f.value}
            label={f.label}
            description={f.description}
            selected={plan.firmness === f.value}
            onPress={() => update({ firmness: f.value })}
          />
        ))}
      </Section>

      <Section title="Wait before telling you" hint="If there's no check-in by then, you'll get a notification.">
        <Chips>
          {WAITS.map((w) => (
            <Chip
              key={w.value}
              label={w.label}
              selected={plan.wait_minutes === w.value}
              onPress={() => update({ wait_minutes: w.value })}
            />
          ))}
        </Chips>
      </Section>

      <Section title="Add to each check-in" hint="Pick one, or keep it simple.">
        <Choice label="Nothing extra" selected={extra === "none"} onPress={() => setExtra("none")} />
        <Choice
          label="Quick replies"
          description={`${isParent ? "You" : parentName} can tap one to send back, like "Love you!"`}
          selected={extra === "replies"}
          onPress={() => setExtra("replies")}
        />
        {!isParent ? (
          <Choice
            label="A note from you"
            description={`${parentName} sees it when it's time to check in.`}
            selected={extra === "note"}
            onPress={() => setExtra("note")}
          />
        ) : null}
      </Section>

      {extra === "replies" ? (
        <Section title="Quick replies" hint="Pick up to four.">
          <Chips>
            {STARTER_REPLIES.map((r) => (
              <Chip key={r} label={r} selected={plan.quick_replies.includes(r)} onPress={() => toggleReply(r)} />
            ))}
          </Chips>
        </Section>
      ) : null}

      {extra === "note" ? (
        <Field
          label="Your note"
          placeholder="Morning, Mom. Coffee time?"
          value={plan.personal_note ?? ""}
          onChangeText={(v) => update({ personal_note: v })}
          maxLength={120}
        />
      ) : null}

      <ErrorText message={error} />
      <Button label="Save check-ins" onPress={save} busy={busy} />
    </Screen>
  );
}
