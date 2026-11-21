import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  /** Replica set name; transactions (HTL-18) need one. Null when unknown or standalone. */
  replicaSet: string | null;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async check(): Promise<HealthReport> {
    let db: HealthReport['db'] = 'down';
    let replicaSet: string | null = null;
    try {
      const admin = this.connection.db?.admin();
      if (admin) {
        const hello = (await admin.command({ hello: 1 })) as {
          setName?: string;
        };
        db = 'up';
        replicaSet = hello.setName ?? null;
      }
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      replicaSet,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
