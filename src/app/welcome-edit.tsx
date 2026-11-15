// The organizer makes the welcome their own: a photo and a short message that
// everyone in the circle sees for a moment each time DailyPulse opens.

import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { Button, ErrorText, Field, Screen, Section, T } from "@/components/ui";
import { WELCOME_BUCKET, WELCOME_LENGTH, WelcomeCard } from "@/components/welcome";
import { errorMessage, useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { space } from "@/lib/theme";

type Picked = { uri: string; mimeType: string };

export default function WelcomeEdit() {
  const { current, isOrganizer, refresh } = useSession();
  const circle = current?.circle;
  const circleId = circle?.id;
  const savedPath = circle?.welcome_photo_path ?? null;

  const [message, setMessage] = useState(circle?.welcome_message ?? "");
  // A new photo picked on this screen, not yet uploaded.
  const [picked, setPicked] = useState<Picked | null>(null);
  // The saved photo, to show in the preview.
  const [savedUri, setSavedUri] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!savedPath) return;
    supabase.storage
      .from(WELCOME_BUCKET)
      .createSignedUrl(savedPath, 600)
      .then(({ data }) => setSavedUri(data?.signedUrl ?? null))
      .catch(() => {});
  }, [savedPath]);

  if (!isOrganizer || !circleId) {
    return (
      <Screen>
        <T>Only the person who set up this circle can change its welcome.</T>
      </Screen>
    );
  }

  async function choose(source: "library" | "camera") {
    setError(null);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.7,
    };
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return setError("The camera is off for DailyPulse. You can choose a photo instead.");
    }
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
    setRemovePhoto(false);
  }

  async function save() {
    if (!circleId) return;
    setBusy(true);
    setError(null);
    try {
      let photoPath: string | null = removePhoto ? null : savedPath;
      if (picked) {
        const extension = picked.mimeType === "image/png" ? "png" : picked.mimeType === "image/heic" ? "heic" : "jpg";
        photoPath = `${circleId}/welcome-${Date.now()}.${extension}`;
        const bytes = await new File(picked.uri).bytes();
        const { error: uploadError } = await supabase.storage
          .from(WELCOME_BUCKET)
          .upload(photoPath, bytes, { contentType: picked.mimeType });
        if (uploadError) throw uploadError;
      }
      const { error: saveError } = await supabase
        .from("circles")
        .update({ welcome_message: message.trim() || null, welcome_photo_path: photoPath })
        .eq("id", circleId);
      if (saveError) throw saveError;
      // The old photo is no longer used. If removing it fails, it's only a stray file.
      if (savedPath && savedPath !== photoPath) {
        await supabase.storage.from(WELCOME_BUCKET).remove([savedPath]).catch(() => {});
      }
      await refresh();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const previewUri = picked?.uri ?? (removePhoto ? null : savedUri);
  const hasPhoto = !!picked || (!!savedPath && !removePhoto);

  return (
    <Screen>
      <T tone="muted">
        Everyone in {circle?.name ? `${circle.name}'s` : "your"} circle sees this for a moment each time they open DailyPulse.
      </T>

      <WelcomeCard photoUri={previewUri} message={message.trim() || null} viewerName={circle?.name} compact />

      <Section title="Photo" hint="A face, a pet, a favorite place. Anything that makes them smile.">
        <View style={styles.buttons}>
          <Button label={hasPhoto ? "Choose a different photo" : "Choose a photo"} variant="secondary" onPress={() => choose("library")} disabled={busy} />
          <Button label="Take a photo" variant="secondary" onPress={() => choose("camera")} disabled={busy} />
          {hasPhoto ? (
            <Button
              label="Remove the photo"
              variant="quiet"
              onPress={() => {
                setPicked(null);
                setRemovePhoto(true);
              }}
              disabled={busy}
            />
          ) : null}
        </View>
      </Section>

      <Field
        label="Message"
        hint={`Optional. Up to ${WELCOME_LENGTH} characters.`}
        placeholder="Hope today is a good one. Love you!"
        value={message}
        onChangeText={setMessage}
        maxLength={WELCOME_LENGTH}
        multiline
      />

      <ErrorText message={error} />
      <Button label="Save welcome" onPress={save} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: space.sm },
});
