# Deploying Campus Lost & Found

The backend now serves the website too, so one container = one address for the site and the API.
Locally you can still use Live Server (port 5500) + `npm run dev` (port 3000) as before.

## What you need
1. A server that stays on (a small Linux VPS works well) and a domain name pointing to its IP address.
2. Docker with the Compose plugin installed on that server.

## Steps (VPS + Docker, includes automatic HTTPS)
1. Copy this whole project folder to the server (git or scp). Do NOT copy `lost-found-backend/.env`.
2. In the project root:
   ```
   cp .env.production.example .env
   ```
   Fill in `DOMAIN`, `DB_PASSWORD` and `JWT_SECRET`. Make the last two long and random:
   `openssl rand -hex 32`
3. Point your domain's DNS "A record" to the server's IP. Open ports 80 and 443 in the firewall.
4. Start everything:
   ```
   docker compose -f docker-compose.prod.yml up -d --build
   ```
5. Visit `https://your-domain/api/health`. It should answer `{"status":"ok"}`. Then open `https://your-domain/`.

The database tables (including the WhatsApp column) are created automatically on first start.

## Day-to-day
- Logs: `docker compose -f docker-compose.prod.yml logs -f app`
- Update after code changes: `docker compose -f docker-compose.prod.yml up -d --build`
- Back up the database:
  `docker compose -f docker-compose.prod.yml exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" lost_found' > backup.sql`
- Photos are in the Docker volume `uploads`. Back it up too, or you lose every photo if the server dies.

## Using a hosting platform instead (Render, Railway, etc.)
The included `Dockerfile` builds the app, so any platform that runs Docker images can use it. Three things must be set up:
- **A MySQL database** from the platform (or any managed MySQL). Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_SSL=true` if the provider requires encryption.
- **A persistent disk/volume mounted at `/data/uploads`.** Without it, every photo disappears whenever the app restarts or redeploys.
- Environment variables: `JWT_SECRET` (16+ random characters) and `PUBLIC_URL` (your site's full address, e.g. `https://yoursite.example`).

Free tiers change often, and many free plans put the app to sleep or have no persistent disk. Check the current pricing page of the platform before you pick one.

## Before real students use it
- Generate a NEW `JWT_SECRET` and database password. The ones in your development `.env` should not be reused.
- Never commit `.env` (the included `.gitignore` already excludes it).
- Passwords are hashed, but the site does not verify college emails or WhatsApp numbers. Decide whether you want to restrict sign-up to your college's email domain.
- Students' WhatsApp numbers are personal data. Consider adding a short privacy note on the sign-up form.
