#!/bin/bash
# Copies the app's public settings from .env.local to Expo's servers, so
# cloud builds have them (.env.local isn't uploaded with the build).
# Run from the dailyreminders folder:  bash scripts/eas-env.sh
set -e
cd "$(dirname "$0")/.."
set -a; source .env.local; set +a
TERMS="https://condorllc.org/assets/dailypulse/terms.html"
PRIVACY="https://condorllc.org/assets/dailypulse/privacy.html"
for ENV in preview production; do
  for PAIR in \
    "EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL" \
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
    "EXPO_PUBLIC_TERMS_URL=$TERMS" \
    "EXPO_PUBLIC_PRIVACY_URL=$PRIVACY"; do
    NAME="${PAIR%%=*}"; VALUE="${PAIR#*=}"
    npx eas-cli@latest env:set --name "$NAME" --value "$VALUE" \
      --environment "$ENV" --visibility plaintext --non-interactive
  done
done
echo "Done. Expo now has the app settings for preview and production builds."
