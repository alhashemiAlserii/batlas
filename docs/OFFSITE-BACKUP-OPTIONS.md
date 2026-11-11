# Off-box backup options (write-up only — nothing is set up)

**Status:** today every Batlas backup lives on one machine: `/workspace/studio/server/backups/` on the shared box (30 newest daily JSON dumps, chmod 600). If that box is lost or wiped, the live free Postgres is the only copy, and that database has **no backups at all** and expires 2026-12-10. Nothing below has been created, configured or uploaded; each option needs Abdallah's OK (accounts, keys, possibly a card).

Sizes today: a dump is ~11–19 KB (one user, 35–57 rows). After `website-upgrade` ships, **uploaded media is inside every dump as base64** (~1.33× the bytes), so one 40 MB trailer makes *every daily file* ~53 MB larger. Plan for anything from kilobytes to a few hundred MB per file (free DB cap is 1 GB).

## Encrypt first, always

Dumps contain password hashes and account data, so any copy that leaves the box should be encrypted **on the box** before upload:

- **age** (public-key): the box only holds the *public* recipient key; the private key lives with Abdallah (password manager + printed/offline copy). A stolen box or a leaked bucket can't decrypt anything. Tiny, no config. Not installed on the box yet (would need `apt install age` or the release binary). <https://github.com/FiloSottile/age>
- **gpg** (already on the box, `/usr/bin/gpg`): same idea with `gpg --encrypt --recipient …`, more moving parts.
- **rclone crypt**: symmetric (password) encryption built into the upload tool (XSalsa20-Poly1305, scrypt key derivation); the password is stored only "lightly obscured" in `rclone.conf` unless the config itself is encrypted, so the box effectively holds the key. <https://rclone.org/crypt/>

Whichever is chosen, the **decryption key must not live only on the box**, or losing the box loses the backups too. A restore drill should include a decrypt step.

## Options

| | (a) Private GitHub repo | (b) Google Drive (rclone / API) | (c) Render paid Postgres | (d) Cloudflare R2 / Backblaze B2 | (e) Abdallah's own device |
| --- | --- | --- | --- | --- | --- |
| What | `age`-encrypted file committed + pushed daily to a new private repo | encrypted file uploaded to a Drive folder | upgrade `batlas-db` from Free to a paid plan | encrypted file uploaded to an S3-compatible bucket | periodic copy pulled to Abdallah's computer / USB |
| Cost | $0 (private repos unlimited on Free) | $0 within 15 GB (shared with Gmail/Photos) | from **$6/month** (0.1 CPU / 256 MB); +$0.30/GB storage | $0 within **10 GB** (both); then R2 $0.015/GB-mo, B2 $6.95/TB-mo | $0 |
| Setup effort | low: create repo, deploy key or token, `age` key pair, 10 lines in `daily-backup.sh` | medium: Google OAuth client + rclone config with a token on the box | very low: one plan change in the Render dashboard | medium: account, bucket, scoped API key, lifecycle rule, rclone/aws-cli | manual, needs Abdallah each time |
| Retention / deletion | git history keeps **every** file forever; deleting needs history rewrite; repo should stay < 1 GB (GitHub warns at 50 MiB/file, blocks 100 MiB) | manual or rclone `--max-age` cleanup | built-in PITR **3 days** on Hobby workspace (7 on Pro) + logical exports kept 7 days | lifecycle rules can expire old objects automatically; versioning possible | whatever he keeps |
| Protects against | box loss | box loss | DB expiry/deletion, bad deploys, accidental deletes (point-in-time) | box loss | box loss + cloud account loss |
| Weak spots | wrong tool for growing binary data ("Git is not designed to serve as a backup tool"); box needs push rights to it | the token on the box can reach Drive; quota shared with mail | not off-Render (same provider); recovery window is short; still costs monthly | another account to look after | manual → gets forgotten |
| Box reachability | HTTPS git push — works from the box (pushes to GitHub already work) | HTTPS — should work | n/a (Render-side) | HTTPS — should work | n/a |

Sources (all opened 2026-11-10): Render free limits <https://render.com/docs/free>; Render prices <https://render.com/pricing>; Render PITR/exports <https://render.com/docs/postgresql-backups>; GitHub plans <https://github.com/pricing>; GitHub file/repo size limits <https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github>; Cloudflare R2 pricing <https://developers.cloudflare.com/r2/pricing/>; Backblaze B2 pricing <https://www.backblaze.com/cloud-storage/pricing>; Google storage 15 GB <https://support.google.com/googleone/answer/9312312?hl=en>; rclone crypt <https://rclone.org/crypt/>.

Other notes:
- (c) also changes the Dec 3 plan: an upgraded database simply doesn't expire, so there is **no move** (see BACKUP-RESTORE.md, Option A). Render's free tier allows only one free Postgres per workspace, which makes a free→free move require deleting the old DB first.
- (a)/(b)/(d) only copy what the box already downloaded; the box still has to be up for the daily 4 am Dubai job.
- Free R2 tier applies to Standard storage only. B2's first 10 GB are always free, with free egress up to 3× stored.

## Recommendation

1. **Now, before 2026-12-10: (c)** — upgrade the existing database to the $6/month plan. It is the only option that removes the expiry and adds real point-in-time recovery, and it makes the risky Dec 3 delete-then-recreate move unnecessary. Needs a card on Render and Abdallah's OK.
2. **Plus one encrypted off-box copy: (d) Backblaze B2 or Cloudflare R2** with `age` public-key encryption, 30-day lifecycle expiry, and the age private key held by Abdallah (not on the box). Free at our size, handles growing media dumps, and old files expire on their own.
   - If a zero-new-account start is wanted *today*, (a) a private GitHub repo with `age`-encrypted files is acceptable **while dumps are small** (no media yet), with a plan to move to (d) before trailers are uploaded.
3. Keep (e) for the few high-stakes moments (e.g. the final backup before any database change): one manual copy on Abdallah's own device.

What setting up (d) would involve (for later, after approval): create the bucket + an API key limited to that bucket, `apt install age rclone`, generate the age key pair (private key to Abdallah), and append to `daily-backup.sh`: `age -r <pubkey> -o f.json.age f.json && rclone copyto f.json.age remote:batlas-backups/…`, plus a monthly drill that downloads, decrypts and runs `scripts/restore-drill.ts`.
