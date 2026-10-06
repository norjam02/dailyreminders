// Shapes of the database rows the app reads. Kept by hand to match
// supabase/migrations.

export type MemberRole = "child" | "parent" | "caregiver" | "family";
export type MemberStatus = "pending" | "active" | "removed";
export type CheckinMode = "button" | "photo" | "selfie";
export type ReminderFirmness = "gentle" | "normal" | "persistent";
export type CheckinStatus = "pending" | "done" | "missed";

export type Circle = {
  id: string;
  name: string;
  organizer_id: string;
};

export type Membership = {
  circle_id: string;
  role: MemberRole;
  status: MemberStatus;
  circle: Circle;
};

export type Member = {
  circle_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  profile: { display_name: string } | null;
};

export type CheckinPlan = {
  circle_id: string;
  mode: CheckinMode;
  photo_prompt: string | null;
  times: string[];
  timezone: string;
  firmness: ReminderFirmness;
  wait_minutes: 30 | 60 | 120;
  quick_replies: string[];
  personal_note: string | null;
};

export type Checkin = {
  id: string;
  circle_id: string;
  scheduled_for: string;
  status: CheckinStatus;
  snoozed_until: string | null;
  prompted_at: string | null;
  responded_at: string | null;
  response_mode: CheckinMode | null;
  quick_reply: string | null;
  photo_path: string | null;
};

export const roleLabel: Record<MemberRole, string> = {
  child: "Child",
  parent: "Parent",
  caregiver: "Caregiver",
  family: "Family",
};

export const STARTER_REPLIES = ["Love you!", "I'm on it", "Thanks for checking", "Doing fine"];
