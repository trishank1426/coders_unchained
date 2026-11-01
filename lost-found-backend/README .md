# Campus Lost & Found: Backend

Node.js + Express API with a **MySQL** database and **photo hosting**.

| What | Where it lives |
|------|----------------|
| Users, items, photo records | MySQL (`users`, `items`, `item_photos`) |
| Photo files | `uploads/` folder, served at `/uploads/<name>.jpg` |

Every uploaded photo is re-saved as a JPEG (max 1600 px) with a 480 px thumbnail.
This confirms the file is a real image and removes hidden data such as the GPS location from phone photos.

## 1. Set up MySQL

**Option A: Docker (easiest)**
```bash
cp .env.example .env        # set DB_PASSWORD and JWT_SECRET
docker compose up -d
```

**Option B: MySQL already installed**
Make sure it is running, then put your login in `.env` (`DB_USER`, `DB_PASSWORD`).

The server creates the database and tables by itself on first start (see `schema.sql`).

## 2. Run the API
```bash
npm install
cp .env.example .env        # skip if done above
npm run dev
```
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

You should see `API running on http://localhost:3000`.

## 3. Connect the website
In the frontend folder, `app.js` already points at `http://localhost:3000/api` with `USE_BACKEND = true`.
Open the site with Live Server (`http://127.0.0.1:5500`). That address is already allowed in `CORS_ORIGIN`.

## Endpoints

| Method | Path | Sign-in | Description |
|--------|------|---------|-------------|
| GET | /api/health | no | Checks the server and database |
| POST | /api/auth/register | no | `name`, `email`, `password`, `whatsapp` (digits with country code, e.g. `919876543210`) |
| POST | /api/auth/login | no | `email`, `password` |
| GET | /api/me | yes | Current user |
| PATCH | /api/me | yes | `{ "whatsapp": "919876543210" }`: add or change your WhatsApp number (for accounts made before WhatsApp was added) |
| GET | /api/items | no | List open items. Query: `type`, `category`, `q`, `page`, `limit`, `status` |
| GET | /api/items/:id | no | One item. Includes the poster's `contactEmail` and `contactWhatsapp` only if you are signed in |
| POST | /api/items | yes | Create item. `multipart/form-data`: `type`, `title`, `description`, `category`, `location`, `date`, `photos` (up to 5 files, 5 MB each) |
| PATCH | /api/items/:id | owner | `{ "status": "resolved" }` or `"open"` |
| DELETE | /api/items/:id | owner | Deletes the item and its photo files |

Send the token as `Authorization: Bearer <token>`.

### Try it
```bash
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Asha","email":"asha@college.edu","password":"supersecret1","whatsapp":"919876543210"}'

curl -X POST localhost:3000/api/items -H "Authorization: Bearer YOUR_TOKEN" \
  -F type=found -F title="Blue AirPods case" -F category=Electronics \
  -F location=Library -F date=2026-10-30 -F photos=@case.jpg

curl "localhost:3000/api/items?type=found&q=airpods"
```

## WhatsApp contact
- Sign-up asks for a WhatsApp number (country code + number). It is stored as digits only in `users.whatsapp`.
- Existing databases are upgraded automatically: the server adds the `whatsapp` column on start.
- Numbers are only returned by `GET /api/items/:id` to signed-in users, never in the public list.
- On an item, the signed-in visitor gets a button that opens `https://wa.me/<number>?text=...` with a ready-made first message. WhatsApp does the delivery; the site never sends messages itself.
- Accounts created before this feature see an **Add WhatsApp** button in the header. Until a poster adds a number, visitors see an email button for that post instead.

## Before going live
- **Use HTTPS** and set `CORS_ORIGIN` to your real website address only, and `PUBLIC_URL` to the API's public address.
- **Create a limited MySQL user** instead of `root`:
  ```sql
  CREATE USER 'lostfound'@'localhost' IDENTIFIED BY 'a-strong-password';
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON lost_found.* TO 'lostfound'@'localhost';
  ```
- **Keep `uploads/` on a disk that persists** and include it in backups together with the database. If you host on a service with temporary disks, switch the photo storage to S3 or similar.
- Put the API behind a proxy such as Nginx, and set `TRUST_PROXY=1` so rate limits see real visitor addresses.
- Real college email checks (a confirmation link) and moderation of posts are not included yet.
