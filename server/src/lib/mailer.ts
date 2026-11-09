/**
 * Pluggable mailer. Stage 2 ships two implementations:
 *  - FileMailer: writes each email to server/data/outbox/*.eml (default; never sends anything)
 *  - MemoryMailer: keeps emails in memory (tests)
 * A real provider (SMTP, Resend, SES, ...) can be added later by implementing `Mailer`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class FileMailer implements Mailer {
  constructor(private dir: string, private from = 'Batlas <no-reply@batlas.local>') {}
  async send(msg: MailMessage) {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.eml`;
    const body = `From: ${this.from}\nTo: ${msg.to}\nSubject: ${msg.subject}\nDate: ${new Date().toUTCString()}\nContent-Type: text/plain; charset=utf-8\n\n${msg.text}\n`;
    await fs.promises.writeFile(path.join(this.dir, name), body, { mode: 0o600 });
  }
}

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
  last(to?: string) {
    const list = to ? this.sent.filter((m) => m.to === to) : this.sent;
    return list[list.length - 1];
  }
}
