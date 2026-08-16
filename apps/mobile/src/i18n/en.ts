import type { de } from './de.js';

/**
 * Teilübersetzung. Fehlende Schlüssel fallen automatisch auf Deutsch zurück
 * (siehe index.ts) — es erscheinen nie rohe Schlüssel in der Oberfläche.
 */
export const en: Partial<Record<keyof typeof de, string>> = {
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.retry': 'Try again',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.later': 'Later',
  'common.loading': 'Loading …',
  'common.official': 'Official information',
  'common.community': 'Community report',
  'common.estimatedPosition': 'Estimated position',
  'onboarding.1.title': 'Your transit. Live. Together.',
  'onboarding.1.body':
    'Live updates from fellow passengers combined with official Swiss transit data.',
  'onboarding.2.title': 'Detect your trip automatically',
  'onboarding.3.title': 'Community',
  'onboarding.next': 'Next',
  'onboarding.start': 'Get started',
  'onboarding.skip': 'Skip',
  'location.title': 'Enable location',
  'location.body':
    'With your location we can detect which service you are travelling on and show you relevant reports.',
  'location.enable': 'Enable location',
  'tab.map': 'Map',
  'tab.trips': 'Trips',
  'tab.report': 'Report',
  'tab.reports': 'Reports',
  'tab.profile': 'Profile',
  'home.searchPlaceholder': 'Where would you like to go?',
  'home.nearby': 'Nearby',
  'home.currentReports': 'Current reports',
  'detection.confirmQuestion': 'Are you travelling on this service?',
  'detection.confirmYes': 'Yes',
  'detection.chooseOther': 'Choose a different trip',
  'detection.manualButton': 'Select my trip',
  'trip.nextStop': 'Next stop',
  'trip.arrival': 'Arrival',
  'trip.liveOnThisTrip': 'Live on this trip',
  'report.create': 'Report',
  'report.submit': 'Send',
  'report.confirm': 'Confirm',
  'report.outdated': 'No longer accurate',
  'profile.signIn': 'Sign in',
  'profile.signOut': 'Sign out',
  'settings.title': 'Settings',
  'error.generic': 'Something went wrong. Please try again.',
};
