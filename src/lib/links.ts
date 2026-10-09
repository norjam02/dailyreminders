// Where people get the app. Set EXPO_PUBLIC_DOWNLOAD_URL to one link that
// works on any phone: during the pilot, the TestFlight and Play testing
// links; after launch, a page (for example on condorllc.org) that sends
// iPhones to the App Store and Android phones to Google Play.
export const DOWNLOAD_URL = process.env.EXPO_PUBLIC_DOWNLOAD_URL?.trim() || null;
