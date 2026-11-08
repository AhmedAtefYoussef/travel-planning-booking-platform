# MongoDB Atlas setup (TRVL-128)

The team leader created the shared Atlas cluster (a replica set, so transactions work for HTL-18), one database user per member, and the team IP access list. Each member received their connection string privately.

## Every member
1. Copy the template: `cp .env.example backend/.env`, then put your own `MONGODB_URI` and the shared secrets into `backend/.env`.
   - `backend/.env` is gitignored, and CI fails any PR that contains an `.env` file.
   - Never paste the URI into GitHub, group chats or AI tools (brief section 11.2d).
2. From `backend/`, run `npm run db:check`. The expected output is:
   ```
   OK in 180 ms
     database:      travel_platform
     replica set:   atlas-xxxx-shard-0
     writable:      yes
     transactions:  supported
   ```
3. `npm run start:dev`, then open `http://localhost:3000/api/health`. It should return `{"status":"ok","db":"up",...}`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Invalid environment configuration` at startup | The message names the missing or malformed variable; compare with `.env.example` |
| `querySrv ENOTFOUND` / timeout | Your IP is not on the Atlas access list, or a VPN/firewall blocks port 27017 |
| `bad auth : authentication failed` | Wrong database user or password (URL-encode special characters in the password) |
| `transactions: NOT supported` | You are pointing at a standalone local MongoDB; use the Atlas URI |

## Rotating credentials
If a URI leaks, the team leader rotates that member's database user password in Atlas (Database Access) and sends the new URI privately.
