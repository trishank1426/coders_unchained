# Campus Lost & Found: Run on Localhost

Node.js + Express API with a MySQL database and photo hosting. The backend also serves the website (`lost-found-frontend`), so one command gives you both.

## Prerequisites

- **Node.js 18 or newer** (`node -v` to check)
- **MySQL 8** running locally, or **Docker** to start one for you

## 1. Open the backend folder

```bash
cd lost-and-found
cd lost-found-backend
```

All commands below are run from inside `lost-found-backend`.

## 2. Install dependencies

```bash
npm install
```

## 3. Set up the `.env` file

Create a file named `.env` in `lost-found-backend` (it already exists in the project; check that it matches this):

```env
PORT=3000
JWT_SECRET=paste-a-long-random-string-here
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-mysql-password
DB_NAME=lost_found
UPLOAD_DIR=uploads
PUBLIC_URL=http://localhost:3000
CORS_ORIGIN=http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:5501,http://localhost:5501
```

Generate a `JWT_SECRET` (must be at least 16 characters):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Security:** never commit `.env` or share it. If your real MySQL password or secret has been shared anywhere, change the password and generate a new `JWT_SECRET`.

## 4. Start MySQL

Pick **one** option.

**Option A: Docker (easiest)**

```bash
docker compose up -d
```

This starts MySQL 8.4 on `127.0.0.1:3306`, using `DB_PASSWORD` and `DB_NAME` from your `.env`. Note that the root password is set only the first time the volume is created. If you change `DB_PASSWORD` later, run `docker compose down -v` first (this deletes the database data).

**Option B: MySQL already installed**

Make sure the MySQL service is running, and that `DB_USER` / `DB_PASSWORD` in `.env` are correct.

You do **not** need to create the database or tables by hand. The server creates `lost_found` and all tables from `schema.sql` on first start.

## 5. Start the server

```bash
npm run dev
```

`dev` restarts automatically when you edit files. For a normal run use `npm start`.

You should see:

```
Lost & Found running on http://localhost:3000
```

## 6. Open the app

- **Website:** http://localhost:3000
- **Health check:** http://localhost:3000/api/health, which should return `{"status":"ok"}`

The frontend automatically uses `/api` on the same address, so no extra setup is needed.

**Alternative: VS Code Live Server.** You can open `lost-found-frontend/index.html` with Live Server on port `5500` or `5501`. The frontend then talks to the API at `http://localhost:3000/api`, and those origins are already allowed in `CORS_ORIGIN`. The backend must still be running.

## Quick test with curl

```bash
# Register
curl -X POST localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Asha","email":"asha@college.edu","password":"supersecret1","whatsapp":"919876543210"}'

# Post an item (replace YOUR_TOKEN with the token from the response above)
curl -X POST localhost:3000/api/items -H "Authorization: Bearer YOUR_TOKEN" \
  -F type=found -F title="Blue AirPods case" -F category=Electronics \
  -F location=Library -F date=2026-10-30 -F photos=@case.jpg

# List items
curl "localhost:3000/api/items?type=found&q=airpods"
```

## Troubleshooting

| Message / problem | Fix |
|---|---|
| `Set JWT_SECRET (16+ characters)` | Add a `JWT_SECRET` of 16+ characters to `.env`. |
| `Cannot reach MySQL. Is it running?` | Start MySQL (or `docker compose up -d`) and check `DB_HOST` / `DB_PORT`. |
| `MySQL rejected the login` | `DB_USER` / `DB_PASSWORD` in `.env` don't match your MySQL account. |
| `EADDRINUSE: port 3000` | Another app is using the port. Stop it or change `PORT` (and `PUBLIC_URL`) in `.env`. |
| Browser shows a CORS error | Add your site's exact address (e.g. `http://127.0.0.1:5500`) to `CORS_ORIGIN`, then restart. |
| Photos don't load | Make sure `PUBLIC_URL` matches the address you use for the API, and that `uploads/` exists. |
| `sharp` install errors | Use Node 18+ and re-run `npm install`. |

## Useful commands

```bash
npm run dev            # start with auto-restart
npm start              # start normally
docker compose up -d   # start MySQL in Docker
docker compose down    # stop MySQL (data kept)
```

## Project notes

- Uploaded photos are saved in `uploads/` and re-encoded as JPEG (max 1600 px) with a 480 px thumbnail. GPS data is stripped.
- Contact details (email, WhatsApp) are only returned to signed-in users.
- Limits: 5 photos per post, 5 MB each.
