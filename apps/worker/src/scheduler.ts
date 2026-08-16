import { Cron } from 'croner';
import type { Logger } from './logger.js';

/**
 * Einfacher Job-Scheduler.
 *
 * Zwei Auslöser: feste Intervalle (Polling) und Cron-Ausdrücke (nächtliche
 * Läufe). Ein Job läuft nie parallel zu sich selbst — ein hängender GTFS-RT-
 * Abruf darf sich nicht aufstauen.
 */
export interface JobDefinition {
  name: string;
  /** Ausführung alle N Sekunden. */
  intervalSeconds?: number;
  /** Alternativ ein Cron-Ausdruck (5 oder 6 Felder). */
  cron?: string;
  /** Sofort beim Start einmal ausführen. */
  runOnStart?: boolean;
  run: () => Promise<void>;
}

export interface JobState {
  name: string;
  running: boolean;
  runs: number;
  failures: number;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly crons: Cron[] = [];
  private readonly states = new Map<string, JobState>();
  private stopped = false;

  constructor(private readonly logger: Logger) {}

  register(job: JobDefinition): void {
    this.states.set(job.name, {
      name: job.name,
      running: false,
      runs: 0,
      failures: 0,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
    });

    const execute = async (): Promise<void> => {
      const state = this.states.get(job.name)!;
      if (this.stopped) return;
      if (state.running) {
        this.logger.warn('Job läuft noch — Ausführung übersprungen', { job: job.name });
        return;
      }
      state.running = true;
      const started = Date.now();
      try {
        await job.run();
        state.runs += 1;
        state.lastError = null;
      } catch (error) {
        state.failures += 1;
        state.lastError = error instanceof Error ? error.message : String(error);
        this.logger.error('Job fehlgeschlagen', { job: job.name, error: state.lastError });
      } finally {
        state.running = false;
        state.lastRunAt = new Date();
        state.lastDurationMs = Date.now() - started;
      }
    };

    if (job.intervalSeconds) {
      const timer = setInterval(() => void execute(), job.intervalSeconds * 1000);
      // Der Prozess soll nicht allein wegen der Timer weiterlaufen.
      timer.unref();
      this.timers.push(timer);
      this.logger.info('Job registriert', { job: job.name, intervalSeconds: job.intervalSeconds });
    }

    if (job.cron) {
      const cron = new Cron(job.cron, { timezone: 'Europe/Zurich' }, () => void execute());
      this.crons.push(cron);
      this.logger.info('Job registriert', { job: job.name, cron: job.cron });
    }

    if (job.runOnStart) void execute();
  }

  snapshot(): JobState[] {
    return [...this.states.values()];
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    for (const cron of this.crons) cron.stop();
  }
}
