import { OAuth2Client } from 'google-auth-library';
import type { Collection, ObjectId } from 'mongodb';
import { ObjectId as MongoObjectId } from 'mongodb';

import { getClientPromise } from '@/lib/mongodb-client';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export class GoogleCalendarNotConfiguredError extends Error {
  constructor() {
    super('Google Calendar is not configured.');
    this.name = 'GoogleCalendarNotConfiguredError';
  }
}

export class GoogleCalendarAccountNotLinkedError extends Error {
  constructor(message = 'Google account is not linked. Please connect Google and try again.') {
    super(message);
    this.name = 'GoogleCalendarAccountNotLinkedError';
  }
}

export class GoogleCalendarInsufficientScopeError extends Error {
  constructor() {
    super('Google Calendar access has not been granted. Please reconnect Google with calendar permissions.');
    this.name = 'GoogleCalendarInsufficientScopeError';
  }
}

export class GoogleCalendarMissingRefreshTokenError extends Error {
  constructor() {
    super('Google account is missing offline access. Please reconnect Google to enable calendar sync.');
    this.name = 'GoogleCalendarMissingRefreshTokenError';
  }
}

export class GoogleCalendarApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown = null) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface CalendarTaskInput {
  taskId: string;
  title: string;
  message?: string;
  dueAt?: string | null;
  referralName?: string | null;
  priority?: string;
  category?: string;
}

interface GoogleAccountContext {
  client: OAuth2Client;
  accounts: Collection;
  accountId: ObjectId;
  originalScope: string | null | undefined;
}

const ensureGoogleAccount = async (userId: string): Promise<GoogleAccountContext> => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new GoogleCalendarNotConfiguredError();
  }

  const mongoClient = await getClientPromise();
  const accounts = mongoClient.db().collection('accounts');

  let objectId: MongoObjectId;
  try {
    objectId = new MongoObjectId(userId);
  } catch {
    throw new GoogleCalendarAccountNotLinkedError();
  }

  const account = await accounts.findOne<{ _id: MongoObjectId; scope?: string | null; refresh_token?: string | null; access_token?: string | null; expires_at?: number | null }>(
    { provider: 'google', userId: objectId }
  );

  if (!account) {
    throw new GoogleCalendarAccountNotLinkedError();
  }

  if (!account.scope?.includes(CALENDAR_SCOPE)) {
    throw new GoogleCalendarInsufficientScopeError();
  }

  const client = new OAuth2Client(clientId, clientSecret);

  client.setCredentials({
    refresh_token: account.refresh_token ?? undefined,
    access_token: account.access_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
    scope: account.scope ?? undefined,
  });

  if (!client.credentials.refresh_token) {
    throw new GoogleCalendarMissingRefreshTokenError();
  }

  return {
    client,
    accounts,
    accountId: account._id,
    originalScope: account.scope ?? null,
  };
};

const updateAccountTokens = async (
  context: GoogleAccountContext,
  accessToken: string,
  expiry: number | null | undefined,
  scope: string | null | undefined
) => {
  await context.accounts.updateOne(
    { _id: context.accountId },
    {
      $set: {
        access_token: accessToken,
        expires_at: expiry ? Math.floor(expiry / 1000) : null,
        scope: scope ?? context.originalScope ?? null,
      },
    }
  );
};

const acquireAccessToken = async (context: GoogleAccountContext, forceRefresh = false): Promise<string> => {
  if (forceRefresh) {
    const refreshToken = context.client.credentials.refresh_token;
    context.client.setCredentials({ refresh_token: refreshToken ?? undefined });
  }

  const { token } = await context.client.getAccessToken();
  const accessToken = token ?? context.client.credentials.access_token;

  if (!accessToken) {
    throw new GoogleCalendarApiError(401, 'Unable to acquire Google access token');
  }

  await updateAccountTokens(
    context,
    accessToken,
    context.client.credentials.expiry_date ?? null,
    context.client.credentials.scope ?? undefined
  );

  return accessToken;
};

const buildEventPayload = (task: CalendarTaskInput) => {
  const startTime = (() => {
    if (task.dueAt) {
      const parsed = new Date(task.dueAt);
      if (!Number.isNaN(parsed.valueOf())) {
        return parsed;
      }
    }
    return new Date(Date.now() + 30 * 60 * 1000);
  })();

  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

  const descriptionParts: string[] = [];
  if (task.message) {
    descriptionParts.push(task.message);
  }

  const metaParts: string[] = [];
  if (task.priority) {
    metaParts.push(`Priority: ${task.priority}`);
  }
  if (task.category) {
    metaParts.push(`Category: ${task.category}`);
  }
  if (task.referralName) {
    metaParts.push(`Referral: ${task.referralName}`);
  }
  if (metaParts.length > 0) {
    descriptionParts.push(metaParts.join(' | '));
  }

  return {
    summary: task.title,
    description: descriptionParts.join('\n\n') || undefined,
    start: { dateTime: startTime.toISOString() },
    end: { dateTime: endTime.toISOString() },
  };
};

export async function addTasksToCalendar(userId: string, tasks: CalendarTaskInput[]) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { created: 0 };
  }

  const context = await ensureGoogleAccount(userId);
  let accessToken = await acquireAccessToken(context);

  const createdTaskIds: string[] = [];

  for (const task of tasks) {
    const payload = buildEventPayload(task);

    const attempt = async (token: string) =>
      fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

    let response: Response;
    try {
      response = await attempt(accessToken);
    } catch (error) {
      throw new GoogleCalendarApiError(500, 'Failed to reach Google Calendar API', error);
    }

    if (response.status === 401) {
      accessToken = await acquireAccessToken(context, true);
      try {
        response = await attempt(accessToken);
      } catch (error) {
        throw new GoogleCalendarApiError(500, 'Failed to reach Google Calendar API', error);
      }
    }

    if (!response.ok) {
      let errorPayload: unknown = null;
      try {
        errorPayload = await response.json();
      } catch {}
      const message =
        (errorPayload as { error?: { message?: string } } | null | undefined)?.error?.message ??
        `Failed to create calendar event (status ${response.status})`;
      throw new GoogleCalendarApiError(response.status, message, errorPayload);
    }

    createdTaskIds.push(task.taskId);
  }

  return { created: createdTaskIds.length };
}

export type { CalendarTaskInput };
