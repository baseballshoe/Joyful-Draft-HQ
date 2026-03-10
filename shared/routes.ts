import { z } from 'zod';
import { insertPlayerSchema, insertDraftStateSchema, insertRoundStrategySchema, draftState, roundStrategy } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  draftState: {
    get: {
      method: 'GET' as const,
      path: '/api/draft-state' as const,
      responses: {
        200: z.custom<typeof draftState.$inferSelect>(),
      }
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/draft-state' as const,
      input: insertDraftStateSchema.partial(),
      responses: {
        200: z.custom<typeof draftState.$inferSelect>(),
      }
    }
  },
  players: {
    list: {
      method: 'GET' as const,
      path: '/api/players' as const,
      input: z.object({
        status: z.string().optional(),
        pos: z.string().optional(),
        tag: z.string().optional(),
        search: z.string().optional()
      }).optional(),
      responses: {
        200: z.array(z.custom<any>()),
      }
    },
    get: {
      method: 'GET' as const,
      path: '/api/players/:id' as const,
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound
      }
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/players/:id' as const,
      input: insertPlayerSchema.partial(),
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound
      }
    },
    reset: {
      method: 'POST' as const,
      path: '/api/players/:id/reset' as const,
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound
      }
    }
  },
  dashboard: {
    get: {
      method: 'GET' as const,
      path: '/api/dashboard' as const,
      responses: {
        200: z.custom<any>() // DashboardData
      }
    }
  },
  roundStrategy: {
    list: {
      method: 'GET' as const,
      path: '/api/round-strategy' as const,
      responses: {
        200: z.array(z.custom<typeof roundStrategy.$inferSelect>())
      }
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/round-strategy/:id' as const,
      input: insertRoundStrategySchema.partial(),
      responses: {
        200: z.custom<typeof roundStrategy.$inferSelect>(),
        404: errorSchemas.notFound
      }
    }
  },
  cheatSheet: {
    list: {
      method: 'GET' as const,
      path: '/api/cheat-sheet' as const,
      responses: {
        200: z.record(z.string(), z.string())
      }
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/cheat-sheet/:section' as const,
      input: z.object({ content: z.string() }),
      responses: {
        200: z.object({ ok: z.literal(true) })
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export const ws = {
  receive: {
    draft_state: z.custom<any>(),
    player_updated: z.custom<any>(),
    round_strategy_updated: z.custom<any>(),
    cheat_sheet_updated: z.custom<any>(),
  }
};
