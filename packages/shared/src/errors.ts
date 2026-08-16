import type { LocalizedText } from '@swissov/types';

/**
 * Fehlerkatalog (§44).
 *
 * Jeder Fehler hat einen stabilen Code, eine technische Meldung für Logs und
 * einen nutzerlesbaren Text. Die App zeigt ausschliesslich `userMessage` an —
 * keine Stacktraces, keine SQL-Fehler, keine kryptischen Codes.
 */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  TRANSIT_DATA_UNAVAILABLE: 'TRANSIT_DATA_UNAVAILABLE',
  REALTIME_UNAVAILABLE: 'REALTIME_UNAVAILABLE',
  JOURNEY_PLANNER_UNAVAILABLE: 'JOURNEY_PLANNER_UNAVAILABLE',
  TRIP_NOT_DETECTED: 'TRIP_NOT_DETECTED',
  NO_ACTIVE_FEED: 'NO_ACTIVE_FEED',
  ABUSE_BLOCKED: 'ABUSE_BLOCKED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const MESSAGES: Record<ErrorCode, { status: number; message: string; userMessage: LocalizedText }> = {
  UNAUTHENTICATED: {
    status: 401,
    message: 'Authentication required',
    userMessage: {
      de: 'Bitte melde dich an, um diese Funktion zu nutzen.',
      fr: 'Connecte-toi pour utiliser cette fonction.',
      it: 'Accedi per utilizzare questa funzione.',
      en: 'Please sign in to use this feature.',
    },
  },
  FORBIDDEN: {
    status: 403,
    message: 'Not allowed',
    userMessage: {
      de: 'Für diese Aktion fehlt dir die Berechtigung.',
      fr: 'Tu n’as pas les droits nécessaires pour cette action.',
      it: 'Non hai i permessi per questa azione.',
      en: 'You do not have permission for this action.',
    },
  },
  NOT_FOUND: {
    status: 404,
    message: 'Resource not found',
    userMessage: {
      de: 'Das haben wir nicht gefunden.',
      fr: 'Nous n’avons pas trouvé cet élément.',
      it: 'Non abbiamo trovato questo elemento.',
      en: 'We could not find that.',
    },
  },
  VALIDATION_FAILED: {
    status: 400,
    message: 'Request validation failed',
    userMessage: {
      de: 'Die Eingabe ist unvollständig oder ungültig.',
      fr: 'La saisie est incomplète ou invalide.',
      it: 'I dati inseriti sono incompleti o non validi.',
      en: 'The input is incomplete or invalid.',
    },
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Rate limit exceeded',
    userMessage: {
      de: 'Du hast in kurzer Zeit sehr viele Aktionen ausgeführt. Bitte warte einen Moment.',
      fr: 'Tu as effectué trop d’actions en peu de temps. Patiente un instant.',
      it: 'Hai eseguito troppe azioni in poco tempo. Attendi un momento.',
      en: 'You have done a lot in a short time. Please wait a moment.',
    },
  },
  CONFLICT: {
    status: 409,
    message: 'Conflicting state',
    userMessage: {
      de: 'Das steht im Widerspruch zum aktuellen Stand.',
      fr: 'Cela entre en conflit avec l’état actuel.',
      it: 'È in conflitto con lo stato attuale.',
      en: 'That conflicts with the current state.',
    },
  },
  ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'Account suspended',
    userMessage: {
      de: 'Dein Konto ist derzeit gesperrt. Du kannst die App weiter nutzen, aber keine Meldungen erstellen.',
      fr: 'Ton compte est actuellement bloqué. Tu peux continuer à utiliser l’app, mais pas publier de signalements.',
      it: 'Il tuo account è bloccato. Puoi usare l’app, ma non pubblicare segnalazioni.',
      en: 'Your account is currently suspended. You can keep using the app but cannot post reports.',
    },
  },
  FEATURE_DISABLED: {
    status: 503,
    message: 'Feature disabled by configuration',
    userMessage: {
      de: 'Diese Funktion ist derzeit nicht verfügbar.',
      fr: 'Cette fonction n’est pas disponible actuellement.',
      it: 'Questa funzione non è al momento disponibile.',
      en: 'This feature is currently unavailable.',
    },
  },
  TRANSIT_DATA_UNAVAILABLE: {
    status: 503,
    message: 'Timetable data unavailable',
    userMessage: {
      de: 'Die Fahrplandaten sind momentan nicht erreichbar. Wir zeigen dir die zuletzt verfügbaren Informationen.',
      fr: 'Les données horaires sont indisponibles. Nous affichons les dernières informations disponibles.',
      it: 'I dati orari non sono raggiungibili. Mostriamo le ultime informazioni disponibili.',
      en: 'Timetable data is currently unavailable. We are showing the most recent information we have.',
    },
  },
  REALTIME_UNAVAILABLE: {
    status: 503,
    message: 'Realtime feed unavailable',
    userMessage: {
      de: 'Echtzeitdaten sind gerade nicht verfügbar. Angezeigt werden die Fahrplanzeiten.',
      fr: 'Les données en temps réel sont indisponibles. Les horaires planifiés sont affichés.',
      it: 'I dati in tempo reale non sono disponibili. Sono mostrati gli orari pianificati.',
      en: 'Realtime data is unavailable. Scheduled times are shown instead.',
    },
  },
  JOURNEY_PLANNER_UNAVAILABLE: {
    status: 503,
    message: 'Journey planner not configured or unavailable',
    userMessage: {
      de: 'Die Verbindungssuche ist momentan nicht verfügbar.',
      fr: 'La recherche d’itinéraires est momentanément indisponible.',
      it: 'La ricerca di collegamenti non è momentaneamente disponibile.',
      en: 'Journey search is currently unavailable.',
    },
  },
  TRIP_NOT_DETECTED: {
    status: 404,
    message: 'No trip candidate matched',
    userMessage: {
      de: 'Wir konnten deine Fahrt nicht eindeutig erkennen. Bitte wähle sie kurz aus.',
      fr: 'Nous n’avons pas pu identifier ton trajet. Sélectionne-le brièvement.',
      it: 'Non siamo riusciti a identificare la tua corsa. Selezionala brevemente.',
      en: 'We could not identify your trip. Please select it.',
    },
  },
  NO_ACTIVE_FEED: {
    status: 503,
    message: 'No active GTFS feed imported',
    userMessage: {
      de: 'Es sind noch keine Fahrplandaten geladen. Bitte versuche es später erneut.',
      fr: 'Aucune donnée horaire n’est encore chargée. Réessaie plus tard.',
      it: 'Non sono ancora stati caricati dati orari. Riprova più tardi.',
      en: 'No timetable data has been loaded yet. Please try again later.',
    },
  },
  ABUSE_BLOCKED: {
    status: 422,
    message: 'Blocked by abuse protection',
    userMessage: {
      de: 'Wir konnten deine Meldung nicht verarbeiten.',
      fr: 'Nous n’avons pas pu traiter ton signalement.',
      it: 'Non è stato possibile elaborare la tua segnalazione.',
      en: 'We could not process your report.',
    },
  },
  INTERNAL: {
    status: 500,
    message: 'Internal server error',
    userMessage: {
      de: 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.',
      fr: 'Une erreur est survenue. Réessaie.',
      it: 'Si è verificato un errore. Riprova.',
      en: 'Something went wrong. Please try again.',
    },
  },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly userMessage: LocalizedText;
  readonly details: unknown;

  constructor(code: ErrorCode, options?: { message?: string; details?: unknown; userMessage?: LocalizedText }) {
    const preset = MESSAGES[code];
    super(options?.message ?? preset.message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = preset.status;
    this.userMessage = options?.userMessage ?? preset.userMessage;
    this.details = options?.details;
  }

  toJSON(requestId?: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        userMessage: this.userMessage,
        ...(this.details !== undefined ? { details: this.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
}

export function errorPreset(code: ErrorCode) {
  return MESSAGES[code];
}
