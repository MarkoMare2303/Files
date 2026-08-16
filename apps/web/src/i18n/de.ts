/**
 * Deutsches Sprachpaket — vollständig (§45).
 * Alle anderen Sprachen fallen pro fehlendem Schlüssel hierauf zurück.
 */
export const de = {
  // Allgemein
  'common.ok': 'OK',
  'common.cancel': 'Abbrechen',
  'common.retry': 'Erneut versuchen',
  'common.close': 'Schliessen',
  'common.back': 'Zurück',
  'common.save': 'Speichern',
  'common.later': 'Später',
  'common.yes': 'Ja',
  'common.no': 'Nein',
  'common.loading': 'Wird geladen …',
  'common.now': 'jetzt',
  'common.minutesShort': '{count} Min.',
  'common.official': 'Offizielle Meldung',
  'common.community': 'Community-Meldung',
  'common.estimatedPosition': 'Geschätzte Position',

  // Onboarding (§58)
  'onboarding.1.title': 'Dein ÖV. Live. Gemeinsam.',
  'onboarding.1.body':
    'Aktuelle Informationen von Fahrgästen und offiziellen Schweizer ÖV-Daten — in einer App.',
  'onboarding.2.title': 'Deine Fahrt automatisch erkennen',
  'onboarding.2.body':
    'Mit deinem Standort erkennen wir, mit welcher Verbindung du gerade unterwegs bist. Die Auswertung passt zu Fahrplan und Strecke — wir speichern keine Bewegungshistorie.',
  'onboarding.3.title': 'Community',
  'onboarding.3.body':
    'Melde in wenigen Sekunden, was du gerade erlebst: Auslastung, Störungen, defekte Türen. Andere Fahrgäste sehen es sofort.',
  'onboarding.next': 'Weiter',
  'onboarding.start': 'Los geht’s',
  'onboarding.skip': 'Überspringen',

  // Standort (§59)
  'location.title': 'Standort aktivieren',
  'location.body':
    'Mit deinem Standort können wir erkennen, mit welcher Verbindung du gerade unterwegs bist und dir passende Meldungen zeigen.',
  'location.enable': 'Standort aktivieren',
  'location.denied.title': 'Standort nicht verfügbar',
  'location.denied.body':
    'Du kannst die App weiter nutzen und deine Fahrt jederzeit manuell auswählen.',
  'location.openSettings': 'Einstellungen öffnen',

  // Navigation
  'tab.map': 'Karte',
  'tab.trips': 'Fahrten',
  'tab.report': 'Melden',
  'tab.reports': 'Meldungen',
  'tab.profile': 'Profil',

  // Startseite (§28)
  'home.greeting.morning': 'Guten Morgen',
  'home.greeting.day': 'Hallo',
  'home.greeting.evening': 'Guten Abend',
  'home.searchPlaceholder': 'Wohin möchtest du?',
  'home.probablyOnBoard': 'Du bist wahrscheinlich unterwegs mit:',
  'home.openTrip': 'Fahrt öffnen',
  'home.nearby': 'In deiner Nähe',
  'home.currentReports': 'Aktuelle Meldungen',
  'home.favorites': 'Favoriten',
  'home.nextDepartures': 'Nächste Abfahrten',
  'home.noNearbyStops': 'Keine Haltestellen in der Nähe gefunden.',
  'home.noReports': 'Aktuell keine Meldungen in deiner Nähe.',

  // Fahrtenerkennung (§11/§12)
  'detection.confirmQuestion': 'Bist du gerade hier unterwegs?',
  'detection.confirmYes': 'Ja',
  'detection.chooseOther': 'Andere Fahrt auswählen',
  'detection.chooseTitle': 'Welche Fahrt ist es?',
  'detection.manualButton': 'Meine Fahrt auswählen',
  'detection.searching': 'Fahrt wird erkannt …',
  'detection.notFound.title': 'Wir konnten deine Fahrt nicht eindeutig erkennen.',
  'detection.notFound.body': 'Bitte wähle sie kurz aus.',
  'detection.disabled': 'Automatische Erkennung ist ausgeschaltet.',
  'detection.confidence': 'Übereinstimmung {percent} %',

  // Manuelle Auswahl
  'manual.title': 'Fahrt auswählen',
  'manual.searchLine': 'Linie suchen',
  'manual.searchStop': 'Haltestelle auswählen',
  'manual.departures': 'Nächste Abfahrten',
  'manual.noDepartures': 'Keine Abfahrten in den nächsten Stunden.',

  // Trip Screen (§14)
  'trip.nextStop': 'Nächster Halt',
  'trip.arrival': 'Ankunft',
  'trip.departure': 'Abfahrt',
  'trip.onTime': 'pünktlich',
  'trip.delay': '+{minutes} Min.',
  'trip.early': '−{minutes} Min.',
  'trip.cancelled': 'Fahrt fällt aus',
  'trip.liveOnThisTrip': 'Live auf dieser Fahrt',
  'trip.noReports': 'Noch keine Meldungen für diese Fahrt.',
  'trip.beFirst': 'Sei die erste Person, die etwas meldet.',
  'trip.follow': 'Meldungen für diese Fahrt aktivieren?',
  'trip.followOn': 'Benachrichtigungen aktiv',
  'trip.followOff': 'Benachrichtigungen aus',
  'trip.endSession': 'Fahrt beenden',
  'trip.allStops': 'Alle Halte',
  'trip.progress': 'Fortschritt',

  // Meldungen (§14/§15/§18)
  'report.create': 'Melden',
  'report.createTitle': 'Was ist los?',
  'report.chooseCategory': 'Kategorie auswählen',
  'report.optionalMessage': 'Ergänzung (optional)',
  'report.messagePlaceholder': 'Kurz beschreiben …',
  'report.submit': 'Senden',
  'report.submitting': 'Wird gesendet …',
  'report.success': 'Danke! Deine Meldung ist online.',
  'report.successOffline': 'Gespeichert. Wird gesendet, sobald du wieder online bist.',
  'report.confirm': 'Bestätigen',
  'report.confirmed': 'Bestätigt',
  'report.outdated': 'Nicht mehr aktuell',
  'report.confirmations': '{count} Personen bestätigen',
  'report.confirmationsOne': '1 Person bestätigt',
  'report.flag': 'Melden',
  'report.flagTitle': 'Warum meldest du das?',
  'report.flagReason.SPAM': 'Spam',
  'report.flagReason.INCORRECT': 'Falsche Information',
  'report.flagReason.OFFENSIVE': 'Beleidigend',
  'report.flagReason.PERSONAL_DATA': 'Enthält persönliche Daten',
  'report.flagReason.OTHER': 'Anderer Grund',
  'report.flagSent': 'Danke — wir prüfen das.',
  'report.needsTrip': 'Wähle zuerst deine Fahrt aus, dann können wir das zuordnen.',
  'report.needsAccount': 'Zum Melden brauchst du ein Konto.',
  'report.trust.low': 'Geringe Sicherheit',
  'report.trust.likely': 'Wahrscheinlich',
  'report.trust.confirmed': 'Mehrfach bestätigt',
  'report.scope.VEHICLE_TRIP': 'Diese Fahrt',
  'report.scope.ROUTE_SEGMENT': 'Streckenabschnitt',
  'report.scope.STOP': 'Haltestelle',
  'report.scope.STATION': 'Bahnhof',
  'report.scope.NETWORK': 'Netzweit',
  'report.mine': 'Deine Meldung',

  // Karte (§13)
  'map.title': 'Karte',
  'map.myLocation': 'Mein Standort',
  'map.layers': 'Ebenen',
  'map.layer.stops': 'Haltestellen',
  'map.layer.reports': 'Community-Meldungen',
  'map.layer.alerts': 'Offizielle Störungen',
  'map.noStyle':
    'Kartenhintergrund nicht konfiguriert. Setze EXPO_PUBLIC_MAP_TILE_URL, um die Karte anzuzeigen.',

  // Suche (§27)
  'search.title': 'Suche',
  'search.placeholder': 'Bahnhof, Linie oder Ort',
  'search.recent': 'Zuletzt gesucht',
  'search.favorites': 'Favoriten',
  'search.noResults': 'Nichts gefunden.',
  'search.minChars': 'Mindestens zwei Zeichen eingeben.',

  // Profil und Einstellungen
  'profile.title': 'Profil',
  'profile.signIn': 'Anmelden',
  'profile.signOut': 'Abmelden',
  'profile.guest': 'Gastmodus',
  'profile.guestBody': 'Du kannst alles ansehen. Zum Melden brauchst du ein Konto.',
  'profile.myReports': 'Meine Meldungen',
  'profile.settings': 'Einstellungen',
  'profile.tier.NEW': 'Neu dabei',
  'profile.tier.ESTABLISHED': 'Etabliert',
  'profile.tier.TRUSTED': 'Vertrauenswürdig',
  'profile.reportsCount': '{count} Meldungen',

  'settings.title': 'Einstellungen',
  'settings.appearance': 'Darstellung',
  'settings.theme.SYSTEM': 'Automatisch',
  'settings.theme.LIGHT': 'Hell',
  'settings.theme.DARK': 'Dunkel',
  'settings.language': 'Sprache',
  'settings.notifications': 'Benachrichtigungen',
  'settings.notify.officialDisruptions': 'Offizielle Störungen',
  'settings.notify.delays': 'Verspätungen',
  'settings.notify.highOccupancy': 'Hohe Auslastung',
  'settings.notify.vehicleIssues': 'Fahrzeugprobleme',
  'settings.notify.safety': 'Sicherheit',
  'settings.notify.connectionAtRisk': 'Anschluss gefährdet',
  'settings.notify.communityReports': 'Community-Meldungen',
  'settings.privacy': 'Datenschutz',
  'settings.autoTripDetection': 'Fahrt automatisch erkennen',
  'settings.autoFollow': 'Erkannter Fahrt automatisch folgen',
  'settings.backgroundLocation': 'Standort im Hintergrund',
  'settings.backgroundLocationHint':
    'Nur nötig, wenn die Erkennung bei ausgeschaltetem Bildschirm weiterlaufen soll.',
  'settings.analytics': 'Anonyme Nutzungsstatistik',
  'settings.analyticsHint':
    'Hilft uns, die App zu verbessern. Es werden keine Standortdaten übertragen.',
  'settings.reducedMotion': 'Bewegungen reduzieren',
  'settings.dataExport': 'Meine Daten exportieren',
  'settings.dataExportDone': 'Die Datei wurde in deine Downloads gespeichert.',
  'settings.deleteAccount': 'Konto löschen',
  'settings.deleteAccountConfirm':
    'Damit werden dein Konto und alle deine Meldungen endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
  'settings.deleteAccountAction': 'Endgültig löschen',
  'settings.about': 'Über die App',

  // Anmeldung (§22)
  'auth.title': 'Anmelden',
  'auth.subtitle': 'Zum Melden und Bestätigen brauchst du ein Konto.',
  'auth.apple': 'Mit Apple anmelden',
  'auth.google': 'Mit Google anmelden',
  'auth.email': 'E-Mail-Adresse',
  'auth.emailAction': 'Anmeldelink senden',
  'auth.emailSent': 'Wir haben dir einen Link geschickt. Prüfe dein Postfach.',
  'auth.continueAsGuest': 'Ohne Konto fortfahren',
  'auth.callbackFailed':
    'Die Anmeldung konnte nicht abgeschlossen werden. Der Link ist möglicherweise abgelaufen — fordere einen neuen an.',
  'auth.notConfigured':
    'Anmeldung ist nicht konfiguriert. Es fehlen EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY.',

  // Fehler (§44)
  'error.generic': 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.',
  'error.offline': 'Keine Verbindung. Wir zeigen dir die zuletzt geladenen Informationen.',
  'error.timetableUnavailable':
    'Die Fahrplandaten sind momentan nicht erreichbar. Wir zeigen dir die zuletzt verfügbaren Informationen.',
  'error.realtimeUnavailable': 'Echtzeitdaten sind gerade nicht verfügbar. Angezeigt werden Fahrplanzeiten.',
  'error.notFound': 'Das haben wir nicht gefunden.',
  'error.rateLimited': 'Du warst sehr aktiv. Bitte warte einen Moment.',
  'error.mapUnavailable':
    'Für die Karte ist keine Kachelquelle konfiguriert. Listen und Meldungen funktionieren trotzdem.',

  // Leere Zustände
  'empty.reports': 'Keine Meldungen.',
  'empty.trips': 'Noch keine Fahrten.',
  'empty.favorites': 'Noch keine Favoriten gespeichert.',

  // Datenherkunft (§7) — jedes Badge sagt, worauf die Zahl beruht.
  'source.realtime': 'Live',
  'source.scheduled': 'Fahrplan',
  'source.estimated': 'Geschätzt',
  'source.explainRealtime': 'Echtzeitdaten des Verkehrsbetriebs.',
  'source.explainScheduled': 'Sollzeit aus dem veröffentlichten Fahrplan.',
  'source.explainEstimated': 'Von uns berechnet — nicht vom Betrieb bestätigt.',

  // Standort im Browser
  'location.unsupported': 'Dein Browser unterstützt keine Standortbestimmung.',
  'location.unavailable': 'Dein Standort konnte nicht ermittelt werden.',
  'location.timeout': 'Die Standortbestimmung hat zu lange gedauert.',
  'location.foregroundOnly':
    'Die Fahrterkennung läuft nur, solange diese Seite geöffnet ist. Im Hintergrund kann ein Browser den Standort nicht abfragen.',
  'location.watching': 'Standort wird verfolgt',
  'location.paused': 'Ortung pausiert',

  // Installation als App
  'pwa.installTitle': 'ÖV Live als App installieren',
  'pwa.installBody': 'Schneller starten, Vollbild und Benachrichtigungen — ohne App Store.',
  'pwa.install': 'Installieren',
  'pwa.installed': 'Als App installiert',
  'pwa.iosTitle': 'Auf dem iPhone installieren',
  'pwa.iosStep1': 'Tippe unten auf «Teilen».',
  'pwa.iosStep2': 'Wähle «Zum Home-Bildschirm».',
  'pwa.iosStep3': 'Bestätige mit «Hinzufügen».',
  'pwa.updateAvailable': 'Eine neue Version ist verfügbar.',
  'pwa.updateApply': 'Aktualisieren',
  'pwa.offlineTitle': 'Keine Verbindung',
  'pwa.offlineBody':
    'Diese Seite ist offline nicht verfügbar. Zuletzt geladene Inhalte kannst du weiter ansehen.',
  'pwa.offlineBadge': 'Offline',
  'pwa.queued': '{count} Meldungen warten auf Verbindung.',
  'pwa.queuedOne': '1 Meldung wartet auf Verbindung.',

  // Push-Benachrichtigungen im Browser
  'push.title': 'Benachrichtigungen',
  'push.enable': 'Benachrichtigungen aktivieren',
  'push.disable': 'Benachrichtigungen ausschalten',
  'push.enabled': 'Benachrichtigungen sind aktiv.',
  'push.blocked.unsupported': 'Dein Browser unterstützt keine Web-Benachrichtigungen.',
  'push.blocked.needsInstallIos':
    'Auf dem iPhone sind Benachrichtigungen erst möglich, wenn du die App zum Home-Bildschirm hinzugefügt hast.',
  'push.blocked.permissionDenied':
    'Benachrichtigungen sind für diese Seite blockiert. Du kannst das in den Browsereinstellungen ändern.',
  'push.blocked.notSignedIn': 'Melde dich an, um Benachrichtigungen zu erhalten.',
  'push.blocked.serverDisabled': 'Benachrichtigungen sind auf diesem Server nicht eingerichtet.',

  // Landing-Page
  'landing.title': 'Schweizer ÖV — live und gemeinsam',
  'landing.subtitle':
    'Fahrplan, Echtzeit und Meldungen von Fahrgästen für Zug, S-Bahn, Tram, Bus und PostAuto in der ganzen Schweiz.',
  'landing.cta': 'App öffnen',
  'landing.install': 'Zum Home-Bildschirm hinzufügen',
  'landing.feature1.title': 'Offiziell und Community — immer unterscheidbar',
  'landing.feature1.body':
    'Meldungen der Verkehrsbetriebe und Beobachtungen von Fahrgästen sind konsequent getrennt gekennzeichnet. Du siehst jederzeit, woher eine Information stammt.',
  'landing.feature2.title': 'Deine Fahrt wird erkannt',
  'landing.feature2.body':
    'Aus deinem Standort, dem Fahrplan und dem Streckenverlauf leiten wir ab, worin du sitzt — ohne Bewegungsprofil zu speichern.',
  'landing.feature3.title': 'In fünf Sekunden gemeldet',
  'landing.feature3.body':
    'Kategorie antippen, fertig. Ohne Verbindung wird die Meldung gespeichert und gesendet, sobald du wieder Empfang hast.',
  'landing.privacyTitle': 'Datenschutz',
  'landing.privacyBody':
    'Keine Bewegungshistorie, keine Weitergabe an Werbenetzwerke, jederzeit exportier- und löschbar.',

  // Verbindungen
  'journey.title': 'Verbindungen',
  'journey.from': 'Von',
  'journey.to': 'Nach',
  'journey.search': 'Suchen',
  'journey.transfers': '{count} Umstiege',
  'journey.transfersOne': '1 Umstieg',
  'journey.direct': 'Direkt',
  'journey.duration': '{minutes} Min.',
} as const;
