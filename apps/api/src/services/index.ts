import type { AppContext } from '../context.js';
import { DetectionService } from './detection.service.js';
import { ModerationService } from './moderation.service.js';
import { ReportsService } from './reports.service.js';
import { TransitService } from './transit.service.js';

export interface ApiServices {
  transit: TransitService;
  detection: DetectionService;
  reports: ReportsService;
  moderation: ModerationService;
}

export function createServices(ctx: AppContext): ApiServices {
  const transit = new TransitService(ctx.db, ctx.cache);
  const detection = new DetectionService(ctx.db, transit, ctx.config);
  const reports = new ReportsService(ctx.db, ctx.cache, ctx.config, transit, ctx.realtime);
  const moderation = new ModerationService(ctx.db, reports);
  return { transit, detection, reports, moderation };
}

export { TransitService, DetectionService, ReportsService, ModerationService };
